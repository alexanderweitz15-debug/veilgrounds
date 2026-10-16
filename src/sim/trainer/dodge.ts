// Dodge trainer: the player stands in an open arena, the sim fires line skillshots (normal kind-1 projectiles, so the
// client draws the usual in-flight telegraph strip) and drops delayed circle zones (`zone` events, the usual ground
// telegraph) at an increasing rate. Higher difficulty: faster shots, shorter zone delay, aim leads the player's
// movement, double shots. The run ends after `lives` hits; the score is the survived time.
// Deterministic: positions from sim.rng and + - * / sqrt only.

import type { Sim } from '../sim';
import { Team, sec } from '../types';
import { spawnProjectile } from '../systems/projectiles';
import { ARENA, humanEid, place, randomDir, runSeconds, type TrainerHud } from './common';
import { scenarioShotHit } from './scenarios';

/** Projectile payload of trainer shots (src/sim/systems/projectiles.ts dispatches hits to trainerShotHit). */
export interface TrainerPayload {
  t: 'trainer';
  flags: string[];
  hit: number[];
}

export interface DodgeState {
  start: number;
  end: number;
  difficulty: 1 | 2 | 3;
  lives: number;
  hits: number;
  shots: number;
  zonesFired: number;
  next: number;
  /** Pending circle zones: centre, radius, resolve tick. */
  zones: { x: number; y: number; r: number; at: number }[];
  /** Optional time limit (ticks, 0 = endless). */
  limit: number;
}

const D = {
  // per difficulty 1..3 (index 0..2)
  interval: [48, 38, 28], // ticks between spawns at the start
  minInterval: [16, 11, 7],
  ramp: [0.25, 0.32, 0.4], // interval shrink per second
  speed: [950, 1250, 1550],
  zoneDelay: [27, 22, 17],
  lead: [0, 0.55, 0.9],
} as const;
const SPAWN_R = 1000;
const SHOT_WIDTH = 120;
const ZONE_R = 230;
const GRACE = sec(3);

export function initDodge(sim: Sim): DodgeState {
  const o = sim.config.trainer ?? {};
  const me = humanEid(sim);
  if (me >= 0) place(sim, me, ARENA.x, ARENA.y);
  return {
    start: sim.tick + GRACE,
    end: -1,
    difficulty: o.difficulty ?? 2,
    lives: Math.max(1, o.lives ?? 5),
    hits: 0,
    shots: 0,
    zonesFired: 0,
    next: sim.tick + GRACE,
    zones: [],
    limit: o.durationSec ? sec(o.durationSec) : 0,
  };
}

const dodgeState = (sim: Sim): DodgeState | undefined => (sim.state.trainer as { dodge?: DodgeState } | undefined)?.dodge;

/** A trainer projectile hit unit `t`. */
export function trainerShotHit(sim: Sim, t: number): void {
  const s = dodgeState(sim);
  if (s && t === humanEid(sim)) registerHit(sim, s, t);
  else if (!s) scenarioShotHit(sim, t);
}

function registerHit(sim: Sim, s: DodgeState, me: number): void {
  if (s.end >= 0 || sim.tick < s.start) return;
  s.hits++;
  const { Hp } = sim.c;
  sim.events.push({ e: 'damage', src: -1, dst: me, amount: Hp.max[me]! / s.lives, type: 'true' });
  if (s.hits >= s.lives) s.end = sim.tick;
}

/** Interval between spawns (ticks) at run time `t` seconds. */
export function dodgeInterval(difficulty: 1 | 2 | 3, t: number): number {
  const i = difficulty - 1;
  return Math.max(D.minInterval[i]!, Math.round(D.interval[i]! - D.ramp[i]! * t));
}

function fireShot(sim: Sim, s: DodgeState, me: number, t: number): void {
  const { Pos } = sim.c;
  const i = s.difficulty - 1;
  const px = Pos.x[me]!;
  const py = Pos.y[me]!;
  const [ux, uy] = randomDir(sim);
  const ox = px + ux * SPAWN_R;
  const oy = py + uy * SPAWN_R;
  const speed = D.speed[i]! + 3 * t;
  // lead: player velocity (this tick's movement) times flight ticks, scaled by difficulty and a random factor
  const flight = SPAWN_R / (speed / 30);
  const lead = D.lead[i]! * sim.rng.next() * flight;
  const tx = px + (Pos.x[me]! - Pos.px[me]!) * lead;
  const ty = py + (Pos.y[me]! - Pos.py[me]!) * lead;
  let dx = tx - ox;
  let dy = ty - oy;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= l;
  dy /= l;
  const payload: TrainerPayload = { t: 'trainer', flags: [], hit: [] };
  spawnProjectile(sim, { kind: 1, src: -1, team: Team.Red, x: ox, y: oy, dx, dy, speed, width: SHOT_WIDTH, maxDist: SPAWN_R * 2, payload });
  s.shots++;
}

function dropZone(sim: Sim, s: DodgeState, me: number): void {
  const { Pos } = sim.c;
  const i = s.difficulty - 1;
  const delay = D.zoneDelay[i]!;
  const lead = D.lead[i]! * sim.rng.next() * delay;
  const x = Pos.x[me]! + (Pos.x[me]! - Pos.px[me]!) * lead;
  const y = Pos.y[me]! + (Pos.y[me]! - Pos.py[me]!) * lead;
  s.zones.push({ x, y, r: ZONE_R, at: sim.tick + delay });
  sim.events.push({ e: 'zone', src: -1, team: Team.Red, x, y, r: ZONE_R, start: sim.tick, at: sim.tick + delay });
  s.zonesFired++;
}

export function updateDodge(sim: Sim, s: DodgeState): void {
  const me = humanEid(sim);
  if (me < 0) return;
  const { Pos, Hp, Unit } = sim.c;
  // resolve zones (also after the run ended, so a last zone still lands visibly but does not count)
  for (let k = s.zones.length - 1; k >= 0; k--) {
    const z = s.zones[k]!;
    if (z.at > sim.tick) continue;
    s.zones.splice(k, 1);
    const dx = Pos.x[me]! - z.x;
    const dy = Pos.y[me]! - z.y;
    const r = z.r + Unit.radius[me]!;
    if (Unit.alive[me] && !Unit.untargetable[me] && dx * dx + dy * dy <= r * r) registerHit(sim, s, me);
  }
  if (s.end >= 0) {
    Hp.cur[me] = Hp.max[me]!;
    return;
  }
  // HP bar shows the lives left; the player cannot die in this trainer
  Hp.cur[me] = Math.max(1, (Hp.max[me]! * (s.lives - s.hits)) / s.lives);
  if (s.limit > 0 && sim.tick - s.start >= s.limit) {
    s.end = sim.tick;
    return;
  }
  if (sim.tick < s.next) return;
  const t = (sim.tick - s.start) / 30;
  const zoneChance = t < 8 ? 0 : s.difficulty === 1 ? 0.25 : 0.35;
  if (sim.rng.next() < zoneChance) dropZone(sim, s, me);
  else {
    fireShot(sim, s, me, t);
    if (s.difficulty === 3 && t > 20 && sim.rng.next() < 0.3) fireShot(sim, s, me, t); // double shot
  }
  s.next = sim.tick + dodgeInterval(s.difficulty, t);
}

/** Survival time in seconds that earns grade S per difficulty (A 2/3, B 1/2, C 1/4 of it). */
const S_TIME = [120, 90, 75];

export function dodgeHud(sim: Sim, s: DodgeState): TrainerHud {
  const t = runSeconds(sim, s.start, s.end);
  const sTime = S_TIME[s.difficulty - 1]!;
  const g = t >= sTime ? 'S' : t >= (sTime * 2) / 3 ? 'A' : t >= sTime / 2 ? 'B' : t >= sTime / 4 ? 'C' : 'D';
  const fired = s.shots + s.zonesFired;
  return {
    kind: 'dodge',
    time: t,
    duration: s.limit / 30,
    done: s.end >= 0,
    score: Math.round(t * 10) / 10,
    grade: g,
    stats: [
      { k: 'survived', v: t, fmt: 'sec' },
      { k: 'hits', v: s.hits, fmt: 'int' },
      { k: 'livesLeft', v: Math.max(0, s.lives - s.hits), fmt: 'int' },
      { k: 'dodged', v: Math.max(0, fired - s.hits), fmt: 'int' },
      { k: 'difficulty', v: s.difficulty, fmt: 'int' },
      { k: 'rate', v: 30 / dodgeInterval(s.difficulty, t), fmt: 'dec' },
    ],
  };
}
