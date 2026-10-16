// Ability display audit, batch A: hook visuals of Aurel, Brom, Corvin, Ferris, Gorvam.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { levelAbility } from '../src/sim/systems/abilities';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

/** Champion in slot 0 at the centre (level 9, Q W E learned, R too with `ult`), plus optional other players. */
function setup(champion: string, others: PlayerSetup[] = [], ult = false): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion), ...others] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of ult ? [0, 1, 2, 3] : [0, 1, 2]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });
const ent = (sim: Sim, id: number) => buildSnapshot(sim, 0, 0).entities.find((e) => e.id === id)!;

describe('Aurel', () => {
  it('passive wheel cooldown, rewind hint, rewind pin while E is in flight, pending R damage marks', () => {
    const { sim, m } = setup('aurel', [player(5, 'gorvam')], true);
    const foe = sim.slots[5]!;
    place(sim, foe, CX + 2500, CY);
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ cdTotal: 8, ready: true });
    steps(sim, sec(3.5));
    place(sim, m, CX + 400, CY);
    steps(sim, sec(0.5));
    // 3 s ago he stood at the centre: the E hint points there
    const hint = buildSnapshot(sim, 0, 0).me!.hints!.find((h) => h.slot === 2)!;
    expect(Math.abs(hint.x - CX)).toBeLessThan(30);
    expect(hint.ok).toBe(true);
    cmd(sim, cast(2, CX + 400, CY));
    steps(sim, 3);
    const pin = buildSnapshot(sim, 0, 0).objects.find((o) => o.tag === 'aurel_e_rewind')!;
    expect(pin.left).toBeGreaterThan(0);
    steps(sim, sec(1));
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ ready: false, cdTotal: 8 }); // the E cast used the wheel
    expect(buildSnapshot(sim, 0, 0).me!.passive!.cdLeft).toBeGreaterThan(6);
    expect(Math.hypot(sim.c.Pos.x[m]! - pin.x, sim.c.Pos.y[m]! - pin.y)).toBeLessThan(5);
    expect(buildSnapshot(sim, 0, 0).objects.some((o) => o.tag === 'aurel_e_rewind')).toBe(false);
    // R: stasis on the foe, then a pending-damage timer mark until the damage lands
    place(sim, foe, CX + 500, CY);
    place(sim, m, CX, CY);
    step(sim);
    cmd(sim, cast(3, CX + 500, CY));
    let marked = false;
    for (let i = 0; i < sec(2.5); i++) {
      step(sim);
      if (ent(sim, foe).marks?.some((k) => k.id === 'aurel_r_pending' && (k.left ?? 0) > 0)) marked = true;
    }
    expect(marked).toBe(true);
    expect(ent(sim, foe).marks?.some((k) => k.id === 'aurel_r_pending')).toBeFalsy();
  });
});

describe('Brom', () => {
  it('bleed stacks as pips on the target, passive shows the highest stack, no permanent E aura', () => {
    const { sim, m } = setup('brom', [player(5, 'gorvam')]);
    const foe = sim.slots[5]!;
    place(sim, foe, CX + 320, CY); // outer ring: 2 stacks
    step(sim);
    cmd(sim, cast(0, CX, CY));
    steps(sim, sec(1));
    const mark = ent(sim, foe).marks!.find((k) => k.id === 'brom_p_bleed')!;
    expect(mark).toMatchObject({ n: 2, max: 5 });
    expect(mark.left).toBeGreaterThan(0);
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ stacks: 2, max: 5, ready: false });
    expect(ent(sim, m).auras ?? []).not.toContain('brom_e_pen');
    expect(ent(sim, m).auras ?? []).not.toContain('brom_e');
  });
});

describe('Corvin', () => {
  it('drum shots in the passive badge, last shot empowered, keg blast ring with fuse timer', () => {
    const { sim, m } = setup('corvin');
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ stacks: 6, max: 6, ready: false });
    cmd(sim, cast(1, CX + 300, CY));
    steps(sim, 12);
    const keg = buildSnapshot(sim, 0, 0).objects.find((o) => o.tag === 'corvin_w_keg')!;
    expect(keg).toMatchObject({ r: 300, shape: 'ring', total: 3 });
    expect(keg.left).toBeGreaterThan(2);
    const drum = (sim.state.corvinDrum as Map<number, { shots: number }>).get(m)!;
    drum.shots = 1;
    expect(buildSnapshot(sim, 0, 0).me!.passive!.ready).toBe(true);
    expect(ent(sim, m).emp).toBe(true);
    steps(sim, sec(3.5));
    expect(buildSnapshot(sim, 0, 0).objects.some((o) => o.tag === 'corvin_w_keg')).toBe(false);
  });
});

describe('Ferris', () => {
  it('passive badge glows only with an allied champion within 800', () => {
    const { sim } = setup('ferris', [player(1, 'gorvam')]);
    const ally = sim.slots[1]!;
    place(sim, ally, CX + 2000, CY);
    step(sim);
    expect(buildSnapshot(sim, 0, 0).me!.passive!.ready).toBe(false);
    place(sim, ally, CX + 500, CY);
    step(sim);
    expect(buildSnapshot(sim, 0, 0).me!.passive!.ready).toBe(true);
  });
});

describe('Gorvam', () => {
  it('auto counter in the passive badge, the 4th auto glows', () => {
    const { sim, m } = setup('gorvam');
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ stacks: 0, max: 4, ready: false });
    sim.state.gorvamChains = new Map([[m, 3]]);
    expect(buildSnapshot(sim, 0, 0).me!.passive).toMatchObject({ stacks: 3, ready: true });
    expect(ent(sim, m).emp).toBe(true);
  });
});
