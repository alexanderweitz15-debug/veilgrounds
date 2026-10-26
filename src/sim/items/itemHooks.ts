// Item passives, actives and consumables (Phase 2, Agent I). Hook ids come from items.json (passive.hook,
// active.hook). Passives are plain PassiveHook objects: champions/index.ts passiveHooksOf appends the owner's item
// and rune hooks (extraHooksOf) to the champion's own passives, so every engine event (damage, autos, ability hits,
// kills, stats, heals) reaches them without further engine edits. Per-tick work runs from the abilities system
// (tickItemsAndRunes). Numbers the spec leaves open are documented in docs/DECISIONS.md ("Items + Prägungen").
// All state lives in sim.state.items keyed by champion eid (champion eids are never recycled).

import type { Sim } from '../sim';
import type { PassiveHook } from '../champions/hooks';
import { Kind, isMinion, isStructure, sec } from '../types';
import { championData, champIdOf, passiveHooksOf } from '../champions';
import { addBuff, addShield, buffs, canAttack } from '../buffs';
import { dealDamage, heal, lastCombatTick } from '../damage';
import { reward } from '../systems/economy';
import { alliedChampionsIn, enemiesInRadius, nearestAlly } from '../systems/abilities';
import { ITEM_SLOTS, inventory, itemById, itemStats } from './inventory';
import { runeHooksOf } from './runeHooks';
import { placeSealWard } from '../wards';

/** Hook with per-tick upkeep (called for every champion, alive or dead, while the item/rune is owned). */
export interface ItemHook extends PassiveHook {
  onTick?(sim: Sim, eid: number): void;
}

// ------------------------------------------------------------------ numbers (docs/DECISIONS.md)

export const STORMBOW_SLOW = { pct: 30, ticks: sec(1) };
/** Blood Crown overflow shield cap: 50 + 15 per level, decays after 25 s without refresh. */
export const BLOOD_CROWN_CAP = (lvl: number): number => 50 + 15 * lvl;
export const BLOOD_CROWN_TICKS = sec(25);
export const EXECUTIONER = { below: 0.4, mult: 1.15 };
export const BLACK_CHAIN = { pctPerStack: 6, max: 5, ticks: sec(6) };
export const VEIL_STAFF_MULT = 1.35;
export const FROST_CORE_SLOW = { pct: 25, ticks: sec(1) };
/** Burning Glass: 30 + 12 % AP magic damage over 3 s (3 ticks), refreshed per hit. */
export const BURN = { base: 30, ap: 0.12, ticks: sec(3), period: sec(1) };
/** Spark Chalice: 50 + 20 % AP magic damage on the next ability hit, every 1.5 s. */
export const SPARK = { base: 50, ap: 0.2, every: sec(1.5) };
export const RAMPART = { radius: 550, asPct: -10, every: 10, ticks: 15 };
/** Storm Mantle: absorbs 180 + 12 per level magic damage, refills 40 s after it first absorbed something. */
export const MANTLE_AMOUNT = (lvl: number): number => 180 + 12 * lvl;
export const MANTLE_RECHARGE = sec(40);
export const LIFE_ROOT = { pctPer5s: 0.015, combatTicks: sec(5) };
export const WARDEN_STAFF_MULT = 1.12;
export const SPELL_RING_MANA = 6;
export const THORN_BLADE_HEAL = 3;
/** Jägerzahn ("Jagdgefährte", LoL jungle companion stand-in): monsters have LoL HP since the jungle overhaul, so the
 *  item carries the clear: +80 % damage to monsters, basic attacks on monsters deal +30 (+3 per level) true damage
 *  and heal 6 (+1 per level) HP. */
export const HUNTER_FANG = { monsterMult: 1.8, petTrue: 30, petTruePerLevel: 3, heal: 6, healPerLevel: 1, minionGoldMult: 0.5, untilTick: sec(14 * 60) };
/** Giving Lamp: 3 charges (+1 per 10 s), a champion hit spends one (1 s apart) for 15 gold to you and the nearest
 *  allied champion within 1000. Quest: 500 gold earned this way. */
export const LAMP = { max: 3, regen: sec(10), icd: sec(1), gold: 15, allyRange: 1000, quest: 500 };
export const HOURGLASS_TICKS = sec(2.5);
/** Chain Relay: 80 + 10 per level shield (holder's heal/shield power applies) for 2.5 s on allies within 500. */
export const RELAY = { radius: 500, base: 80, perLevel: 10, ticks: sec(2.5) };
export const POTION = { heal: 120, ticks: sec(15) };
/** Duskband: +12 % move speed for 1.5 s on an ally champion that receives your heal or shield, once per ally every 6 s. */
export const BAND = { pct: 12, ticks: sec(1.5), icd: sec(6) };

// ------------------------------------------------------------------ state

interface ItemEnt {
  /** Heal-over-time pools (potion: remaining heal at a fixed rate; second wind: remaining + rate). */
  potion: number;
  wind: number;
  windRate: number;
  /** Spark Chalice ready tick. */
  spark: number;
  /** Storm Mantle: amount absorbed since the last refill, refill tick (0 = full, not recharging). */
  mantleUsed: number;
  mantleAt: number;
  /** Giving Lamp. */
  lamp: number;
  lampNext: number;
  lampLast: number;
  lampGold: number;
  /** Duskband: ally eid -> tick its next move speed spark may land. */
  bandAt: Map<number, number>;
}

interface ItemState {
  ent: Map<number, ItemEnt>;
  /** Item active cooldowns per champion: item id -> [until tick, total ticks]. Follows the item, not the slot. */
  cd: Map<number, Map<string, [number, number]>>;
}

function itemState(sim: Sim): ItemState {
  let s = sim.state.items as ItemState | undefined;
  if (!s) sim.state.items = s = { ent: new Map(), cd: new Map() };
  return s;
}

function ent(sim: Sim, eid: number): ItemEnt {
  const s = itemState(sim);
  let e = s.ent.get(eid);
  if (!e) s.ent.set(eid, (e = { potion: 0, wind: 0, windRate: 0, spark: 0, mantleUsed: 0, mantleAt: 0, lamp: LAMP.max, lampNext: 0, lampLast: -1e9, lampGold: 0, bandAt: new Map() }));
  return e;
}

// ------------------------------------------------------------------ helpers

const isChamp = (sim: Sim, e: number): boolean => sim.c.Unit.kind[e] === Kind.Champion;
const isEnemy = (sim: Sim, eid: number, t: number): boolean => sim.c.Unit.team[t] !== sim.c.Unit.team[eid];

/** Current stacks of a stacking stat buff from `src` (pct / pctPerStack). */
function stacksOf(sim: Sim, t: number, id: string, src: number, pctPerStack: number): number {
  const b = buffs(sim, t).find((x) => x.id === id && x.src === src && x.kind === 'stat' && x.until > sim.tick);
  return b ? Math.round(Math.abs(b.pct) / pctPerStack) : 0;
}

/** Heal-over-time from Second Wind (rune): replaces the running one. */
export function startSecondWind(sim: Sim, eid: number, total: number, ticks: number): void {
  const e = ent(sim, eid);
  e.wind = total;
  e.windRate = total / ticks;
}

/** Heal/shield amount after the holder's modifyHeal passives (champion + items: Hüterlampe/Hüterstab). */
function healPower(sim: Sim, eid: number, t: number, amount: number): number {
  for (const h of passiveHooksOf(sim, eid)) if (h.modifyHeal) amount = h.modifyHeal(sim, eid, t, amount);
  return amount;
}

function blackChain(sim: Sim, eid: number, t: number): void {
  if (!isEnemy(sim, eid, t) || isStructure(sim.c.Unit.kind[t]!)) return;
  const n = Math.min(BLACK_CHAIN.max, stacksOf(sim, t, 'black_chain', eid, BLACK_CHAIN.pctPerStack) + 1);
  addBuff(sim, t, { kind: 'stat', stat: 'armor', id: 'black_chain', src: eid, pct: -BLACK_CHAIN.pctPerStack * n, ticks: BLACK_CHAIN.ticks });
}

function lampHit(sim: Sim, eid: number, t: number): void {
  if (!isChamp(sim, t) || !isEnemy(sim, eid, t)) return;
  const e = ent(sim, eid);
  if (e.lamp <= 0 || sim.tick - e.lampLast < LAMP.icd) return;
  e.lamp--;
  e.lampLast = sim.tick;
  if (e.lampNext <= 0) e.lampNext = sim.tick + LAMP.regen;
  reward(sim, eid, LAMP.gold);
  e.lampGold += LAMP.gold;
  const { Pos } = sim.c;
  const ally = nearestAlly(sim, eid, Pos.x[eid]!, Pos.y[eid]!, LAMP.allyRange);
  if (ally >= 0) reward(sim, ally, LAMP.gold);
}

// ------------------------------------------------------------------ passives

/** Generic: healShieldPowerPct item stat (Hüterlampe) on outgoing ability heals/shields. */
const HEAL_POWER: ItemHook = {
  modifyHeal: (sim, eid, _t, amount) => amount * (1 + (itemStats(sim, eid).healShieldPowerPct ?? 0) / 100),
};

export const ITEM_HOOKS: Record<string, ItemHook> = {
  stormbow: {
    onAutoHit(sim, eid, t, _dmg, info) {
      if (info?.crit && isEnemy(sim, eid, t)) addBuff(sim, t, { kind: 'slow', id: 'stormbow', src: eid, pct: STORMBOW_SLOW.pct, ticks: STORMBOW_SLOW.ticks });
    },
  },
  blood_crown: {
    onAutoHit(sim, eid, _t, _dmg, info) {
      if (!info || info.overheal <= 0) return;
      const cur = buffs(sim, eid).find((b) => b.kind === 'shield' && b.id === 'blood_crown' && b.until > sim.tick)?.amount ?? 0;
      const amount = Math.min(BLOOD_CROWN_CAP(sim.c.Champ.level[eid]!), cur + info.overheal);
      if (amount > cur) addShield(sim, eid, amount, BLOOD_CROWN_TICKS, 'blood_crown', eid);
    },
  },
  executioner: {
    modifyDamage(sim, _eid, t, amount) {
      const { Hp, Unit } = sim.c;
      return !isStructure(Unit.kind[t]!) && Hp.cur[t]! < Hp.max[t]! * EXECUTIONER.below ? amount * EXECUTIONER.mult : amount;
    },
  },
  black_chain: {
    onAutoHit: (sim, eid, t) => blackChain(sim, eid, t),
    onAbilityHit: (sim, eid, t) => blackChain(sim, eid, t),
  },
  veil_staff: {
    onComputeStats(sim, eid) {
      sim.c.Stats.ap[eid] = sim.c.Stats.ap[eid]! * VEIL_STAFF_MULT; // Stats.ap is rebuilt every tick: no compounding
    },
  },
  frost_core: {
    onAbilityHit(sim, eid, t) {
      addBuff(sim, t, { kind: 'slow', id: 'frost_core', src: eid, pct: FROST_CORE_SLOW.pct, ticks: FROST_CORE_SLOW.ticks });
    },
  },
  burning_glass: {
    onAbilityHit(sim, eid, t) {
      const total = BURN.base + BURN.ap * sim.c.Stats.ap[eid]!;
      const n = BURN.ticks / BURN.period;
      addBuff(sim, t, { kind: 'dot', id: 'burning_glass', src: eid, amount: total / n, period: BURN.period, dmgType: 'magic', ticks: BURN.ticks });
    },
  },
  spark_chalice: {
    onAbilityHit(sim, eid, t) {
      const e = ent(sim, eid);
      if (sim.tick < e.spark) return;
      e.spark = sim.tick + SPARK.every;
      dealDamage(sim, eid, t, SPARK.base + SPARK.ap * sim.c.Stats.ap[eid]!, 'magic');
    },
  },
  rampart_heart: {
    onTick(sim, eid) {
      if (!sim.c.Unit.alive[eid] || sim.tick % RAMPART.every !== 0) return;
      const { Pos } = sim.c;
      for (const t of enemiesInRadius(sim, eid, Pos.x[eid]!, Pos.y[eid]!, RAMPART.radius)) {
        addBuff(sim, t, { kind: 'stat', stat: 'as', id: 'rampart_heart', src: eid, pct: RAMPART.asPct, ticks: RAMPART.ticks });
      }
    },
  },
  storm_mantle: {
    // ponytail: the buff system has no typed shields, so the mantle restores the HP part of magic damage right
    // after it landed (before the death check). The damage event still shows the full hit and the HUD shows no
    // shield bar; a typed shield in buffs.ts would fix both.
    onDamageTaken(sim, eid, _src, info) {
      if (info.type !== 'magic') return;
      const e = ent(sim, eid);
      const left = MANTLE_AMOUNT(sim.c.Champ.level[eid]!) - e.mantleUsed;
      const restore = Math.min(left, info.amount - info.absorbed);
      if (restore <= 0) return;
      sim.c.Hp.cur[eid] = sim.c.Hp.cur[eid]! + restore;
      e.mantleUsed += restore;
      if (e.mantleAt <= 0) e.mantleAt = sim.tick + MANTLE_RECHARGE;
    },
    onTick(sim, eid) {
      const e = ent(sim, eid);
      if (e.mantleAt > 0 && sim.tick >= e.mantleAt) (e.mantleUsed = 0), (e.mantleAt = 0);
    },
  },
  life_root: {
    onTick(sim, eid) {
      const { Hp, Unit } = sim.c;
      if (!Unit.alive[eid] || sim.tick - lastCombatTick(sim, eid) > LIFE_ROOT.combatTicks) return;
      heal(sim, eid, (Hp.max[eid]! * LIFE_ROOT.pctPer5s) / sec(5));
    },
  },
  warden_staff: {
    modifyHeal: (_sim, _eid, _t, amount) => amount * WARDEN_STAFF_MULT,
  },
  dusk_band: {
    // ponytail: modifyHeal is the only hook every heal and shield on an ally passes through (abilities.ts, chain relay);
    // it returns the amount unchanged and only adds the spark. A dedicated onHealGiven hook would be cleaner.
    modifyHeal(sim, eid, t, amount) {
      if (t === eid || !isChamp(sim, t) || isEnemy(sim, eid, t)) return amount;
      const e = ent(sim, eid);
      if (sim.tick < (e.bandAt.get(t) ?? 0)) return amount;
      e.bandAt.set(t, sim.tick + BAND.icd);
      addBuff(sim, t, { kind: 'stat', stat: 'ms', id: 'dusk_band', src: eid, pct: BAND.pct, ticks: BAND.ticks });
      return amount;
    },
  },
  spell_ring: {
    onKill(sim, eid, victim) {
      const k = sim.c.Unit.kind[victim]!;
      if (!isMinion(k) && k !== Kind.Monster) return;
      const { Mana } = sim.c;
      Mana.cur[eid] = Math.min(Mana.max[eid]!, Mana.cur[eid]! + SPELL_RING_MANA);
    },
  },
  thorn_blade: {
    onAutoHit(sim, eid, t) {
      if (isChamp(sim, t) && isEnemy(sim, eid, t) && championData(champIdOf(sim, eid)).attackType === 'melee') heal(sim, eid, THORN_BLADE_HEAL);
    },
  },
  hunter_fang: {
    // Banish unlock: bannen is a summoner (summoners.ts, not gated here). Gold malus: minionGoldMult (economy.ts).
    modifyDamage: (sim, _eid, t, amount) => (sim.c.Unit.kind[t] === Kind.Monster ? amount * HUNTER_FANG.monsterMult : amount),
    onAutoHit(sim, eid, t) {
      if (sim.c.Unit.kind[t] !== Kind.Monster) return;
      const lvl = sim.c.Champ.level[eid]! - 1;
      dealDamage(sim, eid, t, HUNTER_FANG.petTrue + HUNTER_FANG.petTruePerLevel * lvl, 'true');
      heal(sim, eid, HUNTER_FANG.heal + HUNTER_FANG.healPerLevel * lvl);
    },
  },
  giving_lamp: {
    // "No minion gold penalty": this game has no support gold penalty, so nothing to lift.
    onAutoHit: (sim, eid, t) => lampHit(sim, eid, t),
    onAbilityHit: (sim, eid, t) => lampHit(sim, eid, t),
    onTick(sim, eid) {
      const e = ent(sim, eid);
      if (e.lampNext > 0 && sim.tick >= e.lampNext) {
        e.lamp = Math.min(LAMP.max, e.lamp + 1);
        e.lampNext = e.lamp < LAMP.max ? sim.tick + LAMP.regen : 0;
      }
    },
  },
};

// ------------------------------------------------------------------ dispatch

/** Item hooks of a champion (unique per hook id, inventory order) + the generic heal/shield power hook. */
export function itemHooksOf(sim: Sim, eid: number): ItemHook[] {
  const out: ItemHook[] = [];
  let healPct = false;
  for (const id of inventory(sim, eid)) {
    const it = id ? itemById(id) : undefined;
    if (!it) continue;
    if (it.stats.healShieldPowerPct) healPct = true;
    const h = it.passive?.hook ? ITEM_HOOKS[it.passive.hook] : undefined;
    if (h && !out.includes(h)) out.push(h);
  }
  if (healPct) out.push(HEAL_POWER);
  return out;
}

// Pure derived cache (hook object lists by inventory content), keyed by sim so parallel sims never share it.
const extraCache = new WeakMap<Sim, Map<number, { inv: (string | null)[]; list: ItemHook[] }>>();

/** Item + rune hooks of a champion entity; champions/index.ts passiveHooksOf appends these. */
export function extraHooksOf(sim: Sim, eid: number): ItemHook[] {
  let m = extraCache.get(sim);
  if (!m) extraCache.set(sim, (m = new Map()));
  const inv = inventory(sim, eid);
  const c = m.get(eid);
  if (c && c.inv.every((x, i) => x === inv[i])) return c.list;
  const list = [...itemHooksOf(sim, eid), ...runeHooksOf(sim, eid)];
  m.set(eid, { inv: [...inv], list });
  return list;
}

/** Per-tick upkeep for one champion (abilities system, after the champion's own onTick). */
export function tickItemsAndRunes(sim: Sim, eid: number): void {
  const { Unit } = sim.c;
  const s = itemState(sim).ent.get(eid);
  if (s) {
    if (!Unit.alive[eid]) (s.potion = 0), (s.wind = 0);
    if (s.potion > 0) {
      const d = Math.min(s.potion, POTION.heal / POTION.ticks);
      s.potion -= d;
      heal(sim, eid, d);
    }
    if (s.wind > 0) {
      const d = Math.min(s.wind, s.windRate);
      s.wind -= d;
      heal(sim, eid, d);
    }
  }
  for (const h of extraHooksOf(sim, eid)) h.onTick?.(sim, eid);
}

// ------------------------------------------------------------------ actives + consumables

type UseFn = (sim: Sim, eid: number, x: number, y: number) => boolean;

const USE: Record<string, UseFn> = {
  hourglass(sim, eid) {
    if (!canAttack(sim, eid)) return false; // stunned / airborne / suppressed: items unusable
    if (!addBuff(sim, eid, { kind: 'stasis', id: 'zeitglas', src: eid, ticks: HOURGLASS_TICKS })) return false;
    sim.c.Move.mode[eid] = 0;
    sim.paths.delete(eid);
    return true;
  },
  chain_relay(sim, eid) {
    if (!canAttack(sim, eid)) return false;
    const { Pos, Champ } = sim.c;
    const base = RELAY.base + RELAY.perLevel * Champ.level[eid]!;
    for (const a of alliedChampionsIn(sim, eid, Pos.x[eid]!, Pos.y[eid]!, RELAY.radius)) addShield(sim, a, healPower(sim, eid, a, base), RELAY.ticks, 'kettenrelais', eid);
    return true;
  },
  potion(sim, eid) {
    ent(sim, eid).potion += POTION.heal; // a second potion queues behind the first (same heal rate)
    return true;
  },
  // Siegelward (Agent J): ward entity, placement and vision live in src/sim/wards.ts; the item is consumed on success
  seal_ward: (sim, eid, x, y) => placeSealWard(sim, eid, x, y),
};

/** Item command: use the active / consumable in inventory slot 0..5. Returns true if something happened. */
export function useItem(sim: Sim, eid: number, slot: number, x?: number, y?: number): boolean {
  const { Unit, Pos } = sim.c;
  if (!Unit.alive[eid] || Unit.kind[eid] !== Kind.Champion || !(slot >= 0 && slot < ITEM_SLOTS)) return false;
  const inv = inventory(sim, eid);
  const id = inv[slot];
  const it = id ? itemById(id) : undefined;
  if (!it) return false;
  const hook = it.active?.hook ?? (it.tier === 'consumable' ? it.passive?.hook : undefined);
  const fn = hook ? USE[hook] : undefined;
  if (!fn) return false;
  // failed actives report a castFail like abilities (HUD message + sound; issue from agent C, FEATURE-GAP 1.15)
  const fail = (reason: 'cooldown' | 'cc' | 'target'): false => (sim.events.push({ e: 'castFail', src: eid, slot, reason, item: true }), false);
  if (itemCooldownLeft(sim, eid, it.id) > 0) return fail('cooldown');
  if (!fn(sim, eid, x ?? Pos.x[eid]!, y ?? Pos.y[eid]!)) return fail(canAttack(sim, eid) ? 'target' : 'cc');
  if (it.active) {
    const s = itemState(sim);
    let m = s.cd.get(eid);
    if (!m) s.cd.set(eid, (m = new Map()));
    m.set(it.id, [sim.tick + sec(it.active.cooldown), sec(it.active.cooldown)]);
  }
  if (it.tier === 'consumable') inv[slot] = null;
  return true;
}

/** Ticks until the item's active is ready again (0 = ready). */
export function itemCooldownLeft(sim: Sim, eid: number, itemId: string): number {
  const cd = itemState(sim).cd.get(eid)?.get(itemId);
  return cd ? Math.max(0, cd[0] - sim.tick) : 0;
}

/** HUD: cooldown per inventory slot (7 entries, seconds; total 0 = no active). */
export function itemCooldownHud(sim: Sim, eid: number): { left: number; total: number }[] {
  return inventory(sim, eid).map((id) => {
    const it = id ? itemById(id) : undefined;
    if (!it?.active) return { left: 0, total: 0 };
    return { left: itemCooldownLeft(sim, eid, it.id) / 30, total: it.active.cooldown };
  });
}

// ------------------------------------------------------------------ queries for other systems

/** Lane-minion gold multiplier for a champion (Jägerzahn: 50 % until 14:00). economy.ts minionDeath. */
export function minionGoldMult(sim: Sim, eid: number): number {
  if (sim.tick >= HUNTER_FANG.untilTick) return 1;
  return inventory(sim, eid).some((id) => id && itemById(id)?.passive?.hook === 'hunter_fang') ? HUNTER_FANG.minionGoldMult : 1;
}

/** Giving Lamp quest (500 gold earned) done: Agent J grants +1 ward charge. */
export function givingLampQuestDone(sim: Sim, eid: number): boolean {
  return (itemState(sim).ent.get(eid)?.lampGold ?? 0) >= LAMP.quest;
}

/** Remaining Storm Mantle absorb (for tests/HUD). */
export function stormMantleLeft(sim: Sim, eid: number): number {
  return MANTLE_AMOUNT(sim.c.Champ.level[eid]!) - (itemState(sim).ent.get(eid)?.mantleUsed ?? 0);
}
