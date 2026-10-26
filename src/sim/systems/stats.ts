// Final stats each tick: buff upkeep, champion base + level growth + buffs, buffs on top of non-champion base.
// Non-champions (minions, towers, monsters: Agent A writes Stats at spawn) get their spawn stats snapshotted
// lazily per Unit.serial; if their owner rewrites a stat later, the new value becomes the base.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import type { System } from './index';
import { Kind } from '../types';
import { MAX_ENT } from '../ecs';
import { canMove, statMods, strongestSlow, tickBuffs } from '../buffs';
import { championData, passiveHooksOf } from '../champions';
import { movementLocked } from './abilities';
import { applySecondaryStats, bonusStats } from '../items/inventory';

const AS_CAP = 2.5;
const FIELDS = ['ad', 'ap', 'armor', 'mr', 'as', 'ms'] as const;
type Field = (typeof FIELDS)[number];

interface StatsState {
  serial: Int32Array;
  base: Record<Field, Float64Array>;
  written: Record<Field, Float64Array>;
  /** Champion max HP from base + growth (for bonus-HP ratios). */
  baseHp: Float64Array;
}

function statsState(sim: Sim): StatsState {
  let s = sim.state.stats as StatsState | undefined;
  if (!s) {
    const rec = (): Record<Field, Float64Array> => Object.fromEntries(FIELDS.map((f) => [f, new Float64Array(MAX_ENT)])) as Record<Field, Float64Array>;
    s = { serial: new Int32Array(MAX_ENT), base: rec(), written: rec(), baseHp: new Float64Array(MAX_ENT) };
    sim.state.stats = s;
  }
  return s;
}

export const statsSystem: System = {
  name: 'stats',
  update(sim) {
    tickBuffs(sim);
    const { Unit } = sim.c;
    const ents = query(sim.world, [Unit]);
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i]!;
      if (!Unit.alive[eid]) continue;
      if (Unit.kind[eid] === Kind.Champion) computeChampionStats(sim, eid, false);
      else applyUnitBuffs(sim, eid);
    }
  },
};

/** LoL growth curve: stat at level = base + growth * (lvl-1) * (0.7025 + 0.0175 * (lvl-1)). */
export const growthFactor = (level: number): number => (level - 1) * (0.7025 + 0.0175 * (level - 1));

/** LoL movement speed soft caps (champions). */
export function softCapMs(ms: number): number {
  if (ms > 490) return ms * 0.5 + 230;
  if (ms > 415) return ms * 0.8 + 83;
  if (ms < 220) return ms * 0.5 + 110;
  return ms;
}

/** Movement after slows/buffs: (base + flat) * (1 + pct) * (1 - strongest slow). */
function finalMs(sim: Sim, eid: number, base: number): number {
  const [pct, flat] = statMods(sim, eid, 'ms');
  return (base + flat) * (1 + pct / 100) * (1 - strongestSlow(sim, eid) / 100);
}

export function computeChampionStats(sim: Sim, eid: number, initial: boolean): void {
  const { Stats, Hp, Mana, Champ, Unit } = sim.c;
  const d = championData(sim.championIds[Unit.champ[eid]!] ?? '');
  const b = d.base;
  const g = growthFactor(Math.max(1, Champ.level[eid]!));
  const st = statsState(sim);

  const it = bonusStats(sim, eid); // items + jungle buffs (Agent H, src/sim/items/inventory.ts)
  const hpMax = b.hp + b.hpGrowth * g + (it.hp ?? 0);
  st.baseHp[eid] = hpMax - (it.hp ?? 0);
  const manaMax = d.resource === 'mana' ? b.mana + b.manaGrowth * g + (it.mana ?? 0) : d.resource === 'energy' ? 200 : 0;
  if (initial) {
    Hp.max[eid] = Hp.cur[eid] = hpMax;
    Mana.max[eid] = Mana.cur[eid] = manaMax;
  } else {
    // LoL: gaining max HP/mana also grants the same amount of current HP/mana
    const dh = hpMax - Hp.max[eid]!;
    Hp.max[eid] = hpMax;
    Hp.cur[eid] = Math.min(hpMax, Hp.cur[eid]! + Math.max(0, dh));
    const dm = manaMax - Mana.max[eid]!;
    Mana.max[eid] = manaMax;
    Mana.cur[eid] = Math.min(manaMax, Mana.cur[eid]! + Math.max(0, dm));
  }
  Hp.regen[eid] = ((b.hpRegen + b.hpRegenGrowth * g) / 5) * (1 + (it.hpRegenPct ?? 0) / 100);
  Mana.regen[eid] = d.resource === 'mana' ? ((b.manaRegen + b.manaRegenGrowth * g) / 5) * (1 + (it.manaRegenPct ?? 0) / 100) : d.resource === 'energy' ? 10 : 0;

  const adBase = b.ad + b.adGrowth * g;
  const [adPct, adFlat] = statMods(sim, eid, 'ad');
  Stats.ad[eid] = (adBase + adFlat + (it.ad ?? 0)) * (1 + (adPct + (it.adPct ?? 0)) / 100);
  Stats.bonusAd[eid] = Stats.ad[eid]! - adBase;
  const [apPct, apFlat] = statMods(sim, eid, 'ap');
  Stats.ap[eid] = (apFlat + (it.ap ?? 0)) * (1 + (apPct + (it.apPct ?? 0)) / 100);
  const [arPct, arFlat] = statMods(sim, eid, 'armor');
  Stats.armor[eid] = (b.armor + b.armorGrowth * g + arFlat + (it.armor ?? 0)) * (1 + arPct / 100);
  const [mrPct, mrFlat] = statMods(sim, eid, 'mr');
  Stats.mr[eid] = (b.mr + b.mrGrowth * g + mrFlat + (it.mr ?? 0)) * (1 + mrPct / 100);
  applySecondaryStats(sim, eid, it); // crit, lifesteal, lethality, haste (delta-applied, keeps hook writes)
  // AS = base * (1 + bonus%), level growth counts as bonus AS (spec)
  const asBonus = b.asGrowth * g + statMods(sim, eid, 'as')[0] + (it.asPct ?? 0);
  Stats.as[eid] = Math.min(AS_CAP, b.as * (1 + asBonus / 100));
  Stats.range[eid] = b.range + statMods(sim, eid, 'range')[1]; // flat range buffs
  Stats.windup[eid] = b.windup;
  Stats.tenacity[eid] = Math.min(1, (statMods(sim, eid, 'tenacity')[0] + (it.tenacity ?? 0)) / 100);
  // G/V1: penetration from items (percent values in items.json are 0..100); hooks may adjust in onComputeStats
  Stats.armorPenPct[eid] = Math.min(1, (it.armorPenPct ?? 0) / 100);
  Stats.magicPenPct[eid] = Math.min(1, (it.magicPenPct ?? 0) / 100);
  Stats.magicPen[eid] = it.magicPen ?? 0;
  const ms = softCapMs(finalMs(sim, eid, b.ms + (it.msFlat ?? 0)) * (1 + (it.msPct ?? 0) / 100));
  Stats.ms[eid] = !canMove(sim, eid) || movementLocked(sim, eid) ? 0 : ms;
  for (const h of passiveHooksOf(sim, eid)) h.onComputeStats?.(sim, eid);
}

/** Base HP (base + growth) of a champion; used by bonus-HP ratios. */
export const baseMaxHp = (sim: Sim, eid: number): number => statsState(sim).baseHp[eid] || sim.c.Hp.max[eid]!;

function applyUnitBuffs(sim: Sim, eid: number): void {
  const { Stats, Unit } = sim.c;
  const st = statsState(sim);
  if (st.serial[eid] !== Unit.serial[eid]) {
    st.serial[eid] = Unit.serial[eid]!;
    for (const f of FIELDS) st.base[f][eid] = st.written[f][eid] = Stats[f][eid]!;
  } else {
    for (const f of FIELDS) if (Stats[f][eid] !== st.written[f][eid]) st.base[f][eid] = Stats[f][eid]!; // owner rewrote it
  }
  const base = (f: Field): number => st.base[f][eid]!;
  const mod = (f: 'ad' | 'ap' | 'armor' | 'mr'): number => {
    const [pct, flat] = statMods(sim, eid, f);
    return (base(f) + flat) * (1 + pct / 100);
  };
  Stats.ad[eid] = mod('ad');
  Stats.ap[eid] = mod('ap');
  Stats.armor[eid] = mod('armor');
  Stats.mr[eid] = mod('mr');
  Stats.as[eid] = Math.min(AS_CAP, base('as') * (1 + statMods(sim, eid, 'as')[0] / 100));
  Stats.ms[eid] = base('ms') > 0 && canMove(sim, eid) ? finalMs(sim, eid, base('ms')) : 0;
  for (const f of FIELDS) st.written[f][eid] = Stats[f][eid]!;
}
