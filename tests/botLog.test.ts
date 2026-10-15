// Spec-bots §1/§10 decision log: caps, NDJSON round trip, shortening, F9 rows, and the fog-of-war convention
// checker (spec test 7) catching a planted omniscient position.
import { describe, expect, it } from 'vitest';
import { BotDecisionLog, SightingHistory, checkFogConvention, debugRows, shortenEntry } from '../src/ai/log';
import type { DecisionLogEntry } from '../src/ai/contract';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { sees } from '../src/sim/vision';
import { botGameConfig } from '../src/ai/runner';
import type { Replay } from '../src/replay/replay';

const entry = (tick: number, bot = 1, extra: Partial<DecisionLogEntry> = {}): DecisionLogEntry => ({
  tick,
  bot,
  node: 'trade',
  inputs: { selfX: 1000, selfY: 1200, selfSrc: 'self', hp: 0.73456 },
  scores: { trade: 0.61, farm: 0.4, back: 0.1, roam: 0.05 },
  chosen: 'trade',
  reason: 'winProb 0.61 > 0.55',
  ...extra,
});

describe('decision log', () => {
  it('caps entries (oldest dropped) and bytes', () => {
    const log = new BotDecisionLog(100);
    for (let i = 0; i < 2500; i++) log.push(entry(i, i % 9));
    expect(log.length).toBe(100);
    expect(log.dropped).toBe(2400);
    expect(log.entries()[0]!.tick).toBe(2400);
    expect(log.entries().at(-1)!.tick).toBe(2499);
    expect(log.entries(3).every((e) => e.bot === 3)).toBe(true);
    expect(log.entries(undefined, 2490).length).toBe(10);

    const small = new BotDecisionLog(1e6, 5000);
    for (let i = 0; i < 500; i++) small.push(entry(i));
    expect(small.byteSize).toBeLessThanOrEqual(5000);
    expect(small.toNDJSON().length).toBeLessThanOrEqual(5000 + small.length * 4); // byte estimate ~ string length
    expect(small.length).toBeGreaterThan(10);
  });

  it('NDJSON round trip, one line per decision', () => {
    const log = new BotDecisionLog();
    log.push(entry(5, 2, { injectedError: 'late_recall', perceptionAgeMs: 120.4, reactionMs: 311.7 }));
    log.push(entry(6, 3));
    const text = log.toNDJSON();
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(BotDecisionLog.fromNDJSON(text)).toEqual(log.entries());
    expect(log.entries()[0]!.injectedError).toBe('late_recall');
    expect(log.entries()[0]!.reactionMs).toBe(312);
  });

  it('shortens inputs, scores and reasons', () => {
    const inputs: DecisionLogEntry['inputs'] = {};
    for (let i = 0; i < 50; i++) inputs[`k${i}`] = i + 0.123456;
    const s = shortenEntry({ ...entry(1), inputs, reason: 'x'.repeat(500) });
    expect(Object.keys(s.inputs)).toHaveLength(32);
    expect(s.inputs.k1).toBe(1.12);
    expect(s.reason.length).toBe(200);
  });

  it('F9 rows: latest decision, top 3 scores, last error and reaction time per bot', () => {
    const log = new BotDecisionLog();
    log.push(entry(10, 1, { injectedError: 'carry_too_far', reactionMs: 250 }));
    log.push(entry(20, 1, { node: 'recall', chosen: 'recall', reason: 'low hp' }));
    const rows = debugRows(log, [
      { slot: 1, champ: 'mira', rank: 'gold', skill: 45, archetype: null, rolled: true, mode: 'lane' },
      { slot: 2, champ: 'brom', rank: 'gold', skill: 45, archetype: 'farmer', rolled: false, mode: 'start' },
    ]);
    expect(rows[0]).toMatchObject({ node: 'recall', reason: 'low hp', injectedError: 'carry_too_far', errorTick: 10, reactionMs: 250, tick: 20 });
    expect(rows[0]!.topScores.map((x) => x[0])).toEqual(['trade', 'farm', 'back']);
    expect(rows[1]).toMatchObject({ node: '-', tick: -1, topScores: [] });
  });
});

describe('fog-of-war convention checker (spec test 7)', () => {
  it('accepts tagged seen/cloud/self positions, flags untagged, unknown, unseen and radius-less cloud', () => {
    const h = new SightingHistory();
    h.record(0, 7, 100, 5000, 5000);
    const ok = [
      entry(120, 1, { inputs: { tgtX: 5010, tgtY: 4990, tgtSrc: 'seen', tgtSlot: 7, selfX: 1, selfY: 1, selfSrc: 'self' } }),
      entry(120, 1, { inputs: { jgX: 9000, jgY: 9000, jgSrc: 'cloud', jgR: 1200, jgSlot: 6 } }),
      entry(120, 1, { inputs: { towerX: 6400, towerY: 6400, towerSrc: 'static', hpX: 3 } }), // hpX alone: no Y -> not a position
    ];
    expect(checkFogConvention(ok, h)).toEqual([]);
    const bad = [
      entry(120, 1, { inputs: { tgtX: 5010, tgtY: 4990 } }), // untagged
      entry(120, 1, { inputs: { tgtX: 5010, tgtY: 4990, tgtSrc: 'guess' } }), // unknown source
      entry(120, 1, { inputs: { tgtX: 8000, tgtY: 8000, tgtSrc: 'seen', tgtSlot: 7 } }), // never seen there
      entry(90, 1, { inputs: { tgtX: 5000, tgtY: 5000, tgtSrc: 'seen', tgtSlot: 7 } }), // seen only later (tick 100)
      entry(120, 6, { inputs: { tgtX: 5000, tgtY: 5000, tgtSrc: 'seen', tgtSlot: 7 } }), // red team never saw slot 7 (own team anyway)
      entry(120, 1, { inputs: { jgX: 9000, jgY: 9000, jgSrc: 'cloud' } }), // cloud without radius
      entry(120, 1, { inputs: { tgtX: 5000, tgtY: 5000, tgtSrc: 'seen' } }), // seen without slot
    ];
    expect(checkFogConvention(bad, h)).toHaveLength(bad.length);
  });

  it('catches a planted enemy position taken from the sim while the team could not see it', () => {
    const sim = createSim(botGameConfig(11, 'gold'));
    const h = new SightingHistory();
    for (let i = 0; i < 90; i++) {
      step(sim, []);
      h.recordSnapshot(buildSnapshot(sim, 0, 0));
      h.recordSnapshot(buildSnapshot(sim, 1, 5));
    }
    // red jungler sits in the red fountain: blue cannot see it
    const red = sim.slots[6]!;
    expect(sees(sim, 0, red)).toBe(false);
    const x = sim.c.Pos.x[red]!;
    const y = sim.c.Pos.y[red]!;
    // blue bot 1 sees itself (team-visible), legit
    const own = sim.slots[1]!;
    const legit = entry(sim.tick, 1, { inputs: { selfX: sim.c.Pos.x[own]!, selfY: sim.c.Pos.y[own]!, selfSrc: 'self' } });
    const planted = entry(sim.tick, 1, { node: 'gank', inputs: { jgX: x, jgY: y, jgSrc: 'seen', jgSlot: 6 } });
    const v = checkFogConvention([legit, planted], h);
    expect(v).toHaveLength(1);
    expect(v[0]!.entry).toBe(planted);
    expect(v[0]!.key).toBe('jg');
  });

  it('replay carries the log as NDJSON', () => {
    const log = new BotDecisionLog();
    log.push(entry(1));
    const r: Replay = { version: 1, config: botGameConfig(1), inputs: {}, ticks: 1, hash: '', botLog: log.toNDJSON() };
    expect(BotDecisionLog.fromNDJSON(r.botLog!)).toHaveLength(1);
  });
});
