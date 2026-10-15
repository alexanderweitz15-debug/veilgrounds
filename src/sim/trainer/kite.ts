// Kiting / combo trainer: a practice dummy that stands, strafes between random arena points or chases the player.
// Measures auto-attack uptime (autos fired at the dummy vs attack speed x active time), DPS vs theoretical auto DPS,
// chase contacts, and combo execution time: from the first ability cast until every learned ability (Q W E R) was
// cast, gaps over COMBO_GAP restart the combo. A finished combo refreshes cooldowns and mana for the next attempt.

import type { Sim } from '../sim';
import { Team, sec } from '../types';
import { spawnDummy } from '../systems/champions';
import { moveTo } from '../systems/input';
import { champAbil, refreshCooldowns } from '../systems/abilities';
import { dealDamage } from '../damage';
import { isRef } from '../sim';
import { ARENA, autoLevel, grade, humanEid, place, raiseLevel, randomDir, runSeconds, type TrainerHud } from './common';

export interface KiteState {
  start: number;
  end: number;
  duration: number;
  behaviour: 'stand' | 'strafe' | 'chase';
  dummy: number;
  dummySerial: number;
  /** Tick of the first auto at the dummy (-1 = not started; uptime is measured from here). */
  active: number;
  attacks: number;
  /** Sum over fired autos of (1 / attack speed) seconds = time the autos "used". */
  attackTime: number;
  damage: number;
  touches: number;
  lastTouch: number;
  nextMove: number;
  /** Player's last non-zero move speed (Stats.ms is 0 during wind-ups/roots; the chaser must not slow down then). */
  playerMs: number;
  combo: { start: number; last: number; mask: number };
  combos: number;
  comboLast: number;
  comboBest: number;
}

export const KITE_DEFAULT_SEC = 120;
const COMBO_GAP = sec(4);
const STRAFE_MS = 300;
const TOUCH_GAP = sec(1);

export function initKite(sim: Sim): KiteState {
  const o = sim.config.trainer ?? {};
  const me = humanEid(sim);
  if (me >= 0) {
    place(sim, me, ARENA.x - 350, ARENA.y);
    raiseLevel(sim, me, o.level ?? 6);
    autoLevel(sim, me);
  }
  const dummy = spawnDummy(sim, ARENA.x + 350, ARENA.y, Team.Red);
  return {
    start: sim.tick,
    end: -1,
    duration: sec(o.durationSec ?? KITE_DEFAULT_SEC),
    behaviour: o.dummy ?? 'strafe',
    dummy,
    dummySerial: sim.c.Unit.serial[dummy]!,
    active: -1,
    attacks: 0,
    attackTime: 0,
    damage: 0,
    touches: 0,
    lastTouch: -1e9,
    nextMove: sim.tick,
    playerMs: 0,
    combo: { start: -1, last: -1, mask: 0 },
    combos: 0,
    comboLast: 0,
    comboBest: 0,
  };
}

function moveDummy(sim: Sim, s: KiteState, me: number): void {
  const { Pos, Stats, Unit } = sim.c;
  const d = s.dummy;
  if (s.behaviour === 'stand') return;
  if (s.behaviour === 'strafe') {
    Stats.ms[d] = STRAFE_MS;
    const arrived = sim.c.Move.mode[d] === 0;
    if (arrived || sim.tick >= s.nextMove) {
      const [ux, uy] = randomDir(sim);
      const r = 250 + sim.rng.next() * 400;
      moveTo(sim, d, ARENA.x + ux * r, ARENA.y + uy * r);
      s.nextMove = sim.tick + sec(2.5);
    }
    return;
  }
  // chase: a bit slower than the player, re-paths every 6 ticks, contact = a "hit" (true damage, never lethal)
  if (Stats.ms[me]! > 0) s.playerMs = Stats.ms[me]!;
  Stats.ms[d] = Math.max(200, s.playerMs - 35);
  if (sim.tick >= s.nextMove) {
    moveTo(sim, d, Pos.x[me]!, Pos.y[me]!);
    s.nextMove = sim.tick + 6;
  }
  const dx = Pos.x[me]! - Pos.x[d]!;
  const dy = Pos.y[me]! - Pos.y[d]!;
  const reach = Unit.radius[me]! + Unit.radius[d]! + 40;
  if (Unit.alive[me] && dx * dx + dy * dy <= reach * reach && sim.tick - s.lastTouch >= TOUCH_GAP) {
    s.touches++;
    s.lastTouch = sim.tick;
    const amount = Math.min(sim.c.Hp.max[me]! * 0.04, sim.c.Hp.cur[me]! - 1);
    if (amount > 0) dealDamage(sim, d, me, amount, 'true');
  }
}

export function updateKite(sim: Sim, s: KiteState): void {
  const me = humanEid(sim);
  if (me < 0 || s.end >= 0) return;
  if (!isRef(sim, s.dummy, s.dummySerial)) {
    s.end = sim.tick;
    return;
  }
  const { Stats } = sim.c;
  for (const ev of sim.events) {
    if (ev.e === 'attack' && ev.src === me && ev.dst === s.dummy) {
      if (s.active < 0) s.active = sim.tick;
      s.attacks++;
      s.attackTime += 1 / Math.max(0.1, Stats.as[me]!);
    } else if (ev.e === 'damage' && ev.src === me && ev.dst === s.dummy) s.damage += ev.amount;
    else if (ev.e === 'cast' && ev.src === me && !ev.recast && ev.slot >= 0 && ev.slot <= 3) noteCast(sim, s, me, ev.slot);
  }
  if (s.combo.start >= 0 && sim.tick - s.combo.last > COMBO_GAP) s.combo = { start: -1, last: -1, mask: 0 };
  moveDummy(sim, s, me);
  if (sim.tick - s.start >= s.duration) s.end = sim.tick;
}

/** Bit mask of the abilities the champion has learned. */
function learnedMask(sim: Sim, me: number): number {
  const r = champAbil(sim, me).ranks;
  let m = 0;
  for (let i = 0; i < 4; i++) if (r[i]! > 0) m |= 1 << i;
  return m;
}

function noteCast(sim: Sim, s: KiteState, me: number, slot: number): void {
  if (s.combo.start < 0) s.combo = { start: sim.tick, last: sim.tick, mask: 0 };
  s.combo.mask |= 1 << slot;
  s.combo.last = sim.tick;
  const need = learnedMask(sim, me);
  if (need === 0 || (s.combo.mask & need) !== need || need === 1 << slot) return;
  const t = (sim.tick - s.combo.start) / 30;
  s.combos++;
  s.comboLast = t;
  s.comboBest = s.comboBest > 0 ? Math.min(s.comboBest, t) : t;
  s.combo = { start: -1, last: -1, mask: 0 };
  refreshCooldowns(sim, me);
  sim.c.Mana.cur[me] = sim.c.Mana.max[me]!;
}

export function kiteHud(sim: Sim, s: KiteState): TrainerHud {
  const me = humanEid(sim);
  const t = runSeconds(sim, s.start, s.end);
  const activeSec = s.active >= 0 ? Math.max(1 / 30, ((s.end >= 0 ? s.end : sim.tick) - s.active) / 30) : 0;
  const uptime = activeSec > 0 ? Math.min(100, (s.attackTime / activeSec) * 100) : 0;
  const { Stats } = sim.c;
  const theo = me >= 0 ? Stats.ad[me]! * Stats.as[me]! * (1 + Stats.crit[me]! * 0.75) : 0;
  const dps = activeSec > 0 ? s.damage / activeSec : 0;
  const score = Math.max(0, Math.round(uptime - 2 * s.touches));
  return {
    kind: 'kite',
    time: t,
    duration: s.duration / 30,
    done: s.end >= 0,
    score,
    grade: grade(score),
    stats: [
      { k: 'uptime', v: uptime, fmt: 'pct' },
      { k: 'dps', v: dps, fmt: 'int' },
      { k: 'theoDps', v: theo, fmt: 'int' },
      { k: 'autos', v: s.attacks, fmt: 'int' },
      ...(s.behaviour === 'chase' ? [{ k: 'touches', v: s.touches, fmt: 'int' as const }] : []),
      { k: 'combos', v: s.combos, fmt: 'int' },
      { k: 'comboLast', v: s.comboLast, fmt: 'dec' },
      { k: 'comboBest', v: s.comboBest, fmt: 'dec' },
    ],
  };
}
