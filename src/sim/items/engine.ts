// Item engine: compiles the data-driven passives / actives of items.json (schema.ts) into PassiveHook objects and
// executes them. Passives become one ItemHook per owned item (champions/index.ts passiveHooksOf appends them to the
// champion's own hooks, so every engine event reaches them). Conditions and values are compiled once into closures;
// per-owner state (cooldowns, charges, stacks, counters, absorb pools) lives in sim.state.items, keyed by champion eid
// (champion eids are never recycled) and passive key. No Math.random, no module-level state besides the compile caches.
// Semantics are documented in docs/ITEMS-FORMAT.md; numbers of the original code-hook items are pinned by
// tests/itemEngine.golden.test.ts.

import type { Sim } from '../sim';
import type { DamageInfo, EffectCtx, PassiveHook, AutoHitInfo } from '../champions/hooks';
import { Kind, isMinion, isStructure, sec, type DamageType } from '../types';
import { championData, champIdOf, passiveHooksOf } from '../champions';
import { addBuff, addShield, buffs, canAttack, ccLevel, removeBuffs, type BuffKind } from '../buffs';
import { dealDamage, heal, lastCombatTick } from '../damage';
import { reward } from '../systems/economy';
import { alliedChampionsIn, enemiesInRadius, nearestAlly } from '../systems/abilities';
import { placeSealWard } from '../wards';
import { sees } from '../vision';
import { dist2 } from '../vec';
import type {
  ActiveTarget, Cond, Effect, ItemData, PassiveData, Rule, SelfCond, TargetKind, Trigger, UnitCond, UseBase, Value,
} from './schema';

/** Passive hook with per-tick upkeep and the shield-break event (both only reach item and rune hooks). */
export interface ItemHook extends PassiveHook {
  onTick?(sim: Sim, eid: number): void;
  /** A hit emptied the owner's shield (damage.ts). */
  onShieldBreak?(sim: Sim, eid: number, src: number, info: DamageInfo): void;
}

// ------------------------------------------------------------------ state

interface RuleState {
  /** Internal cooldown: ready from this tick. */
  readyAt: number;
  charges: number;
  /** Next charge regained at this tick (0 = not regenerating). */
  chargeNext: number;
  /** absorbDamage: amount absorbed since the last refill; refill tick (0 = full, not recharging). */
  used: number;
  rechargeAt: number;
}

interface PassiveState {
  rules: RuleState[];
  /** name -> [count, expiry tick (0 = permanent)]. */
  stacks: Record<string, number[]>;
  counters: Record<string, number>;
}

interface ItemEnt {
  /** Second Wind (rune) heal-over-time pool: remaining + rate. */
  wind: number;
  windRate: number;
  /** healOverTime pools (potion): name -> [remaining, rate per tick]. They outlive the consumed item. */
  pools: Map<string, number[]>;
  passives: Map<string, PassiveState>;
}

export interface ItemState {
  ent: Map<number, ItemEnt>;
  /** Item active cooldowns per champion: item id -> [until tick, total ticks]. Follows the item, not the slot. */
  cd: Map<number, Map<string, [number, number]>>;
}

export function itemState(sim: Sim): ItemState {
  let s = sim.state.items as ItemState | undefined;
  if (!s) sim.state.items = s = { ent: new Map(), cd: new Map() };
  return s;
}

export function ent(sim: Sim, eid: number): ItemEnt {
  const s = itemState(sim);
  let e = s.ent.get(eid);
  if (!e) s.ent.set(eid, (e = { wind: 0, windRate: 0, pools: new Map(), passives: new Map() }));
  return e;
}

function pstate(sim: Sim, eid: number, key: string, rules: readonly CRule[]): PassiveState {
  const e = ent(sim, eid);
  let ps = e.passives.get(key);
  if (!ps) {
    ps = { rules: rules.map((r) => ({ readyAt: 0, charges: r.charges?.max ?? 0, chargeNext: 0, used: 0, rechargeAt: 0 })), stacks: {}, counters: {} };
    e.passives.set(key, ps);
  } else {
    // items sharing a passive key share its state; a different item may bring more rules
    for (let i = ps.rules.length; i < rules.length; i++) ps.rules.push({ readyAt: 0, charges: rules[i]!.charges?.max ?? 0, chargeNext: 0, used: 0, rechargeAt: 0 });
  }
  return ps;
}

const stackCount = (sim: Sim, ps: PassiveState, name: string): number => {
  const s = ps.stacks[name];
  return s && (s[1] === 0 || sim.tick < s[1]) ? s[0]! : 0;
};

// ------------------------------------------------------------------ context

/** What a trigger knows; conditions and values read it. */
interface Ctx {
  itemId: string;
  ps: PassiveState;
  rs: RuleState;
  /** Trigger's target unit (hit unit, victim, picked unit of an active), -1 none. */
  target: number;
  /** Damage source (onDamageTaken), -1 none. */
  source: number;
  /** The unit an effect is currently applied to. */
  rcp: number;
  damage: number;
  absorbed: number;
  overheal: number;
  crit: boolean;
  dmgType: DamageType | '';
  isAuto: boolean;
  slot: number;
  x: number;
  y: number;
  /** Scratch: value shared between an effect and its per-recipient step; an applyBuff to a single recipient failed. */
  val: number;
  failed: boolean;
  /** Owner level when the trigger fired (a kill inside the effect list may level the owner up: values keep the old level). */
  level: number;
}

const NO_RS: RuleState = { readyAt: 0, charges: 0, chargeNext: 0, used: 0, rechargeAt: 0 };

function mkCtx(sim: Sim, eid: number, itemId: string, ps: PassiveState): Ctx {
  return { itemId, ps, rs: NO_RS, target: -1, source: -1, rcp: -1, damage: 0, absorbed: 0, overheal: 0, crit: false, dmgType: '', isAuto: false, slot: -1, x: 0, y: 0, val: 0, failed: false, level: sim.c.Champ.level[eid]! };
}

// ------------------------------------------------------------------ values

type Val = (sim: Sim, eid: number, c: Ctx) => number;

const SCALE: Record<string, (sim: Sim, eid: number, c: Ctx) => number> = {
  ap: (s, e) => s.c.Stats.ap[e]!,
  ad: (s, e) => s.c.Stats.ad[e]!,
  bonusAd: (s, e) => s.c.Stats.bonusAd[e]!,
  armor: (s, e) => s.c.Stats.armor[e]!,
  mr: (s, e) => s.c.Stats.mr[e]!,
  maxHp: (s, e) => s.c.Hp.max[e]!,
  curHp: (s, e) => s.c.Hp.cur[e]!,
  missingHp: (s, e) => s.c.Hp.max[e]! - s.c.Hp.cur[e]!,
  targetMaxHp: (s, _e, c) => (c.target >= 0 ? s.c.Hp.max[c.target]! : 0),
  targetCurHp: (s, _e, c) => (c.target >= 0 ? s.c.Hp.cur[c.target]! : 0),
  targetMissingHp: (s, _e, c) => (c.target >= 0 ? s.c.Hp.max[c.target]! - s.c.Hp.cur[c.target]! : 0),
  recipientMaxHp: (s, _e, c) => (c.rcp >= 0 ? s.c.Hp.max[c.rcp]! : 0),
  recipientCurHp: (s, _e, c) => (c.rcp >= 0 ? s.c.Hp.cur[c.rcp]! : 0),
  recipientMissingHp: (s, _e, c) => (c.rcp >= 0 ? s.c.Hp.max[c.rcp]! - s.c.Hp.cur[c.rcp]! : 0),
  damage: (_s, _e, c) => c.damage,
  overheal: (_s, _e, c) => c.overheal,
};

export function compileValue(v: Value): Val {
  if (typeof v === 'number') return () => v;
  const base = v.base ?? 0;
  const perLevel = v.perLevel;
  const terms: [(sim: Sim, eid: number, c: Ctx) => number, number][] = [];
  for (const [k, coef] of Object.entries(v.scale ?? {})) {
    if (k === 'stacks') for (const [name, kk] of Object.entries(coef as Record<string, number>)) terms.push([(s, _e, c) => stackCount(s, c.ps, name), kk]);
    else terms.push([SCALE[k]!, coef as number]);
  }
  const { min, max } = v;
  return (sim, eid, c) => {
    let r = base;
    if (perLevel) r += perLevel * (c.level - 1);
    for (let i = 0; i < terms.length; i++) r += terms[i]![1] * terms[i]![0](sim, eid, c);
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };
}

// ------------------------------------------------------------------ conditions

type Pred = (sim: Sim, eid: number, c: Ctx) => boolean;

const KIND_TEST: Record<TargetKind, (k: number) => boolean> = {
  champion: (k) => k === Kind.Champion,
  minion: isMinion,
  monster: (k) => k === Kind.Monster,
  structure: isStructure,
  ward: (k) => k === Kind.Ward,
  pet: (k) => k === Kind.Pet,
  plant: (k) => k === Kind.Plant,
  dummy: (k) => k === Kind.Dummy,
};

const hasBuffNamed = (sim: Sim, u: number, name: string): boolean => buffs(sim, u).some((b) => b.until > sim.tick && (b.id === name || b.kind === name));

function unitPred(u: UnitCond, which: 'target' | 'source'): Pred {
  const kinds = u.kind?.map((k) => KIND_TEST[k]);
  const notKinds = u.notKind?.map((k) => KIND_TEST[k]);
  const { team, hpBelowPct, hpAbovePct, hasBuff } = u;
  return (sim, eid, c) => {
    const t = which === 'target' ? c.target : c.source;
    if (t < 0) return false;
    const { Unit, Hp } = sim.c;
    const k = Unit.kind[t]!;
    if (kinds && !kinds.some((f) => f(k))) return false;
    if (notKinds && notKinds.some((f) => f(k))) return false;
    if (team === 'enemy' && Unit.team[t] === Unit.team[eid]) return false;
    if (team === 'ally' && (Unit.team[t] !== Unit.team[eid] || t === eid)) return false;
    if (hpBelowPct !== undefined && !(Hp.cur[t]! < Hp.max[t]! * (hpBelowPct / 100))) return false;
    if (hpAbovePct !== undefined && !(Hp.cur[t]! > Hp.max[t]! * (hpAbovePct / 100))) return false;
    if (hasBuff !== undefined && !hasBuffNamed(sim, t, hasBuff)) return false;
    return true;
  };
}

function selfPred(s: SelfCond): Pred {
  const { hpBelowPct, hpAbovePct, attack, alive, crowdControlled, hasBuff, levelAtLeast } = s;
  return (sim, eid) => {
    const { Unit, Hp, Champ } = sim.c;
    if (alive !== undefined && !!Unit.alive[eid] !== alive) return false;
    if (hpBelowPct !== undefined && !(Hp.cur[eid]! < Hp.max[eid]! * (hpBelowPct / 100))) return false;
    if (hpAbovePct !== undefined && !(Hp.cur[eid]! > Hp.max[eid]! * (hpAbovePct / 100))) return false;
    if (attack !== undefined && championData(champIdOf(sim, eid)).attackType !== attack) return false;
    if (crowdControlled !== undefined && ccLevel(sim, eid) > 0 !== crowdControlled) return false;
    if (hasBuff !== undefined && !hasBuffNamed(sim, eid, hasBuff)) return false;
    if (levelAtLeast !== undefined && Champ.level[eid]! < levelAtLeast) return false;
    return true;
  };
}

type Gate = (sim: Sim) => boolean;

/** Conditions that need only the sim (tick, game time): checked before a context is even built. */
export function compileGate(c: Cond | undefined): Gate[] {
  const out: Gate[] = [];
  if (!c) return out;
  if (c.everyTicks !== undefined) {
    const n = c.everyTicks;
    out.push((s) => s.tick % n === 0);
  }
  if (c.beforeSeconds !== undefined) {
    const n = sec(c.beforeSeconds);
    out.push((s) => s.tick < n);
  }
  if (c.afterSeconds !== undefined) {
    const n = sec(c.afterSeconds);
    out.push((s) => s.tick >= n);
  }
  return out;
}

export function compileCond(c: Cond | undefined): Pred[] {
  const out: Pred[] = [];
  if (!c) return out;
  if (c.target) out.push(unitPred(c.target, 'target'));
  if (c.source) out.push(unitPred(c.source, 'source'));
  if (c.self) out.push(selfPred(c.self));
  if (c.crit !== undefined) out.push((_s, _e, x) => x.crit === c.crit);
  if (c.overheal !== undefined) out.push((_s, _e, x) => x.overheal > 0 === c.overheal);
  if (c.damageType) {
    const list = c.damageType as string[];
    out.push((_s, _e, x) => list.includes(x.dmgType));
  }
  if (c.isAuto !== undefined) out.push((_s, _e, x) => x.isAuto === c.isAuto);
  if (c.damageTakenPctMaxHp !== undefined) {
    const p = c.damageTakenPctMaxHp / 100;
    out.push((s, e, x) => x.damage >= s.c.Hp.max[e]! * p);
  }
  if (c.inCombatSeconds !== undefined) {
    const n = sec(c.inCombatSeconds);
    out.push((s, e) => s.tick - lastCombatTick(s, e) <= n);
  }
  if (c.castSlot) {
    const list = c.castSlot;
    out.push((_s, _e, x) => list.includes(x.slot));
  }
  if (c.stacksAtLeast) {
    const need = Object.entries(c.stacksAtLeast);
    out.push((s, _e, x) => need.every(([name, n]) => stackCount(s, x.ps, name) >= n));
  }
  return out;
}

// ------------------------------------------------------------------ effects

/** Returns false when the effect could not apply (immune target, ward limit): an active then does not trigger. */
type Exec = (sim: Sim, eid: number, c: Ctx) => boolean | void;

interface AimData {
  to: 'self' | 'target' | 'source' | 'nearestAlly' | 'alliesInRadius' | 'enemiesInRadius';
  radius?: number;
  range?: number;
  around?: 'self' | 'target';
}

type RFn = (sim: Sim, eid: number, c: Ctx, u: number) => void;

/** Calls fn once per recipient (c.rcp = the recipient meanwhile). No closures: this runs on every proc. */
function forEachRecipient(sim: Sim, eid: number, c: Ctx, a: AimData, fn: RFn): void {
  const { Pos } = sim.c;
  const prev = c.rcp;
  switch (a.to) {
    case 'self':
      c.rcp = eid;
      fn(sim, eid, c, eid);
      break;
    case 'target':
      if (c.target >= 0) {
        c.rcp = c.target;
        fn(sim, eid, c, c.target);
      }
      break;
    case 'source':
      if (c.source >= 0) {
        c.rcp = c.source;
        fn(sim, eid, c, c.source);
      }
      break;
    case 'nearestAlly': {
      const u = nearestAlly(sim, eid, Pos.x[eid]!, Pos.y[eid]!, a.range!);
      if (u >= 0) {
        c.rcp = u;
        fn(sim, eid, c, u);
      }
      break;
    }
    default: {
      const at = a.around === 'target' && c.target >= 0 ? c.target : eid;
      const list = a.to === 'alliesInRadius' ? alliedChampionsIn(sim, eid, Pos.x[at]!, Pos.y[at]!, a.radius!) : enemiesInRadius(sim, eid, Pos.x[at]!, Pos.y[at]!, a.radius!);
      for (const u of list) {
        c.rcp = u;
        fn(sim, eid, c, u);
      }
    }
  }
  c.rcp = prev;
}

const dur = (e: { seconds?: number; ticks?: number }): number => e.ticks ?? sec(e.seconds!);

/** Heal/shield amount after the holder's modifyHeal passives (champion + items: Hüterlampe/Hüterstab). */
export function healPower(sim: Sim, eid: number, t: number, amount: number): number {
  for (const h of passiveHooksOf(sim, eid)) if (h.modifyHeal) amount = h.modifyHeal(sim, eid, t, amount);
  return amount;
}

const CLEANSE_DEFAULT = ['slow', 'blind', 'root', 'silence', 'stun'];

/** Current stacks of a stacking stat buff from `src` (pct / pctPerStack). */
function stacksOf(sim: Sim, t: number, id: string, src: number, pctPerStack: number): number {
  const b = buffs(sim, t).find((x) => x.id === id && x.src === src && x.kind === 'stat' && x.until > sim.tick);
  return b ? Math.round(Math.abs(b.pct) / pctPerStack) : 0;
}

function compileEffect(e: Effect): Exec {
  switch (e.type) {
    case 'damage': {
      const v = compileValue(e.value);
      const apply: RFn = (sim, eid, c, u) => void dealDamage(sim, eid, u, v(sim, eid, c), e.dmgType);
      return (sim, eid, c) => forEachRecipient(sim, eid, c, e, apply);
    }
    case 'heal': {
      const v = compileValue(e.value);
      const per = e.perSeconds !== undefined ? sec(e.perSeconds) : 0;
      const apply: RFn = (sim, eid, c, u) => {
        const a = v(sim, eid, c);
        heal(sim, u, per ? a / per : a);
      };
      return (sim, eid, c) => forEachRecipient(sim, eid, c, e, apply);
    }
    case 'shield': {
      const v = compileValue(e.value);
      const cap = e.cap !== undefined ? compileValue(e.cap) : null;
      const ticks = dur(e);
      const apply: RFn = (sim, eid, c, u) => {
        const amount = e.healPower ? healPower(sim, eid, u, c.val) : c.val;
        if (!e.accumulate) return addShield(sim, u, amount, ticks, e.id, eid);
        const cur = buffs(sim, u).find((b) => b.kind === 'shield' && b.id === e.id && b.until > sim.tick)?.amount ?? 0;
        const next = cap ? Math.min(cap(sim, eid, c), cur + amount) : cur + amount;
        if (next > cur) addShield(sim, u, next, ticks, e.id, eid);
      };
      return (sim, eid, c) => {
        c.val = v(sim, eid, c);
        forEachRecipient(sim, eid, c, e, apply);
      };
    }
    case 'applyBuff': {
      const ticks = dur(e);
      const dmg = e.damage !== undefined ? compileValue(e.damage) : null;
      const periodTicks = e.period !== undefined ? sec(e.period) : 0;
      const single = e.to === 'self' || e.to === 'target' || e.to === 'source';
      const kind = e.kind as BuffKind;
      const apply: RFn = (sim, eid, c, u) => {
        let pct = e.pct;
        if (e.stacks && pct !== undefined) pct = pct * Math.min(e.stacks.max, stacksOf(sim, u, e.id, eid, Math.abs(e.pct!)) + 1);
        // one object shape for every buff (addBuff stays monomorphic)
        const ok = addBuff(sim, u, {
          kind,
          id: e.id,
          src: eid,
          stat: e.stat,
          pct,
          flat: e.flat,
          amount: dmg ? dmg(sim, eid, c) / (ticks / periodTicks) : undefined,
          period: dmg ? periodTicks : undefined,
          dmgType: e.dmgType,
          uncleansable: e.uncleansable,
          ticks,
        });
        if (!ok && single) c.failed = true;
      };
      return (sim, eid, c) => {
        c.failed = false;
        forEachRecipient(sim, eid, c, e, apply);
        return !c.failed;
      };
    }
    case 'cleanse': {
      const kinds = new Set<string>(e.kinds ?? CLEANSE_DEFAULT);
      const ids = new Set<string>(e.ids ?? []);
      const pred = (b: { kind: string; id: string; uncleansable?: boolean }): boolean => !b.uncleansable && (kinds.has(b.kind) || ids.has(b.id));
      const apply: RFn = (sim, _eid, _c, u) => removeBuffs(sim, u, pred);
      return (sim, eid, c) => forEachRecipient(sim, eid, c, e, apply);
    }
    case 'restoreMana': {
      const v = compileValue(e.value);
      return (sim, eid, c) => {
        const { Mana } = sim.c;
        Mana.cur[eid] = Math.min(Mana.max[eid]!, Mana.cur[eid]! + v(sim, eid, c));
      };
    }
    case 'gold': {
      const apply: RFn = (sim, _eid, c, u) => {
        reward(sim, u, e.amount);
        if (e.counter) c.ps.counters[e.counter] = (c.ps.counters[e.counter] ?? 0) + e.amount;
      };
      return (sim, eid, c) => forEachRecipient(sim, eid, c, e, apply);
    }
    case 'absorbDamage': {
      const v = compileValue(e.value);
      const recharge = e.rechargeSeconds !== undefined ? sec(e.rechargeSeconds) : 0;
      return (sim, eid, c) => {
        const rs = c.rs;
        const restore = Math.min(v(sim, eid, c) - rs.used, c.damage - c.absorbed);
        if (restore <= 0) return;
        sim.c.Hp.cur[eid] = sim.c.Hp.cur[eid]! + restore;
        rs.used += restore;
        if (recharge && rs.rechargeAt <= 0) rs.rechargeAt = sim.tick + recharge;
      };
    }
    case 'healOverTime': {
      const v = compileValue(e.value);
      const ticks = dur(e);
      return (sim, eid, c) => {
        const total = v(sim, eid, c);
        const pools = ent(sim, eid).pools;
        const name = e.pool ?? c.itemId;
        let p = pools.get(name);
        if (!p) pools.set(name, (p = [0, 0]));
        p[0] = p[0]! + total; // a second potion queues behind the first (same rate)
        p[1] = total / ticks;
      };
    }
    case 'addStack': {
      const ticks = e.seconds !== undefined || e.ticks !== undefined ? dur(e) : 0;
      const amount = e.amount ?? 1;
      return (sim, _eid, c) => {
        const n = Math.min(e.max, stackCount(sim, c.ps, e.name) + amount);
        c.ps.stacks[e.name] = [n, ticks ? sim.tick + ticks : 0];
      };
    }
    case 'clearStack':
      return (_sim, _eid, c) => void delete c.ps.stacks[e.name];
    case 'statMult':
      return (sim, eid) => void (sim.c.Stats[e.stat][eid] = sim.c.Stats[e.stat][eid]! * e.mult);
    case 'statAdd': {
      const v = compileValue(e.value);
      if (e.stat === 'tenacity') return (sim, eid, c) => void (sim.c.Stats.tenacity[eid] = Math.min(1, sim.c.Stats.tenacity[eid]! + v(sim, eid, c) / 100));
      return (sim, eid, c) => void (sim.c.Stats[e.stat as 'ad'][eid] = sim.c.Stats[e.stat as 'ad'][eid]! + v(sim, eid, c));
    }
    case 'stopMovement':
      return (sim, eid) => {
        sim.c.Move.mode[eid] = 0;
        sim.paths.delete(eid);
      };
    case 'placeSealWard':
      return (sim, eid, c) => placeSealWard(sim, eid, c.x, c.y);
    case 'damageMult':
    case 'healMult':
      // applied by the modifyDamage / modifyHeal hooks (compile): the rule's factor, no executor needed
      return () => undefined;
  }
}

// ------------------------------------------------------------------ rules

interface CRule {
  idx: number;
  gate: Gate[];
  conds: Pred[];
  cd: number;
  charges: { max: number; regen: number } | null;
  effects: Exec[];
  /** damageMult / healMult factor of a modifier rule. */
  mult: number;
  absorb: { value: Val; recharge: number } | null;
}

function compileRule(r: Rule, idx: number): CRule {
  const absorb = r.do.find((e) => e.type === 'absorbDamage');
  const mod = r.do.find((e) => e.type === 'damageMult' || e.type === 'healMult');
  return {
    idx,
    gate: compileGate(r.if),
    conds: compileCond(r.if),
    cd: r.cooldown !== undefined ? sec(r.cooldown) : 0,
    charges: r.charges ? { max: r.charges.max, regen: sec(r.charges.regenSeconds) } : null,
    effects: r.do.map(compileEffect),
    mult: mod && (mod.type === 'damageMult' || mod.type === 'healMult') ? mod.mult : 1,
    absorb: absorb && absorb.type === 'absorbDamage' ? { value: compileValue(absorb.value), recharge: absorb.rechargeSeconds !== undefined ? sec(absorb.rechargeSeconds) : 0 } : null,
  };
}

/** Conditions, then cooldown / charges, then the effects. Returns false if the rule did not fire. */
function fire(sim: Sim, eid: number, r: CRule, c: Ctx): boolean {
  for (let i = 0; i < r.gate.length; i++) if (!r.gate[i]!(sim)) return false;
  for (let i = 0; i < r.conds.length; i++) if (!r.conds[i]!(sim, eid, c)) return false;
  const rs = c.ps.rules[r.idx] ?? NO_RS;
  if (r.cd && sim.tick < rs.readyAt) return false;
  if (r.charges && rs.charges <= 0) return false;
  if (r.cd) rs.readyAt = sim.tick + r.cd;
  if (r.charges) {
    rs.charges--;
    if (rs.chargeNext <= 0) rs.chargeNext = sim.tick + r.charges.regen;
  }
  c.rs = rs;
  for (let i = 0; i < r.effects.length; i++) r.effects[i]!(sim, eid, c);
  return true;
}

interface Compiled {
  hook: ItemHook;
  rules: CRule[];
  key: string;
}

const cache = new WeakMap<PassiveData, Map<string, Compiled>>();

/** The ItemHook of a passive for one owned copy (`key`: passive key, `#n` suffix for stacking copies). */
export function passiveHook(item: ItemData, key: string): ItemHook | undefined {
  return compiled(item, key)?.hook;
}

function compiled(item: ItemData, key: string): Compiled | undefined {
  const p = item.passive;
  if (!p?.rules?.length) return undefined;
  let m = cache.get(p);
  if (!m) cache.set(p, (m = new Map()));
  let c = m.get(key);
  if (!c) m.set(key, (c = compile(item.id, p, key)));
  return c;
}

function compile(itemId: string, p: PassiveData, key: string): Compiled {
  const rules = p.rules!.map(compileRule);
  const by = new Map<Trigger, CRule[]>();
  p.rules!.forEach((r, i) => {
    for (const t of Array.isArray(r.on) ? r.on : [r.on]) {
      let l = by.get(t);
      if (!l) by.set(t, (l = []));
      l.push(rules[i]!);
    }
  });
  // does the rule need its passive state (cooldowns, charges, stacks, counters, absorb pools)?
  const needsPs = (r: Rule): boolean => !!(r.cooldown || r.charges || /stack|absorbDamage|"counter"/.test(JSON.stringify(r)));
  const stateful = p.rules!.some(needsPs);
  const psOf = (sim: Sim, eid: number): PassiveState => (stateful ? pstate(sim, eid, key, rules) : EMPTY_PS);
  const hook: ItemHook = {};
  const run = (sim: Sim, eid: number, list: CRule[], c: Ctx): void => {
    for (let i = 0; i < list.length; i++) fire(sim, eid, list[i]!, c);
  };
  // per-tick rules: the context is only built once a rule passes its cheap sim-only gate
  const runLazy = (sim: Sim, eid: number, list: CRule[]): void => {
    let c: Ctx | undefined;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      let ok = true;
      for (let j = 0; j < r.gate.length && ok; j++) ok = r.gate[j]!(sim);
      if (!ok) continue;
      fire(sim, eid, r, (c ??= mkCtx(sim, eid, itemId, psOf(sim, eid))));
    }
  };

  const onHit = by.get('onHit');
  if (onHit) {
    hook.onAutoHit = (sim, eid, t, dmg, info?: AutoHitInfo) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = t;
      c.damage = dmg;
      c.crit = !!info?.crit;
      c.overheal = info?.overheal ?? 0;
      c.isAuto = true;
      run(sim, eid, onHit, c);
    };
  }
  const onAbilityHit = by.get('onAbilityHit');
  if (onAbilityHit) {
    hook.onAbilityHit = (sim, eid, t, ctx: EffectCtx) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = t;
      c.slot = ctx.slot;
      c.x = ctx.x;
      c.y = ctx.y;
      run(sim, eid, onAbilityHit, c);
    };
  }
  const onCast = by.get('onCast');
  if (onCast) {
    hook.onCast = (sim, eid, slot) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.slot = slot;
      run(sim, eid, onCast, c);
    };
  }
  const onKill = by.get('onKill');
  if (onKill) {
    hook.onKill = (sim, eid, victim) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = victim;
      run(sim, eid, onKill, c);
    };
  }
  const onTakedown = by.get('onTakedown');
  if (onTakedown) {
    hook.onTakedown = (sim, eid, victim) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = victim;
      run(sim, eid, onTakedown, c);
    };
  }
  const damageHook =
    (list: CRule[]) =>
    (sim: Sim, eid: number, src: number, info: DamageInfo): void => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.source = src;
      c.damage = info.amount;
      c.absorbed = info.absorbed;
      c.dmgType = info.type;
      c.isAuto = info.isAuto;
      run(sim, eid, list, c);
    };
  const onDamageTaken = by.get('onDamageTaken');
  if (onDamageTaken) hook.onDamageTaken = damageHook(onDamageTaken);
  const onShieldBreak = by.get('onShieldBreak');
  if (onShieldBreak) hook.onShieldBreak = damageHook(onShieldBreak);

  const onTick = by.get('onTick') ?? [];
  const charged = rules.filter((r) => r.charges);
  const absorbing = rules.filter((r) => r.absorb && r.absorb.recharge);
  if (onTick.length || charged.length || absorbing.length) {
    hook.onTick = (sim, eid) => {
      if (charged.length || absorbing.length) upkeep(sim, eid);
      if (onTick.length) runLazy(sim, eid, onTick);
    };
  }
  function upkeep(sim: Sim, eid: number): void {
    const ps = psOf(sim, eid);
    for (const r of charged) {
      const rs = ps.rules[r.idx]!;
      if (rs.chargeNext > 0 && sim.tick >= rs.chargeNext) {
        rs.charges = Math.min(r.charges!.max, rs.charges + 1);
        rs.chargeNext = rs.charges < r.charges!.max ? sim.tick + r.charges!.regen : 0;
      }
    }
    for (const r of absorbing) {
      const rs = ps.rules[r.idx]!;
      if (rs.rechargeAt > 0 && sim.tick >= rs.rechargeAt) (rs.used = 0), (rs.rechargeAt = 0);
    }
  }

  // pure modifiers: no cooldowns or charges (validate.ts), state only for stack conditions
  const modDamage = by.get('modifyDamage');
  if (modDamage) {
    hook.modifyDamage = (sim, eid, t, amount, type, isAuto) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = t;
      c.dmgType = type;
      c.isAuto = isAuto;
      for (let i = 0; i < modDamage.length; i++) {
        const r = modDamage[i]!;
        let ok = true;
        for (let j = 0; j < r.gate.length && ok; j++) ok = r.gate[j]!(sim);
        for (let j = 0; j < r.conds.length && ok; j++) ok = r.conds[j]!(sim, eid, c);
        if (ok) amount *= r.mult;
      }
      return amount;
    };
  }
  const modHeal = by.get('modifyHeal');
  if (modHeal) {
    hook.modifyHeal = (sim, eid, t, amount) => {
      const c = mkCtx(sim, eid, itemId, psOf(sim, eid));
      c.target = t;
      for (let i = 0; i < modHeal.length; i++) {
        const r = modHeal[i]!;
        let ok = true;
        for (let j = 0; j < r.gate.length && ok; j++) ok = r.gate[j]!(sim);
        for (let j = 0; j < r.conds.length && ok; j++) ok = r.conds[j]!(sim, eid, c);
        if (ok) amount *= r.mult;
      }
      return amount;
    };
  }
  const stats = by.get('onComputeStats');
  if (stats) hook.onComputeStats = (sim, eid) => runLazy(sim, eid, stats);
  return { hook, rules, key };
}

const EMPTY_PS: PassiveState = { rules: [], stacks: {}, counters: {} };

// ------------------------------------------------------------------ queries

/** Remaining absorbDamage pool of the item's passive (Sturmgewand: `stormMantleLeft`). Read-only. */
export function absorbLeft(sim: Sim, eid: number, item: ItemData): number {
  const cmp = compiled(item, item.passive?.key ?? item.id);
  const r = cmp?.rules.find((x) => x.absorb);
  if (!cmp || !r?.absorb) return 0;
  const ps = itemState(sim).ent.get(eid)?.passives.get(cmp.key);
  return r.absorb.value(sim, eid, mkCtx(sim, eid, item.id, ps ?? EMPTY_PS)) - (ps?.rules[r.idx]?.used ?? 0);
}

/** Counter value of the item's passive (gold effects with `counter`). */
export function counterOf(sim: Sim, eid: number, item: ItemData, name: string): number {
  return itemState(sim).ent.get(eid)?.passives.get(item.passive?.key ?? item.id)?.counters[name] ?? 0;
}

// ------------------------------------------------------------------ actives + consumables

const useCache = new WeakMap<UseBase, Exec[]>();

/** Nearest champion to (x, y) that an active of `owner` may target, or -1. Enemies must be visible. */
function pickChampion(sim: Sim, eid: number, kind: ActiveTarget, range: number, x: number, y: number): number {
  const { Pos, Unit } = sim.c;
  const ox = Pos.x[eid]!;
  const oy = Pos.y[eid]!;
  const list =
    kind === 'allyChampion'
      ? alliedChampionsIn(sim, eid, ox, oy, range).filter((u) => u !== eid)
      : enemiesInRadius(sim, eid, ox, oy, range).filter((u) => Unit.kind[u] === Kind.Champion && sees(sim, Unit.team[eid]!, u) && !Unit.untargetable[u]);
  let best = -1;
  let bd = Infinity;
  for (const u of list) {
    if (dist2(ox, oy, Pos.x[u]!, Pos.y[u]!) > range * range) continue;
    const d = dist2(Pos.x[u]!, Pos.y[u]!, x, y);
    if (d < bd) (bd = d), (best = u);
  }
  return best;
}

/** Runs an active / consumable use. False = could not be used (stun, no target, immune, ward limit): no cooldown. */
export function runUse(sim: Sim, eid: number, item: ItemData, spec: UseBase, x: number, y: number): boolean {
  if (spec.requires?.includes('canAttack') && !canAttack(sim, eid)) return false;
  let target = -1;
  if (spec.target === 'allyChampion' || spec.target === 'enemyChampion') {
    target = pickChampion(sim, eid, spec.target, spec.range!, x, y);
    if (target < 0) return false;
  }
  let list = useCache.get(spec);
  if (!list) useCache.set(spec, (list = spec.effects.map(compileEffect)));
  const c = mkCtx(sim, eid, item.id, pstate(sim, eid, `${item.id}:use`, []));
  c.target = target;
  c.x = x;
  c.y = y;
  for (const ex of list) if (ex(sim, eid, c) === false) return false;
  return true;
}

/** Upkeep of owner-level pools before the hooks' onTick (potion): heals a share per tick, ends at death. */
export function tickPools(sim: Sim, eid: number): void {
  const s = itemState(sim).ent.get(eid);
  if (!s) return;
  if (!sim.c.Unit.alive[eid]) {
    s.wind = 0;
    for (const p of s.pools.values()) p[0] = 0;
  }
  for (const p of s.pools.values()) {
    if (p[0]! > 0) {
      const d = Math.min(p[0]!, p[1]!);
      p[0] = p[0]! - d;
      heal(sim, eid, d);
    }
  }
  if (s.wind > 0) {
    const d = Math.min(s.wind, s.windRate);
    s.wind -= d;
    heal(sim, eid, d);
  }
}

/** Heal-over-time from Second Wind (rune): replaces the running one. */
export function startSecondWind(sim: Sim, eid: number, total: number, ticks: number): void {
  const e = ent(sim, eid);
  e.wind = total;
  e.windRate = total / ticks;
}
