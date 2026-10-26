// Spec-bots §2/§10: playstyle axes -> knobs (data/bots/playstyleAxes.json), archetypes, rank-dependent rolls,
// champion bias only for rolled styles, application order, skill mapping, tilt and hysteresis helpers.
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, PLAYSTYLE_AXES, type Knob, type Playstyle } from '../src/ai/contract';
import {
  ARCHETYPE_PLAYSTYLES,
  KNOB_DEFS,
  buildBotParams,
  computeKnobs,
  defaultPersonalitySeed,
  neutralPlaystyle,
  nominalSkill,
  resolvePlaystyle,
  rollPlaystyle,
  rollSigma,
  withHysteresis,
  withTilt,
} from '../src/ai/params';
import { PROFILES, profileOf } from '../src/ai/profiles';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { CHAMPION_DATA } from '../src/sim/champions';
import { classicConfig } from '../src/ai/runner';
import { BOT_CONFIGS, applyBotConfig, parseBotConfig } from '../src/ai/botConfig';
import { Rng } from '../src/sim/rng';
import type { PlayerSetup } from '../src/sim/types';

/** Compile-time exhaustiveness: a missing or unknown Knob here is a type error. */
const ALL_KNOBS: Record<Knob, true> = {
  tradeAbortS: true, tradeAbortHpRatio: true, tradeWindowMult: true, tradeWinThreshold: true, allInKillProb: true, allInDeathProb: true,
  orbwalkChance: true, spacingBuffer: true, kiteBack: true,
  fightWeight: true, diveTolerancePctShift: true, towerDive: true, chaseChanceShift: true, escapeFightThreshold: true, gankRiskShift: true,
  roamDesireBase: true, roamThreshold: true, supportAdcBinding: true,
  objectiveSafetyThreshold: true, stealAttempts: true,
  farmWeight: true, pingFollowThreshold: true,
  wardIntervalMult: true, controlWardBuyGold: true, useSweeper: true,
  flashOffensive: true, flashDangerThreshold: true, dashEngageWeight: true, ultKillThreshold: true,
  groupWeight: true, splitWeight: true, pingObedience: true, fightJoinThreshold: true, fightJoinLatencyMult: true,
  recallThresholdShift: true, macroIntervalMult: true, waveSacrifice: true,
  gankThreshold: true, gankEvalIntervalS: true,
  harassRateShift: true, utilFarm: true, utilTrade: true, utilHarass: true, utilRoam: true, utilPush: true, utilRecall: true,
  utilObjective: true, utilVision: true, utilGroup: true, utilCatchLane: true,
};

const ps = (o: Partial<Playstyle>): Playstyle => ({ ...neutralPlaystyle(), ...o });
const k = (o: Partial<Playstyle>, knob: Knob): number => computeKnobs(ps(o))[knob];

const botSetup = (champion: string, rank: Rank, bot: Partial<NonNullable<PlayerSetup['bot']>> = {}, slot = 5): PlayerSetup => ({
  slot,
  team: 1,
  champion,
  role: 'mid',
  summoners: ['sprung', 'entflammen'],
  isHuman: false,
  bot: { rank, variance: 'normal', ...bot },
});

const sd = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('axis -> knob mapping (playstyleAxes.json)', () => {
  it('every contract Knob is defined, nothing extra', () => {
    expect(Object.keys(KNOB_DEFS).sort()).toEqual(Object.keys(ALL_KNOBS).sort());
  });

  it('spec endpoints and neutral values', () => {
    const cases: [Knob, keyof Playstyle, number, number, number][] = [
      // knob, axis, value at -5, at 0, at +5
      ['tradeAbortS', 'tradeLength', 2, 4.5, 7],
      ['orbwalkChance', 'kiting', 1, 0.5, 0],
      ['spacingBuffer', 'kiting', 50, 150, 250],
      ['fightWeight', 'aggression', 0.6, 1, 1.6],
      ['diveTolerancePctShift', 'aggression', -15, 0, 15],
      ['chaseChanceShift', 'aggression', -25, 0, 25],
      ['escapeFightThreshold', 'aggression', 0.85, 0.6, 0.4],
      ['gankRiskShift', 'aggression', -0.15, 0, 0.15],
      ['gankThreshold', 'aggression', 0.7, 0.55, 0.4],
      ['roamDesireBase', 'roam', 0.1, 0.4, 0.7],
      ['roamThreshold', 'roam', 0.7, 0.5, 0.3],
      ['supportAdcBinding', 'roam', 0.9, 0.65, 0.4],
      ['objectiveSafetyThreshold', 'objectiveRisk', 0.8, 0.55, 0.3],
      ['wardIntervalMult', 'vision', 2, 1, 0.5],
      ['flashDangerThreshold', 'resourceUse', 1, 0.75, 0.5],
      ['ultKillThreshold', 'resourceUse', 0.9, 0.65, 0.4],
      ['pingObedience', 'teamplay', 0.3, 0.625, 0.95],
      ['fightJoinThreshold', 'teamplay', 0.6, 0.45, 0.3],
      ['macroIntervalMult', 'tempo', 1.5, 1, 0.7],
      ['tradeWindowMult', 'tradeLength', 0.8, 1, 1],
    ];
    for (const [knob, axis, lo, mid, hi] of cases) {
      expect(k({ [axis]: -5 }, knob), `${knob} @-5`).toBeCloseTo(lo, 6);
      expect(k({ [axis]: 0 }, knob), `${knob} @0`).toBeCloseTo(mid, 6);
      expect(k({ [axis]: 5 }, knob), `${knob} @+5`).toBeCloseTo(hi, 6);
    }
  });

  it('multi-axis knobs: trade threshold, all-in, recall', () => {
    expect(k({ tradeLength: -5 }, 'tradeWinThreshold')).toBeCloseTo(0.45, 6); // short trades lower to 0.45
    expect(k({ aggression: 5 }, 'tradeWinThreshold')).toBeCloseTo(0.4, 6);
    expect(k({ aggression: -5 }, 'tradeWinThreshold')).toBeCloseTo(0.7, 6);
    expect(k({ tradeLength: 5 }, 'tradeWinThreshold')).toBeCloseTo(0.55, 6);
    expect(k({}, 'allInKillProb')).toBeCloseTo(0.6, 6);
    expect(k({ aggression: 1 }, 'allInKillProb')).toBeCloseTo(0.5, 6); // +-0.1 per step
    expect(k({ tradeLength: 5 }, 'allInKillProb')).toBeCloseTo(0.5, 6); // long trades prefer all-in at 0.5
    expect(k({ aggression: -1 }, 'allInDeathProb')).toBeCloseTo(0.15, 6);
    expect(k({ roam: 5, tempo: 5 }, 'roamThreshold')).toBeCloseTo(0.2, 6);
    expect(k({ farmPriority: 2 }, 'recallThresholdShift')).toBeCloseTo(0, 6); // farm counts only above +2
    expect(k({ farmPriority: 5 }, 'recallThresholdShift')).toBeCloseTo(0.3, 6);
    expect(k({ tempo: -5 }, 'recallThresholdShift')).toBeCloseTo(-0.1, 6);
  });

  it('bool knobs switch at their thresholds', () => {
    expect(k({ resourceUse: 0 }, 'flashOffensive')).toBe(1);
    expect(k({ resourceUse: -1 }, 'flashOffensive')).toBe(0);
    expect(k({ objectiveRisk: 3 }, 'stealAttempts')).toBe(1);
    expect(k({ objectiveRisk: 2 }, 'stealAttempts')).toBe(0);
    expect(k({ kiting: 0 }, 'kiteBack')).toBe(1);
    expect(k({ kiting: 1 }, 'kiteBack')).toBe(0);
    expect(k({ aggression: 1 }, 'towerDive')).toBe(0);
    expect(k({ aggression: 2 }, 'towerDive')).toBe(1);
  });

  it('clamps hold for every archetype, every extreme and random styles', () => {
    const styles: Playstyle[] = [...ARCHETYPES.map((a) => ARCHETYPE_PLAYSTYLES[a])];
    for (const v of [-5, 5]) styles.push(Object.fromEntries(PLAYSTYLE_AXES.map((a) => [a, v])) as Playstyle);
    const rng = new Rng(4);
    for (let i = 0; i < 300; i++) styles.push(rollPlaystyle(rng, 5));
    for (const s of styles) {
      const kn = computeKnobs(s);
      for (const [name, def] of Object.entries(KNOB_DEFS)) {
        const v = kn[name as Knob];
        expect(Number.isFinite(v)).toBe(true);
        if ('bool' in def) expect([0, 1]).toContain(v);
        else {
          expect(v).toBeGreaterThanOrEqual(def.clamp[0]);
          expect(v).toBeLessThanOrEqual(def.clamp[1]);
        }
      }
    }
  });
});

describe('archetypes (spec §2 table, kiting sign inverted per DECISIONS.md)', () => {
  it('8 archetypes with integer axes -5..+5', () => {
    expect(Object.keys(ARCHETYPE_PLAYSTYLES).sort()).toEqual([...ARCHETYPES].sort());
    for (const a of ARCHETYPES) for (const ax of PLAYSTYLE_AXES) {
      const v = ARCHETYPE_PLAYSTYLES[a][ax];
      expect(Number.isInteger(v) && v >= -5 && v <= 5, `${a}.${ax}`).toBe(true);
    }
  });

  it('kiting inverted: Pro-Standard orbwalks, Int-Bot does not', () => {
    expect(ARCHETYPE_PLAYSTYLES.proStandard.kiting).toBe(-4);
    expect(ARCHETYPE_PLAYSTYLES.intBot.kiting).toBe(5);
    expect(ARCHETYPE_PLAYSTYLES.duelist.kiting).toBe(-3);
    expect(ARCHETYPE_PLAYSTYLES.farmer.farmPriority).toBe(5);
    expect(ARCHETYPE_PLAYSTYLES.roamer.roam).toBe(5);
    expect(computeKnobs(ARCHETYPE_PLAYSTYLES.proStandard).orbwalkChance).toBeCloseTo(0.9, 6);
    expect(computeKnobs(ARCHETYPE_PLAYSTYLES.intBot).orbwalkChance).toBe(0);
  });

  it('champion bias: all 26 champions, spec examples (Lysa kiting inverted)', () => {
    expect(Object.keys(CHAMPION_DATA).length).toBeGreaterThanOrEqual(27);
    for (const c of Object.values(CHAMPION_DATA)) expect(c.botBias, c.id).toBeDefined();
    expect(CHAMPION_DATA.renn!.botBias).toEqual({ aggression: 2, roam: 2 });
    expect(CHAMPION_DATA.lysa!.botBias).toEqual({ kiting: -2, farmPriority: 2 });
    expect(CHAMPION_DATA.harrow!.botBias).toEqual({ teamplay: -3, tempo: 1 });
  });
});

describe('rank-dependent roll', () => {
  const roll = (skill: number, n = 1500): Playstyle[] => {
    const rng = new Rng(skill * 7 + 1);
    return Array.from({ length: n }, () => rollPlaystyle(rng, skill));
  };

  it('sigma: Iron 2.5 .. Challenger 1.2, interpolated by skill', () => {
    expect(rollSigma(5)).toBeCloseTo(2.5, 6);
    expect(rollSigma(100)).toBeCloseTo(1.2, 6);
    expect(rollSigma(52.5)).toBeCloseTo(1.85, 6);
  });

  it('Iron spreads wide (many +-4/+-5), Challenger narrow', () => {
    const iron = roll(5).map((s) => s.aggression);
    const chall = roll(100).map((s) => s.aggression);
    expect(sd(iron)).toBeGreaterThan(2.1);
    expect(sd(iron)).toBeLessThan(2.7);
    expect(sd(chall)).toBeGreaterThan(1.0);
    expect(sd(chall)).toBeLessThan(1.45);
    expect(iron.filter((v) => Math.abs(v) >= 4).length / iron.length).toBeGreaterThan(0.12);
    expect(chall.filter((v) => Math.abs(v) >= 4).length / chall.length).toBeLessThan(0.02);
    expect(Math.abs(mean(iron))).toBeLessThan(0.25);
  });

  it('Challenger constraints: kiting <= +3, vision >= 0 (Iron unconstrained)', () => {
    const chall = roll(100, 3000);
    expect(Math.max(...chall.map((s) => s.kiting))).toBeLessThanOrEqual(3);
    expect(Math.min(...chall.map((s) => s.vision))).toBeGreaterThanOrEqual(0);
    const iron = roll(5, 3000);
    expect(Math.max(...iron.map((s) => s.kiting))).toBeGreaterThan(3);
    expect(Math.min(...iron.map((s) => s.vision))).toBeLessThan(0);
  });
});

describe('bot config files (spec §10 format)', () => {
  it('bundled example parses and applies; invalid configs are rejected', () => {
    const cfg = BOT_CONFIGS.find((c) => c.id === 'enemy_jungle')!;
    expect(cfg).toMatchObject({ champion: 'vessa', rank: 'diamond', skill: 80, personalitySeed: 918273, archetype: 'roamer' });
    const setup = applyBotConfig(botSetup('mira', 'gold'), cfg);
    expect(setup.champion).toBe('vessa');
    const p = buildBotParams(setup, new Rng(1));
    expect(p.rolled).toBe(false);
    expect(p.archetype).toBe('roamer');
    expect(p.playstyle).toEqual(cfg.playstyle);
    expect(() => parseBotConfig({ id: 'x', rank: 'gold', playstyle: { kiting: 7 } })).toThrow(/kiting/);
    expect(() => parseBotConfig({ id: 'x', rank: 'wood' })).toThrow(/rank/);
    expect(() => parseBotConfig({ id: 'x', rank: 'gold', foo: 1 })).toThrow(/foo/);
  });
});

describe('BotParams (spec §10 order)', () => {
  it('skill from rank (Platinum 58) and division override', () => {
    expect(PROFILES.map((p) => p.skill)).toEqual([5, 15, 30, 45, 58, 68, 80, 88, 94, 100]);
    expect(nominalSkill({ rank: 'gold', variance: 'normal' })).toBe(45);
    expect(nominalSkill({ rank: 'gold', variance: 'normal', skill: 51 })).toBe(51);
    const rng = new Rng(3);
    const skills = Array.from({ length: 400 }, () => buildBotParams(botSetup('mira', 'gold', { skill: 51, variance: 'stable' }), rng).skill);
    expect(Math.abs(mean(skills) - 51)).toBeLessThan(2.5);
  });

  it('champion bias only when rolled', () => {
    const rolled = (champ: string): number[] =>
      Array.from({ length: 1500 }, (_, i) => resolvePlaystyle(botSetup(champ, 'challenger', { personalitySeed: i * 7919 + 13 })).playstyle.aggression);
    const renn = mean(rolled('renn')); // aggression +2
    const ferris = mean(rolled('ferris')); // aggression -2
    expect(renn).toBeGreaterThan(1.6);
    expect(ferris).toBeLessThan(-1.6);
    // manual: preset or any axis -> no bias
    const manual = resolvePlaystyle(botSetup('renn', 'challenger', { playstyle: { tempo: 1 }, personalitySeed: 1 }));
    expect(manual.rolled).toBe(false);
    expect(manual.playstyle).toEqual(ps({ tempo: 1 }));
    const preset = resolvePlaystyle(botSetup('renn', 'gold', { archetype: 'farmer', personalitySeed: 1 }));
    expect(preset.playstyle).toEqual(ARCHETYPE_PLAYSTYLES.farmer);
    expect(preset.archetype).toBe('farmer');
    expect(preset.rolled).toBe(false);
    // preset overlaid by manual axes
    expect(resolvePlaystyle(botSetup('renn', 'gold', { archetype: 'farmer', playstyle: { roam: 3 } })).playstyle.roam).toBe(3);
  });

  it('order: variance changes skill/behaviour, never the playstyle; knobs follow the playstyle', () => {
    const setup = botSetup('renn', 'platinum', { variance: 'volatile', personalitySeed: 42 });
    const a = buildBotParams(setup, new Rng(1));
    const b = buildBotParams(setup, new Rng(2));
    expect(a.playstyle).toEqual(b.playstyle);
    expect(a.skill).not.toBe(b.skill);
    expect(a.rolled).toBe(true);
    expect(a.playstyle).toEqual(resolvePlaystyle(setup).playstyle);
    expect(a.knobs).toEqual(computeKnobs(a.playstyle));
    expect(a.hysteresis).toBeCloseTo(a.behavior.hysteresis, 9);
    expect(a.personalitySeed).toBe(42);
  });

  it('hysteresis 0.25 at Gold, 0.10 at Challenger', () => {
    expect(profileOf('gold').behavior.hysteresis).toBe(0.25);
    expect(profileOf('challenger').behavior.hysteresis).toBe(0.1);
    for (const r of RANKS) {
      const h = profileOf(r).behavior.hysteresis;
      expect(h).toBeGreaterThanOrEqual(0.1);
      expect(h).toBeLessThanOrEqual(0.25);
    }
  });

  it('personality seeds: config builders set them, default is stable per seed and slot', () => {
    const cfg = classicConfig('mira', 'adc', 'gold', { seed: 77 });
    for (const p of cfg.players) if (p.bot) expect(p.bot.personalitySeed).toBe(defaultPersonalitySeed(77, p.slot));
    expect(defaultPersonalitySeed(77, 3)).not.toBe(defaultPersonalitySeed(77, 4));
    expect(defaultPersonalitySeed(77, 3)).not.toBe(defaultPersonalitySeed(78, 3));
  });

  it('withTilt worsens execution and adds aggression; withHysteresis keeps the running behaviour', () => {
    const p = buildBotParams(botSetup('mira', 'gold', { playstyle: { aggression: 0 } }), new Rng(5));
    expect(withTilt(p, 0)).toBe(p);
    const t = withTilt(p, 3);
    expect(t.behavior.reactionMedianMs).toBeGreaterThan(p.behavior.reactionMedianMs);
    expect(t.behavior.skillshotHitPct).toBeLessThan(p.behavior.skillshotHitPct);
    expect(t.playstyle.aggression).toBe(3);
    expect(t.knobs.fightWeight).toBeGreaterThan(p.knobs.fightWeight);
    expect(p.playstyle.aggression).toBe(0); // not mutated

    const gold = { hysteresis: 0.25 };
    const chall = { hysteresis: 0.1 };
    expect(withHysteresis({ farm: 0.5, fight: 0.6 }, 'farm', gold)).toBe('farm'); // 0.625 > 0.6
    expect(withHysteresis({ farm: 0.5, fight: 0.6 }, 'farm', chall)).toBe('fight'); // 0.55 < 0.6
    expect(withHysteresis({ farm: 0.5, fight: 0.6 }, null, gold)).toBe('fight');
    expect(withHysteresis({ farm: 0.5, fight: 0.6 }, 'gone', gold)).toBe('fight');
  });
});
