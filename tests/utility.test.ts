// Utility model (docs/BRAIN-REWORK.md §5, §4.6): values.json consistency, rank curves, style factors, value
// functions, selection (hysteresis, rank noise, logging) and test 8 (shove-and-recall) in scenario form.
import { describe, expect, it } from 'vitest';
import { Kind } from '../src/sim/types';
import { PLATE_GOLD } from '../src/sim/systems/towers';
import { BASE_BOUNTY } from '../src/sim/systems/economy';
import type { Rank } from '../src/ai/profiles/schema';
import type { BotParams } from '../src/ai/contract';
import { TeamAI } from '../src/ai/bot/teamai';
import { BUILDS } from '../src/ai/bot/builds';
import { tradeRun } from '../src/ai/bot/trade';
import { VALUES, rankCurve, styleFactor } from '../src/ai/utility/values';
import { buildWorld } from '../src/ai/utility/world';
import { farmValue, pushValue, recallValue, stayDeathProb } from '../src/ai/utility/value';
import { INTENT_NODE, scoreCandidates, utilitySelect, utilityState } from '../src/ai/utility/select';
import { utilityOn } from '../src/ai/utility/flag';
import { MAP, PLAYERS, ScriptedBot, champEnt, hud, minion, paramsFor, snapshot } from './botScenario';
import type { SnapEntity } from '../src/sim/snapshot';

const SKILL: Record<string, number> = { iron: 5, silver: 30, gold: 45, diamond: 80, challenger: 100 };

/** Blue mid laner (slot 2) with a real team AI and the utility flag set. */
function midBot(rank: Rank, seed = 1, params?: BotParams): ScriptedBot {
  const bot = new ScriptedBot(2, params ?? paramsFor(rank, {}, 2), seed);
  (bot.ctx as { teamAI: TeamAI }).teamAI = new TeamAI(0, MAP, PLAYERS, seed, bot.ctx.log);
  (bot.ctx as { utility?: boolean }).utility = true;
  (bot.ctx as { build: unknown }).build = BUILDS[PLAYERS[2]!.champion] ?? null;
  return bot;
}

/** Mid lane point at arc fraction t (blue frame: 0 = blue nexus side). */
const mid = (t: number): { x: number; y: number } => ({ x: 1800 + 12400 * t, y: 1800 + 12400 * t });
const at = (p: { x: number; y: number }, dx = 0, dy = 0): [number, number] => [p.x + dx, p.y + dy];

function wave(team: number, c: { x: number; y: number }, n = 3, kind: number = Kind.MinionCaster): SnapEntity[] {
  return Array.from({ length: n }, (_, i) => {
    const m = minion(team, c.x + 60 * i, c.y - 60 * i, kind);
    const hp = kind === Kind.MinionCaster ? 290 : 460;
    return { ...m, hp, maxHp: hp };
  });
}

const noNoise = (p: BotParams): BotParams => ({ ...p, behavior: { ...p.behavior, utilityNoisePct: 0 } as BotParams['behavior'] });

describe('values.json', () => {
  it('gold equivalents agree with the sim rules they mirror', () => {
    expect(VALUES.gold.plate).toBe(PLATE_GOLD);
    expect(VALUES.gold.kill.base).toBe(BASE_BOUNTY);
    expect(VALUES.gold.xp).toBe(0.4);
  });
  it('rank curves interpolate over skill and clamp at the ends', () => {
    expect(rankCurve(VALUES.lane.csShare, SKILL.gold!)).toBeCloseTo(0.82);
    const between = rankCurve(VALUES.lane.csShare, 60);
    expect(between).toBeGreaterThan(0.82);
    expect(between).toBeLessThan(0.9);
    expect(rankCurve(VALUES.lane.csShare, 0)).toBeCloseTo(0.62);
    expect(rankCurve(VALUES.recall.shoveFirst, SKILL.iron!)).toBe(0);
    expect(rankCurve(VALUES.recall.shoveFirst, SKILL.silver!)).toBe(1);
    expect(rankCurve(VALUES.combat.chaseAbort.pct, SKILL.iron!)).toBe(0);
    expect(rankCurve(VALUES.combat.diveAggroSwap.pct, SKILL.gold!)).toBe(0);
    expect(rankCurve(VALUES.combat.diveAggroSwap.pct, 58)).toBe(70);
  });
  it('style factors stay in 0.6 .. 1.6 and follow their axis', () => {
    for (const id of Object.keys(VALUES.style).filter((k) => k !== 'note')) {
      for (const v of [-5, 0, 5]) {
        const p = paramsFor('gold', { roam: v, tempo: v, aggression: v, farmPriority: v, objectiveRisk: v, vision: v, teamplay: v });
        const f = styleFactor(id, p);
        expect(f, `${id} @ ${v}`).toBeGreaterThanOrEqual(0.5);
        expect(f, `${id} @ ${v}`).toBeLessThanOrEqual(1.6);
      }
    }
    expect(styleFactor('roam', paramsFor('gold', { roam: 5 }))).toBeGreaterThan(styleFactor('roam', paramsFor('gold', { roam: -5 })));
    expect(styleFactor('recall', paramsFor('gold', { tempo: -5 }))).toBeGreaterThan(styleFactor('recall', paramsFor('gold', { tempo: 5 })));
  });
});

describe('feature flag', () => {
  it('is off without BOT_UTILITY / BotStatic.utility: the classic trade leaf runs', () => {
    const bot = new ScriptedBot(2, paramsFor('gold', {}, 2), 1);
    expect(utilityOn(bot.ctx)).toBe(false);
    const n = bot.node(snapshot({ tick: 6000, team: 0, entities: [champEnt(2, ...at(mid(0.4)))], me: hud(2) }));
    expect(tradeRun(n)).toBe('failure'); // no trade running
    expect(bot.log.some((e) => e.node === INTENT_NODE)).toBe(false);
  });
});

describe('value functions', () => {
  it('farm: minions about to die add value, gank risk costs', () => {
    const bot = midBot('gold');
    const ents = [champEnt(2, ...at(mid(0.42))), ...wave(1, mid(0.46), 4)];
    const n = bot.node(snapshot({ tick: 6000, team: 0, entities: ents, me: hud(2) }));
    const w = buildWorld(n);
    const f = farmValue(w)!;
    expect(f.benefit).toBeGreaterThan(0);
    expect(f.terms.minions).toBeGreaterThan(0);
    const risky = farmValue({ ...w, gankRisk: 0.8 })!;
    expect(risky.cost).toBeGreaterThan(f.cost);
  });

  it('heal path (§4.6): staying is deadly only at low HP', () => {
    const bot = midBot('gold');
    const maxHp = champEnt(2, 0, 0).maxHp;
    const low = bot.node(snapshot({ tick: 6000, team: 0, entities: [champEnt(2, ...at(mid(0.4)), { hp: maxHp * 0.2 })], me: hud(2) }));
    expect(stayDeathProb(buildWorld(low))).toBeGreaterThan(VALUES.weights.recallStayDeathThreshold);
    const bot2 = midBot('gold');
    const ok = bot2.node(snapshot({ tick: 6000, team: 0, entities: [champEnt(2, ...at(mid(0.4)), { hp: maxHp * 0.9 })], me: hud(2) }));
    expect(stayDeathProb(buildWorld(ok))).toBeLessThan(VALUES.weights.recallStayDeathThreshold);
  });

  it('recall: item term needs the profile gold threshold; Iron (null threshold) ignores gold', () => {
    const ents = [champEnt(2, ...at(mid(0.4)))];
    const g = midBot('gold');
    const rich = recallValue(buildWorld(g.node(snapshot({ tick: 9000, team: 0, entities: ents, me: hud(2, { gold: 1300 }) }))))!;
    expect(rich.terms.item).toBeGreaterThan(0);
    const g2 = midBot('gold');
    const poor = recallValue(buildWorld(g2.node(snapshot({ tick: 9000, team: 0, entities: ents, me: hud(2, { gold: 500 }) }))))!;
    expect(poor.terms.item).toBe(0);
    const i = midBot('iron');
    const iron = recallValue(buildWorld(i.node(snapshot({ tick: 9000, team: 0, entities: ents, me: hud(2, { gold: 1300 }) }))))!;
    expect(iron.terms.item).toBe(0);
  });

  it('push: a crashed wave with the opponent away is worth plates before 14:00', () => {
    const bot = midBot('gold');
    const tower = { x: 9350, y: 9350 };
    const ents = [champEnt(2, ...at(tower, -650, -650)), ...wave(0, { x: tower.x - 350, y: tower.y - 350 }, 4, Kind.MinionMelee)];
    const n = bot.node(snapshot({ tick: 9000, team: 0, entities: ents, me: hud(2) }));
    const p = pushValue(buildWorld(n));
    expect(p).not.toBeNull();
    expect(p!.terms.plates).toBeGreaterThan(0);
    expect(p!.terms.structure).toBeGreaterThan(0);
  });
});

describe('selection', () => {
  it('the running intent gets + hysteresis x |score| (no noise)', () => {
    const p = noNoise(paramsFor('gold', {}, 2));
    const ents = [champEnt(2, ...at(mid(0.42))), ...wave(1, mid(0.46), 4)];
    const a = midBot('gold', 1, p);
    const fresh = scoreCandidates(a.node(snapshot({ tick: 6000, team: 0, entities: ents, me: hud(2) })), utilityState({}));
    const farm = fresh.find((s) => s.id === 'farm')!;
    expect(farm.score).toBeCloseTo(farm.raw, 6);
    const b = midBot('gold', 1, p);
    const st = utilityState({});
    st.intent = 'farm';
    st.until = 1e9;
    const held = scoreCandidates(b.node(snapshot({ tick: 6000, team: 0, entities: ents, me: hud(2) })), st).find((s) => s.id === 'farm')!;
    expect(held.score).toBeCloseTo(held.raw + p.hysteresis * Math.abs(held.raw), 6);
  });

  it('rank noise: Iron spreads scores far more than Challenger', () => {
    const spread = (rank: Rank): number => {
      const bot = midBot(rank, 3);
      const ents = [champEnt(2, ...at(mid(0.42))), ...wave(1, mid(0.46), 4)];
      const rel: number[] = [];
      for (let k = 0; k < 120; k++) {
        const s = scoreCandidates(bot.node(snapshot({ tick: 6000 + k * 10, team: 0, entities: ents, me: hud(2) })), utilityState({})).find((x) => x.id === 'farm')!;
        rel.push((s.score - s.raw) / Math.abs(s.raw));
      }
      const m = rel.reduce((a, b) => a + b, 0) / rel.length;
      return Math.sqrt(rel.reduce((a, b) => a + (b - m) ** 2, 0) / rel.length);
    };
    const iron = spread('iron');
    const chall = spread('challenger');
    expect(iron).toBeGreaterThan(0.25);
    expect(chall).toBeLessThan(0.12);
  });

  it('every decision logs all candidate scores under the intent node', () => {
    const bot = midBot('gold');
    const ents = [champEnt(2, ...at(mid(0.42))), ...wave(1, mid(0.46), 4)];
    const n = bot.node(snapshot({ tick: 6000, team: 0, entities: ents, me: hud(2) }));
    const r = utilitySelect(n);
    expect(r).not.toBe('failure');
    const e = bot.log.filter((x) => x.node === INTENT_NODE).pop()!;
    expect(e).toBeTruthy();
    const ids = utilityState(bot.mem).last.map((s) => s.id);
    expect(Object.keys(e.scores ?? {}).sort()).toEqual([...ids].sort());
    expect(ids).toContain('farm');
  });
});

describe('test 8 (scenario): shove-and-recall', () => {
  // Diamond mid laner with 1300 gold, wave in the middle of the lane: recall is the best intent, but the bot shoves
  // first; once the wave sits in the enemy tower it recalls
  it('Diamond shoves the mid-lane wave before recalling, then recalls after the crash', () => {
    const bot = midBot('diamond', 5);
    const clash = mid(0.5);
    const ents = [champEnt(2, ...at(clash, -450, -450)), ...wave(0, { x: clash.x - 150, y: clash.y - 150 }, 4, Kind.MinionMelee), ...wave(1, { x: clash.x + 100, y: clash.y + 100 }, 3)];
    const n1 = bot.node(snapshot({ tick: 7 * 1800, team: 0, entities: ents, me: hud(2, { gold: 1300 }) }));
    const top = scoreCandidates(n1, utilityState({}))[0]!;
    expect(top.id).toBe('recall');
    expect(top.value.data?.shoveFirst).toBe(true);
    const n2 = bot.node(snapshot({ tick: 7 * 1800 + 10, team: 0, entities: ents, me: hud(2, { gold: 1300 }) }));
    utilitySelect(n2);
    expect(utilityState(bot.mem).intent).toBe('recall');
    expect(n2.out.some((a) => a.cmd.t === 'recall')).toBe(false);
    expect(bot.mem.ext.wave.state).toBe('crash');
    // crashed: own minions under the enemy outer tower, no enemy minions, nobody around -> recall now
    const tower = { x: 9350, y: 9350 };
    const crashed = [champEnt(2, ...at(tower, -1500, -1500)), ...wave(0, { x: tower.x - 300, y: tower.y - 300 }, 3, Kind.MinionMelee)];
    const n3 = bot.node(snapshot({ tick: 7 * 1800 + 400, team: 0, entities: crashed, me: hud(2, { gold: 1300 }) }));
    utilitySelect(n3);
    expect(n3.out.some((a) => a.cmd.t === 'recall')).toBe(true);
  });

  it('Iron does not shove first (rank curve), it recalls on the wave it has', () => {
    const bot = midBot('iron', 5);
    const clash = mid(0.5);
    const ents = [champEnt(2, ...at(clash, -450, -450)), ...wave(0, { x: clash.x - 150, y: clash.y - 150 }, 4, Kind.MinionMelee), ...wave(1, { x: clash.x + 100, y: clash.y + 100 }, 3)];
    const maxHp = champEnt(2, 0, 0).maxHp;
    const n = bot.node(snapshot({ tick: 7 * 1800, team: 0, entities: [{ ...ents[0]!, hp: maxHp * 0.15 }, ...ents.slice(1)], me: hud(2, { gold: 1300 }) }));
    const rec = recallValue(buildWorld(n))!;
    expect(rec.data?.shoveFirst).toBe(false);
  });
});
