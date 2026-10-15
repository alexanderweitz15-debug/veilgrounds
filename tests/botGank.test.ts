// Agent L ganks and roams (docs/spec-bots.md §4, §5): laning safety tiers, escape Flash timing (spec test 2),
// jungler gank score (spec test 3), roam prerequisite (spec test 4).
import { describe, expect, it } from 'vitest';
import { Kind, type SimEvent } from '../src/sim/types';
import type { Rank } from '../src/ai/profiles/schema';
import { escape } from '../src/ai/ganks/escape';
import { laningSafety } from '../src/ai/ganks/risk';
import { gankScore, gankThreshold, jungleGank } from '../src/ai/ganks/jungle';
import { roam } from '../src/ai/roams/roam';
import { nodes, lConditions, lScores } from '../src/ai/ganks';
import type { BotPerception } from '../src/ai/perception';
import { ScriptedBot, champ, champEnt, eidOf, hud, minion, paramsFor, snapshot } from './botScenario';

const isFlash = (c: { t: string; slot?: number }): boolean => c.t === 'spell' && c.slot === 0; // summoner 0 = sprung

describe('§4.1 laning safety tiers', () => {
  const pvWith = (risk: number): BotPerception => {
    const bot = new ScriptedBot(2, paramsFor('gold', {}, 2), 1);
    const pv = bot.perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 7000, 7000)], me: hud(2) }));
    return { ...pv, gankRisk: { top: risk, mid: risk, bot: risk } };
  };
  it('tiers by risk, aggression shifts thresholds by up to 0.15, hysteresis on the way down', () => {
    const g = paramsFor('gold');
    expect(laningSafety(pvWith(0.1), g, 'mid').tier).toBe(0);
    expect(laningSafety(pvWith(0.3), g, 'mid')).toMatchObject({ tier: 1, allowTrade: 'short', targetShift: 200 });
    expect(laningSafety(pvWith(0.5), g, 'mid')).toMatchObject({ tier: 2, allowPush: false, allowTrade: 'killOnly', stayNearTower: true });
    expect(laningSafety(pvWith(0.8), g, 'mid')).toMatchObject({ tier: 3, retreat: true, allowTrade: 'none' });
    expect(laningSafety(pvWith(0.5), paramsFor('gold', { aggression: 5 }), 'mid').tier).toBe(1);
    expect(laningSafety(pvWith(0.3), paramsFor('gold', { aggression: -5 }), 'mid').tier).toBe(2);
    expect(laningSafety(pvWith(0.38), g, 'mid', false, 2).tier).toBe(2); // stays (0.4 - 0.05)
    expect(laningSafety(pvWith(0.33), g, 'mid', false, 2).tier).toBe(1);
  });
});

describe('spec test 2: escape Flash timing', () => {
  // blue top (Brom) 900 in front of its outer tower, 45 % HP, Flash up; enemy jungler (Grimald) + top (Isolde) on it
  // own top outer tower stands at (1300, 10600): 900 behind the bot
  const ME = { x: 1250, y: 11500 };
  const ents = () => {
    const maxHp = champEnt(0, 0, 0).maxHp;
    return [champEnt(0, ME.x, ME.y, { hp: maxHp * 0.45 }), champEnt(6, ME.x + 450, ME.y + 350), champEnt(5, ME.x + 50, ME.y + 650)];
  };
  // Grimald E (slot 2): ground-targeted CC circle, cast at the bot
  const ccCast: SimEvent = { e: 'cast', src: eidOf(6), slot: 2, x: ME.x, y: ME.y };

  function run(rank: Rank, seed: number) {
    const bot = new ScriptedBot(0, paramsFor(rank, {}, 0), seed);
    let tick = 300 * 30;
    const flashes: { tick: number; phase: string }[] = [];
    let mode = '';
    const step = (phase: string, o: { events?: SimEvent[]; cc?: number } = {}) => {
      const n = bot.node(snapshot({ tick, team: 0, entities: ents(), me: hud(0, { cc: o.cc ?? 0 }), events: o.events ?? [] }));
      escape(n);
      for (const a of n.out) if (isFlash(a.cmd as { t: string; slot?: number })) flashes.push({ tick, phase });
      tick += bot.interval;
    };
    for (let i = 0; i < 12; i++) step('before');
    step('cast', { events: [ccCast] });
    step('cc', { cc: 3 });
    step('cc', { cc: 3 });
    for (let i = 0; i < 6; i++) step('after');
    mode = bot.log.find((e) => e.node === 'escape' && (e.chosen === 'escape' || e.chosen === 'fight'))?.chosen ?? '';
    return { flashes, mode, log: bot.log };
  }

  it('Platinum flashes when the CC cast starts, never before', () => {
    expect(champ('grimald').abilities[2]!.effects.some((e) => e.kind === 'root' || e.kind === 'stun')).toBe(true);
    for (let seed = 1; seed <= 20; seed++) {
      const r = run('platinum', seed);
      expect(r.mode, `seed ${seed}`).toBe('escape');
      expect(r.flashes.filter((f) => f.phase === 'before'), `seed ${seed}`).toEqual([]);
      expect(r.flashes[0]?.phase, `seed ${seed}`).toBe('cast');
      const entry = r.log.find((e) => e.chosen === 'flash')!;
      expect(entry.reason).toMatch(/^a: CC cast/);
    }
  });

  it('Iron cannot read the wind-up: flashes only after the CC, in ~15 % of escape runs', () => {
    let escapes = 0;
    let late = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = run('iron', seed);
      expect(r.flashes.filter((f) => f.phase === 'before' || f.phase === 'cast')).toEqual([]);
      if (r.mode !== 'escape') continue; // Iron flips a coin between fight and flight (§4.2.2)
      escapes++;
      if (r.flashes.some((f) => f.phase === 'after')) late++;
    }
    const rate = late / escapes;
    console.log(`iron escapes ${escapes}, late flashes ${late} (${(rate * 100).toFixed(1)} %)`);
    expect(escapes).toBeGreaterThan(80);
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.25);
  });
});

describe('spec test 3: jungler gank score', () => {
  // red top (Isolde) pushed into the blue half at 40 % HP, Flash known down; blue jungler (Lio) close by
  const TARGET = { x: 1200, y: 12500 };
  function scenario(rank: Rank, o: { hp?: number; flashDown?: boolean; pushed?: boolean } = {}) {
    const bot = new ScriptedBot(1, paramsFor(rank, {}, 1), 7);
    const tick = 400 * 30;
    const maxHp = champEnt(5, 0, 0).maxHp;
    const pushed = o.pushed ?? true;
    const wave = pushed
      ? [minion(1, 1200, 12100), minion(1, 1250, 12000), minion(1, 1150, 11950), minion(1, 1200, 11900), minion(0, 1200, 11800)]
      : [minion(1, 1200, 14000), minion(0, 1200, 13800), minion(0, 1250, 13900)];
    const ents = [champEnt(1, 2000, 11700), champEnt(0, 1250, 11000), champEnt(5, TARGET.x, pushed ? TARGET.y : 14100, { hp: maxHp * (o.hp ?? 0.4) }), ...wave];
    const s = (t: number) => snapshot({ tick: t, team: 0, entities: ents, me: hud(1) });
    bot.perceive(s(tick - 30));
    const n = bot.node(s(tick));
    if (o.flashDown ?? true) bot.st.tracks.get(5)!.cds.flashReadyAt = tick + 200 * 30; // the bot saw the Flash
    return { n, pv: n.pv as BotPerception, bot };
  }

  it('wave on the jungler side, target 40 % HP without Flash -> score > 0.7 for rank >= Gold, and a gank starts', () => {
    for (const rank of ['gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'] as const) {
      const { n, pv, bot } = scenario(rank);
      const ev = gankScore(n, pv, 'top')!;
      expect(ev.score, `${rank} ${JSON.stringify(ev.terms)}`).toBeGreaterThan(0.7);
      expect(ev.score).toBeGreaterThan(gankThreshold(n));
      jungleGank(n);
      expect(bot.log.find((e) => e.node === 'jungleGank')?.chosen, rank).toBe('gank_top');
    }
  });

  it('no window: full HP, Flash up, clash in the enemy half -> below the threshold', () => {
    const { n, pv } = scenario('diamond', { hp: 1, flashDown: false, pushed: false });
    const ev = gankScore(n, pv, 'top');
    expect(ev === null || ev.score < gankThreshold(n)).toBe(true);
  });
});

describe('spec test 4: roam prerequisite', () => {
  // blue mid with its own wave pushing on its own side (not crashed, not frozen); a juicy top-lane target
  function roams(rank: Rank, seed: number): boolean {
    const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), seed);
    const tick = 500 * 30;
    const maxHp = champEnt(5, 0, 0).maxHp;
    const ents = [
      champEnt(2, 6900, 6900),
      champEnt(0, 1250, 11000),
      champEnt(1, 2000, 11500),
      champEnt(5, 1200, 12500, { hp: maxHp * 0.3 }),
      ...[0, 1, 2, 3, 4, 5].map((i) => minion(0, 7200 + i * 40, 7200 + i * 30)),
      minion(1, 7600, 7600),
      minion(1, 7650, 7620),
    ];
    // own ping forces a minimap glance so the far target is perceived
    const ping: SimEvent = { e: 'ping', slot: 2, team: 0, kind: 'alert', x: 1200, y: 12500, target: -1 };
    bot.perceive(snapshot({ tick: tick - 30, team: 0, entities: ents, me: hud(2) }));
    const n = bot.node(snapshot({ tick, team: 0, entities: ents, me: hud(2), events: [ping] }));
    const pv = n.pv as BotPerception;
    expect(pv.waves.mid.pushing).toBe(true);
    expect(pv.waves.mid.crashed).toBe(false);
    roam(n);
    const e = bot.log.find((x) => x.node === 'roam' && x.chosen.startsWith('roam_'));
    if (e && rank === 'iron') expect(e.injectedError).toBe('roam_from_push');
    return !!e;
  }
  it('Diamond does not roam off a pushing wave; Iron does in ~30 % (roam_from_push)', () => {
    let iron = 0;
    for (let seed = 1; seed <= 300; seed++) {
      expect(roams('diamond', seed), `diamond seed ${seed}`).toBe(false);
      if (roams('iron', seed)) iron++;
    }
    console.log(`iron roams off a pushing wave: ${iron}/300`);
    expect(iron / 300).toBeGreaterThan(0.2);
    expect(iron / 300).toBeLessThan(0.4);
  });
});

describe('node registry for the behaviour tree', () => {
  it('exports actions, conditions and scores that tolerate a stub perception', () => {
    expect(Object.keys(nodes).sort()).toEqual(['counterGank', 'enemyRoamReaction', 'escape', 'gankRiskReaction', 'jungleGank', 'roam']);
    const bot = new ScriptedBot(2, paramsFor('gold', {}, 2), 1);
    const n = bot.node(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 7000, 7000)], me: hud(2) }));
    const stub = { ...n, pv: { tick: 3000, enemies: new Map(), gankRisk: { top: 0, mid: 0, bot: 0 }, threat: () => 0, audio: [] } };
    for (const f of Object.values(nodes)) expect(f(stub)).toBe('failure');
    for (const f of Object.values(lConditions)) expect(f(stub)).toBe(false);
    for (const f of Object.values(lScores)) expect(f(stub)).toBe(0);
    expect(Kind.Champion).toBe(1);
  });
});
