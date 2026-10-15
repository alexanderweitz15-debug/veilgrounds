// Probability clouds after sight loss (spec-bots §3): centre drifts along the last direction toward a plausible
// target (camp, lane, recall path), radius grows with speed x time, weight decays. Horizon by rank (rankModel).
// Challenger corrections: camp kills seen and scoreboard CS (laner gaining CS = in lane; jungler = clearing).

import type { BotParams } from '../contract';
import type { LaneName, MapData, Pt } from '../../sim/map';
import { dst } from '../bot/geo';
import { cloudHorizonS, junglerInputs } from './rankModel';
import { laneLength } from './waves';
import { lanePoint } from '../bot/geo';
import type { TrackMem } from './types';

export type Cloud = { x: number; y: number; r: number; weight: number };

const LANE_OF_ROLE: Record<string, LaneName | null> = { top: 'top', mid: 'mid', adc: 'bot', support: 'bot', jungle: null };

export interface CloudEnv {
  map: MapData;
  /** Enemy team id (the track's team). */
  enemyTeam: 0 | 1;
  /** Enemy speed estimate (units/s). */
  ms: number;
  /** Camp ids the bot knows were cleared recently (enemy side), team-qualified "1:dornenbock". */
  campKilled: ReadonlyMap<string, number>;
}

/** Plausible destinations for an unseen enemy of this role (enemy-team frame). */
export function plausibleTargets(env: CloudEnv, role: string, tick: number): Pt[] {
  const side = env.map.sides[env.enemyTeam];
  const out: Pt[] = [{ x: side.fountain.x, y: side.fountain.y }];
  const lanePt = (l: LaneName, t: number): Pt => {
    const pts = side.lanes[l];
    return lanePoint(pts, laneLength(pts) * t);
  };
  if (role === 'jungle') {
    for (const c of side.camps) {
      const k = `${env.enemyTeam}:${c.id}`;
      const killed = env.campKilled.get(k);
      if (killed !== undefined && tick - killed < 135 * 30) continue; // still respawning
      out.push({ x: c.x, y: c.y });
    }
    for (const l of ['top', 'mid', 'bot'] as const) out.push(lanePt(l, 0.48));
  } else {
    const own = LANE_OF_ROLE[role];
    if (own) out.push(lanePt(own, 0.47));
    if (role === 'mid' || role === 'support') for (const l of ['top', 'mid', 'bot'] as const) if (l !== own) out.push(lanePt(l, 0.5));
  }
  return out;
}

/** Cloud for an unseen track, or null (seen now / rank keeps no clouds / horizon passed / never seen). */
export function cloudOf(t: TrackMem, tick: number, params: BotParams, env: CloudEnv): Cloud | null {
  if (t.visibleNow || !t.anchor) return null;
  const horizon = cloudHorizonS(params);
  if (horizon <= 0) return null;
  const age = Math.max(0, (tick - t.anchor.tick) / 30);
  if (age > horizon) return null;
  const a = t.anchor;
  if (t.dead) {
    const f = env.map.sides[env.enemyTeam].fountain;
    return { x: f.x, y: f.y, r: f.r, weight: 1 };
  }
  const inputs = junglerInputs(params);
  let targets = plausibleTargets(env, t.role, tick);
  // Challenger: CS counting. A laner who gained CS while unseen is farming its lane; a jungler is on its camps.
  if (inputs.csCounting && t.cs > t.csAtLastSeen) {
    const lane = LANE_OF_ROLE[t.role];
    if (lane) targets = [targets[1] ?? targets[0]!];
    else if (t.role === 'jungle') targets = targets.slice(1, 1 + env.map.sides[env.enemyTeam].camps.length).filter(Boolean);
    if (!targets.length) targets = plausibleTargets(env, t.role, tick);
  }
  // pick the target best aligned with the last direction (nearest if direction unknown)
  let best = targets[0]!;
  let bestScore = -Infinity;
  const hasDir = t.dirX !== 0 || t.dirY !== 0;
  for (const p of targets) {
    const d = dst(a, p);
    if (d < 1) continue;
    const cos = ((p.x - a.x) * t.dirX + (p.y - a.y) * t.dirY) / d;
    const score = (hasDir ? cos : 0) - d / 8000;
    if (score > bestScore) (bestScore = score), (best = p);
  }
  const d = dst(a, best);
  const travel = Math.min(d, env.ms * age * 0.8);
  const ux = d > 0 ? (best.x - a.x) / d : 0;
  const uy = d > 0 ? (best.y - a.y) / d : 0;
  const weight = Number.isFinite(horizon) ? Math.max(0.05, 1 - age / horizon) : 1 / (1 + age / 60);
  return { x: a.x + ux * travel, y: a.y + uy * travel, r: Math.min(4000, 150 + env.ms * age * 0.5), weight };
}
