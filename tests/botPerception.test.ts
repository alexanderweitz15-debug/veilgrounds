// Agent L perception (docs/spec-bots.md §3): near range + reaction, minimap glances, clouds, GankRisk timings
// (spec test 1), ThreatMap, audio cues, Flash detection, hook patterns, and no omniscience (spec test 7).
import { describe, expect, it } from 'vitest';
import { Kind, type SimEvent } from '../src/sim/types';
import { AUDIO_BLUR, buildSnapshot } from '../src/sim/snapshot';
import { createSim, step } from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { checkFogConvention, SightingHistory } from '../src/ai/log';
import { nodes } from '../src/ai/ganks';
import { BotRunner, botGameConfig } from '../src/ai/runner';
import type { DecisionLogEntry } from '../src/ai/contract';
import { laneProgress } from '../src/ai/bot/geo';
import { threatReach } from '../src/ai/perception/threat';
import { teamEvents } from '../src/sim/snapshot';
import { sees } from '../src/sim/vision';
import { MAP, PLAYERS, champ, ScriptedBot, champEnt, eidOf, hud, minion, paramsFor, rows, snapshot } from './botScenario';

const T0 = 185 * 30; // 3:05

describe('spec test 1: gank detection timings per rank', () => {
  /** First tick at which the blue mid's GankRisk(mid) exceeds 0.4 after the enemy jungler shows at `jg` at 3:05. */
  function run(rank: Rank, seed: number, jg: { x: number; y: number }, untilS = 20): { first: number; max: number } {
    const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), seed);
    let first = -1;
    let max = 0;
    for (let tick = T0 - 300; tick <= T0 + untilS * 30; tick += bot.interval) {
      const ents = [champEnt(2, 7000, 7000), champEnt(7, 8300, 8300)];
      if (tick >= T0) ents.push(champEnt(6, jg.x, jg.y));
      const pv = bot.perceive(snapshot({ tick, team: 0, entities: ents, me: hud(2) }));
      if (tick >= T0) {
        max = Math.max(max, pv.gankRisk.mid);
        if (first < 0 && pv.gankRisk.mid > 0.4) first = tick;
      }
    }
    return { first, max };
  }
  const RIVER_NEAR = { x: 7500, y: 8200 }; // river, 1300 from the mid laner (near range)
  const RIVER_FAR = { x: 8600, y: 9300 }; // river, ~2900 away: minimap only

  it('Diamond > 0.4 within 1 s, Gold within 8 s, Silver 8-15 s late, Iron never > 0.2 (near-range sighting)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const d = run('diamond', seed, RIVER_NEAR);
      expect(d.first, `diamond seed ${seed}`).toBeGreaterThanOrEqual(T0);
      expect(d.first - T0, `diamond seed ${seed}`).toBeLessThanOrEqual(30);
      const g = run('gold', seed, RIVER_NEAR);
      expect(g.first, `gold seed ${seed}`).toBeGreaterThanOrEqual(T0);
      expect(g.first - T0, `gold seed ${seed}`).toBeLessThanOrEqual(8 * 30);
      const s = run('silver', seed, RIVER_NEAR);
      expect(s.first - T0, `silver seed ${seed}`).toBeGreaterThanOrEqual(8 * 30);
      expect(s.first - T0, `silver seed ${seed}`).toBeLessThanOrEqual(16 * 30);
      expect(run('iron', seed, RIVER_NEAR).max, `iron seed ${seed}`).toBeLessThanOrEqual(0.2);
      expect(run('bronze', seed, RIVER_NEAR).max).toBeLessThanOrEqual(0.2);
    }
  });

  it('outside near range only the minimap shows it: within the glance interval (+1 decision)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const rank of ['gold', 'diamond', 'challenger'] as const) {
        const p = paramsFor(rank);
        const r = run(rank, seed, RIVER_FAR);
        expect(r.first, `${rank} seed ${seed}`).toBeGreaterThanOrEqual(T0);
        expect(r.first - T0, `${rank} seed ${seed}`).toBeLessThanOrEqual(p.behavior.minimapIntervalS * 30 + 30 / p.behavior.microHz + 1);
      }
      // Silver: minimap glance, the 8-15 s late reaction, then (worst case) the next glance refreshes the sighting
      const sp = paramsFor('silver');
      const s = run('silver', seed, RIVER_FAR, 45);
      expect(s.first, `silver seed ${seed}`).toBeGreaterThanOrEqual(T0 + 8 * 30);
      expect(s.first - T0, `silver seed ${seed}`).toBeLessThanOrEqual((2 * sp.behavior.minimapIntervalS + 15) * 30 + 30 / sp.behavior.microHz + 1);
      expect(run('iron', seed, RIVER_FAR).max).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('minimap glances', () => {
  const far = (): ReturnType<typeof champEnt> => champEnt(5, 1300, 12000); // enemy top, far from the bot lane
  it('far enemies are not perceived between glances; own ping / kill feed / recall force a glance', () => {
    const bot = new ScriptedBot(3, paramsFor('iron', {}, 3), 4);
    // init, then move the next periodic glance far away so only forced glances can happen
    bot.perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(3, 9000, 1200)], me: hud(3) }));
    bot.st.nextGlance = 1e9;
    let pv = bot.perceive(snapshot({ tick: 3015, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3) }));
    expect(pv.glanced).toBeNull();
    expect(pv.enemies.get(5)!.visibleNow).toBe(false);
    const ping: SimEvent = { e: 'ping', slot: 3, team: 0, kind: 'alert', x: 9000, y: 1200, target: -1 };
    pv = bot.perceive(snapshot({ tick: 3030, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3), events: [ping] }));
    expect(pv.glanced).toContain('ownPing');
    expect(pv.enemies.get(5)!.visibleNow).toBe(true);
    // next decision without a forced reason: stale again
    pv = bot.perceive(snapshot({ tick: 3045, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3) }));
    expect(pv.enemies.get(5)!.visibleNow).toBe(false);
    const death: SimEvent = { e: 'death', eid: eidOf(1), kind: Kind.Champion, team: 0, killer: eidOf(6), x: 5000, y: 5000 };
    pv = bot.perceive(snapshot({ tick: 3060, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3), events: [death] }));
    expect(pv.glanced).toContain('killFeed');
    pv = bot.perceive(snapshot({ tick: 3090, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3, { recallLeft: 7 }) }));
    expect(pv.glanced).toContain('recall');
  });

  it('ally pings force a glance from Silver, not for Iron', () => {
    const ping: SimEvent = { e: 'ping', slot: 1, team: 0, kind: 'danger', x: 5000, y: 5000, target: -1 };
    for (const [rank, want] of [['iron', false], ['silver', true]] as const) {
      const bot = new ScriptedBot(3, paramsFor(rank, {}, 3), 4);
      bot.perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(3, 9000, 1200)], me: hud(3) }));
      bot.st.nextGlance = 1e9;
      const pv = bot.perceive(snapshot({ tick: 3015, team: 0, entities: [champEnt(3, 9000, 1200), far()], me: hud(3), events: [ping] }));
      expect(pv.enemies.get(5)!.visibleNow, rank).toBe(want);
    }
  });

  it('near range: an enemy is noticed only after the sampled reaction time', () => {
    const bot = new ScriptedBot(3, paramsFor('iron', {}, 3), 9);
    bot.perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(3, 9000, 1200)], me: hud(3) }));
    bot.st.nextGlance = 1e9;
    const pv = bot.perceive(snapshot({ tick: 3015, team: 0, entities: [champEnt(3, 9000, 1200), champEnt(8, 9600, 1200)], me: hud(3) }));
    expect(pv.enemies.get(8)!.visibleNow).toBe(false); // Iron ~450 ms > 0 ticks
    const later = bot.perceive(snapshot({ tick: 3045, team: 0, entities: [champEnt(3, 9000, 1200), champEnt(8, 9600, 1200)], me: hud(3) }));
    expect(later.enemies.get(8)!.visibleNow).toBe(true);
  });
});

describe('probability clouds', () => {
  /** Enemy jungler seen walking (two samples), then gone; returns the track's cloud `afterS` seconds later. */
  function cloudAfter(rank: Rank, afterS: number) {
    const bot = new ScriptedBot(1, paramsFor(rank, {}, 1), 3);
    const me = (t: number) => snapshot({ tick: t, team: 0, entities: [champEnt(1, 5000, 9000), ...(t <= 3030 ? [champEnt(6, 5600 + (t - 3000) * 5, 9800)] : [])], me: hud(1) });
    bot.perceive(me(3000));
    bot.perceive(me(3015));
    bot.perceive(me(3030));
    return { pv: bot.perceive(me(3030 + Math.round(afterS * 30))), bot };
  }
  it('horizon by rank: Iron none, Gold 30 s, Diamond 90 s, Challenger until contact', () => {
    expect(cloudAfter('iron', 5).pv.enemies.get(6)!.cloud).toBeNull();
    expect(cloudAfter('gold', 10).pv.enemies.get(6)!.cloud).not.toBeNull();
    expect(cloudAfter('gold', 31).pv.enemies.get(6)!.cloud).toBeNull();
    expect(cloudAfter('diamond', 80).pv.enemies.get(6)!.cloud).not.toBeNull();
    expect(cloudAfter('diamond', 91).pv.enemies.get(6)!.cloud).toBeNull();
    expect(cloudAfter('challenger', 400).pv.enemies.get(6)!.cloud).not.toBeNull();
  });
  it('radius grows, weight decays, centre drifts from the last sighting', () => {
    const a = cloudAfter('diamond', 5).pv.enemies.get(6)!;
    const b = cloudAfter('diamond', 40).pv.enemies.get(6)!;
    expect(b.cloud!.r).toBeGreaterThan(a.cloud!.r);
    expect(b.cloud!.weight).toBeLessThan(a.cloud!.weight);
    const drift = (t: typeof a): number => Math.hypot(t.cloud!.x - t.lastX, t.cloud!.y - t.lastY);
    expect(drift(a)).toBeGreaterThan(0);
    expect(drift(b)).toBeGreaterThanOrEqual(drift(a));
    // the last seen position never changes while unseen
    expect(b.lastX).toBe(a.lastX);
    expect(b.visibleNow).toBe(false);
  });
  it('Challenger CS counting: a laner gaining CS while unseen is placed in its lane', () => {
    const bot = new ScriptedBot(2, paramsFor('challenger', {}, 2), 3);
    const s = (t: number, cs: number, seen: boolean) =>
      snapshot({ tick: t, team: 0, entities: [champEnt(2, 3600, 8600), ...(seen ? [champEnt(5, 3000, 9000)] : [])], me: hud(2), players: rows({ 5: { cs } }) });
    bot.perceive(s(3000, 40, true));
    bot.perceive(s(3015, 40, true));
    const pv = bot.perceive(s(3015 + 20 * 30, 46, false));
    const c = pv.enemies.get(5)!.cloud!;
    const top = MAP.sides[1].lanes.top;
    // nearer to the enemy top lane polyline than to the fountain
    const dLane = laneProgress(top, c).off;
    expect(dLane).toBeLessThan(Math.hypot(MAP.sides[1].fountain.x - c.x, MAP.sides[1].fountain.y - c.y));
  });
});

describe('threat map', () => {
  it('towers, visible enemies (+ Flash reach unless known down), bushes from Silver', () => {
    const t = MAP.sides[1].towers.mid[0]!;
    const make = (rank: Rank) => {
      const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), 5);
      const s = (tick: number) => snapshot({ tick, team: 0, entities: [champEnt(2, 6000, 6000), champEnt(7, 7000, 6000)], me: hud(2) });
      bot.perceive(s(30 * 200));
      return bot.perceive(s(30 * 200 + 30));
    };
    const pv = make('gold');
    expect(pv.threat(t.x, t.y)).toBeGreaterThanOrEqual(1.5);
    expect(pv.threat(7000, 6200)).toBeGreaterThan(0.5);
    expect(make('iron').threat(2000, 12000)).toBe(0);
    const bush = MAP.bushes.find((b) => Math.hypot(b.x - 6000, b.y - 6000) > 2500 && Math.hypot(b.x - 7000, b.y - 6000) > 2500 && !MAP.sides.some((s) => Object.values(s.towers).flat().some((tw) => Math.hypot(tw.x - b.x, tw.y - b.y) < 1000)))!;
    expect(make('silver').threat(bush.x, bush.y)).toBeGreaterThan(0);
    expect(make('iron').threat(bush.x, bush.y)).toBe(0);
    // Flash known down shrinks the reach
    const bot = new ScriptedBot(2, paramsFor('gold', {}, 2), 5);
    const s = (tick: number) => snapshot({ tick, team: 0, entities: [champEnt(2, 6000, 6000), champEnt(7, 7000, 6000)], me: hud(2) });
    bot.perceive(s(6000));
    const px = 7000 - (threatReach(champ('thessaly')) + 200);
    const before = bot.perceive(s(6030)).threat(px, 6000);
    bot.st.tracks.get(7)!.cds.flashReadyAt = 1e9;
    expect(bot.perceive(s(6060)).threat(px, 6000)).toBeLessThan(before);
  });
});

describe('audio cues and cooldown tracking', () => {
  it('heard casts reach every rank; Platinum+ use them to re-anchor the track', () => {
    for (const [rank, uses] of [['gold', false], ['platinum', true]] as const) {
      const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), 5);
      bot.perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 6000, 6000), champEnt(6, 6500, 6500)], me: hud(2) }));
      bot.perceive(snapshot({ tick: 3030, team: 0, entities: [champEnt(2, 6000, 6000), champEnt(6, 6500, 6500)], me: hud(2) }));
      const pv = bot.perceive(snapshot({ tick: 3200, team: 0, entities: [champEnt(2, 6000, 6000)], me: hud(2), audio: [{ slot: 6, abilitySlot: 0, x: 7200, y: 6000, dx: -1, dy: 0, tick: 3190 }] }));
      expect(pv.audio).toHaveLength(1);
      expect(pv.enemies.get(6)!.anchor!.src, rank).toBe(uses ? 'audio' : 'seen');
    }
  });

  it('blink jump without a dash cast = Flash: tracked from Diamond, never for Iron', () => {
    for (const [rank, tracked] of [['iron', false], ['diamond', true]] as const) {
      const bot = new ScriptedBot(3, paramsFor(rank, {}, 3), 5);
      const s = (tick: number, x: number) => snapshot({ tick, team: 0, entities: [champEnt(3, 9000, 1200), champEnt(8, x, 1300)], me: hud(3) });
      bot.perceive(s(3000, 9600));
      bot.perceive(s(3030, 9600));
      bot.perceive(s(3060, 9600));
      const pv = bot.perceive(s(3066, 10100)); // 500 in 0.2 s
      expect((pv.enemies.get(8)!.cds.flashReadyAt ?? 0) > 3066, rank).toBe(tracked);
    }
  });

  it('hook pattern: three Q casts aimed at the current position -> "position" (Platinum+)', () => {
    for (const [rank, want] of [['gold', undefined], ['platinum', 'position']] as const) {
      const bot = new ScriptedBot(3, paramsFor(rank, {}, 3), 5);
      let tick = 3000;
      for (let i = 0; i < 4; i++) {
        const x = 9000 + i * 60; // the bot walks along +x
        const events: SimEvent[] = i > 0 ? [{ e: 'cast', src: eidOf(8), slot: 0, x, y: 1200 }] : [];
        bot.perceive(snapshot({ tick, team: 0, entities: [champEnt(3, x, 1200, { moving: true }), champEnt(8, x + 900, 1300)], me: hud(3), events }));
        tick += 150;
      }
      const pv = bot.perceive(snapshot({ tick, team: 0, entities: [champEnt(3, 9300, 1200), champEnt(8, 10200, 1300)], me: hud(3) }));
      expect(pv.hookPattern.get(8), rank).toBe(want);
    }
  });
});

describe('snapshot audio cues (sim side)', () => {
  it('only unseen enemy casts within 1800 of an alive ally, position snapped to the blur grid', () => {
    const config = botGameConfig(3, 'gold');
    const sim = createSim(config);
    const runner = new BotRunner(config);
    let found = 0;
    while (sim.tick < 30 * 60 * 5) {
      step(sim, runner.tick(sim));
      for (const team of [0, 1]) {
        for (const a of teamEvents(sim, team).audio) {
          found++;
          expect(a.x % AUDIO_BLUR).toBe(0);
          expect(a.y % AUDIO_BLUR).toBe(0);
          const eid = sim.slots[a.slot]!;
          expect(sim.c.Unit.team[eid]).not.toBe(team);
          expect(sees(sim, team, eid)).toBe(false);
          expect(Math.abs(sim.c.Pos.x[eid]! - a.x)).toBeLessThanOrEqual(AUDIO_BLUR / 2);
        }
      }
    }
    console.log(`audio cues in 5 min: ${found}`);
    expect(buildSnapshot(sim, 0, 0).audio).toBeDefined();
  }, 300_000);

  it('deterministic: an unseen cast 1600 from an ally is heard (blurred), one 2000 away is not', () => {
    const sim = createSim(botGameConfig(5, 'gold'));
    step(sim, []);
    const blue = sim.slots[0]!;
    const red = sim.slots[6]!;
    const { Pos } = sim.c;
    // blue top in its jungle, red jungler 1600 away (champion vision 1200, no minions yet, far from towers)
    for (const [e, x, y] of [[blue, 4000, 8000], [red, 4000 + 1600, 8000 + 30]] as const) (Pos.x[e] = x), (Pos.y[e] = y);
    for (const s of [1, 2, 3, 4]) (Pos.x[sim.slots[s]!] = 900), (Pos.y[sim.slots[s]!] = 900);
    expect(sees(sim, 0, red)).toBe(false);
    sim.events.push({ e: 'cast', src: red, slot: 0, x: 4000, y: 8030 });
    const heard = teamEvents(sim, 0);
    expect(heard.audio).toEqual([{ slot: 6, abilitySlot: 0, x: 5600, y: 8000, dx: -1, dy: 0, tick: sim.tick }]);
    expect(heard.events.some((e) => e.e === 'cast')).toBe(false); // the cast itself stays hidden
    Pos.x[red] = 4000 + 2000;
    expect(teamEvents(sim, 0).audio).toEqual([]);
  });
});

describe('spec test 7: no omniscience', () => {
  const L_NODES = new Set(['escape', 'gankRisk', 'jungleGank', 'counterGank', 'roam', 'enemyRoam']);

  it('1000 random states: the log never contains an enemy position the team has not seen (scripted)', () => {
    const rng = new Rng(77);
    const sightings = new SightingHistory();
    const all: DecisionLogEntry[] = [];
    let states = 0;
    for (let game = 0; game < 10; game++) {
      const slot = game % 5;
      const rank = RANKS[(game * 3) % RANKS.length]!;
      const bot = new ScriptedBot(slot, paramsFor(rank, { roam: 5, aggression: 3 }, slot), 1000 + game);
      let tick = 90 * 30 + game * 600;
      for (let s = 0; s < 100; s++, states++) {
        tick += 5 + rng.int(120);
        const ents = [];
        const me = PLAYERS[slot]!;
        const center = { x: 3000 + rng.next() * 10000, y: 3000 + rng.next() * 10000 };
        for (const p of PLAYERS) {
          const x = center.x + (rng.next() - 0.5) * 5000;
          const y = center.y + (rng.next() - 0.5) * 5000;
          const visible = p.team === me.team || rng.chance(0.4);
          if (visible) ents.push(champEnt(p.slot, x, y, { hp: 300 + rng.next() * 1200, moving: rng.chance(0.5) }));
        }
        for (let k = 0; k < 6; k++) ents.push(minion(rng.int(2), center.x + (rng.next() - 0.5) * 3000, center.y + (rng.next() - 0.5) * 3000));
        const events: SimEvent[] = [];
        const vis = ents.filter((e) => e.kind === Kind.Champion && e.team !== me.team);
        if (vis.length && rng.chance(0.5)) events.push({ e: 'cast', src: vis[0]!.id, slot: rng.int(4), x: center.x, y: center.y });
        if (rng.chance(0.1)) events.push({ e: 'ping', slot: (slot + 1) % 5, team: 0, kind: 'missing', x: center.x, y: center.y, target: -1 });
        const audio = rng.chance(0.2) ? [{ slot: 5 + rng.int(5), abilitySlot: 0, x: Math.round(center.x / AUDIO_BLUR) * AUDIO_BLUR, y: Math.round(center.y / AUDIO_BLUR) * AUDIO_BLUR, dx: 1, dy: 0, tick }] : [];
        const snap = snapshot({ tick, team: 0, entities: ents, me: hud(slot), events, audio });
        sightings.recordSnapshot(snap);
        const n = bot.node(snap);
        for (const f of Object.values(nodes)) f(n);
      }
      all.push(...bot.log);
    }
    expect(states).toBe(1000);
    const mine = all.filter((e) => L_NODES.has(e.node));
    expect(mine.length).toBeGreaterThan(50);
    const bad = checkFogConvention(mine, sightings);
    expect(bad.map((b) => `${b.entry.node}/${b.key}: ${b.problem}`)).toEqual([]);
    // positions are present at all (the check is not vacuous)
    expect(mine.some((e) => Object.values(e.inputs).includes('seen'))).toBe(true);
  });

  it('headless game: L nodes log only team-seen / estimated enemy positions', () => {
    const config = botGameConfig(21, 'diamond');
    const sim = createSim(config);
    const runner = new BotRunner(config);
    const sightings = new SightingHistory();
    runner.onPerceive = (_slot, snap) => sightings.recordSnapshot(snap);
    while (sim.tick < 5 * 60 * 30) step(sim, runner.tick(sim));
    const logs = runner.bots.flatMap((b) => [...b.ctx.log.entries(b.ctx.slot)]);
    const unique = [...new Set(logs)];
    const mine = unique.filter((e) => L_NODES.has(e.node));
    const byNode: Record<string, number> = {};
    for (const e of mine) byNode[`${e.node}:${e.chosen}`] = (byNode[`${e.node}:${e.chosen}`] ?? 0) + 1;
    console.log(`L log entries (5 min, diamond): ${JSON.stringify(byNode)}`);
    expect(mine.length).toBeGreaterThan(0);
    const bad = checkFogConvention(mine, sightings);
    expect(bad.map((b) => `${b.entry.node}/${b.key}: ${b.problem}`)).toEqual([]);
  }, 300_000);
});

describe('fog guard (static)', () => {
  it('perception, gank and roam modules never import sim state (sim, ecs, vision, bitecs)', () => {
    const sources = {
      ...import.meta.glob<string>('../src/ai/perception/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob<string>('../src/ai/ganks/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob<string>('../src/ai/roams/*.ts', { query: '?raw', import: 'default', eager: true }),
    };
    expect(Object.keys(sources).length).toBeGreaterThan(12);
    for (const [f, src] of Object.entries(sources)) {
      expect(src, f).not.toMatch(/from '(\.\.\/)+sim\/(sim|ecs|vision)'|from 'bitecs'/);
      expect(src, f).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});
