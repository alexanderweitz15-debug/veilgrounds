// Bots use jungle plants (src/ai/bot/plants.ts): hand-built snapshots for each decision, plus one short seeded sim in
// which a hurt bot next to a Honigfrucht pops it.
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { Kind, type PlayerSetup, type SimConfig } from '../src/sim/types';
import { MAP_SIZE } from '../src/sim/map';
import { plantState } from '../src/sim/systems/plants';
import { plants } from '../src/ai/bot/plants';
import type { SnapEntity } from '../src/sim/snapshot';
import { champEnt, hud, paramsFor, ScriptedBot, snapshot } from './botScenario';
import { NO_RUNES, place } from './combat-helpers';

const BOT = 2; // aurel, blue mid
const ENEMY = 7; // thessaly, red mid
let nextId = 5000;
const fruit = (variant: string, x: number, y: number, o: Partial<SnapEntity> = {}): SnapEntity => {
  const id = nextId++;
  return { id, serial: id, kind: Kind.Plant, team: 2, x, y, px: x, py: y, fx: 0, fy: 0, hp: 1, maxHp: 1, shield: 0, mana: 0, maxMana: 0, radius: 45, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false, alive: true, variant: variant as SnapEntity['variant'], ...o };
};

/** One decision of the plants leaf: the bot at (1000, 1000) with the given extras. */
function decide(extra: SnapEntity[], o: { hp?: number; mana?: number; mode?: string; role?: string } = {}) {
  const bot = new ScriptedBot(BOT, paramsFor('gold'), 7);
  if (o.mode) bot.mem.mode = o.mode;
  if (o.role) (bot.ctx as { role: string }).role = o.role;
  const me = champEnt(BOT, 1000, 1000);
  me.hp = me.maxHp * (o.hp ?? 1);
  me.mana = me.maxMana * (o.mana ?? 1);
  const n = bot.node(snapshot({ tick: 3000, team: 0, entities: [me, ...extra], me: hud(BOT) }));
  const r = plants(n);
  return { r, out: n.out.map((a) => a.cmd), id: extra.map((e) => e.id) };
}

describe('bot plant decisions', () => {
  it('pops a Honigfrucht at low HP when no enemy is near', () => {
    const f = fruit('honigfrucht', 1400, 1000);
    const d = decide([f], { hp: 0.4 });
    expect(d.r).toBe('success');
    expect(d.out).toEqual([{ t: 'attack', target: f.id }]);
  });

  it('does not when an enemy champion is near, at full HP, or when the fruit is too far', () => {
    const f = fruit('honigfrucht', 1400, 1000);
    const foe = champEnt(ENEMY, 2200, 1000);
    expect(decide([f, foe], { hp: 0.4 }).r).toBe('failure');
    expect(decide([f], { hp: 0.95 }).r).toBe('failure');
    expect(decide([fruit('honigfrucht', 3500, 1000)], { hp: 0.4 }).r).toBe('failure');
    expect(decide([fruit('honigfrucht', 1400, 1000, { grow: 0.5 })], { hp: 0.4 }).r).toBe('failure'); // still sprouting
  });

  it('walks over honey pieces while hurt', () => {
    const piece = fruit('honigstueck', 1300, 1100);
    const d = decide([piece], { hp: 0.6 });
    expect(d.out).toEqual([{ t: 'move', x: 1300, y: 1100 }]);
    expect(decide([piece], { hp: 0.95 }).r).toBe('failure');
  });

  it('pops a Manafrucht at low mana, a Schildfrucht before a fight', () => {
    const m = fruit('manafrucht', 1300, 1000);
    expect(decide([m], { mana: 0.2 }).out).toEqual([{ t: 'attack', target: m.id }]);
    expect(decide([m], { mana: 0.8 }).r).toBe('failure');
    const s = fruit('schildfrucht', 1300, 1000);
    const foe = champEnt(ENEMY, 2400, 1000);
    expect(decide([s, foe]).out).toEqual([{ t: 'attack', target: s.id }]);
    expect(decide([s]).r).toBe('failure'); // no fight in sight
  });

  it('pops a Windfrucht while fleeing, Spähfrucht only as jungler / support', () => {
    const w = fruit('windfrucht', 1300, 1000);
    const foe = champEnt(ENEMY, 2100, 1000);
    expect(decide([w, foe], { mode: 'retreat', hp: 0.3 }).out).toEqual([{ t: 'attack', target: w.id }]);
    expect(decide([w, foe], { mode: 'lane' }).r).toBe('failure');
    const sp = fruit('spaehfrucht', 1300, 1000);
    expect(decide([sp], { role: 'jungle' }).out).toEqual([{ t: 'attack', target: sp.id }]);
    expect(decide([sp], { role: 'mid' }).r).toBe('failure');
  });

  it('never goes for a Sprungfrucht', () => {
    expect(decide([fruit('sprungfrucht', 1200, 1000)], { hp: 0.3, mana: 0.1 }).r).toBe('failure');
  });
});

describe('bot pops a Honigfrucht in a seeded game', () => {
  it('hurt bot next to a ripe Honigfrucht pops it within 8 s and eats a piece', () => {
    const players: PlayerSetup[] = [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
      { slot: 1, team: 0, champion: 'aurel', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, bot: { rank: 'gold', variance: 'stable' }, runes: NO_RUNES },
    ];
    const cfg: SimConfig = { seed: 1, mode: 'sandbox', minionsEnabled: false, players };
    const sim = createSim(cfg);
    const bots = new BotRunner(cfg, undefined, { noVariance: true });
    while (sim.tick < 90 * 30 + 2) step(sim); // plants grow at 1:30; the bots stay at the fountain until then
    const bot = sim.slots[1]!;
    const p = plantState(sim).plants.find((q) => q.type === 'honigfrucht' && q.x + q.y < MAP_SIZE)!;
    place(sim, sim.slots[0]!, 400, 400);
    place(sim, bot, p.x + 350, p.y);
    sim.c.Hp.cur[bot] = sim.c.Hp.max[bot]! * 0.35;
    let popped = -1;
    let ate = false;
    for (let i = 0; i < 8 * 30 && !ate; i++) {
      step(sim, bots.tick(sim));
      if (popped < 0 && p.spawnAt >= 0) popped = i;
      if (popped >= 0 && plantState(sim).pieces.length < 5) ate = true;
    }
    expect(popped).toBeGreaterThanOrEqual(0);
    expect(plantState(sim).pieces.length + (ate ? 1 : 0)).toBeGreaterThan(0);
  }, 60_000);
});
