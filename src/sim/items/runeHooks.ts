// Prägungen (runes) in the sim (Agent I). The rune page comes from PlayerSetup.runes (default preset if missing),
// resolved per champion on first use. Stat runes fold into inventory.bonusStats (permanent stats); keystones and
// hook minors are PassiveHooks appended by itemHooks.extraHooksOf. Numbers: docs/DECISIONS.md ("Items + Prägungen").

import type { Sim } from '../sim';
import type { ItemHook } from './itemHooks';
import type { BonusStat } from './inventory';
import type { RuneData } from './schema';
import { Kind, sec } from '../types';
import { championData, champIdOf } from '../champions';
import { addBuff, buffs } from '../buffs';
import { dealDamage, heal, lastCombatTick } from '../damage';
import { ITEM_SLOTS, inventory, itemById, itemStats } from './inventory';
import { RUNES, defaultRunes, type RuneChoice } from './runes';
import { startSecondWind } from './itemHooks';

const RUNE_BY_ID = new Map(RUNES.map((r) => [r.id, r]));
export const runeById = (id: string): RuneData | undefined => RUNE_BY_ID.get(id);

// ------------------------------------------------------------------ numbers (docs/DECISIONS.md)

/** Adaptive minor: +9 AD or +15 AP. */
export const ADAPTIVE_AP_PER_AD = 15 / 9;
/** Lasting Harm: 3 separate hits (distinct ticks) within 3 s; 30-180 by level + 40 % bonus AD + 25 % AP; CD 25 s. */
export const HARM = { hits: 3, window: sec(3), min: 30, max: 180, bonusAd: 0.4, ap: 0.25, cd: sec(25) };
export const PRECISION = { pct: 8, max: 6, ticks: sec(6) };
/** Grit: in combat = dealt/took damage within the last 3 s; ready after 4 s of combat. */
export const GRIT = { leave: sec(3), after: sec(4), healPct: 0.02, dmgPct: 0.03 };
/** Inspiration: free Uhrmacherstiefel at 12:00 if no boots owned; boots cost -10 % before. */
export const INSPIRATION = { at: sec(12 * 60), boots: 'stiefel_hast', discount: 0.9 };
/** Mana Flow: +25 max mana per champion ability hit, max 250, at most once per 6 s. */
export const MANA_FLOW = { per: 25, max: 10, icd: sec(6) };
export const SECOND_WIND = { pct: 0.06, ticks: sec(10) };
export const COUP = { below: 0.4, mult: 1.08 };
export const VIGILANCE_WARD_MULT = 1.1;

/** Archetypes whose adaptive tie-break (no items yet) goes to AP. */
const AP_ARCHETYPES = new Set(['burst_mage', 'skillshot_mage', 'battlemage', 'control_mage', 'enchanter', 'healer']);

// ------------------------------------------------------------------ state

interface RuneEnt {
  harmReady: number;
  /** Lasting Harm: victim eid -> ticks of separate hits in the window. */
  harm: Map<number, number[]>;
  /** Grit: tick the current combat started (-1 = out of combat). */
  gritSince: number;
  manaFlow: number;
  manaFlowNext: number;
  bootsDone: boolean;
}

interface RuneState {
  /** Resolved rune page per champion eid (null = none, e.g. not a player champion). */
  page: Map<number, RuneChoice | null>;
  ent: Map<number, RuneEnt>;
}

function runeState(sim: Sim): RuneState {
  let s = sim.state.runes as RuneState | undefined;
  if (!s) sim.state.runes = s = { page: new Map(), ent: new Map() };
  return s;
}

function ent(sim: Sim, eid: number): RuneEnt {
  const s = runeState(sim);
  let e = s.ent.get(eid);
  if (!e) s.ent.set(eid, (e = { harmReady: 0, harm: new Map(), gritSince: -1, manaFlow: 0, manaFlowNext: 0, bootsDone: false }));
  return e;
}

/** Rune page of a champion: PlayerSetup.runes, else the champion's default preset. Unknown rune ids are ignored. */
export function runePageOf(sim: Sim, eid: number): RuneChoice | null {
  const s = runeState(sim);
  if (s.page.has(eid)) return s.page.get(eid)!;
  const { Unit } = sim.c;
  let page: RuneChoice | null = null;
  if (Unit.kind[eid] === Kind.Champion && Unit.slot[eid]! >= 0) {
    const p = sim.config.players.find((x) => x.slot === Unit.slot[eid]);
    page = p?.runes ?? defaultRunes(champIdOf(sim, eid));
  }
  s.page.set(eid, page);
  return page;
}

function runesOf(sim: Sim, eid: number): RuneData[] {
  const p = runePageOf(sim, eid);
  if (!p) return [];
  return [p.keystone, ...p.minor].flatMap((id) => {
    const r = runeById(id);
    return r ? [r] : [];
  });
}

export const hasRune = (sim: Sim, eid: number, id: string): boolean => runesOf(sim, eid).some((r) => r.id === id);

/** Adaptive: AP if item AP beats item AD; tie (e.g. no items) by archetype. */
export function adaptiveIsAp(sim: Sim, eid: number): boolean {
  const it = itemStats(sim, eid);
  const ad = it.ad ?? 0;
  const ap = it.ap ?? 0;
  if (ap !== ad) return ap > ad;
  return AP_ARCHETYPES.has(championData(champIdOf(sim, eid)).archetype);
}

/** Permanent stats from runes (minor stat runes, keystone stats, Mana Flow stacks). inventory.bonusStats adds these. */
export function runeStats(sim: Sim, eid: number): Partial<Record<BonusStat, number>> {
  const out: Partial<Record<BonusStat, number>> = {};
  const add = (k: BonusStat, v: number): void => void (out[k] = (out[k] ?? 0) + v);
  for (const r of runesOf(sim, eid)) {
    for (const [k, v] of Object.entries(r.stats ?? {}) as [BonusStat | 'adaptive', number][]) {
      if (k === 'adaptive') {
        if (adaptiveIsAp(sim, eid)) add('ap', v * ADAPTIVE_AP_PER_AD);
        else add('ad', v);
      } else add(k, v);
    }
  }
  const mf = runeState(sim).ent.get(eid)?.manaFlow ?? 0;
  if (mf > 0) add('mana', mf * MANA_FLOW.per);
  return out;
}

// ------------------------------------------------------------------ hooks

const isEnemyChamp = (sim: Sim, eid: number, t: number): boolean => sim.c.Unit.kind[t] === Kind.Champion && sim.c.Unit.team[t] !== sim.c.Unit.team[eid];

function lastingHarm(sim: Sim, eid: number, t: number): void {
  if (!isEnemyChamp(sim, eid, t)) return;
  const e = ent(sim, eid);
  if (sim.tick < e.harmReady) return;
  // ponytail: "separate" = distinct ticks; one multi-hit resolution counts once, two hits in the same tick once
  const list = (e.harm.get(t) ?? []).filter((k) => sim.tick - k < HARM.window);
  if (list[list.length - 1] !== sim.tick) list.push(sim.tick);
  e.harm.set(t, list);
  if (list.length < HARM.hits) return;
  e.harm.clear();
  e.harmReady = sim.tick + HARM.cd;
  const { Stats, Champ } = sim.c;
  const lvl = Math.max(1, Champ.level[eid]!);
  const amount = HARM.min + ((HARM.max - HARM.min) * (lvl - 1)) / 17 + HARM.bonusAd * Stats.bonusAd[eid]! + HARM.ap * Stats.ap[eid]!;
  dealDamage(sim, eid, t, amount, adaptiveIsAp(sim, eid) ? 'magic' : 'phys');
}

export const RUNE_HOOKS: Record<string, ItemHook> = {
  rune_lasting_harm: {
    onAutoHit: (sim, eid, t) => lastingHarm(sim, eid, t),
    onAbilityHit: (sim, eid, t) => lastingHarm(sim, eid, t),
  },
  rune_precision: {
    onAutoHit(sim, eid, t) {
      if (!isEnemyChamp(sim, eid, t)) return;
      const b = buffs(sim, eid).find((x) => x.id === 'praezision' && x.kind === 'stat' && x.until > sim.tick);
      const n = Math.min(PRECISION.max, (b ? Math.round(b.pct / PRECISION.pct) : 0) + 1);
      addBuff(sim, eid, { kind: 'stat', stat: 'as', id: 'praezision', src: eid, pct: PRECISION.pct * n, ticks: PRECISION.ticks });
    },
  },
  rune_grit: {
    onTick(sim, eid) {
      const e = ent(sim, eid);
      const inCombat = sim.c.Unit.alive[eid] && sim.tick - lastCombatTick(sim, eid) <= GRIT.leave;
      if (!inCombat) e.gritSince = -1;
      else if (e.gritSince < 0) e.gritSince = sim.tick;
    },
    onAutoHit(sim, eid, t) {
      const e = ent(sim, eid);
      if (!isEnemyChamp(sim, eid, t) || e.gritSince < 0 || sim.tick - e.gritSince < GRIT.after) return;
      e.gritSince = sim.tick; // next proc after another 4 s of combat
      const max = sim.c.Hp.max[eid]!;
      heal(sim, eid, max * GRIT.healPct);
      dealDamage(sim, eid, t, max * GRIT.dmgPct, 'magic');
    },
  },
  rune_inspiration: {
    onTick(sim, eid) {
      const e = ent(sim, eid);
      if (e.bootsDone || sim.tick < INSPIRATION.at || sim.tick % 30 !== 0) return;
      const inv = inventory(sim, eid);
      if (inv.some((id) => id && itemById(id)?.unique === 'boots')) {
        e.bootsDone = true;
        return;
      }
      const slot = inv.findIndex((x, i) => i < ITEM_SLOTS && x === null);
      if (slot < 0) return; // full inventory: retry every second
      inv[slot] = INSPIRATION.boots;
      e.bootsDone = true;
    },
  },
  rune_mana_flow: {
    onAbilityHit(sim, eid, t) {
      if (!isEnemyChamp(sim, eid, t) || championData(champIdOf(sim, eid)).resource !== 'mana') return;
      const e = ent(sim, eid);
      if (e.manaFlow >= MANA_FLOW.max || sim.tick < e.manaFlowNext) return;
      e.manaFlow++;
      e.manaFlowNext = sim.tick + MANA_FLOW.icd;
    },
  },
  rune_second_wind: {
    onDamageTaken(sim, eid, src) {
      if (src < 0 || !isEnemyChamp(sim, eid, src)) return;
      const { Hp } = sim.c;
      startSecondWind(sim, eid, Math.max(0, Hp.max[eid]! - Hp.cur[eid]!) * SECOND_WIND.pct, SECOND_WIND.ticks);
    },
  },
  rune_coup: {
    modifyDamage(sim, eid, t, amount) {
      const { Hp } = sim.c;
      return isEnemyChamp(sim, eid, t) && Hp.cur[t]! < Hp.max[t]! * COUP.below ? amount * COUP.mult : amount;
    },
  },
  // rune_vigilance: stats only (+5 haste); ward lifetime via wardDurationMult (Agent J's ward code).
};

/** Hooks of the champion's keystone + hook minors. */
export function runeHooksOf(sim: Sim, eid: number): ItemHook[] {
  const out: ItemHook[] = [];
  for (const r of runesOf(sim, eid)) {
    const h = r.hook ? RUNE_HOOKS[r.hook] : undefined;
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** Shop price multiplier for boots (Inspiration before 12:00). inventory.quote applies it. */
export function bootsPriceMult(sim: Sim, eid: number): number {
  return sim.tick < INSPIRATION.at && hasRune(sim, eid, 'inspiration') ? INSPIRATION.discount : 1;
}

/** Ward lifetime multiplier (Wachsamkeit +10 %). For Agent J's ward placement. */
export function wardDurationMult(sim: Sim, eid: number): number {
  return hasRune(sim, eid, 'wachsamkeit') ? VIGILANCE_WARD_MULT : 1;
}
