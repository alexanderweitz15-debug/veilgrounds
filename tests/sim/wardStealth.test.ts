// B1 (AGENTS-PLAN §4): stealth. Schleierwards, Nyx seeds, Grimald traps (and abilities flagged 'stealth') are hidden from the enemy
// team unless (a) an enemy Siegelward is within 450, (b) an enemy Suchfeuer covers them, (c) a Spaehfrucht pop / Nyx R
// revealed them within the last 3 s. Siegelwards are always visible (normal vision rules).
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../../src/sim/sim';
import { Kind, sec, type Command, type PlayerSetup } from '../../src/sim/types';
import { buildSnapshot, teamEvents } from '../../src/sim/snapshot';
import { MAP_SIZE } from '../../src/sim/map';
import { isRevealed } from '../../src/sim/buffs';
import { sees } from '../../src/sim/vision';
import { inventory } from '../../src/sim/items/inventory';
import { levelAbility } from '../../src/sim/systems/abilities';
import { championData } from '../../src/sim/champions';
import { addGroundObject, groundObjects } from '../../src/sim/summons';
import { plantState } from '../../src/sim/systems/plants';
import { walkable } from '../../src/sim/map';
import { SEAL, STEALTH_LINGER, WARD_RADIUS, stealthPointSeen, wardsOf } from '../../src/sim/wards';
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { CX, CY, makeSim, place, steps } from '../combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true });

function duel(blue = 'mira', red = 'brom'): { sim: Sim; a: number; b: number } {
  const sim = makeSim({ players: [player(0, blue), player(5, red)] });
  const [a, b] = [sim.slots[0]!, sim.slots[5]!];
  place(sim, a, CX, CY);
  place(sim, b, CX + 3000, CY);
  step(sim);
  return { sim, a, b };
}
const as = (sim: Sim, slot: number, c: Command): void => step(sim, [{ slot, cmd: c }]);
const inSnap = (sim: Sim, team: number, eid: number): boolean => buildSnapshot(sim, team, team === 0 ? 0 : 5).entities.some((e) => e.id === eid);
const sealAt = (sim: Sim, slot: number, eid: number, x: number, y: number): void => {
  inventory(sim, eid)[0] = 'siegelward';
  as(sim, slot, { t: 'item', slot: 0, x, y });
};

describe('B1 ward stealth', () => {
  it('enemy Schleierward outside every reveal is not in the team snapshot, even next to a champion', () => {
    const { sim, a, b } = duel();
    place(sim, b, CX + 500, CY + 200);
    step(sim);
    as(sim, 5, { t: 'ward', x: CX + 500, y: CY });
    const w = wardsOf(sim, 1)[0]!.eid;
    place(sim, b, CX + 6000, CY);
    steps(sim, 2);
    expect(Math.hypot(sim.c.Pos.x[a]! - sim.c.Pos.x[w]!, sim.c.Pos.y[a]! - sim.c.Pos.y[w]!)).toBeLessThan(600); // in mira's sight range
    expect(sees(sim, 0, w)).toBe(false);
    expect(inSnap(sim, 0, w)).toBe(false);
    // the owner team sees it, flagged as stealthed
    const own = buildSnapshot(sim, 1, 5).entities.find((e) => e.id === w)!;
    expect(own).toMatchObject({ ward: 'veil', stealth: true });
  });

  it('enemy Siegelward within 450 reveals it (stealth flag, disabled); at 500+ it does not', () => {
    const { sim, a, b } = duel();
    place(sim, b, CX + 500, CY + 200);
    step(sim);
    as(sim, 5, { t: 'ward', x: CX + 500, y: CY });
    const w = wardsOf(sim, 1)[0]!.eid;
    place(sim, b, CX + 6000, CY);
    step(sim);
    const wx = sim.c.Pos.x[w]!;
    const wy = sim.c.Pos.y[w]!;
    // seal ward 520 away (beyond 450 + ward radius): still hidden
    sealAt(sim, 0, a, wx - 520, wy);
    step(sim);
    const seal = wardsOf(sim, 0).find((x) => x.type === 'seal')!.eid;
    expect(Math.hypot(sim.c.Pos.x[seal]! - wx, sim.c.Pos.y[seal]! - wy)).toBeGreaterThan(SEAL.revealR + WARD_RADIUS);
    expect(inSnap(sim, 0, w)).toBe(false);
    // second seal replaces the first, 400 away: revealed
    sealAt(sim, 0, a, wx - 400, wy);
    step(sim);
    const e = buildSnapshot(sim, 0, 0).entities.find((x) => x.id === w);
    expect(e).toMatchObject({ ward: 'veil', stealth: true });
    expect(sim.c.Vision.r[w]).toBe(0);
    // seal wards themselves are not stealthed
    const s2 = wardsOf(sim, 0).find((x) => x.type === 'seal')!.eid;
    expect(buildSnapshot(sim, 0, 0).entities.find((x) => x.id === s2)!.stealth).toBeUndefined();
    // a revealed ward is attackable: 3 autos kill it
    place(sim, a, wx - 300, wy);
    as(sim, 0, { t: 'attack', target: w });
    steps(sim, sec(6));
    expect(wardsOf(sim, 1)).toHaveLength(0);
  });

  it('Spaehfrucht reveals enemy wards in its cone for 3 s, then they are hidden again', () => {
    const { sim, a, b } = duel();
    steps(sim, sec(90) + 1); // plants grow at 1:30
    const p = plantState(sim).plants.find((q) => q.type === 'spaehfrucht' && q.x + q.y < MAP_SIZE)!;
    // ward spot: the middle cone point (900 ahead, radius 480) when popping from the west
    let spot: { x: number; y: number } | null = null;
    for (const [ox, oy] of [[900, 0], [900, 150], [900, -150], [700, 0], [1100, 0]] as const) {
      if (walkable(sim.map.nav, p.x + ox, p.y + oy)) {
        spot = { x: p.x + ox, y: p.y + oy };
        break;
      }
    }
    expect(spot).not.toBeNull();
    place(sim, b, spot!.x, spot!.y);
    step(sim);
    as(sim, 5, { t: 'ward', x: spot!.x, y: spot!.y });
    const w = wardsOf(sim, 1)[0]!.eid;
    place(sim, b, CX - 3000, CY);
    place(sim, a, p.x - 400, p.y);
    step(sim);
    expect(inSnap(sim, 0, w)).toBe(false);
    as(sim, 0, { t: 'attack', target: p.eid });
    for (let i = 0; i < sec(3) && p.spawnAt < 0; i++) step(sim);
    expect(p.spawnAt).toBeGreaterThan(0); // popped
    place(sim, a, CX - 4000, CY); // mira leaves: only the cone sees the spot
    step(sim);
    expect(buildSnapshot(sim, 0, 0).entities.find((e) => e.id === w)).toMatchObject({ stealth: true });
    steps(sim, STEALTH_LINGER);
    expect(inSnap(sim, 0, w)).toBe(false); // linger over, the cone's vision points (10 s) do not see stealth
    expect(isRevealed(sim, 0, w)).toBe(false);
  });

  it('Nyx R keeps enemy wards in 1200 revealed and for 3 s after leaving', () => {
    const { sim, a, b } = duel('mira', 'nyx');
    as(sim, 0, { t: 'ward', x: CX + 400, y: CY });
    const w = wardsOf(sim, 0)[0]!.eid;
    place(sim, a, CX - 5000, CY);
    place(sim, b, CX + 1300, CY);
    sim.c.Champ.level[b] = 6;
    sim.c.Champ.skillPoints[b] = 6;
    levelAbility(sim, b, 3);
    step(sim);
    expect(inSnap(sim, 1, w)).toBe(false);
    as(sim, 5, { t: 'cast', slot: 3, x: CX + 1300, y: CY });
    steps(sim, 10);
    expect(buildSnapshot(sim, 1, 5).entities.find((e) => e.id === w)).toMatchObject({ stealth: true });
    place(sim, b, CX + 6000, CY); // out of range, R still running
    steps(sim, STEALTH_LINGER - 3);
    expect(inSnap(sim, 1, w)).toBe(true);
    steps(sim, 6);
    expect(inSnap(sim, 1, w)).toBe(false);
  });
});

describe('B1 stealthed ground objects and zones', () => {
  it('Nyx seeds and Grimald traps: hidden from enemies with vision, shown under an enemy Siegelward (450)', () => {
    const { sim, a, b } = duel('mira', 'nyx');
    addGroundObject(sim, { owner: b, tag: 'nyx_seed', x: CX + 300, y: CY, r: 100, ticks: sec(90), stealth: true });
    addGroundObject(sim, { owner: b, tag: 'grimald_trap', x: CX - 300, y: CY, r: 75, ticks: sec(60), stealth: true });
    step(sim);
    const tags = (team: number): string[] => buildSnapshot(sim, team, team === 0 ? 0 : 5).objects.map((o) => o.tag);
    expect(tags(0)).not.toContain('nyx_seed'); // mira stands right next to them
    expect(tags(0)).not.toContain('grimald_trap');
    expect(buildSnapshot(sim, 1, 5).objects.find((o) => o.tag === 'nyx_seed')).toMatchObject({ stealth: true });
    sealAt(sim, 0, a, CX + 300 + 400, CY);
    step(sim);
    expect(tags(0)).toContain('nyx_seed'); // 400 away
    expect(tags(0)).not.toContain('grimald_trap'); // 1000 away
  });

  it('Lysa E wire is visible to enemies (user 19.10.); an ability flagged stealth reaches them only under true sight', () => {
    const run = (withSeal: boolean, stealthFlag = false): boolean => {
      const { sim, a, b } = duel('mira', 'lysa');
      const ab = championData('lysa').abilities[2]!;
      const flags = ab.flags;
      if (stealthFlag) ab.flags = [...(flags ?? []), 'stealth'];
      place(sim, b, CX + 600, CY);
      sim.c.Champ.skillPoints[b] = 1;
      levelAbility(sim, b, 2);
      if (withSeal) sealAt(sim, 0, a, CX + 300, CY);
      step(sim);
      expect(sees(sim, 0, b)).toBe(true); // lysa herself is visible
      let seen = false;
      as(sim, 5, { t: 'cast', slot: 2, x: CX + 200, y: CY });
      for (let i = 0; i < 20; i++) {
        seen ||= teamEvents(sim, 0).events.some((e) => e.e === 'zone' && e.team === 1);
        step(sim);
      }
      ab.flags = flags;
      return seen;
    };
    expect(championData('lysa').abilities[2]!.flags).not.toContain('stealth');
    expect(run(false)).toBe(true);
    expect(run(false, true)).toBe(false);
    expect(run(true, true)).toBe(true);
  });
});

describe('B1 bot-game regression', () => {
  it('no enemy Schleierward or stealthed object reaches a team snapshot without a reveal (2 min, 10 bots)', () => {
    let enemyWards = 0;
    runBotGame(botGameConfig(2, 'gold'), sec(150), (sim) => {
      if (sim.tick % 10 !== 0) return;
      for (const team of [0, 1]) {
        enemyWards += wardsOf(sim, 1 - team).filter((x) => x.type === 'veil').length;
        const snap = buildSnapshot(sim, team, team === 0 ? 0 : 5);
        for (const e of snap.entities) if (e.kind === Kind.Ward && e.ward === 'veil' && e.team !== team) expect(isRevealed(sim, team, e.id)).toBe(true);
        for (const o of snap.objects) {
          if (!o.stealth || o.team === team) continue;
          const g = groundObjects(sim).find((x) => x.id === o.id)!;
          expect(stealthPointSeen(sim, team, g.x, g.y, g.r, g.revealUntil[team])).toBe(true);
        }
      }
    });
    expect(enemyWards).toBeGreaterThan(0); // the bots did ward
  }, 120_000);
});
