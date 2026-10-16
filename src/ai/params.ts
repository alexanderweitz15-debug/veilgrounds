// Bot parameters (spec-bots §2, §10): rank profile -> variance offset -> champion bias (rolled styles only) ->
// playstyle axes -> knobs; tilt is applied at runtime via withTilt(). Everything numeric comes from
// data/bots/playstyleAxes.json, data/bots/archetypes.json and the rank profiles. Bot code only, never the Sim.

import axesJson from '../data/bots/playstyleAxes.json';
import archJson from '../data/bots/archetypes.json';
import { Rng } from '../sim/rng';
import type { PlayerSetup } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { profileOf, rollBotProfile } from './profiles';
import type { RankBehavior } from './profiles/schema';
import { ARCHETYPES, PLAYSTYLE_AXES, type Archetype, type BotParams, type Knob, type Playstyle, type PlaystyleAxis } from './contract';

type L10n = { de: string; en: string };
export interface AxisLabel {
  name: L10n;
  left: L10n;
  right: L10n;
}
/** One axis contribution: perStep per axis step (or [below 0, above 0]); counts from startAt (default 0). */
export interface KnobTerm {
  axis: PlaystyleAxis;
  perStep: number | [number, number];
  startAt?: number;
}
export type KnobDef =
  | { base: number; from: KnobTerm[]; clamp: [number, number]; note?: string }
  | { bool: { axis: PlaystyleAxis; gte?: number; lte?: number }; note?: string };

export const AXIS_LABELS = axesJson.axes as Record<PlaystyleAxis, AxisLabel>;
export const KNOB_DEFS = axesJson.knobs as unknown as Record<Knob, KnobDef>;
export const ARCHETYPE_PLAYSTYLES = Object.fromEntries(
  ARCHETYPES.map((a) => [a, archJson.archetypes[a].playstyle as Playstyle]),
) as Record<Archetype, Playstyle>;
export const ARCHETYPE_NAMES = Object.fromEntries(ARCHETYPES.map((a) => [a, archJson.archetypes[a].name as L10n])) as Record<Archetype, L10n>;
const ROLL = archJson.roll as {
  sigma: { skill: number; sigma: number }[];
  constraints: { minSkill: number; axis: PlaystyleAxis; min?: number; max?: number }[];
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Axis value: integer -5..+5. */
export const clampAxis = (v: number): number => clamp(Math.round(v), -5, 5);
export const neutralPlaystyle = (): Playstyle => Object.fromEntries(PLAYSTYLE_AXES.map((a) => [a, 0])) as Playstyle;

// ------------------------------------------------------------------ axes -> knobs

export function knobValue(def: KnobDef, s: Playstyle): number {
  if ('bool' in def) {
    const v = s[def.bool.axis];
    return (def.bool.gte === undefined || v >= def.bool.gte) && (def.bool.lte === undefined || v <= def.bool.lte) ? 1 : 0;
  }
  let v = def.base;
  for (const t of def.from) {
    const x = s[t.axis] - (t.startAt ?? 0);
    const step = typeof t.perStep === 'number' ? t.perStep : x < 0 ? t.perStep[0] : t.perStep[1];
    v += step * x;
  }
  return clamp(v, def.clamp[0], def.clamp[1]);
}

export function computeKnobs(s: Playstyle): Record<Knob, number> {
  const out = {} as Record<Knob, number>;
  for (const k of Object.keys(KNOB_DEFS) as Knob[]) out[k] = knobValue(KNOB_DEFS[k], s);
  return out;
}

// ------------------------------------------------------------------ playstyle roll

/** Roll sigma by skill: piecewise linear through archetypes.json roll.sigma (Iron 2.5 .. Challenger 1.2). */
export function rollSigma(skill: number): number {
  const pts = ROLL.sigma;
  if (skill <= pts[0]!.skill) return pts[0]!.sigma;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (skill <= b.skill) return a.sigma + ((b.sigma - a.sigma) * (skill - a.skill)) / (b.skill - a.skill);
  }
  return pts[pts.length - 1]!.sigma;
}

/** Spec §2 random playstyle: N(0, sigma(skill)) per axis, champion bias shifts, then clamp and rank constraints. */
export function rollPlaystyle(rng: Rng, skill: number, bias: Partial<Playstyle> = {}): Playstyle {
  const sigma = rollSigma(skill);
  const s = neutralPlaystyle();
  for (const a of PLAYSTYLE_AXES) s[a] = clampAxis(rng.normal() * sigma + (bias[a] ?? 0));
  for (const c of ROLL.constraints) {
    if (skill < c.minSkill) continue;
    if (c.max !== undefined) s[c.axis] = Math.min(s[c.axis], c.max);
    if (c.min !== undefined) s[c.axis] = Math.max(s[c.axis], c.min);
  }
  return s;
}

type BotSetup = NonNullable<PlayerSetup['bot']>;

/** Nominal skill of a bot setup: explicit division skill or the rank anchor (spec §10). */
export const nominalSkill = (bot: BotSetup): number => bot.skill ?? profileOf(bot.rank).skill;

/** Personality seed when the setup has none: stable per (game seed, slot). */
export const defaultPersonalitySeed = (configSeed: number, slot: number): number =>
  (Math.imul((configSeed ^ 0x7a1e5eed) >>> 0, 0x9e3779b1) + Math.imul(slot + 1, 0x85ebca6b)) >>> 0;

/** True if the setup fixes the playstyle (archetype preset or any manual axis). */
export const isManualStyle = (bot: BotSetup): boolean => !!bot.archetype || (!!bot.playstyle && Object.keys(bot.playstyle).length > 0);

export interface ResolvedStyle {
  playstyle: Playstyle;
  archetype: Archetype | null;
  rolled: boolean;
  personalitySeed: number;
}

/**
 * Playstyle of a bot setup. Pure function of the setup: lobby, scoreboard and worker get the same answer.
 * Manual (archetype preset and/or axes): preset values overlaid by the given axes, no champion bias.
 * Otherwise: rank-dependent roll from personalitySeed plus champion botBias.
 */
export function resolvePlaystyle(setup: PlayerSetup, configSeed = 0): ResolvedStyle {
  const bot = setup.bot!;
  const personalitySeed = bot.personalitySeed ?? defaultPersonalitySeed(configSeed, setup.slot);
  if (isManualStyle(bot)) {
    const s = bot.archetype ? { ...ARCHETYPE_PLAYSTYLES[bot.archetype] } : neutralPlaystyle();
    for (const [k, v] of Object.entries(bot.playstyle ?? {})) if (typeof v === 'number') s[k as PlaystyleAxis] = clampAxis(v);
    return { playstyle: s, archetype: bot.archetype ?? null, rolled: false, personalitySeed };
  }
  const bias = CHAMPION_DATA[setup.champion]?.botBias ?? {};
  return { playstyle: rollPlaystyle(new Rng(personalitySeed), nominalSkill(bot), bias), archetype: null, rolled: true, personalitySeed };
}

/** Archetype with the smallest squared distance (labels for rolled styles). */
export function nearestArchetype(s: Playstyle): Archetype {
  let best: Archetype = ARCHETYPES[0];
  let bestD = Infinity;
  for (const a of ARCHETYPES) {
    const p = ARCHETYPE_PLAYSTYLES[a];
    const d = PLAYSTYLE_AXES.reduce((acc, ax) => acc + (s[ax] - p[ax]) ** 2, 0);
    if (d < bestD) [best, bestD] = [a, d];
  }
  return best;
}

// ------------------------------------------------------------------ BotParams

/**
 * Flat parameters of one bot (spec §10 order): rank profile (division skill) -> variance offset (rng) -> champion
 * bias (rolled styles only) -> playstyle axes -> knobs. `rank` is the effective rank after variance (nearer
 * anchor), `skill` the varied continuous value. Tilt: withTilt() at runtime.
 */
export function buildBotParams(setup: PlayerSetup, rng: Rng, configSeed = 0): BotParams {
  const bot = setup.bot!;
  const profile = rollBotProfile(bot.rank, bot.variance, rng, nominalSkill(bot));
  const st = resolvePlaystyle(setup, configSeed);
  return {
    slot: setup.slot,
    rank: profile.rank,
    skill: profile.skill,
    behavior: profile.behavior,
    playstyle: st.playstyle,
    archetype: st.archetype,
    rolled: st.rolled,
    knobs: computeKnobs(st.playstyle),
    hysteresis: profile.behavior.hysteresis,
    personalitySeed: st.personalitySeed,
  };
}

/** Max tilt stacks; at this level the full profile tiltPerformanceDropPct applies. */
export const MAX_TILT = 3;

/**
 * Tilt (runtime, spec §4.2 "gestorben -> Tilt +1"): execution worsens by up to the profile's
 * tiltPerformanceDropPct and the bot plays one aggression step more per stack. Returns a new object.
 * ponytail: linear in stacks, no decay here; the caller owns the tilt counter and its decay.
 */
export function withTilt(params: BotParams, tilt: number, mode: 'legacy' | 'attention' = 'legacy'): BotParams {
  const n = clamp(tilt, 0, MAX_TILT);
  if (n <= 0) return params;
  // BRAIN-REWORK §9: tilt acts through longer distraction windows (src/ai/humanize/attention.ts, tilt x
  // attention.json tiltExtendPct) plus one aggression step per stack - no direct parameter degradation. The caller
  // switches to 'attention' once the attention model is consumed (runTree, shared-changes.md); 'legacy' keeps today's
  // behaviour until then.
  if (mode === 'attention') {
    const playstyle = { ...params.playstyle, aggression: clampAxis(params.playstyle.aggression + Math.round(n)) };
    return { ...params, playstyle, knobs: computeKnobs(playstyle) };
  }
  const drop = (params.behavior.tiltPerformanceDropPct / 100) * (n / MAX_TILT);
  const b: RankBehavior = {
    ...params.behavior,
    reactionMedianMs: params.behavior.reactionMedianMs * (1 + drop),
    lastHitJitterMs: params.behavior.lastHitJitterMs * (1 + drop),
    aimErrorDeg: params.behavior.aimErrorDeg * (1 + drop),
    skillshotHitPct: params.behavior.skillshotHitPct * (1 - drop),
    errorInjectionPct: Math.min(100, params.behavior.errorInjectionPct * (1 + drop)),
  };
  const playstyle = { ...params.playstyle, aggression: clampAxis(params.playstyle.aggression + Math.round(n)) };
  return { ...params, behavior: b, playstyle, knobs: computeKnobs(playstyle) };
}

/**
 * BRAIN-REWORK §4.4/§4.7 orbwalk chance (0..1): the rank's chance at kiting axis 0 (profile orbwalkPct, %) blended
 * linearly to 100 % at kiting -5 ("Profi") and 0 % at +5 ("keins") - spec-bots §2: rank limits the execution, the
 * axis the preference. Replaces knobs.orbwalkChance (axis only, base 0.5) once the reflex layer reads it.
 */
export function orbwalkChanceAt(orbwalkPct: number, kiting: number): number {
  const base = clamp(orbwalkPct / 100, 0, 1);
  const k = clamp(kiting, -5, 5) / 5;
  return k < 0 ? base + (1 - base) * -k : base * (1 - k);
}

/** BRAIN-REWORK §4.3 harass budget (autos/min): profile harassPerMin plus the aggression knob harassRateShift. */
export const harassBudgetPerMin = (harassPerMin: number, p: Pick<BotParams, 'knobs'>): number => Math.max(0, harassPerMin + p.knobs.harassRateShift);

/**
 * Spec §1 hysteresis: the running behaviour gets a bonus of params.hysteresis (fraction, 0.10 .. 0.25) on its
 * score; returns the chosen key. Ties keep the current behaviour, else the first key in insertion order.
 */
export function withHysteresis(scores: Readonly<Record<string, number>>, current: string | null | undefined, params: Pick<BotParams, 'hysteresis'>): string {
  let best = current ?? '';
  let bestScore = -Infinity;
  if (current != null && current in scores) {
    const s = scores[current]!;
    bestScore = s >= 0 ? s * (1 + params.hysteresis) : s * (1 - params.hysteresis);
  }
  for (const [k, s] of Object.entries(scores)) {
    if (k === current) continue;
    if (s > bestScore) [best, bestScore] = [k, s];
  }
  return best;
}

// ------------------------------------------------------------------ display

/** "kurz --x-------- lang": one cell per axis value -5..+5 (11 cells). */
export function formatScale(axis: PlaystyleAxis, value: number, lang: 'de' | 'en' = 'de'): string {
  const l = AXIS_LABELS[axis];
  const pos = clampAxis(value) + 5;
  const bar = Array.from({ length: 11 }, (_, i) => (i === pos ? 'x' : '-')).join('');
  return `${l.left[lang]} ${bar} ${l.right[lang]}`;
}

/** Signed axis value for labels ("+3", "0", "-2"). */
export const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
