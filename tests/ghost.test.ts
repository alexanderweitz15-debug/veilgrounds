// Challenger-Geist (src/ai/ghost.ts): divergence detection on synthetic data, intent extraction, and the guarantee
// that the ghost does not influence the simulation (same state hash and replay with or without it).
import { describe, expect, it } from 'vitest';
import { DivergenceTracker, GhostRunner, MAX_MOMENTS, intentOf, type GhostIntent, type PlayerFacts } from '../src/ai/ghost';
import { BotRunner, botGameConfig } from '../src/ai/runner';
import { createSim, step, stateHash } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { Recorder, playReplay } from '../src/replay/replay';
import { Kind, type SimConfig, type SimEvent, type TickInput } from '../src/sim/types';
import { champEnt, hud, minion, snapshot } from './botScenario';
import { scenarioConfig } from '../src/game/scenarioConfig';
import { trainerHud } from '../src/sim/trainer';

const facts = (tick: number, o: Partial<PlayerFacts> = {}): PlayerFacts => ({
  tick,
  eid: 100,
  team: 0,
  dead: false,
  hp: 0.5,
  x: 7000,
  y: 7000,
  home: 8500,
  recalling: false,
  flashed: false,
  engaged: false,
  events: [],
  enemyHp: new Map(),
  ...o,
});

const death = (eid: number, killer: number, o: Partial<Extract<SimEvent, { e: 'death' }>> = {}): SimEvent => ({ e: 'death', eid, kind: Kind.Champion, team: 0, killer, x: 7000, y: 7000, ...o });

/** Feeds ticks from..to; `at` returns facts overrides for a tick. */
function run(tr: DivergenceTracker, from: number, to: number, at: (t: number) => Partial<PlayerFacts> = () => ({}), intents: Record<number, GhostIntent[]> = {}): void {
  for (let t = from; t <= to; t++) {
    tr.onTick(facts(t, at(t)));
    for (const i of intents[t] ?? []) tr.onIntent(i);
  }
}

describe('divergence tracker', () => {
  it('ghost backs off, player stays and dies -> high-impact retreat moment', () => {
    const tr = new DivergenceTracker();
    run(tr, 1000, 1200, (t) => (t >= 1150 ? { dead: true, events: t === 1150 ? [death(100, 205)] : [] } : { hp: 0.3 }), { 1001: [{ tick: 1001, kind: 'retreat', why: 'low hp' }] });
    const m = tr.moments();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'retreat', outcome: 'died', impact: 10, why: 'low hp' });
    expect(m[0]!.t).toBeCloseTo(1001 / 30, 3);
    expect(m[0]!.vars.after).toBe(5);
  });

  it('player agrees (recalls or walks home) -> no moment', () => {
    const tr = new DivergenceTracker();
    run(tr, 0, 400, (t) => ({ recalling: t > 20 && t < 60, dead: t > 300 }), { 10: [{ tick: 10, kind: 'recall', why: 'low hp' }] });
    const tr2 = new DivergenceTracker();
    run(tr2, 0, 400, (t) => ({ home: 8500 - t * 10, dead: t > 300 }), { 10: [{ tick: 10, kind: 'retreat', why: 'outnumbered' }] });
    expect(tr.moments()).toHaveLength(0);
    expect(tr2.moments()).toHaveLength(0);
  });

  it('ghost flashes, player does not and dies -> flash moment; player flashing too -> none', () => {
    const tr = new DivergenceTracker();
    run(tr, 0, 120, (t) => (t >= 40 ? { dead: true } : { hp: 0.4 }), { 20: [{ tick: 20, kind: 'flash', why: 'skillshot dodge' }] });
    expect(tr.moments()[0]).toMatchObject({ kind: 'flash', outcome: 'died', impact: 9 });
    const ok = new DivergenceTracker();
    run(ok, 0, 120, (t) => ({ flashed: t === 25, dead: t >= 40 }), { 20: [{ tick: 20, kind: 'flash', why: 'skillshot dodge' }] });
    expect(ok.moments()).toHaveLength(0);
  });

  it('one death is one moment (retreat first, then Flash before the same death)', () => {
    const tr = new DivergenceTracker();
    run(tr, 0, 200, (t) => ({ dead: t >= 150 }), { 10: [{ tick: 10, kind: 'retreat', why: 'low hp' }], 120: [{ tick: 120, kind: 'flash', why: 'skillshot' }] });
    expect(tr.moments().map((m) => m.kind)).toEqual(['retreat']);
  });

  it('missed last hits the ghost had planned are grouped per minute', () => {
    const tr = new DivergenceTracker();
    const ids = [501, 502, 503, 504, 505];
    const intents: Record<number, GhostIntent[]> = {};
    ids.forEach((id, k) => (intents[100 + k * 200] = [{ tick: 100 + k * 200, kind: 'lastHit', target: id, why: 'last hit' }]));
    // each minion dies 20 ticks after the plan; the last one is the player's own CS
    run(tr, 0, 3000, (t) => {
      const k = ids.findIndex((_, i) => t === 120 + i * 200);
      if (k < 0) return {};
      return { events: [death(ids[k]!, k === 4 ? 100 : 300, { kind: Kind.MinionMelee, team: 1 })] };
    }, intents);
    const m = tr.moments();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'lastHit', outcome: 'missedCs' });
    expect(m[0]!.vars.n).toBe(4);
    expect(m[0]!.vars.gold).toBe(80);
  });

  it('objective: far away while the enemy takes it -> objLost', () => {
    const tr = new DivergenceTracker();
    run(tr, 0, 600, (t) => (t === 500 ? { events: [death(900, 206, { kind: Kind.Monster, team: 2, x: 10500, y: 5500, killerTeam: 1 } as never)] } : { x: 2000, y: 2000 }), {
      10: [{ tick: 10, kind: 'objective', obj: 'leviathan', x: 10500, y: 5500, why: 'safety 0.8' }],
    });
    expect(tr.moments()[0]).toMatchObject({ kind: 'objective', outcome: 'objLost', vars: { obj: 'leviathan' } });
  });

  it('keeps at most 10 moments, the most impactful, in time order; one per kind per 20 s', () => {
    const tr = new DivergenceTracker();
    // 30 deaths after retreat intents, 40 s apart
    for (let k = 0; k < 30; k++) {
      const t0 = k * 1200;
      run(tr, t0, t0 + 400, (t) => (t >= t0 + 100 && t < t0 + 300 ? { dead: true } : {}), { [t0 + 5]: [{ tick: t0 + 5, kind: 'retreat', why: `r${k}` }] });
    }
    const m = tr.moments();
    expect(m.length).toBe(MAX_MOMENTS);
    for (let i = 1; i < m.length; i++) expect(m[i]!.t).toBeGreaterThan(m[i - 1]!.t);
    // a second retreat death within 20 s is the same fight: not reported twice
    const tr2 = new DivergenceTracker();
    run(tr2, 0, 900, (t) => ({ dead: (t >= 100 && t < 200) || (t >= 500 && t < 600) }), { 5: [{ tick: 5, kind: 'retreat', why: 'a' }], 300: [{ tick: 300, kind: 'retreat', why: 'b' }] });
    expect(tr2.moments()).toHaveLength(1);
  });
});

describe('intent extraction', () => {
  it('reads Flash, recall, last hits on low minions and retreat log entries', () => {
    const low = { ...minion(1, 7100, 7000), hp: 60 };
    const high = minion(1, 7150, 7000);
    const snap = snapshot({ tick: 300, team: 0, me: hud(3), entities: [champEnt(3, 7000, 7000), low, high] });
    const flashSlot = 0;
    const out = intentOf(300, snap, [
      { cmd: { t: 'spell', slot: 0, x: 0, y: 0 } },
      { cmd: { t: 'attack', target: low.id } },
      { cmd: { t: 'attack', target: high.id } },
    ], [{ tick: 300, bot: 3, node: 'retreat', inputs: {}, chosen: 'retreat', reason: 'tower aggro' }, { tick: 300, bot: 3, node: 'dodge', inputs: {}, chosen: 'dodge', reason: 'skillshot' }], flashSlot, null);
    expect(out.map((i) => i.kind).sort()).toEqual(['flash', 'lastHit', 'retreat']);
    expect(out.find((i) => i.kind === 'lastHit')!.target).toBe(low.id);
    expect(out.find((i) => i.kind === 'flash')!.why).toBe('skillshot');
    const obj = intentOf(300, snap, [], [], -1, { kind: 'take_objective', obj: 'leviathan', x: 10500, y: 5500, reason: 'safety' });
    expect(obj[0]).toMatchObject({ kind: 'objective', obj: 'leviathan' });
  });
});

describe('ghost runner', () => {
  /** Bot game with slot 0 taken over by a scripted "player" that walks mid and attacks what is near. */
  const humanConfig = (): SimConfig => {
    const c = botGameConfig(21, 'gold');
    const p = c.players.find((x) => x.slot === 2)!; // mid
    p.isHuman = true;
    delete p.bot;
    return c;
  };
  const script = (tick: number): TickInput[] => (tick % 45 === 0 ? [{ slot: 2, cmd: { t: 'attackMove', x: 7600 + (tick % 400), y: 7600 } }] : []);

  function game(withGhost: boolean, ticks: number): { hash: string; replayHash: string; ghost: GhostRunner | null } {
    const c = humanConfig();
    const sim = createSim(structuredClone(c));
    const bots = new BotRunner(c);
    const rec = new Recorder(structuredClone(c));
    const ghost = withGhost ? new GhostRunner(c, 2) : null;
    while (sim.tick < ticks) {
      const human = script(sim.tick);
      const inputs = [...human, ...bots.tick(sim)];
      rec.record(sim.tick, inputs);
      step(sim, inputs);
      if (ghost) ghost.observe(buildSnapshot(sim, 0, 2), human.map((h) => h.cmd));
    }
    const replay = rec.finish(sim);
    return { hash: stateHash(sim), replayHash: stateHash(playReplay(replay)), ghost };
  }

  it('in a scenario: an idle player dying under 2v1 pressure gets a "back off" moment', () => {
    const c = scenarioConfig({ scenario: 'turret2v1' }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 'gold', 11);
    const sim = createSim(c);
    const bots = new BotRunner(c);
    const ghost = new GhostRunner(c, 0);
    for (let i = 0; i < 30 * 25 && !trainerHud(sim)!.done; i++) {
      step(sim, bots.tick(sim));
      ghost.observe(buildSnapshot(sim, 0, 0), []);
    }
    expect(trainerHud(sim)!.why).toBe('died');
    const m = ghost.finish(sim.tick);
    expect(ghost.dead).toBe(false);
    expect(m.length).toBeGreaterThan(0);
    expect(m.some((x) => (x.kind === 'retreat' || x.kind === 'flash' || x.kind === 'recall') && x.outcome === 'died')).toBe(true);
  }, 60_000);

  it('does not affect the simulation: same hash with and without ghost, replay bit-identical', () => {
    const T = 30 * 100;
    const a = game(true, T);
    const b = game(false, T);
    expect(a.hash).toBe(b.hash);
    expect(a.replayHash).toBe(a.hash);
    expect(a.ghost!.dead).toBe(false);
    expect(a.ghost!.decisions).toBeGreaterThan(T / 6 / 2);
  }, 120_000);
});
