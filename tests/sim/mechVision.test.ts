// mech-vision: LoL-like vision rules on top of the bush / ward / stealth base (src/sim/vision.ts, wards.json exposure,
// towers.json trueSightR). Seeded and short; the fog filter stays strict (snapshots only contain what the team sees).
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, type Sim } from '../../src/sim/sim';
import { Kind, sec, type Command, type PlayerSetup } from '../../src/sim/types';
import { buildSnapshot } from '../../src/sim/snapshot';
import { addBuff } from '../../src/sim/buffs';
import { EXPOSE, sees } from '../../src/sim/vision';
import { inBush, walkable } from '../../src/sim/map';
import { trinket, wardsOf } from '../../src/sim/wards';
import { makeSim, place, steps } from '../combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true });
const as = (sim: Sim, slot: number, c: Command): void => step(sim, [{ slot, cmd: c }]);
const inSnap = (sim: Sim, team: number, eid: number): boolean => buildSnapshot(sim, team, team === 0 ? 0 : 5).entities.some((e) => e.id === eid);

/** Blue mira `a` just outside a free bush, red brom `b` inside it at the edge (touching range). Neither sees the other. */
function bushDuel(): { sim: Sim; a: number; b: number } {
  const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
  const [a, b] = [sim.slots[0]!, sim.slots[5]!];
  const towers = [...query(sim.world, [sim.c.Unit])].filter((e) => sim.c.Unit.kind[e] === Kind.Tower);
  for (const bush of sim.map.bushes) {
    const inside = { x: bush.x + bush.r - 15, y: bush.y };
    const outside = { x: bush.x + bush.r + 70, y: bush.y };
    const ok = (p: { x: number; y: number }): boolean => walkable(sim.map.nav, p.x, p.y) && towers.every((t) => Math.hypot(sim.c.Pos.x[t]! - p.x, sim.c.Pos.y[t]! - p.y) > 2200);
    if (!ok(inside) || !ok(outside) || inBush(sim.map, outside.x, outside.y) >= 0 || inBush(sim.map, inside.x, inside.y) < 0) continue;
    place(sim, b, inside.x, inside.y);
    place(sim, a, outside.x, outside.y);
    step(sim);
    return { sim, a, b };
  }
  throw new Error('no free bush found');
}

describe('mech-vision: bush attack exposure', () => {
  it('a unit in a bush is hidden until it attacks; the attack exposes it for bushAttackS, then it is hidden again', () => {
    const { sim, a, b } = bushDuel();
    sim.c.Unit.invulnerable[a] = 1; // no damage lands: isolates the bush rule from the hit rule
    steps(sim, 3);
    expect(sees(sim, 0, b)).toBe(false);
    expect(inSnap(sim, 0, b)).toBe(false);
    as(sim, 5, { t: 'attack', target: a });
    expect(sees(sim, 0, b)).toBe(true); // exposed from the start of the attack
    const snap = buildSnapshot(sim, 0, 0).entities.find((e) => e.id === b)!;
    expect(snap).toBeDefined();
    expect(snap.revealed).toBeUndefined(); // not a real reveal effect: no reveal marker
    as(sim, 5, { t: 'stop' });
    const t0 = sim.tick;
    while (sim.tick < t0 + EXPOSE.bushTicks - 3) step(sim);
    expect(sees(sim, 0, b)).toBe(true);
    while (sim.tick < t0 + EXPOSE.bushTicks + 3) step(sim);
    expect(sees(sim, 0, b)).toBe(false);
    expect(inSnap(sim, 0, b)).toBe(false);
  });

  it('attacking from outside any bush exposes nothing extra (bush rule only)', () => {
    const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    sim.c.Unit.invulnerable[a] = 1;
    place(sim, a, 6000, 8750);
    place(sim, b, 6000 + 4000, 8750);
    steps(sim, 2);
    expect(sees(sim, 0, b)).toBe(false); // out of sight range
    // the attack command only walks him towards mira; he is nowhere near a bush, no exposure
    as(sim, 5, { t: 'attack', target: a });
    expect(sees(sim, 0, b)).toBe(false);
  });

  it('an invisible unit stays hidden when it attacks from a bush', () => {
    const { sim, a, b } = bushDuel();
    sim.c.Unit.invulnerable[a] = 1;
    addBuff(sim, b, { kind: 'stat', stat: 'invisible', id: 'test_cloak', src: b, ticks: sec(5) });
    as(sim, 5, { t: 'attack', target: a });
    steps(sim, 10);
    expect(sees(sim, 0, b)).toBe(false);
  });
});

describe('mech-vision: attacker exposure on champion hits', () => {
  it('a champion hit from the bush sees the attacker for championHitS after the damage, no longer', () => {
    const { sim, a, b } = bushDuel();
    const { Hp } = sim.c;
    as(sim, 5, { t: 'attack', target: a });
    let hit = -1;
    for (let i = 0; i < 90 && hit < 0; i++) {
      const hp = Hp.cur[a]!;
      step(sim);
      if (Hp.cur[a]! < hp) hit = sim.tick;
    }
    expect(hit).toBeGreaterThan(0);
    as(sim, 5, { t: 'stop' }); // no second hit
    while (sim.tick < hit + EXPOSE.hitTicks - 3) step(sim);
    expect(sees(sim, 0, b)).toBe(true);
    expect(inSnap(sim, 0, b)).toBe(true);
    while (sim.tick < hit + EXPOSE.hitTicks + 3) step(sim);
    expect(sees(sim, 0, b)).toBe(false);
    expect(inSnap(sim, 0, b)).toBe(false);
  });
});

describe('mech-vision: tower true sight', () => {
  it('a Schleierward within tower true sight is visible to the tower team, one outside is not', () => {
    const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    const tower = [...query(sim.world, [sim.c.Unit])].find((e) => sim.c.Unit.kind[e] === Kind.Tower && sim.c.Unit.team[e] === 0)!;
    const tx = sim.c.Pos.x[tower]!;
    const ty = sim.c.Pos.y[tower]!;
    place(sim, a, 100, 100); // mira far away: only the tower sees
    // find a walkable point 400 from the tower for the ward, and one ~1000 away (inside tower vision 1350, outside true sight)
    const spot = (d: number): { x: number; y: number } => {
      for (let k = 0; k < 16; k++) {
        const ang = (k * Math.PI) / 8;
        const p = { x: tx + Math.cos(ang) * d, y: ty + Math.sin(ang) * d };
        if (walkable(sim.map.nav, p.x, p.y)) return p;
      }
      throw new Error('no spot');
    };
    const near = spot(400);
    place(sim, b, near.x, near.y);
    step(sim);
    as(sim, 5, { t: 'ward', x: near.x, y: near.y });
    const w1 = wardsOf(sim, 1)[0]!.eid;
    steps(sim, 2);
    expect(sees(sim, 0, w1)).toBe(true);
    expect(inSnap(sim, 0, w1)).toBe(true);
    trinket(sim, b).charges = 1;
    const far = spot(1000);
    place(sim, b, far.x, far.y);
    step(sim);
    as(sim, 5, { t: 'ward', x: far.x, y: far.y });
    const w2 = wardsOf(sim, 1).find((w) => w.eid !== w1)!.eid;
    steps(sim, 2);
    expect(Math.hypot(sim.c.Pos.x[w2]! - tx, sim.c.Pos.y[w2]! - ty)).toBeGreaterThan(800);
    expect(sees(sim, 0, w2)).toBe(false);
    expect(inSnap(sim, 0, w2)).toBe(false);
    expect(sees(sim, 1, w2)).toBe(true); // own ward
  });
});

describe('mech-vision: Schleierward lifetime scales with level (LoL 90 -> 120 s)', () => {
  it('level 1 ward lasts 90 s, level 18 ward 120 s', () => {
    const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, 6000, 8750);
    place(sim, b, 6000, 8750 + 300);
    sim.c.Champ.level[b] = 18;
    step(sim);
    as(sim, 0, { t: 'ward', x: 6000, y: 8750 });
    as(sim, 5, { t: 'ward', x: 6000, y: 9000 });
    const w1 = wardsOf(sim, 0)[0]!.eid;
    const w2 = wardsOf(sim, 1)[0]!.eid;
    steps(sim, sec(89));
    expect(wardsOf(sim, 0).some((w) => w.eid === w1)).toBe(true);
    steps(sim, sec(2));
    expect(wardsOf(sim, 0).some((w) => w.eid === w1)).toBe(false);
    expect(wardsOf(sim, 1).some((w) => w.eid === w2)).toBe(true);
    steps(sim, sec(30));
    expect(wardsOf(sim, 1).some((w) => w.eid === w2)).toBe(false);
  });
});
