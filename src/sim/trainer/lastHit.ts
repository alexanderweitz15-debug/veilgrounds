// Last-hit trainer: one lane (mid), no enemy champion. Counts CS, missed CS (enemy minions that died without the
// player's last hit), minion gold and gold per minute; ends after `durationSec`. Tower mode: only enemy waves spawn
// and push into the player's outer tower (structures invulnerable), so last hits have to be weaved between tower shots.

import type { Sim } from '../sim';
import { isMinion, sec } from '../types';
import { scheduleNextWave } from '../systems/waves';
import { grade, humanEid, place, runSeconds, type TrainerHud } from './common';

export interface LastHitState {
  start: number;
  end: number;
  duration: number;
  cs: number;
  missed: number;
  csGold: number;
  goldAtStart: number;
}

export const LAST_HIT_DEFAULT_SEC = 300;

export function initLastHit(sim: Sim): LastHitState {
  const me = humanEid(sim);
  const o = sim.config.trainer ?? {};
  if (o.tower) sim.flags.towersInvulnerable = true;
  // at (normal) / behind (tower mode) the own mid outer tower (map data, moved with the lane-length change)
  const tw = sim.map.sides[0].towers.mid[0]!;
  const back = o.tower ? 600 : 100;
  if (me >= 0) place(sim, me, tw.x - back, tw.y - back);
  scheduleNextWave(sim, sec(2)); // no 65 s wait for the first wave
  return { start: sim.tick, end: -1, duration: sec(o.durationSec ?? LAST_HIT_DEFAULT_SEC), cs: 0, missed: 0, csGold: 0, goldAtStart: me >= 0 ? sim.c.Champ.totalGold[me]! : 0 };
}

export function updateLastHit(sim: Sim, s: LastHitState): void {
  if (s.end >= 0) return;
  const me = humanEid(sim);
  const { Unit } = sim.c;
  const myTeam = me >= 0 ? Unit.team[me]! : 0;
  for (const ev of sim.events) {
    if (ev.e === 'death' && isMinion(ev.kind) && ev.team !== myTeam) {
      if (ev.killer === me) s.cs++;
      else s.missed++;
    } else if (ev.e === 'gold' && ev.eid === me) s.csGold += ev.amount;
  }
  if (sim.tick - s.start >= s.duration) s.end = sim.tick;
}

export function lastHitScore(s: LastHitState): number {
  const total = s.cs + s.missed;
  return total > 0 ? Math.round((s.cs / total) * 100) : 0;
}

export function lastHitHud(sim: Sim, s: LastHitState): TrainerHud {
  const t = runSeconds(sim, s.start, s.end);
  const me = humanEid(sim);
  const gold = me >= 0 ? sim.c.Champ.totalGold[me]! - s.goldAtStart : 0;
  const min = Math.max(t, 1) / 60;
  const score = lastHitScore(s);
  return {
    kind: 'lastHit',
    time: t,
    duration: s.duration / 30,
    done: s.end >= 0,
    score,
    grade: grade(score),
    stats: [
      { k: 'cs', v: s.cs, fmt: 'int' },
      { k: 'missed', v: s.missed, fmt: 'int' },
      { k: 'accuracy', v: score, fmt: 'pct' },
      { k: 'csPerMin', v: s.cs / min, fmt: 'dec' },
      { k: 'csGold', v: s.csGold, fmt: 'int' },
      { k: 'gpm', v: gold / min, fmt: 'int' },
    ],
  };
}
