// Shared helpers of the Phase 5 trainers (src/sim/trainer/*). Deterministic: integer ticks, + - * / sqrt, sim.rng.

import type { Sim } from '../sim';
import { nearestWalkable, scalePt } from '../map';
import { canLevelSlot, levelAbility } from '../systems/abilities';
import { CUM_XP, grantXp, MAX_LEVEL } from '../systems/economy';

/** One line of the trainer HUD; the client translates `k` (trainer.stat.<k>) and formats by `fmt`. */
export interface TrainerStat {
  k: string;
  v: number;
  fmt: 'int' | 'pct' | 'sec' | 'dec';
}

/** Trainer state as the client sees it (Snapshot.trainer). */
export interface TrainerHud {
  kind: string;
  /** Seconds of the run so far (frozen when done). */
  time: number;
  /** Run length in seconds, 0 = until the end condition. */
  duration: number;
  done: boolean;
  /** Duels / arena: did the player's team win. */
  won?: boolean;
  /** 0..100 for graded trainers, survived seconds for the dodge trainer. */
  score: number;
  grade: string;
  stats: TrainerStat[];
  /** Szenario-Trainer: scenario id and why it ended (i18n scenario.why.<why>). */
  scenario?: string;
  why?: string;
}

/** Open, walkable area far from towers and camps (blue top corner) used by the dodge and kiting trainers. */
export const ARENA = scalePt({ x: 2000, y: 14000 });

/** Champion eid of the human player (first human slot), -1 if none. */
export function humanEid(sim: Sim): number {
  const p = sim.config.players.find((q) => q.isHuman) ?? sim.config.players[0];
  return p ? (sim.slots[p.slot] ?? -1) : -1;
}

/** Teleport a unit (stop moving/attacking). */
export function place(sim: Sim, eid: number, x: number, y: number): void {
  const { Pos, Move, Atk } = sim.c;
  const p = nearestWalkable(sim.map.nav, x, y);
  Pos.x[eid] = Pos.px[eid] = p.x;
  Pos.y[eid] = Pos.py[eid] = p.y;
  Move.mode[eid] = 0;
  Atk.target[eid] = -1;
  Atk.attackMove[eid] = 0;
  sim.paths.delete(eid);
}

/** Raise a champion to `level` (never lowers). */
export function raiseLevel(sim: Sim, eid: number, level: number): void {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const need = CUM_XP[l]! - sim.c.Champ.xp[eid]!;
  if (need > 0) grantXp(sim, eid, need);
}

/** Spend all skill points: ultimate first, then max Q, W, E in that order. */
export function autoLevel(sim: Sim, eid: number): void {
  for (let guard = 0; guard < 40 && sim.c.Champ.skillPoints[eid]! > 0; guard++) {
    const slot = [3, 0, 1, 2].find((s) => canLevelSlot(sim, eid, s));
    if (slot === undefined) break;
    levelAbility(sim, eid, slot);
  }
}

/** Letter grade for a 0..100 score. */
export function grade(pct: number): string {
  return pct >= 90 ? 'S' : pct >= 75 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'D';
}

/** Random unit vector from two uniform components (rejection sampling, sqrt only). */
export function randomDir(sim: Sim): [number, number] {
  for (let i = 0; i < 16; i++) {
    const x = sim.rng.next() * 2 - 1;
    const y = sim.rng.next() * 2 - 1;
    const l2 = x * x + y * y;
    if (l2 > 0.01 && l2 <= 1) {
      const l = Math.sqrt(l2);
      return [x / l, y / l];
    }
  }
  return [1, 0];
}

export const runSeconds = (sim: Sim, start: number, end: number): number => Math.max(0, ((end >= 0 ? end : sim.tick) - start) / 30);
