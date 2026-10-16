// Vision (spec-bots §2 vision axis, §8): ward spots per role/side, seal wards (Siegelward) bought and placed,
// sweeper (Suchfeuer) swap and use; predictive smite on epic monsters.
import { describe, expect, it } from 'vitest';
import { Kind } from '../src/sim/types';
import { ScriptedBot, champEnt, hud, MAP, paramsFor, PLAYERS, snapshot } from './botScenario';
import { sealWard, smiteCheck, sweep, visionShop, wardSpots } from '../src/ai/bot/macro';
import { TeamAI } from '../src/ai/bot/teamai';
import type { DecisionLogEntry } from '../src/ai/contract';
import type { Rank } from '../src/ai/profiles/schema';
import type { SnapEntity } from '../src/sim/snapshot';

function bot(rank: Rank, slot: number, seed = 1, style = {}): ScriptedBot {
  const b = new ScriptedBot(slot, paramsFor(rank, style, slot), seed);
  const log: DecisionLogEntry[] = [];
  (b.ctx as { teamAI: TeamAI }).teamAI = new TeamAI(PLAYERS[slot]!.team as 0 | 1, MAP, PLAYERS, seed, { push: (e) => void log.push(e), entries: () => log });
  return b;
}

describe('ward spots', () => {
  it('both sides get the data spots mirrored, plus the bushes', () => {
    const blue = bot('gold', 4);
    const red = bot('gold', 9);
    const t = 10 * 60 * 30;
    const sb = wardSpots(blue.node(snapshot({ tick: t, team: 0, entities: [champEnt(4, 5000, 5000)], me: hud(4) })));
    const sr = wardSpots(red.node(snapshot({ tick: t, team: 1, entities: [champEnt(9, 11000, 11000)], me: hud(9) })));
    expect(sb.length).toBe(sr.length);
    expect(sb.length).toBeGreaterThan(MAP.bushes.length + 10);
    const objB = sb.filter((q) => q.kind === 'objective');
    const objR = sr.filter((q) => q.kind === 'objective');
    expect(objB.length).toBeGreaterThanOrEqual(4);
    // reflected across the river diagonal: lane and objective identity are kept (red's Leviathan wards at the Leviathan)
    for (const q of objB) expect(objR.some((r) => Math.abs(r.x - (MAP.size - q.y)) < 1 && Math.abs(r.y - (MAP.size - q.x)) < 1)).toBe(true);
    const near = (q: { x: number; y: number; obj?: string }): number => Math.hypot(q.x - MAP.objectives[q.obj as 'leviathan'].x, q.y - MAP.objectives[q.obj as 'leviathan'].y);
    for (const q of [...objB, ...objR]) expect(near(q)).toBeLessThan(2000);
  });
});

describe('seal ward and sweeper', () => {
  const t = 12 * 60 * 30;
  const spot = MAP.objectives.leviathan;
  const at = { x: spot.x - 900, y: spot.y - 600 }; // next to the blue-side dragon pit entrance spot

  it('a support carrying a Siegelward places it on a nearby objective / river spot (logged)', () => {
    const b = bot('gold', 4);
    const items = ['siegelward', null, null, null, null, null, null];
    const n = b.node(snapshot({ tick: t, team: 0, entities: [champEnt(4, at.x, at.y)], me: hud(4, { items }) }));
    expect(sealWard(n)).toBe(true);
    expect(n.out[0]!.cmd).toMatchObject({ t: 'item', slot: 0 });
    expect(b.log.some((e) => e.node === 'vision' && e.chosen === 'seal_ward')).toBe(true);
  });

  it('buys a Siegelward on a fountain visit (Gold support), Iron laners never', () => {
    let gold = 0;
    let iron = 0;
    for (let i = 0; i < 100; i++) {
      const s = bot('gold', 4, 100 + i);
      const n = s.node(snapshot({ tick: t, team: 0, entities: [champEnt(4, 1000, 1000)], me: hud(4, { gold: 2000 }) }));
      if (visionShop(n, 1500).some((a) => a.cmd.t === 'buy' && a.cmd.item === 'siegelward')) gold++;
      const l = bot('iron', 0, 300 + i);
      const m = l.node(snapshot({ tick: t, team: 0, entities: [champEnt(0, 1000, 1000)], me: hud(0, { gold: 2000 }) }));
      if (visionShop(m, 1500).some((a) => a.cmd.t === 'buy')) iron++;
    }
    expect(gold).toBeGreaterThan(60);
    expect(iron).toBe(0);
  });

  it('swaps to the sweeper (vision axis >= 1, support, level 9) and sweeps a spot it passes', () => {
    const b = bot('gold', 4, 1, { vision: 3 });
    const tr = { id: 'schleierward' as const, charges: 1, maxCharges: 2, cdLeft: 0, cdTotal: 90, canSwap: 'suchfeuer' as const };
    const n = b.node(snapshot({ tick: t, team: 0, entities: [champEnt(4, 1000, 1000)], me: hud(4, { trinket: tr }) }));
    expect(visionShop(n, 0).some((a) => a.cmd.t === 'trinket' && a.cmd.id === 'suchfeuer')).toBe(true);
    const sw = { id: 'suchfeuer' as const, charges: 1, maxCharges: 1, cdLeft: 0, cdTotal: 90, canSwap: null };
    const q = wardSpots(n).find((s) => s.kind === 'objective')!;
    const m = b.node(snapshot({ tick: t + 30, team: 0, entities: [champEnt(4, q.x + 100, q.y)], me: hud(4, { trinket: sw }) }));
    expect(sweep(m)).toBe(true);
    expect(m.out[0]!.cmd.t).toBe('ward');
  });
});

describe('smite on an epic monster', () => {
  const mon = (hp: number): SnapEntity => ({ id: 777, serial: 777, kind: Kind.Monster, team: 2, x: 10500, y: 5500, px: 10500, py: 5500, fx: 1, fy: 0, hp, maxHp: 3500, shield: 0, mana: 0, maxMana: 0, radius: 130, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1, moving: false, alive: true });
  it('smites when the HP will be within smite damage before its next look (team damage predicted)', () => {
    const b = bot('challenger', 1);
    const self = champEnt(1, 10100, 5300);
    const t = 15 * 60 * 30;
    // first look: 1500 HP; next look 6 ticks later: 800 HP (team deals ~117 HP per tick; smite at level 6: 582)
    smiteCheck(b.node(snapshot({ tick: t, team: 0, entities: [self, mon(1500)], me: hud(1) })), mon(1500), 'secure', 'leviathan');
    const n = b.node(snapshot({ tick: t + 6, team: 0, entities: [self, mon(800)], me: hud(1) }));
    expect(smiteCheck(n, mon(800), 'secure', 'leviathan')).toBe(true);
    expect(n.out[0]!.cmd).toMatchObject({ t: 'spell', target: 777 });
  });
  it('does not smite a monster far above smite damage that nobody is hitting', () => {
    const b = bot('challenger', 1);
    const n = b.node(snapshot({ tick: 1000, team: 0, entities: [champEnt(1, 10100, 5300), mon(2500)], me: hud(1) }));
    expect(smiteCheck(n, mon(2500), 'secure', 'leviathan')).toBe(false);
  });
});
