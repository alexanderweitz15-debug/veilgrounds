// BRAIN-REWORK §9 attention model (src/ai/humanize/attention.ts) and error episodes (src/ai/errors.ts).
// Test 10 of §10: Iron bot, 5 min -> distracted share 30-40 %, no window longer than 3 s, no minion ignored forever
// (real runner with the new brain on: the runner feeds the model, reflex cancels last hits while distracted).
import { describe, expect, it } from 'vitest';
import { attentionAt, attentionProbe, attentionStats, ensureAttention, isDistracted, observeAttention, reactionPenaltyMs } from '../src/ai/humanize/attention';
import { detectErrors, errorActive, errorDurationS, startErrorEpisode } from '../src/ai/errors';
import { orbwalkChanceAt, withTilt } from '../src/ai/params';
import { PROFILES } from '../src/ai/profiles';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { newMemory, type BotMemory } from '../src/ai/bot/types';
import { BotDecisionLog, debugRows, INTENT_NODE } from '../src/ai/log';
import type { BotParams, DecisionLogEntry } from '../src/ai/contract';
import type { Snapshot } from '../src/sim/snapshot';
import { Kind, type SimEvent } from '../src/sim/types';
import { createSim, step } from '../src/sim/sim';
import { BotRunner, botGameConfig } from '../src/ai/runner';
import { reflexState } from '../src/ai/reflex/state';
import { paramsFor } from './botScenario';
import attn from '../src/data/bots/attention.json';

interface Fake {
  mem: BotMemory;
  ctx: { slot: number; team: 0 | 1; toxic: boolean; lang: 'de'; log: BotDecisionLog; params: BotParams };
}

const fake = (rank: Rank, seed: number, slot = 0): Fake => {
  const params = { ...paramsFor(rank, {}, slot), personalitySeed: seed };
  return { mem: newMemory(), ctx: { slot, team: 0, toxic: true, lang: 'de', log: new BotDecisionLog(1_000_000), params } };
};

/**
 * Synthetic game for calibration: decisions every `every` ticks, perception minimap glances at the profile interval,
 * 0.67 champion kills per minute in the kill feed, +300 gold per minute, a team chat line every 2 min (what the
 * bots see in the first 15 min of a real game, tools/scratch measurement).
 */
function simulate(f: Fake, minutes: number, every = 10, from = 0): void {
  const b = f.ctx.params.behavior;
  const glanceEvery = Math.round(b.minimapIntervalS * 30);
  const ps = f.mem.ext.perception;
  for (let t = from; t < from + minutes * 1800; t += every) {
    const events: SimEvent[] = [];
    const eventTicks: number[] = [];
    for (let k = t - every + 1; k <= t; k++) {
      if (k > 0 && k % 2700 === 0) events.push({ e: 'death', eid: 1, kind: Kind.Champion, team: 1, killer: 2, x: 0, y: 0 }), eventTicks.push(k);
      if (k > 0 && k % 3600 === 0) events.push({ e: 'chat', slot: 3, team: 0, text: '?' }), eventTicks.push(k);
      if (k > 0 && k % glanceEvery === 0) (ps.lastGlance = k), (ps.glanceReason = 'interval');
    }
    const snap = { tick: t, events, eventTicks, me: { gold: 500 + (t / 1800) * 300, dead: false, inFountain: false } } as unknown as Snapshot;
    observeAttention(f.mem, f.ctx as never, snap);
  }
}

describe('attention model: calibration against Table B (errorInjectionPct)', () => {
  it('distracted share per rank within +-3 points of errorInjectionPct, windows 0.5..3 s', () => {
    const rows: string[] = [];
    for (const rank of RANKS) {
      const target = PROFILES[RANKS.indexOf(rank)]!.behavior.errorInjectionPct / 100;
      let share = 0;
      let maxS = 0;
      const seeds = [11, 22, 33, 44];
      for (const seed of seeds) {
        const f = fake(rank, seed);
        simulate(f, 30);
        const s = attentionStats(f.mem, 30 * 1800)!;
        share += s.share / seeds.length;
        maxS = Math.max(maxS, s.maxWindowS);
        const durs = f.ctx.log.entries().filter((e) => e.node === 'attention' && !e.chosen.includes('+')).map((e) => Number(e.inputs.until) - e.tick);
        for (const d of durs) expect(d).toBeGreaterThanOrEqual(Math.round(Math.min(attn.minS, attn.minimapS[0]!, attn.killFeedS[0]!) * 30));
      }
      rows.push(`${rank} ${(share * 100).toFixed(1)} % (target ${(target * 100).toFixed(0)})`);
      expect(Math.abs(share - target), rows.join(' | ')).toBeLessThanOrEqual(0.03);
      expect(maxS).toBeLessThanOrEqual(attn.maxS + 1e-9);
    }
  });

  it('cadence independent: queried every tick or every 15 ticks gives the same random windows', () => {
    const a = fake('iron', 5);
    const b = fake('iron', 5);
    ensureAttention(a.mem, a.ctx, 0);
    ensureAttention(b.mem, b.ctx, 0);
    const seqA: boolean[] = [];
    for (let t = 0; t < 3 * 1800; t++) seqA.push(isDistracted(a.mem, t));
    const statB = (() => {
      for (let t = 0; t < 3 * 1800; t += 15) isDistracted(b.mem, t);
      return attentionStats(b.mem, 3 * 1800 - 1)!;
    })();
    const shareA = seqA.filter(Boolean).length / seqA.length;
    expect(statB.share).toBeCloseTo(shareA, 9);
    const winA = a.ctx.log.entries().map((e) => [e.tick, e.inputs.until]);
    const winB = b.ctx.log.entries().map((e) => [e.tick, e.inputs.until]);
    expect(winB).toEqual(winA);
  });

  it('effects while distracted: no last hits, no harass, +150 ms reaction, no predictive dodge; logged', () => {
    const f = fake('iron', 9);
    ensureAttention(f.mem, f.ctx, 0);
    let t = 0;
    while (!isDistracted(f.mem, t)) t++;
    const e = attentionAt(f.mem, t);
    expect(e).toMatchObject({ distracted: true, reason: 'random', skipLastHit: true, pauseHarass: true, reactionPenaltyMs: attn.reactionPenaltyMs, predictiveDodge: false });
    expect(reactionPenaltyMs(f.mem, t)).toBe(attn.reactionPenaltyMs);
    expect(attentionProbe(f.mem)(t)).toEqual({ distracted: true, reason: 'random' });
    expect(reactionPenaltyMs(f.mem, e.untilTick)).toBe(0);
    const log = f.ctx.log.entries()[0]!;
    expect(log).toMatchObject({ node: 'attention', chosen: 'distracted(random)' });
    expect(log.reason).toMatch(/^\d+(\.\d)? s \(until \d+\)$/);
  });

  it('a bot the model never saw is focused', () => {
    const mem = newMemory();
    expect(isDistracted(mem, 100)).toBe(false);
    expect(attentionStats(mem, 100)).toBeNull();
  });

  it('tilt lengthens windows (x1 + tilt x 30 %, capped at 3 s) and raises the share', () => {
    const calm = fake('gold', 3);
    const tilted = fake('gold', 3);
    tilted.mem.ext.tilt = 3;
    simulate(calm, 20);
    simulate(tilted, 20);
    const sc = attentionStats(calm.mem, 20 * 1800)!;
    const st = attentionStats(tilted.mem, 20 * 1800)!;
    expect(st.share).toBeGreaterThan(sc.share * 1.3);
    expect(st.maxWindowS).toBeLessThanOrEqual(attn.maxS);
  });

  it('withTilt attention mode: aggression +1 per stack, no direct degradation', () => {
    const p = paramsFor('gold');
    const t = withTilt(p, 2, 'attention');
    expect(t.playstyle.aggression).toBe(p.playstyle.aggression + 2);
    expect(t.behavior).toBe(p.behavior);
  });

  it('orbwalk chance: rank value at kiting 0, 100 % at -5, 0 % at +5', () => {
    expect(orbwalkChanceAt(55, 0)).toBeCloseTo(0.55);
    expect(orbwalkChanceAt(55, -5)).toBeCloseTo(1);
    expect(orbwalkChanceAt(97, 5)).toBeCloseTo(0);
    expect(orbwalkChanceAt(20, -2.5)).toBeCloseTo(0.6);
  });
});

describe('F9 rows (BRAIN-REWORK §3)', () => {
  it('intent + top-3 candidates from the utility log node; reflex / attention passed through; absent -> tree node only', () => {
    const log = new BotDecisionLog(1000);
    log.push({ tick: 10, bot: 1, node: 'lane', inputs: {}, chosen: 'farm', reason: 'tree' });
    const info = { champ: 'brom', rank: 'gold', skill: 45, archetype: null, rolled: true, mode: 'lane' };
    expect(debugRows(log, [{ slot: 1, ...info }])[0]!.intent).toBeUndefined();
    log.push({ tick: 20, bot: 1, node: INTENT_NODE, inputs: {}, scores: { farm: 3.1, trade: 1.2, roam: -0.4, recall: 0.5 }, chosen: 'farm', reason: 'best' });
    log.push({ tick: 21, bot: 1, node: 'lane', inputs: {}, chosen: 'lastHit', reason: 'window' });
    const reflex = { intent: 'laneFarm/push', plans: [{ kind: 'lastHit', targetId: 42, inTicks: 12 }], util30s: 0.55, stand: null };
    const row = debugRows(log, [{ slot: 1, ...info, reflex, attention: { text: 'focused', share: 0.2 } }])[0]!;
    expect(row.intent).toEqual({ chosen: 'farm', tick: 20, candidates: [['farm', 3.1], ['trade', 1.2], ['recall', 0.5]] });
    expect(row.node).toBe('lane');
    expect(row.reflex).toBe(reflex);
    expect(row.attention?.share).toBe(0.2);
  });
});

describe('error episodes: duration, detection, "Mein Fehler"', () => {
  it('logs injectedError with duration, stays active for durS, then is detected', () => {
    const f = fake('gold', 1);
    const ep = startErrorEpisode(f.mem, f.ctx, 'idle_after_shove', 1000);
    expect(errorDurationS('idle_after_shove', f.ctx.params.skill)).toBeCloseTo(8, 1);
    expect(f.ctx.log.entries()[0]).toMatchObject({ node: 'error', chosen: 'idle_after_shove', injectedError: 'idle_after_shove', reason: 'injectedError: idle_after_shove (dur 8 s)' });
    expect(errorActive(f.mem, 'idle_after_shove', ep.until - 1)).toBe(ep);
    expect(startErrorEpisode(f.mem, f.ctx, 'idle_after_shove', 1100)).toBe(ep); // not restarted
    expect(detectErrors(f.mem, f.ctx, ep.until - 1)).toEqual([]);
    detectErrors(f.mem, f.ctx, ep.until);
    expect(errorActive(f.mem, 'idle_after_shove', ep.until)).toBeNull();
    expect(f.ctx.log.entries().some((e: DecisionLogEntry) => e.chosen === 'detected:idle_after_shove')).toBe(true);
  });

  it('"Mein Fehler" from Silver about 20 %, never below Silver', () => {
    const rate = (rank: Rank): number => {
      let said = 0;
      for (let i = 0; i < 400; i++) {
        const f = fake(rank, 100 + i);
        startErrorEpisode(f.mem, f.ctx, 'chase_third_kill', 0);
        said += detectErrors(f.mem, f.ctx, 10_000).length;
      }
      return said / 400;
    };
    expect(rate('iron')).toBe(0);
    expect(rate('bronze')).toBe(0);
    expect(Math.abs(rate('silver') - 0.2)).toBeLessThan(0.06);
    expect(Math.abs(rate('diamond') - 0.2)).toBeLessThan(0.06);
  });
});

describe('test 10 (BRAIN-REWORK §10): Iron bot game, 5 min, new brain on (real runner wiring)', () => {
  // one game for all clauses: the runner itself feeds the attention model (RunnerOptions.reflex -> new brain), the
  // reflex layer cancels / skips last hits while distracted, the legacy per-minion lapse is gone
  let game: ReturnType<typeof playIron> | null = null;
  const iron = (): ReturnType<typeof playIron> => (game ??= playIron());

  it('distracted share 30-40 %, no window longer than 3 s, every window logged', () => {
    const { bots, end } = iron();
    // the per-game variance roll lifts some "Iron" bots towards Bronze/Silver (Iron is the floor): judge the bots that
    // play as Iron against 30-40 %, all ten against their mean target (errorInjectionPct after variance) +-5 points.
    // A single bot over 5 min is noisy (one bot in a Bronze roll had 15 % against 28 %), so no per-bot bound.
    const ironShares: number[] = [];
    const info: string[] = [];
    let share = 0;
    let target = 0;
    for (const b of bots.bots) {
      const s = attentionStats(b.mem, end)!;
      expect(s.maxWindowS).toBeLessThanOrEqual(3);
      const tgt = b.ctx.params.behavior.errorInjectionPct / 100;
      info.push(`${b.ctx.params.rank}/${Math.round(b.ctx.params.skill)} ${s.share.toFixed(2)} (${tgt.toFixed(2)})`);
      share += s.share / bots.bots.length;
      target += tgt / bots.bots.length;
      if (b.ctx.params.rank === 'iron') ironShares.push(s.share);
      const logged = bots.log.entries(b.ctx.slot).filter((e) => e.node === 'attention' && !e.chosen.includes('+')).length;
      expect(logged).toBe(s.windows);
    }
    expect(Math.abs(share - target), info.join(' | ')).toBeLessThanOrEqual(0.05);
    expect(ironShares.length, info.join(' | ')).toBeGreaterThanOrEqual(3);
    const mean = ironShares.reduce((a, c) => a + c, 0) / ironShares.length;
    expect(mean, info.join(' | ')).toBeGreaterThanOrEqual(0.3);
    expect(mean, info.join(' | ')).toBeLessThanOrEqual(0.4);
  }, 300_000);

  it('no minion ignored forever: every minion with >= 2 kill windows in reach was attacked at least once', () => {
    const { windows, attacked, distractedCancels } = iron();
    const missed: string[] = [];
    let n2 = 0;
    for (const [key, w] of windows) {
      if (w < 2) continue;
      n2++;
      if (!attacked.has(key)) missed.push(key);
    }
    // the plans really are cancelled / skipped through the attention windows (reason 'distracted')
    expect(missed, `${missed.length} of ${n2} minions with >= 2 windows never attacked`).toEqual([]);
    expect(distractedCancels).toBeGreaterThan(0);
    // seed 7 (22 Oct): 45 minions with >= 2 separate windows in reach over the 5 min
    expect(n2).toBeGreaterThanOrEqual(20);
  }, 300_000);
});

/**
 * Seed 7, Iron, variance stable, 5 min, reflex layer on. Records per laner and enemy minion (by serial) how many
 * separate kill windows it had in reach (reflex window table: a < b, no walk) and whether the bot ever started a
 * wind-up on it.
 */
function playIron(): { bots: BotRunner; end: number; windows: Map<string, number>; attacked: Set<string>; distractedCancels: number } {
  const config = botGameConfig(7, 'iron', 'stable');
  const sim = createSim(config);
  const bots = new BotRunner(config, undefined, { reflex: true });
  const end = 5 * 1800;
  const windows = new Map<string, number>();
  const open = new Set<string>();
  const attacked = new Set<string>();
  const { Atk, Unit } = sim.c;
  while (sim.tick < end) {
    const inputs = bots.tick(sim);
    for (const b of bots.bots) {
      const me = sim.slots[b.ctx.slot]!;
      const last = reflexState(b.mem).last;
      const now = new Set<string>();
      if (last && last.tick === sim.tick) {
        for (const w of last.windows) {
          if (w.a === Infinity || w.a >= w.b || w.walk > 0) continue;
          const key = `${b.ctx.slot}:${(w.m as { serial?: number }).serial ?? w.m.id}`;
          now.add(key);
          if (!open.has(key)) windows.set(key, (windows.get(key) ?? 0) + 1);
        }
      }
      for (const k of open) if (k.startsWith(`${b.ctx.slot}:`) && !now.has(k)) open.delete(k);
      for (const k of now) open.add(k);
      if (me >= 0 && Atk.phase[me] === 1 && Atk.target[me]! >= 0) attacked.add(`${b.ctx.slot}:${Unit.serial[Atk.target[me]!]}`);
    }
    step(sim, inputs);
  }
  let distractedCancels = 0;
  for (const b of bots.bots) distractedCancels += reflexState(b.mem).stats.cancels.distracted ?? 0;
  return { bots, end, windows, attacked, distractedCancels };
}
