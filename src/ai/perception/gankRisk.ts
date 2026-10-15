// Jungler model + GankRisk per lane for the next 20 s (spec-bots §3 "Jungler-Modell", §4.1).
// Inputs by rank (rankModel.junglerInputs): Iron/Bronze nothing; Silver sightings 8-15 s late; Gold + wave state;
// Platinum + timers; Diamond + path prediction (clouds drift along the clear path); Challenger + leash/CS counting.
// Sources: the enemy jungler and enemy laners that are missing from their lane (roams, spec §5.2).

import type { BotParams } from '../contract';
import type { LaneName, MapData, Pt } from '../../sim/map';
import { dst } from '../bot/geo';
import { junglerInputs } from './rankModel';
import { laneLength, lanePos } from './waves';
import { lanePoint } from '../bot/geo';
import type { Cloud } from './clouds';
import type { PosSource, TrackMem, WaveInfo } from './types';

/** First gank timing of a full clear starting at 1:30 (spec §3: gank lane at 3:15). */
export const FIRST_GANK_S = 195;
const SPAWN_S = 90;

export interface JunglerEstimate {
  x: number;
  y: number;
  r: number;
  weight: number;
  src: PosSource;
  /** Tick of the underlying sighting/cue (-1 for timer priors). */
  tick: number;
}

/** Timer prior (Platinum+): where the enemy jungler should be by its standard clear. Null when nothing to say. */
export function junglerPrior(map: MapData, enemyTeam: 0 | 1, timeS: number, start: 'top' | 'bot' | null): JunglerEstimate | null {
  const side = map.sides[enemyTeam];
  const buff = (s: 'top' | 'bot'): Pt => {
    // buff camps: the one nearer to the top lane polyline is the top-side buff
    const buffs = side.camps.filter((c) => c.buff);
    const top = side.lanes.top;
    buffs.sort((a, b) => dstToLane(a, top) - dstToLane(b, top));
    return s === 'top' ? buffs[0]! : buffs[buffs.length - 1]!;
  };
  if (timeS < SPAWN_S - 30 || timeS > FIRST_GANK_S + 40) return null;
  if (timeS <= SPAWN_S + 15) {
    if (!start) return null;
    const b = buff(start);
    return { x: b.x, y: b.y, r: 600, weight: 0.8, src: 'prior', tick: -1 };
  }
  // after the start buff: drifting toward the gank lane on the other side (both sides if the start is unknown)
  if (!start) return null;
  const target = start === 'top' ? 'bot' : 'top';
  const pts = side.lanes[target];
  const gank = lanePoint(pts, laneLength(pts) * 0.5);
  const b = buff(start);
  const f = Math.min(1, (timeS - SPAWN_S) / (FIRST_GANK_S - SPAWN_S));
  return { x: b.x + (gank.x - b.x) * f, y: b.y + (gank.y - b.y) * f, r: 1500 * (1 - f) + 500, weight: 0.6, src: 'prior', tick: -1 };
}

function dstToLane(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (const q of pts) best = Math.min(best, dst(p, q));
  return best;
}

export interface RiskInputs {
  map: MapData;
  team: 0 | 1;
  tick: number;
  params: BotParams;
  tracks: ReadonlyMap<number, TrackMem>;
  clouds: ReadonlyMap<number, Cloud | null>;
  waves: Readonly<Record<LaneName, WaveInfo>>;
  /** Own laner position per lane (null = none alive/known). */
  laners: Readonly<Record<LaneName, { x: number; y: number; hpFrac: number; flashUp: boolean } | null>>;
  /** Enemy jungler slot (lobby knowledge) or -1. */
  junglerSlot: number;
  /** Timer prior for the jungler (Platinum+), null if none. */
  prior: JunglerEstimate | null;
  /** Prior split per side lane when the start side is unknown (first gank window). */
  startKnown: boolean;
  enemyMs: number;
}

const LANE_ROLE: Record<string, LaneName | null> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot', jungle: null };

/** Source position the given rank may use for a track, or null. */
export function riskSource(t: TrackMem, cloud: Cloud | null, p: RiskInputs): { x: number; y: number; r: number; w: number; src: PosSource; tick: number } | null {
  const inp = junglerInputs(p.params);
  if (t.dead) return null;
  if (t.visibleNow && p.tick >= t.usableFrom) return { x: t.lastX, y: t.lastY, r: 0, w: 1, src: 'seen', tick: t.lastTick };
  if (inp.sightDelayS[1] > 0) {
    // Silver: no clouds; the latest sighting, once it "sank in", decays over 20 s
    if (!t.known || p.tick < t.usableFrom) return null;
    const age = (p.tick - t.lastTick) / 30;
    if (age > 20) return null;
    return { x: t.lastX, y: t.lastY, r: p.enemyMs * age * 0.6, w: 1 - age / 20, src: t.visibleNow ? 'seen' : 'cloud', tick: t.lastTick };
  }
  if (cloud && t.anchor) return { ...cloud, w: cloud.weight, src: 'cloud', tick: t.anchor.tick };
  return null;
}

/** GankRisk 0..1 per lane. Iron/Bronze: all 0 (they only react to a jungler in near range, via the escape node). */
export function gankRisk(p: RiskInputs): Record<LaneName, number> {
  const out: Record<LaneName, number> = { top: 0, mid: 0, bot: 0 };
  const inp = junglerInputs(p.params);
  if (!inp.enabled) return out;
  const timeS = p.tick / 30;
  for (const lane of ['top', 'mid', 'bot'] as const) {
    const laner = p.laners[lane];
    const at: Pt = laner ?? lanePoint(p.map.sides[p.team].lanes[lane], laneLength(p.map.sides[p.team].lanes[lane]) * 0.45);
    let safe = 1;
    for (const [slot, t] of p.tracks) {
      const ownLane = LANE_ROLE[t.role];
      // the lane opponent standing in its own lane is not a gank; the jungler and roaming laners are
      if (slot !== p.junglerSlot && (ownLane === lane || !t.role)) continue;
      if (slot !== p.junglerSlot && ownLane) {
        // a laner counts only once it is missing from its own lane (unseen, or seen outside its lane)
        if (t.visibleNow && lanePos(p.map, p.team, ownLane, { x: t.lastX, y: t.lastY }).off < 1200) continue;
      }
      let src = riskSource(t, p.clouds.get(slot) ?? null, p);
      if (!src && slot === p.junglerSlot && inp.timers && p.prior) src = { ...p.prior, w: p.prior.weight };
      let prob = 0;
      if (src) {
        const tt = Math.max(0, dst(src, at) - src.r * 0.5 - 300) / p.enemyMs;
        prob = src.w * Math.max(0, Math.min(1, (20 - tt) / 15));
      } else if (slot === p.junglerSlot && inp.timers && !p.startKnown && lane !== 'mid') {
        // first-gank window without position: both side lanes share the prior
        const win = Math.abs(timeS - FIRST_GANK_S) < 25 ? 1 : 0;
        prob = 0.45 * win;
      }
      safe *= 1 - prob;
    }
    let risk = (1 - safe) * 0.75;
    if (inp.wave) {
      const w = p.waves[lane];
      if (w.visible && w.enemySide) risk *= 1.2;
      if (w.atOwnTower) risk *= 0.6;
    }
    if (risk > 0.1 && laner) {
      if (laner.hpFrac < 0.5) risk += 0.1;
      if (!laner.flashUp) risk += 0.1;
    }
    out[lane] = Math.max(0, Math.min(1, risk));
  }
  return out;
}
