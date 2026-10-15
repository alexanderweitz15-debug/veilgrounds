// Last-hit planner (src/ai/bot/lasthit.ts): minion HP prediction from observed swings, kill windows, rank timing
// error, and a headless CS floor; decision-log throttle (spec-bots §1: one entry per decision, not per tick).
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot, teamEvents } from '../src/sim/snapshot';
import { Kind, isMinion, type SimEvent } from '../src/sim/types';
import { botGameConfig } from '../src/ai/runner';
import { runBotGame } from '../src/ai/harness';
import { incomingHits, killWindow, newLastHitMem, observeAttacks } from '../src/ai/bot/lasthit';
import type { View } from '../src/ai/bot/perception';
import { BotDecisionLog } from '../src/ai/log';
import type { SnapEntity } from '../src/sim/snapshot';

const ent = (hp: number): SnapEntity => ({ id: 1, serial: 1, kind: Kind.MinionCaster, team: 1, x: 0, y: 0, px: 0, py: 0, fx: 1, fy: 0, hp, maxHp: 300, shield: 0, mana: 0, maxMana: 0, radius: 48, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false, alive: true });

describe('kill window', () => {
  it('opens after the hit that brings HP into own damage and closes at the killing hit', () => {
    // 100 HP, own hit 60: hits of 30 at +5 (70 left), +10 (40 left -> window opens at +11), +20 (10), +30 (dead)
    const w = killWindow(ent(100), [{ at: 1005, dmg: 30 }, { at: 1010, dmg: 30 }, { at: 1020, dmg: 30 }, { at: 1030, dmg: 30 }], 60, 1000);
    expect(w).toEqual({ a: 1011, b: 1030 });
  });
  it('is open now when HP is already within the own hit; never when a single hit jumps over it', () => {
    expect(killWindow(ent(50), [], 60, 1000)).toEqual({ a: 1001, b: Infinity });
    const tower = killWindow(ent(250), [{ at: 1003, dmg: 270 }], 120, 1000);
    expect(tower.a).toBe(Infinity); // the tower shot kills from above the own damage: no window
    expect(tower.b).toBe(1003);
  });
});

describe('minion HP prediction from observed swings (no champion acting)', () => {
  it('predicts the death tick of minions killed by minions/towers exactly in most cases', () => {
    const sim = createSim(botGameConfig(1, 'gold'));
    const mem = newLastHitMem();
    let events: SimEvent[] = [];
    let ticks: number[] = [];
    const preds = new Map<number, { T: number; b: number }[]>();
    const errs: number[] = [];
    while (sim.tick < 5 * 1800) {
      step(sim, []);
      for (const ev of teamEvents(sim, 0).events) (events.push(ev), ticks.push(sim.tick));
      for (const ev of sim.events) {
        if (ev.e !== 'death' || !isMinion(ev.kind) || ev.team !== 1 || !preds.has(ev.eid)) continue;
        if (ev.killer < 0 || sim.c.Unit.kind[ev.killer] === Kind.Champion) continue;
        for (const p of preds.get(ev.eid)!) if (p.b !== Infinity && sim.tick - p.T <= 30) errs.push(p.b - sim.tick);
        preds.delete(ev.eid);
      }
      if (sim.tick % 4 !== 0) continue;
      const snap = buildSnapshot(sim, 0, 0);
      snap.events = events;
      snap.eventTicks = ticks;
      events = [];
      ticks = [];
      const self = snap.entities.find((e) => e.id === snap.me!.eid)!;
      const v = { tick: snap.tick, snap, me: snap.me, self, ownMinions: snap.entities.filter((e) => e.team === 0 && isMinion(e.kind) && e.alive), ownTowers: snap.entities.filter((e) => e.team === 0 && e.kind === Kind.Tower && e.alive) } as unknown as View;
      observeAttacks(v, mem);
      for (const m of snap.entities.filter((e) => e.team === 1 && isMinion(e.kind) && e.alive)) {
        const w = killWindow(m, incomingHits(v, mem, m), 0, snap.tick);
        const list = preds.get(m.id) ?? [];
        list.push({ T: snap.tick, b: w.b });
        preds.set(m.id, list);
      }
    }
    const exact = errs.filter((e) => Math.abs(e) <= 1).length / errs.length;
    expect(errs.length).toBeGreaterThan(200);
    expect(exact).toBeGreaterThan(0.75);
  }, 120_000);
});

describe('bot CS (headless)', () => {
  it('laners farm in a 10-minute game (regression floor; Table A calibration via npm run bot-sim)', () => {
    const g = runBotGame(botGameConfig(3, 'gold'), 10 * 1800);
    const laners = g.stats.filter((s) => s.role === 'top' || s.role === 'mid' || s.role === 'adc');
    const csPerMin = laners.reduce((a, s) => a + s.cs, 0) / laners.length / g.minutes;
    expect(csPerMin).toBeGreaterThan(1.5); // regression floor (seed 3 measures ~1.8; 6-seed 15-min Gold mean ~3.2)
    // unchanged decisions re-evaluated every tick are throttled in the decision log
    expect(g.bots.log.throttled).toBeGreaterThan(0);
  }, 300_000);
});

describe('decision log throttle', () => {
  const entry = (tick: number, chosen = 'lane', reason = 'r') => ({ tick, bot: 1, node: 'wave', inputs: {}, chosen, reason });
  it('drops an unchanged decision within the window, keeps changes and a heartbeat', () => {
    const log = new BotDecisionLog(1000, 1e9, 150);
    for (let t = 0; t < 300; t++) log.push(entry(t));
    log.push(entry(300, 'crash'));
    log.push(entry(301, 'crash', 'other reason'));
    const e = log.entries();
    expect(e.map((x) => x.tick)).toEqual([0, 150, 300, 301]);
    expect(log.throttled).toBe(298);
  });
  it('is off by default (cap tests, replays)', () => {
    const log = new BotDecisionLog(1000);
    for (let t = 0; t < 10; t++) log.push(entry(t));
    expect(log.length).toBe(10);
  });
});
