// Ability display audit, batch C (kaelen, kiran, lio, lysa, mira, nyx): hook visuals in the snapshot.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { addBuff } from '../src/sim/buffs';
import { levelAbility, refreshCooldowns } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { missingHooks } from '../src/sim/champions';
import { buildSnapshot } from '../src/sim/snapshot';
import { addGroundObject } from '../src/sim/summons';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const C_CHAMPS = ['kaelen', 'kiran', 'lio', 'lysa', 'mira', 'nyx'];
const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

function setup(champion: string, extra: PlayerSetup[] = []): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion), ...extra] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of [0, 1, 2, 3]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });
const snap = (sim: Sim) => buildSnapshot(sim, 0, 0);
const ent = (sim: Sim, e: number) => snap(sim).entities.find((s) => s.id === e);

describe('batch C hooks', () => {
  it('every hook id is exported', () => {
    for (const id of C_CHAMPS) expect([id, missingHooks(id)]).toEqual([id, []]);
  });
  it('visuals are read-only (no hook state created by a snapshot)', () => {
    for (const id of C_CHAMPS) {
      const sim = makeSim({ players: [player(0, id)] });
      step(sim);
      buildSnapshot(sim, 0, 0); // shared snapshot state settles
      const keys = Object.keys(sim.state).sort();
      buildSnapshot(sim, 0, 0);
      expect([id, Object.keys(sim.state).sort()]).toEqual([id, keys]);
    }
  });
});

describe('Kaelen', () => {
  it('W hint onto a visible marked enemy; follow-through after the dash = empowered + passive timer', () => {
    const { sim, m } = setup('kaelen');
    const d = spawnDummy(sim, CX + 700, CY, 1);
    addBuff(sim, d, { kind: 'mark', id: 'kaelen_mark', src: m, ticks: sec(3) });
    step(sim);
    const hints = snap(sim).me!.hints!;
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ slot: 1, ok: true, link: true });
    cmd(sim, cast(1, CX + 700, CY));
    steps(sim, 20);
    expect(ent(sim, m)!.emp).toBe(true);
    expect(snap(sim).me!.passive).toMatchObject({ ready: true });
    expect(snap(sim).me!.passive!.cdLeft!).toBeGreaterThan(0);
  });
});

describe('Kiran', () => {
  it('E fate link is a line from Kiran following the ally, with a timer', () => {
    const { sim, m } = setup('kiran', [player(1, 'mira')]);
    const ally = sim.slots[1]!;
    place(sim, ally, CX + 300, CY);
    step(sim);
    cmd(sim, cast(2, CX + 300, CY, ally));
    steps(sim, 8);
    const link = snap(sim).objects.find((o) => o.tag === 'kiran_e_link');
    expect(link).toMatchObject({ shape: 'line', follow: ally });
    expect(link!.left!).toBeGreaterThan(0);
    expect(snap(sim).me!.passive?.cdTotal).toBe(15);
    void m;
  });
});

describe('Lio', () => {
  it('sparks show as pips on the target; R rain area stays visible with strikes left', () => {
    const { sim, m } = setup('lio');
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    cmd(sim, cast(0, CX + 800, CY));
    steps(sim, 30);
    expect(ent(sim, d)!.marks).toContainEqual(expect.objectContaining({ id: 'lio_p_spark', n: 1, max: 3 }));
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 1, max: 3, ready: false });
    refreshCooldowns(sim, m);
    cmd(sim, cast(3, CX + 500, CY));
    let rain = false;
    for (let i = 0; i < 20 && !rain; i++) (step(sim), (rain = snap(sim).objects.some((o) => o.tag === 'lio_r_rain' && (o.n ?? 0) >= 1)));
    expect(rain).toBe(true);
    steps(sim, 40);
    expect(snap(sim).objects.some((o) => o.tag === 'lio_r_rain')).toBe(false);
  });
});

describe('Lysa', () => {
  it('thread stacks on the HUD badge and as pips on the target', () => {
    const { sim } = setup('lysa');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    for (let i = 0; i < 300 && (snap(sim).me!.passive?.stacks ?? 0) < 2; i++) step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 2, max: 8 });
    expect(ent(sim, d)!.marks).toContainEqual(expect.objectContaining({ id: 'lysa_p_thread', n: 2 }));
  });
});

describe('Mira', () => {
  it('E arms the third shot: empowered glow + ready badge', () => {
    const { sim, m } = setup('mira');
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, ready: false });
    cmd(sim, cast(2, CX + 300, CY));
    steps(sim, 15);
    expect(ent(sim, m)!.emp).toBe(true);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 2, ready: true });
  });
});

describe('Nyx', () => {
  it('W arms the ambush auto; R shows the 1200 veil ring with a timer; seeds count on the badge', () => {
    const { sim, m } = setup('nyx');
    cmd(sim, cast(1, CX, CY));
    steps(sim, 8);
    expect(ent(sim, m)!.emp).toBe(true);
    steps(sim, sec(3));
    expect(ent(sim, m)!.emp).toBeFalsy();
    cmd(sim, cast(3, CX, CY));
    steps(sim, 12);
    const veil = snap(sim).objects.find((o) => o.tag === 'nyx_r_veil');
    expect(veil).toMatchObject({ shape: 'dome', r: 1200, total: 6 });
    expect(ent(sim, m)!.auras).toContain('nyx_r');
    addGroundObject(sim, { owner: m, tag: 'nyx_seed', x: CX + 2000, y: CY, r: 100, ticks: sec(90) });
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 1, ready: true });
  });
});
