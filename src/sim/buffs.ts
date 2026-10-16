// Generic buffs and crowd control. All state lives in sim.state (several sims may run side by side).
// Convention: pct values are percent points (40 = 40 %); durations are ticks here, seconds in data.
// CC strength: slow < blind < root < stun = airborne < suppression. Tenacity shortens every CC except
// airborne and suppression. Unstoppable / stasis ignore new CC (suppression still lands on unstoppable).

import type { Sim } from './sim';
import { dealDamage, heal } from './damage';
import { cancelRecall } from './systems/economy';
import { MAX_ENT } from './ecs';
import { isStructure } from './types';

export type CcKind = 'slow' | 'blind' | 'root' | 'silence' | 'stun' | 'airborne' | 'suppress' | 'stasis';
export type StatKey =
  | 'as'
  | 'ms'
  | 'ad'
  | 'ap'
  | 'armor'
  | 'mr'
  | 'dmgReduction'
  | 'tenacity'
  | 'invisible'
  | 'untargetable'
  | 'range'
  | 'armorPen'
  | 'projImmune'
  /** Outgoing damage in percent points (Exhaust: -40). Applied by damage.dealDamage. */
  | 'dmgDealt';
export type BuffKind = CcKind | 'stat' | 'shield' | 'unstoppable' | 'dot' | 'grievous' | 'mark';

export interface Buff {
  kind: BuffKind;
  /** Source key: a buff with the same (id, kind, stat, src) refreshes instead of stacking. */
  id: string;
  src: number;
  /** Serial of `src` when applied (eids are recycled; a dead champion keeps its serial, so DoT kills still credit). */
  srcSerial?: number;
  stat?: StatKey;
  pct: number;
  flat: number;
  /** Shield: remaining amount. Dot: damage per period. */
  amount: number;
  start: number;
  until: number;
  /** Dot: ticks between damage instances. */
  period: number;
  dmgType?: 'phys' | 'magic' | 'true';
}

export type BuffInit = Partial<Buff> & { kind: BuffKind; id: string; ticks: number };

interface Entry {
  serial: number;
  list: Buff[];
  /** Untargetable/invulnerable flags this module set (so it only clears what it owns). */
  setUntargetable: boolean;
  setInvulnerable: boolean;
}

interface BuffState {
  ents: Map<number, Entry>;
  reveal: [Int32Array, Int32Array];
  revealSerial: [Int32Array, Int32Array];
}

export function buffState(sim: Sim): BuffState {
  let s = sim.state.buffs as BuffState | undefined;
  if (!s) {
    s = {
      ents: new Map(),
      reveal: [new Int32Array(MAX_ENT), new Int32Array(MAX_ENT)],
      revealSerial: [new Int32Array(MAX_ENT), new Int32Array(MAX_ENT)],
    };
    sim.state.buffs = s;
  }
  return s;
}

function entry(sim: Sim, eid: number, create: boolean): Entry | undefined {
  const s = buffState(sim);
  let e = s.ents.get(eid);
  const serial = sim.c.Unit.serial[eid]!;
  if (e && e.serial !== serial) {
    s.ents.delete(eid); // eid recycled
    e = undefined;
  }
  if (!e && create) {
    e = { serial, list: [], setUntargetable: false, setInvulnerable: false };
    s.ents.set(eid, e);
  }
  return e;
}

export function buffs(sim: Sim, eid: number): readonly Buff[] {
  return entry(sim, eid, false)?.list ?? [];
}

const HARD_CC: ReadonlySet<BuffKind> = new Set(['root', 'stun', 'airborne', 'suppress', 'stasis']);
const CC: ReadonlySet<BuffKind> = new Set(['slow', 'blind', 'root', 'silence', 'stun', 'airborne', 'suppress']);
const NO_TENACITY: ReadonlySet<BuffKind> = new Set(['airborne', 'suppress']);

/** Adds or refreshes a buff. Returns false if the target is immune. */
export function addBuff(sim: Sim, eid: number, init: BuffInit): boolean {
  const { Unit, Stats } = sim.c;
  if (!Unit.alive[eid] || init.ticks <= 0) return false;
  // towers, inhibitors and the nexus are immune to crowd control (and displacement: airborne)
  if ((CC.has(init.kind) || init.kind === 'stasis') && isStructure(Unit.kind[eid]!)) return false;
  const e = entry(sim, eid, true)!;
  if (CC.has(init.kind)) {
    const immune = e.list.some((b) => b.kind === 'stasis' || (b.kind === 'unstoppable' && init.kind !== 'suppress'));
    if (immune) return false;
  }
  let ticks = init.ticks;
  if (CC.has(init.kind) && !NO_TENACITY.has(init.kind)) {
    ticks = Math.max(1, Math.round(ticks * (1 - Math.min(1, Stats.tenacity[eid]!))));
  }
  const b: Buff = {
    kind: init.kind,
    id: init.id,
    src: init.src ?? -1,
    srcSerial: init.src !== undefined && init.src >= 0 ? Unit.serial[init.src]! : 0,
    stat: init.stat,
    pct: init.pct ?? 0,
    flat: init.flat ?? 0,
    amount: init.amount ?? 0,
    start: sim.tick,
    until: sim.tick + ticks,
    period: init.period ?? 0,
    dmgType: init.dmgType,
  };
  const i = e.list.findIndex((o) => o.id === b.id && o.kind === b.kind && o.stat === b.stat && o.src === b.src);
  if (i >= 0) {
    if (b.kind === 'shield') sim.c.Hp.shield[eid] = Math.max(0, sim.c.Hp.shield[eid]! - e.list[i]!.amount);
    e.list[i] = b;
  } else {
    e.list.push(b);
  }
  if (b.kind === 'shield') sim.c.Hp.shield[eid] = sim.c.Hp.shield[eid]! + b.amount;
  if (HARD_CC.has(b.kind)) cancelRecall(sim, eid);
  if (b.kind === 'stat' && b.stat === 'untargetable' && !Unit.untargetable[eid]) {
    Unit.untargetable[eid] = 1;
    e.setUntargetable = true;
  }
  if (b.kind === 'stasis') {
    if (!Unit.untargetable[eid]) (Unit.untargetable[eid] = 1), (e.setUntargetable = true);
    if (!Unit.invulnerable[eid]) (Unit.invulnerable[eid] = 1), (e.setInvulnerable = true);
  }
  return true;
}

export function addShield(sim: Sim, eid: number, amount: number, ticks: number, id: string, src = -1): void {
  addBuff(sim, eid, { kind: 'shield', id, src, amount, ticks });
}

/** Extend an existing buff by `ticks`, but never beyond start + maxTicks. Returns false if absent. */
export function extendBuff(sim: Sim, eid: number, id: string, ticks: number, maxTicks: number): boolean {
  const e = entry(sim, eid, false);
  if (!e) return false;
  let found = false;
  for (const b of e.list) {
    if (b.id !== id || b.until <= sim.tick) continue;
    b.until = Math.min(b.until + ticks, b.start + maxTicks);
    found = true;
  }
  return found;
}

export function removeBuffs(sim: Sim, eid: number, pred: (b: Buff) => boolean): void {
  const e = entry(sim, eid, false);
  if (!e) return;
  for (const b of e.list) if (pred(b)) b.until = sim.tick; // expires (and is cleaned) on the next tickBuffs
}

export function hasBuff(sim: Sim, eid: number, kind: BuffKind, id?: string): boolean {
  const e = entry(sim, eid, false);
  if (!e) return false;
  for (const b of e.list) if (b.kind === kind && b.until > sim.tick && (id === undefined || b.id === id)) return true;
  return false;
}

const active = (sim: Sim, eid: number, kinds: BuffKind[]): boolean => {
  const e = entry(sim, eid, false);
  if (!e) return false;
  const unstoppable = e.list.some((b) => b.kind === 'unstoppable' && b.until > sim.tick);
  for (const b of e.list) {
    if (b.until <= sim.tick || !kinds.includes(b.kind)) continue;
    if (unstoppable && b.kind !== 'suppress' && b.kind !== 'stasis') continue;
    return true;
  }
  return false;
};

export const canMove = (sim: Sim, eid: number): boolean => !active(sim, eid, ['root', 'stun', 'airborne', 'suppress', 'stasis']);
export const canAttack = (sim: Sim, eid: number): boolean => !active(sim, eid, ['stun', 'airborne', 'suppress', 'stasis']);
export const canCast = (sim: Sim, eid: number): boolean => !active(sim, eid, ['silence', 'stun', 'airborne', 'suppress', 'stasis']);
export const isBlind = (sim: Sim, eid: number): boolean => active(sim, eid, ['blind']);
/** Hard CC (root/stun/airborne/suppression/stasis) or silence: interrupts channels. */
export const channelBroken = (sim: Sim, eid: number): boolean => active(sim, eid, ['root', 'stun', 'airborne', 'suppress', 'stasis', 'silence']);

/** Any active stat buff of this stat (flag-like stats: invisible, projImmune, untargetable). */
export function hasStat(sim: Sim, eid: number, stat: StatKey): boolean {
  const e = entry(sim, eid, false);
  if (!e) return false;
  for (const b of e.list) if (b.kind === 'stat' && b.stat === stat && b.until > sim.tick) return true;
  return false;
}

/** 0 none, 1 slow, 2 blind, 3 root, 4 stun/airborne, 5 suppression (for HUD/bots). Silence counts as 2. */
export function ccLevel(sim: Sim, eid: number): number {
  const order: Partial<Record<BuffKind, number>> = { slow: 1, blind: 2, silence: 2, root: 3, stun: 4, airborne: 4, suppress: 5, stasis: 5 };
  let lvl = 0;
  const e = entry(sim, eid, false);
  if (!e) return 0;
  for (const b of e.list) if (b.until > sim.tick) lvl = Math.max(lvl, order[b.kind] ?? 0);
  return lvl;
}

/** SnapEntity.cc bits (render: CC indicators). Mirrors canMove/canCast: an unstoppable unit reports no CC but suppress/stasis. */
export const CC_BIT = { stun: 1, root: 2, slow: 4, silence: 8, airborne: 16, blind: 32, suppress: 64, stasis: 128 } as const;

/** Active CC as CC_BIT mask, strongest slow (pct points) and the last tick any of it lasts (0 = none). */
export function ccState(sim: Sim, eid: number): { mask: number; slow: number; until: number } {
  const e = entry(sim, eid, false);
  if (!e) return { mask: 0, slow: 0, until: 0 };
  const unstoppable = e.list.some((b) => b.kind === 'unstoppable' && b.until > sim.tick);
  let mask = 0;
  let until = 0;
  for (const b of e.list) {
    if (b.until <= sim.tick || !(b.kind in CC_BIT)) continue;
    if (unstoppable && b.kind !== 'suppress' && b.kind !== 'stasis') continue;
    mask |= CC_BIT[b.kind as keyof typeof CC_BIT];
    until = Math.max(until, b.until);
  }
  return { mask, slow: strongestSlow(sim, eid), until };
}

/** Strongest active slow in percent points (LoL: only the strongest slow applies). */
export function strongestSlow(sim: Sim, eid: number): number {
  const e = entry(sim, eid, false);
  if (!e) return 0;
  if (e.list.some((b) => b.kind === 'unstoppable' && b.until > sim.tick)) return 0;
  let s = 0;
  for (const b of e.list) if (b.kind === 'slow' && b.until > sim.tick) s = Math.max(s, b.pct);
  return s;
}

/** Sum of active stat buffs: [pct, flat]. */
export function statMods(sim: Sim, eid: number, stat: StatKey): [number, number] {
  const e = entry(sim, eid, false);
  if (!e) return [0, 0];
  let pct = 0;
  let flat = 0;
  for (const b of e.list) {
    if (b.kind !== 'stat' || b.stat !== stat || b.until <= sim.tick) continue;
    pct += b.pct;
    flat += b.flat;
  }
  return [pct, flat];
}

/** Multiplier on incoming damage from dmgReduction buffs (applied by damage.dealDamage after mitigation). */
export function damageTakenMult(sim: Sim, eid: number): number {
  return Math.max(0.1, 1 - statMods(sim, eid, 'dmgReduction')[0] / 100);
}

/** Multiplier on outgoing damage from dmgDealt buffs (Exhaust). */
export function damageDealtMult(sim: Sim, eid: number): number {
  return Math.max(0, 1 + statMods(sim, eid, 'dmgDealt')[0] / 100);
}

/** Multiplier on healing received (grievous wounds: strongest applies). */
export function healMult(sim: Sim, eid: number): number {
  const e = entry(sim, eid, false);
  if (!e) return 1;
  let g = 0;
  for (const b of e.list) if (b.kind === 'grievous' && b.until > sim.tick) g = Math.max(g, b.pct);
  return 1 - g / 100;
}

/** Healing from abilities/summoners. Grievous wounds apply inside damage.heal (so regen honours them too). */
export function healUnit(sim: Sim, eid: number, amount: number): number {
  return heal(sim, eid, amount);
}

// ------------------------------------------------------------------ reveal (vision.ts reads this)

export function reveal(sim: Sim, team: number, eid: number, ticks: number): void {
  if (team !== 0 && team !== 1) return;
  const s = buffState(sim);
  s.reveal[team][eid] = Math.max(s.revealSerial[team][eid] === sim.c.Unit.serial[eid] ? s.reveal[team][eid]! : 0, sim.tick + ticks);
  s.revealSerial[team][eid] = sim.c.Unit.serial[eid]!;
}

export function isRevealed(sim: Sim, team: number, eid: number): boolean {
  if (team !== 0 && team !== 1) return false;
  const s = sim.state.buffs as BuffState | undefined;
  if (!s) return false;
  return s.reveal[team][eid]! > sim.tick && s.revealSerial[team][eid] === sim.c.Unit.serial[eid];
}

// ------------------------------------------------------------------ per-tick upkeep (called by the stats system)

/** Expire buffs, apply DoTs, reconcile shields with Hp.shield. Dead units lose all buffs. */
export function tickBuffs(sim: Sim): void {
  const { Unit, Hp } = sim.c;
  const s = buffState(sim);
  for (const [eid, e] of [...s.ents]) {
    if (e.serial !== Unit.serial[eid]) {
      s.ents.delete(eid);
      continue;
    }
    if (!Unit.alive[eid]) {
      for (const b of e.list) b.until = sim.tick;
    }
    // shields: damage.ts drains Hp.shield; charge the drain to shields that expire first
    const shields = e.list.filter((b) => b.kind === 'shield').sort((a, b) => a.until - b.until);
    let total = 0;
    for (const b of shields) total += b.amount;
    let drained = total - Hp.shield[eid]!;
    for (const b of shields) {
      if (drained <= 0) break;
      const d = Math.min(drained, b.amount);
      b.amount -= d;
      drained -= d;
    }
    // DoTs (first instance one period after application)
    for (const b of e.list) {
      if (b.kind !== 'dot' || b.period <= 0 || b.until < sim.tick) continue;
      const age = sim.tick - b.start;
      if (age > 0 && age % b.period === 0 && Unit.alive[eid]) {
        // the source keeps the credit after its own death (Ignite kill), but not once its eid is a different unit
        const src = b.src >= 0 && Unit.serial[b.src] === b.srcSerial ? b.src : -1;
        dealDamage(sim, src, eid, b.amount, b.dmgType ?? 'true');
      }
    }
    // expire
    const keep: Buff[] = [];
    for (const b of e.list) {
      if (b.until > sim.tick && !(b.kind === 'shield' && b.amount <= 0)) keep.push(b);
      else if (b.kind === 'shield') Hp.shield[eid] = Math.max(0, Hp.shield[eid]! - b.amount);
    }
    e.list = keep;
    if (e.setUntargetable && !keep.some((b) => b.kind === 'stasis' || (b.kind === 'stat' && b.stat === 'untargetable'))) {
      Unit.untargetable[eid] = 0;
      e.setUntargetable = false;
    }
    if (e.setInvulnerable && !keep.some((b) => b.kind === 'stasis')) {
      Unit.invulnerable[eid] = 0;
      e.setInvulnerable = false;
    }
    if (keep.length === 0 && !e.setUntargetable && !e.setInvulnerable) s.ents.delete(eid);
  }
}
