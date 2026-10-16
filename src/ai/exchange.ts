// ExchangeEstimate (spec-bots §6): who wins a fight over horizon T, from the bot's knowledge only. Core is a pure
// function over plain fighter specs (testable without a sim); exchangeFromSnapshot() builds the specs from a
// fog-filtered Snapshot. Rank noise (Iron +-40 %, Gold +-20 %, Challenger +-7 %) comes from the bot's own Rng.
// ponytail: one aggregated damage pool per side, no positioning/CC/mana/item actives; upgrade path = simulate the
// combo sequence per fighter with CC windows from ability effects.

import type { Rng } from '../sim/rng';
import type { ChampionData, Effect, Ranked, Scaling } from '../sim/champions/schema';
import { championData } from '../sim/champions';
import { growthFactor } from '../sim/systems/stats';
import { towerBaseDamage, TOWER_AS, TOWER_RADIUS, TOWER_RANGE } from '../sim/systems/towers';
import { MINION_DMG_VS_CHAMP_STRUCT, MINION_STATS, minionScale } from '../sim/systems/minions';
import type { Snapshot, SnapEntity } from '../sim/snapshot';
import { CHAMP_ABILITY_DMG_MULT, Kind, TICK_HZ, isMinion } from '../sim/types';
import type { ExchangeResult } from './contract';

export interface FighterStats {
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  as: number;
}

export interface FighterSpec {
  champ: ChampionData;
  level: number;
  hp: number;
  maxHp: number;
  shield?: number;
  /** Known final stats (own champion); else estimated from base + level growth + itemValue. */
  stats?: FighterStats;
  /** Item value in gold (fog-safe scoreboard field) for the stat estimate. */
  itemValue?: number;
  /** Q W E R ranks; unknown -> estimateRanks(champ, level). */
  ranks?: readonly number[];
  /** Seconds until Q W E R are ready; undefined entry = unknown (rank policy, see unknownReadyFactor). */
  cdLeft?: readonly (number | undefined)[];
  /** Orbwalk quality 0..1 (bot: knobs.orbwalkChance); default 0.5. */
  orbwalk?: number;
}

export interface ExchangeInput {
  /** allies[0] = the bot itself (deathProb is about it). */
  allies: FighterSpec[];
  /** enemies[0] = the main target (killProb is about it). */
  enemies: FighterSpec[];
  horizonS: number;
  gameTimeS: number;
  /** Enemy minions that would aggro onto our side / allied minions onto theirs (capped at 6). */
  enemyMinions?: number;
  allyMinions?: number;
  /** Tower (tier 0..3) shooting at our side (we are under their tower) / at their side. */
  enemyTower?: { tier: number } | null;
  allyTower?: { tier: number } | null;
}

export interface ExchangeDetail extends ExchangeResult {
  /** Mitigated damage dealt by allies / taken from enemies over T, before noise. */
  dealt: number;
  taken: number;
  /** Noise multipliers applied (1 +- exchangeNoise(skill)). */
  noiseDealt: number;
  noiseTaken: number;
  /** Side HP fractions after T (effective HP incl. shields/heals, over max HP). */
  allyHpAfter: number;
  enemyHpAfter: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const rv = (v: Ranked, rank: number): number => (typeof v === 'number' ? v : (v[clamp(rank - 1, 0, v.length - 1)] ?? 0));
const mit = (resist: number): number => (resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist));

/** Estimation noise by skill: piecewise linear 0.40 @ Iron (5), 0.20 @ Gold (45), 0.07 @ Challenger (100). */
export function exchangeNoise(skill: number): number {
  if (skill <= 5) return 0.4;
  if (skill <= 45) return 0.4 - (0.2 * (skill - 5)) / 40;
  if (skill <= 100) return 0.2 - (0.13 * (skill - 45)) / 55;
  return 0.07;
}

/**
 * Expected availability of an ability whose cooldown is unknown (spec §6: Iron assumes everything ready,
 * Challenger estimates). ponytail: flat expectation by skill; L's EnemyTrack.cds supplies real timers.
 */
export const unknownReadyFactor = (skill: number): number => 1 - 0.3 * clamp((skill - 5) / 95, 0, 1);

/** Ability ranks from level + maxOrder (R at 6/11/16, one point each first, then max order). */
export function estimateRanks(champ: ChampionData, level: number): number[] {
  const lv = clamp(Math.round(level), 1, 18);
  const r = (lv >= 6 ? 1 : 0) + (lv >= 11 ? 1 : 0) + (lv >= 16 ? 1 : 0);
  const idx = (k: 'Q' | 'W' | 'E'): number => ({ Q: 0, W: 1, E: 2 })[k];
  const ranks = [0, 0, 0, r];
  let pts = lv - r;
  for (const k of champ.maxOrder) if (pts > 0) (ranks[idx(k)]! += 1), pts--;
  for (const k of champ.maxOrder) {
    const i = idx(k);
    const add = Math.min(pts, 5 - ranks[i]!);
    ranks[i]! += add;
    pts -= add;
  }
  return ranks;
}

/** Stats from base + level growth, plus a crude item estimate from itemValue (1 AD ~ 35 g, 1 AP ~ 22 g). */
export function estimateStats(champ: ChampionData, level: number, itemValue = 0): FighterStats {
  const b = champ.base;
  const g = growthFactor(clamp(level, 1, 18));
  const magic = damageTypeShare(champ) > 0.5;
  const offense = itemValue * 0.6;
  const defense = itemValue * 0.15;
  return {
    ad: b.ad + b.adGrowth * g + (magic ? 0 : offense / 35),
    ap: magic ? offense / 22 : 0,
    armor: b.armor + b.armorGrowth * g + defense / 40,
    mr: b.mr + b.mrGrowth * g + defense / 40,
    as: Math.min(2.5, b.as * (1 + (b.asGrowth * g) / 100 + (magic ? 0 : itemValue / 3000) * 0.3)),
  };
}

/** Share of ability damage scaling with AP (0 = pure AD champion). */
function damageTypeShare(champ: ChampionData): number {
  let ap = 0;
  let ad = 0;
  for (const a of champ.abilities)
    for (const e of a.effects)
      if (e.kind === 'damage') {
        ap += e.amount.ap ?? 0;
        ad += (e.amount.ad ?? 0) + (e.amount.bonusAd ?? 0);
      }
  return ap + ad > 0 ? ap / (ap + ad) : 0;
}

function scale(s: Scaling, f: FighterSpec, st: FighterStats, rank: number, target: FighterSpec | undefined): number {
  const b = f.champ.base;
  const g = growthFactor(clamp(f.level, 1, 18));
  let v = s.byLevel ? s.byLevel[0] + ((s.byLevel[1] - s.byLevel[0]) * (clamp(f.level, 1, 18) - 1)) / 17 : rv(s.base, rank);
  v += (s.ad ?? 0) * st.ad + (s.bonusAd ?? 0) * Math.max(0, st.ad - (b.ad + b.adGrowth * g)) + (s.ap ?? 0) * st.ap;
  v += (s.maxHp ?? 0) * f.maxHp + (s.bonusHp ?? 0) * Math.max(0, f.maxHp - (b.hp + b.hpGrowth * g));
  if (target) v += (s.targetMaxHp ?? 0) * target.maxHp + (s.targetMissingHp ?? 0) * Math.max(0, target.maxHp - target.hp) * 0.5;
  return v;
}

const isOwnSide = (e: Effect): boolean => 'target' in e && (e.target === 'self' || e.target === 'ally' || e.target === 'allies');

/** One side's output over T: mitigated damage on the opposing main target, plus own heals/shields. */
function sideOutput(side: FighterSpec[], foes: FighterSpec[], T: number, skill: number): { damage: number; sustain: number } {
  const target = foes[0];
  const armor = foes.length ? foes.reduce((a, f) => a + (f.stats ?? estimateStats(f.champ, f.level, f.itemValue)).armor, 0) / foes.length : 0;
  const mr = foes.length ? foes.reduce((a, f) => a + (f.stats ?? estimateStats(f.champ, f.level, f.itemValue)).mr, 0) / foes.length : 0;
  let damage = 0;
  let sustain = 0;
  const unknownReady = unknownReadyFactor(skill);
  for (const f of side) {
    const st = f.stats ?? estimateStats(f.champ, f.level, f.itemValue);
    const ranks = f.ranks ?? estimateRanks(f.champ, f.level);
    let castTime = 0;
    for (let s = 0; s < 4; s++) {
      const rank = ranks[s] ?? 0;
      const ab = f.champ.abilities[s];
      if (!ab || rank <= 0) continue;
      const known = f.cdLeft?.[s];
      const first = known ?? 0;
      if (first > T) continue;
      const cd = Math.max(1, rv(ab.cooldown, rank));
      // ponytail: at most 3 casts per ability in the window (mana not modelled)
      const casts = Math.min(3, 1 + Math.floor((T - first) / cd));
      const avail = known === undefined ? unknownReady : 1;
      castTime += ab.castTime * casts;
      for (const e of ab.effects) {
        if (e.kind === 'damage' && !isOwnSide(e)) {
          const raw = scale(e.amount, f, st, rank, target);
          const m = e.type === 'phys' ? mit(armor) : e.type === 'magic' ? mit(mr) : 1;
          damage += raw * m * casts * avail * CHAMP_ABILITY_DMG_MULT;
        } else if ((e.kind === 'heal' || e.kind === 'shield') && (e.target === 'self' || e.target === 'ally' || e.target === 'allies')) {
          sustain += scale(e.amount, f, st, rank, undefined) * casts * avail;
        }
      }
    }
    const tAuto = Math.max(0, T - castTime);
    const orb = 0.75 + 0.25 * clamp(f.orbwalk ?? 0.5, 0, 1);
    damage += st.ad * st.as * tAuto * orb * mit(armor);
  }
  return { damage, sustain };
}

/** Minion + tower damage on a side over T (mitigated by that side's average armor). */
function environment(minions: number, tower: { tier: number } | null | undefined, T: number, gameTimeS: number, armor: number): number {
  const scaleM = minionScale(Math.round(gameTimeS * TICK_HZ));
  const melee = MINION_STATS[Kind.MinionMelee]!;
  const caster = MINION_STATS[Kind.MinionCaster]!;
  const minionDps = ((melee.ad * melee.as + caster.ad * caster.as) / 2) * scaleM * MINION_DMG_VS_CHAMP_STRUCT;
  let d = clamp(minions, 0, 6) * minionDps * T;
  if (tower) {
    const shots = Math.floor(TOWER_AS * T + 0.5);
    const base = towerBaseDamage(clamp(tower.tier, 0, 3), Math.round(gameTimeS * TICK_HZ));
    for (let k = 0; k < shots; k++) d += base * (1 + 0.4 * Math.min(3, k));
  }
  return d * mit(armor);
}

const ehp = (f: FighterSpec): number => Math.max(0, f.hp) + Math.max(0, f.shield ?? 0);

/**
 * ExchangeEstimate for both sides over input.horizonS. winProb from the HP fractions after T, killProb for
 * enemies[0], deathProb for allies[0]. Noise: each side's damage x (1 + u * exchangeNoise(skill)), u uniform in
 * [-1, 1] from `rng` (no rng = exact).
 */
export function exchangeEstimate(input: ExchangeInput, opts: { skill?: number; rng?: Rng } = {}): ExchangeDetail {
  const skill = opts.skill ?? 100;
  const T = Math.max(0, input.horizonS);
  const avgArmor = (side: FighterSpec[]): number => (side.length ? side.reduce((a, f) => a + (f.stats ?? estimateStats(f.champ, f.level, f.itemValue)).armor, 0) / side.length : 0);
  const out = sideOutput(input.allies, input.enemies, T, skill);
  const inc = sideOutput(input.enemies, input.allies, T, skill);
  const dealt = out.damage + environment(input.allyMinions ?? 0, input.allyTower, T, input.gameTimeS, avgArmor(input.enemies));
  const taken = inc.damage + environment(input.enemyMinions ?? 0, input.enemyTower, T, input.gameTimeS, avgArmor(input.allies));
  const n = exchangeNoise(skill);
  const noiseDealt = opts.rng ? 1 + n * (opts.rng.next() * 2 - 1) : 1;
  const noiseTaken = opts.rng ? 1 + n * (opts.rng.next() * 2 - 1) : 1;
  const dealtN = dealt * noiseDealt;
  const takenN = taken * noiseTaken;

  const sum = (side: FighterSpec[], fn: (f: FighterSpec) => number): number => side.reduce((a, f) => a + fn(f), 0);
  const allyMax = Math.max(1, sum(input.allies, (f) => f.maxHp));
  const enemyMax = Math.max(1, sum(input.enemies, (f) => f.maxHp));
  const allyPool = sum(input.allies, ehp) + out.sustain;
  const enemyPool = sum(input.enemies, ehp) + inc.sustain;
  const allyHpAfter = clamp((allyPool - takenN) / allyMax, 0, 1.5);
  const enemyHpAfter = clamp((enemyPool - dealtN) / enemyMax, 0, 1.5);

  // focus: the main target / the bot takes a focus-weighted share of its side's incoming damage
  const share = (n: number): number => Math.min(1, 1.5 / Math.max(1, n));
  const self = input.allies[0];
  const tgt = input.enemies[0];
  const killRatio = tgt ? (dealtN * share(input.enemies.length)) / Math.max(1, ehp(tgt) + inc.sustain / Math.max(1, input.enemies.length)) : 0;
  const deathRatio = self ? (takenN * share(input.allies.length)) / Math.max(1, ehp(self) + out.sustain / Math.max(1, input.allies.length)) : 0;
  return {
    winProb: sig(5 * (allyHpAfter - enemyHpAfter)),
    killProb: tgt ? sig((killRatio - 1) / 0.15) : 0,
    deathProb: self ? sig((deathRatio - 1) / 0.15) : 0,
    dealt,
    taken,
    noiseDealt,
    noiseTaken,
    allyHpAfter,
    enemyHpAfter,
  };
}

// ------------------------------------------------------------------ snapshot builder

export interface SnapshotExchangeOpts {
  /** Entity ids; allies[0] should be the bot itself (snap.me.eid). */
  allies: number[];
  enemies: number[];
  horizonS: number;
  /** Bot skill (after variance) for noise and unknown-cooldown policy. */
  skill: number;
  rng?: Rng;
  /** Known enemy cooldowns: player slot -> seconds until Q W E R ready (undefined = unknown). */
  knownCds?: ReadonlyMap<number, readonly (number | undefined)[]>;
  /** Own orbwalk quality (knobs.orbwalkChance). */
  orbwalk?: number;
}

/** Spec §6 from the bot's fog-filtered view: entities, own HUD (stats, ranks, cooldowns), scoreboard item value. */
export function exchangeFromSnapshot(snap: Snapshot, o: SnapshotExchangeOpts): ExchangeDetail {
  const byId = new Map(snap.entities.map((e) => [e.id, e]));
  const rows = new Map(snap.players.map((r) => [r.slot, r]));
  const spec = (e: SnapEntity, own: boolean): FighterSpec => {
    const champ = championData(e.champ ?? '');
    const base: FighterSpec = { champ, level: Math.max(1, e.level), hp: e.hp, maxHp: e.maxHp, shield: e.shield, itemValue: rows.get(e.slot)?.itemValue ?? 0 };
    if (snap.me && e.id === snap.me.eid) {
      const me = snap.me;
      return { ...base, stats: me.stats, ranks: me.abilities.map((a) => a.rank), cdLeft: me.abilities.map((a) => a.cdLeft), orbwalk: o.orbwalk };
    }
    if (!own) {
      const cds = o.knownCds?.get(e.slot);
      if (cds) base.cdLeft = cds;
    }
    return base;
  };
  const pick = (ids: number[], own: boolean): FighterSpec[] =>
    ids.map((id) => byId.get(id)).filter((e): e is SnapEntity => !!e && e.alive && e.kind === Kind.Champion).map((e) => spec(e, own));
  const allyEnts = o.allies.map((id) => byId.get(id)).filter((e): e is SnapEntity => !!e);
  const enemyEnts = o.enemies.map((id) => byId.get(id)).filter((e): e is SnapEntity => !!e);
  const near = (list: SnapEntity[], x: number, y: number, r: number): boolean => list.some((a) => (a.x - x) ** 2 + (a.y - y) ** 2 <= r * r);
  let enemyMinions = 0;
  let allyMinions = 0;
  let enemyTower: { tier: number } | null = null;
  let allyTower: { tier: number } | null = null;
  for (const e of snap.entities) {
    if (!e.alive) continue;
    if (isMinion(e.kind)) {
      if (e.team !== snap.team && near(allyEnts, e.x, e.y, 700)) enemyMinions++;
      else if (e.team === snap.team && near(enemyEnts, e.x, e.y, 700)) allyMinions++;
    } else if (e.kind === Kind.Tower) {
      // ponytail: tier unknown in the snapshot, assume inner (1)
      const reach = TOWER_RANGE + TOWER_RADIUS + 65;
      if (e.team !== snap.team && allyEnts[0] && near([allyEnts[0]], e.x, e.y, reach)) enemyTower = { tier: 1 };
      if (e.team === snap.team && enemyEnts[0] && near([enemyEnts[0]], e.x, e.y, reach)) allyTower = { tier: 1 };
    }
  }
  return exchangeEstimate(
    { allies: pick(o.allies, true), enemies: pick(o.enemies, false), horizonS: o.horizonS, gameTimeS: snap.time, enemyMinions, allyMinions, enemyTower, allyTower },
    { skill: o.skill, rng: o.rng },
  );
}
