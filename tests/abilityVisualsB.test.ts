// Ability display audit, batch B (Dagny, Grimald, Hagen, Harrow, Ilvane): hook visuals in the snapshot.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { addBuff } from '../src/sim/buffs';
import { levelAbility, refreshCooldowns } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { buildSnapshot, type Snapshot } from '../src/sim/snapshot';
import { addGroundObject, petsOf } from '../src/sim/summons';
import { missingHooks } from '../src/sim/champions';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

function setup(champion: string): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion)] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of [0, 1, 2, 3]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });
const snap = (sim: Sim, team = 0): Snapshot => buildSnapshot(sim, team, team === 0 ? 0 : 5);
const ent = (s: Snapshot, id: number) => s.entities.find((e) => e.id === id)!;
/** Step until pred(snapshot) holds (max n ticks); returns that snapshot or null. */
function until(sim: Sim, n: number, pred: (s: Snapshot) => boolean): Snapshot | null {
  for (let i = 0; i < n; i++) {
    step(sim);
    const s = snap(sim);
    if (pred(s)) return s;
  }
  return null;
}

describe('batch B hook coverage', () => {
  it('no missing hook ids', () => {
    for (const id of ['dagny', 'grimald', 'hagen', 'harrow', 'ilvane']) expect([id, missingHooks(id)]).toEqual([id, []]);
  });
});

describe('Dagny', () => {
  it('E draws a timed shield wall in front of her (+ aura), gone after 2 s', () => {
    const { sim, m } = setup('dagny');
    cmd(sim, cast(2, CX + 300, CY));
    const s = until(sim, 15, (x) => x.objects.some((o) => o.tag === 'dagny_e_wall'))!;
    expect(s).not.toBeNull();
    const w = s.objects.find((o) => o.tag === 'dagny_e_wall')!;
    expect(w.shape).toBe('wall');
    expect(w.left).toBeGreaterThan(0);
    expect(w.total).toBe(2);
    expect(w.x2).toBeDefined();
    expect(ent(s, m).auras).toContain('dagny_e');
    steps(sim, sec(2.2));
    expect(snap(sim).objects.some((o) => o.tag === 'dagny_e_wall')).toBe(false);
  });

  it('passive counts autos (2 = next auto bursts, empowered); W shred is a mark on the target', () => {
    const { sim, m } = setup('dagny');
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, max: 3 });
    cmd(sim, { t: 'attack', target: d });
    const s = until(sim, 200, (x) => x.me!.passive?.stacks === 2)!;
    expect(s).not.toBeNull();
    expect(s.me!.passive!.ready).toBe(true);
    expect(ent(s, m).emp).toBe(true);
    cmd(sim, cast(1, CX + 150, CY));
    const s2 = until(sim, 20, (x) => !!ent(x, d).marks?.some((k) => k.id === 'dagny_w_shred'));
    expect(s2).not.toBeNull();
  });
});

describe('Grimald', () => {
  it('trap count on the passive badge; traps stay hidden from the enemy; R aura ring with timer', () => {
    const { sim, m } = setup('grimald');
    addGroundObject(sim, { owner: m, tag: 'grimald_trap', x: CX + 600, y: CY, r: 75, ticks: sec(60) });
    addGroundObject(sim, { owner: m, tag: 'grimald_trap', x: CX + 600, y: CY + 200, r: 75, ticks: sec(60) });
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 2, max: 3, ready: true });
    expect(snap(sim).objects.filter((o) => o.tag === 'grimald_trap')).toHaveLength(2);
    expect(snap(sim, 1).objects.filter((o) => o.tag === 'grimald_trap')).toHaveLength(0);
    cmd(sim, cast(3, CX + 400, CY));
    const s = until(sim, 40, (x) => x.objects.some((o) => o.tag === 'grimald_r_aura'))!;
    expect(s).not.toBeNull();
    const a = s.objects.find((o) => o.tag === 'grimald_r_aura')!;
    expect([a.r, a.total]).toEqual([300, 3]);
    expect(ent(s, m).auras).toContain('grimald_r');
  });
});

describe('Hagen', () => {
  it('3 casts fill the bell (empowered auto); R aura ring + slow stage pips on enemies inside', () => {
    const { sim, m } = setup('hagen');
    const d = spawnDummy(sim, CX + 300, CY, 1);
    for (let i = 0; i < 3; i++) {
      refreshCooldowns(sim, m);
      cmd(sim, cast(0, CX, CY));
      steps(sim, 10);
    }
    let s = snap(sim);
    expect(s.me!.passive).toMatchObject({ stacks: 3, max: 3, ready: true, cdLeft: 0, cdTotal: 10 });
    expect(ent(s, m).emp).toBe(true);
    refreshCooldowns(sim, m);
    cmd(sim, cast(3, CX, CY));
    s = until(sim, 50, (x) => x.objects.some((o) => o.tag === 'hagen_r_peal') && (ent(x, d).marks?.find((k) => k.id === 'hagen_r_peal')?.n ?? 0) >= 2)!;
    expect(s).not.toBeNull();
    const ring = s.objects.find((o) => o.tag === 'hagen_r_peal')!;
    expect([ring.r, ring.shape, ring.total]).toEqual([500, 'dome', 4]);
    expect(ent(s, d).marks!.find((k) => k.id === 'hagen_r_peal')!.max).toBe(4);
  });
});

describe('Harrow', () => {
  it('E march aura + tower link while active; R siege minions carry their lifetime', () => {
    const { sim, m } = setup('harrow');
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, max: 4 });
    cmd(sim, cast(2, CX, CY));
    const s = until(sim, 15, (x) => !!ent(x, m).auras?.includes('harrow_e'))!;
    expect(s).not.toBeNull();
    expect(s.me!.hints?.some((h) => h.slot === 2 && h.link)).toBe(true);
    cmd(sim, cast(3, CX, CY));
    steps(sim, 15);
    const mins = petsOf(sim, m, 'harrow_siege');
    expect(mins.length).toBe(3);
    const s2 = snap(sim);
    for (const e of mins) expect(ent(s2, e).marks?.find((k) => k.id === 'harrow_r_siege')?.left).toBeGreaterThan(0);
  });
});

describe('Ilvane', () => {
  it('thread marks count on the passive badge; E projectile immunity shows as an aura', () => {
    const { sim, m } = setup('ilvane');
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, ready: false });
    addBuff(sim, d, { kind: 'mark', id: 'ilvane_thread', src: m, ticks: sec(4) });
    step(sim);
    const s = snap(sim);
    expect(s.me!.passive).toMatchObject({ stacks: 1, ready: true });
    expect(ent(s, d).marks?.some((k) => k.id === 'ilvane_thread')).toBe(true);
    cmd(sim, cast(2, CX + 300, CY));
    expect(until(sim, 20, (x) => !!ent(x, m).auras?.includes('ilvane_e'))).not.toBeNull();
  });
});
