// Fluid movement pass (user 2026-11-04: "die Bots spielen zu steif, viel zu viel Stehen"). Runs after the decisions of a
// tick for every bot, both brains. Two LoL habits the brains did not have:
//  1. Orbwalk shuffle: after an auto fires (backswing), step a little (sideways / kite back vs champions) and re-issue
//     the same attack just before the attack timer is ready again - the auto timer is not lost (sim: a move during the
//     backswing only cancels the animation).
//  2. Idle strafe: a bot that stands without an order or attack target does small steps around the spot it stopped at,
//     biased toward its own side, instead of freezing.
// Reads only the bot's own unit and the target it is already attacking (visible to it) - no fog leak. Numbers and rank
// curves in src/data/bots/values.json "fluid". Any order the brain or the reflex issued this tick wins (pass skips).
import type { Sim } from '../sim/sim';
import type { Command } from '../sim/types';
import { Kind } from '../sim/types';
import { isBusy } from '../sim/systems/abilities';
import { canMove } from '../sim/buffs';
import type { Rng } from '../sim/rng';
import { VALUES, rankCurve } from './utility/values';

const F = VALUES.fluid;

export interface FluidState {
  /** Re-attack this target (eid + serial) at tick `at` after an orbwalk step. */
  reTarget: number;
  reSerial: number;
  reAt: number;
  /** Side of the next shuffle step (alternates). */
  side: number;
  /** Idle anchor (where the bot stopped) and when the bot stood still since. */
  ax: number;
  ay: number;
  stillSince: number;
  nextStrafe: number;
  lastAtkStart: number;
  /** The last move came from the idle strafe (keep the anchor, short pause on arrival). */
  strafing: boolean;
}

export const newFluid = (): FluidState => ({ reTarget: -1, reSerial: 0, reAt: 0, side: 1, ax: NaN, ay: NaN, stillSince: -1, nextStrafe: 0, lastAtkStart: -1, strafing: false });

/** `orbwalk` false: the reflex layer (new brain) schedules its own autos and orbwalk steps - only the idle strafe runs. */
export function fluidPass(sim: Sim, eid: number, team: number, skill: number, st: FluidState, rng: Rng, ordered: boolean, orbwalk = true): Command | null {
  const { Unit, Pos, Atk, Move, Champ, Stats } = sim.c;
  if (!Unit.alive[eid] || Champ.recallAt[eid]! > 0) return reset(st);
  if (ordered) {
    // the brain gave a new order this tick: forget the pending re-attack and the idle anchor
    st.reTarget = -1;
    st.stillSince = -1;
    st.strafing = false;
    return null;
  }
  if (isBusy(sim, eid) || !canMove(sim, eid)) return null;
  const t = sim.tick;
  // pending re-attack after an orbwalk step
  if (st.reTarget >= 0) {
    const tg = st.reTarget;
    if (!Unit.alive[tg] || Unit.serial[tg] !== st.reSerial) {
      st.reTarget = -1;
      return null;
    }
    if (t >= st.reAt) {
      st.reTarget = -1;
      return { t: 'attack', target: tg };
    }
    return null;
  }
  // 1. orbwalk shuffle: auto just fired (backswing), enough time to the next auto
  const tg = Atk.target[eid]!;
  if (orbwalk && Atk.phase[eid] === 2 && tg >= 0 && Unit.alive[tg] && st.lastAtkStart !== Atk.phaseEnd[eid] && !isStructureKind(Unit.kind[tg]!)) {
    st.lastAtkStart = Atk.phaseEnd[eid]!;
    const left = Atk.nextReady[eid]! - t;
    if (left >= F.minGapTicks && rng.chance(rankCurve(F.shufflePct, skill) / 100)) {
      const champ = Unit.kind[tg] === Kind.Champion;
      const range = Stats.range[eid]! + Unit.radius[eid]! + Unit.radius[tg]!;
      let dx = Pos.x[eid]! - Pos.x[tg]!;
      let dy = Pos.y[eid]! - Pos.y[tg]!;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const step = rankCurve(F.shuffleStep, skill) * (0.7 + 0.6 * rng.next());
      st.side = -st.side;
      // ranged vs champion: kite back while it stays in range; otherwise a sideways arc around the target
      const back = champ && Stats.range[eid]! > 300 && d + step * 0.7 < range - F.rangeMargin ? 0.7 : 0;
      const side = Math.sqrt(1 - back * back);
      let x = Pos.x[eid]! + (dx * back - dy * side * st.side) * step;
      let y = Pos.y[eid]! + (dy * back + dx * side * st.side) * step;
      // keep it in range of the target (melee arcs around, ranged never steps out)
      const nd = Math.hypot(x - Pos.x[tg]!, y - Pos.y[tg]!);
      if (nd > range - F.rangeMargin) {
        const k = (range - F.rangeMargin) / nd;
        x = Pos.x[tg]! + (x - Pos.x[tg]!) * k;
        y = Pos.y[tg]! + (y - Pos.y[tg]!) * k;
      }
      st.reTarget = tg;
      st.reSerial = Unit.serial[tg]!;
      st.reAt = Atk.nextReady[eid]! - F.reattackLeadTicks;
      return { t: 'move', x, y };
    }
    return null;
  }
  // 2. idle strafe: standing with no order and no target
  const idle = Move.mode[eid] === 0 && tg < 0 && Atk.phase[eid] === 0;
  if (!idle) {
    st.stillSince = -1;
    if (Move.mode[eid] === 0 || tg >= 0) st.strafing = false; // something else took over
    return null;
  }
  const f = sim.map.sides[team === 1 ? 1 : 0].fountain;
  if ((Pos.x[eid]! - f.x) ** 2 + (Pos.y[eid]! - f.y) ** 2 < f.r * f.r) return null; // shopping in the fountain
  if (st.stillSince < 0) {
    st.stillSince = t;
    if (st.strafing) st.nextStrafe = t + Math.round(rankCurve(F.strafePauseTicks, skill) * (0.5 + rng.next()));
    else {
      st.ax = Pos.x[eid]!;
      st.ay = Pos.y[eid]!;
      st.nextStrafe = t + Math.round(rankCurve(F.idleDelayTicks, skill) * (0.6 + 0.8 * rng.next()));
    }
    return null;
  }
  if (t < st.nextStrafe) return null;
  st.strafing = true;
  let bx = f.x - st.ax;
  let by = f.y - st.ay;
  const bl = Math.hypot(bx, by) || 1;
  bx /= bl;
  by /= bl;
  let ox = rng.next() * 2 - 1;
  let oy = rng.next() * 2 - 1;
  const ol = Math.hypot(ox, oy) || 1; // ponytail: no trig in bot code (determinism across engines)
  ox /= ol;
  oy /= ol;
  // never step toward the enemy side more than a little: reflect the forward component
  const fwd = -(ox * bx + oy * by);
  if (fwd > 0.3) {
    ox += bx * fwd * 2;
    oy += by * fwd * 2;
  }
  const r = F.strafeRadius * (0.5 + 0.5 * rng.next());
  return { t: 'move', x: st.ax + ox * r, y: st.ay + oy * r };
}

function reset(st: FluidState): null {
  st.strafing = false;
  st.reTarget = -1;
  st.stillSince = -1;
  return null;
}

const isStructureKind = (k: number): boolean => k === Kind.Tower || k === Kind.Nexus || k === Kind.Inhibitor;
