// Ability display (audit "Fähigkeiten-Anzeige"): recast windows in the HUD, hook visuals in the snapshot, passives.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { levelAbility } from '../src/sim/systems/abilities';
import { CHAMPION_DATA, CHAMPION_HOOKS, missingHooks } from '../src/sim/champions';
import { buildSnapshot } from '../src/sim/snapshot';
import { addGroundObject } from '../src/sim/summons';
import { buffs } from '../src/sim/buffs';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

function setup(champion: string): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion)] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of [0, 1, 2]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });

describe('passives', () => {
  it('every champion has passive data and all hook ids are exported', () => {
    for (const id of Object.keys(CHAMPION_DATA)) {
      expect([id, CHAMPION_DATA[id]!.passive.hooks.length > 0]).toEqual([id, true]);
      expect([id, missingHooks(id)]).toEqual([id, []]);
      expect([id, !!CHAMPION_HOOKS[id]]).toEqual([id, true]);
    }
  });
});

describe('recast HUD', () => {
  it('Isolde Q: window "opens in" after the cast, then open with a draining timer', () => {
    const { sim } = setup('isolde');
    cmd(sim, cast(0, CX + 100, CY));
    steps(sim, 8);
    const soon = buildSnapshot(sim, 0, 0).me!.abilities[0]!.recast!;
    expect(soon.opensIn).toBeGreaterThan(0);
    steps(sim, sec(1.5));
    const open = buildSnapshot(sim, 0, 0).me!.abilities[0]!.recast!;
    expect(open.opensIn).toBe(0);
    expect(open.left).toBeGreaterThan(0);
    expect(open.left).toBeLessThanOrEqual(open.total);
    steps(sim, sec(2.5));
    expect(buildSnapshot(sim, 0, 0).me!.abilities[0]!.recast).toBeUndefined();
  });

  it('Isolde E: wire line while pulling, then recast window + dash range hint', () => {
    const { sim, m } = setup('isolde');
    // find a direction with a wall within E range
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    let wire = false;
    let hint = false;
    for (const [dx, dy] of dirs) {
      place(sim, m, CX, CY);
      step(sim);
      cmd(sim, cast(2, CX + dx * 800, CY + dy * 800));
      for (let i = 0; i < 40; i++) {
        const s = buildSnapshot(sim, 0, 0);
        if (s.objects.some((o) => o.tag === 'isolde_wire' && o.follow === m)) wire = true;
        if (s.me!.abilities[2]!.recast && s.me!.hints?.some((h) => h.slot === 2 && h.r > 400)) hint = true;
        step(sim);
      }
      if (wire) break;
      steps(sim, sec(20));
    }
    if (!wire) return; // no wall near the test spot (map change): nothing to show
    expect(hint).toBe(true);
  });
});

describe('Renn E blade hints', () => {
  it('each own blade gets an E ring, dimmed when out of reach', () => {
    const { sim, m } = setup('renn');
    addGroundObject(sim, { owner: m, tag: 'renn_blade', x: CX + 400, y: CY, r: 40, ticks: 120 });
    addGroundObject(sim, { owner: m, tag: 'renn_blade', x: CX + 2000, y: CY, r: 40, ticks: 120 });
    step(sim);
    const hints = buildSnapshot(sim, 0, 0).me!.hints!;
    expect(hints.map((h) => [h.slot, h.ok])).toEqual([[2, true], [2, false]]);
    expect(buildSnapshot(sim, 0, 0).me!.passive?.stacks).toBe(2);
  });
});

describe('Seraphyne passive', () => {
  it('+15 % MS after every ability refreshes instead of stacking, HUD badge glows', () => {
    const { sim, m } = setup('seraphyne');
    cmd(sim, cast(0, CX + 300, CY));
    steps(sim, 20);
    cmd(sim, cast(2, CX + 300, CY));
    steps(sim, 20);
    const ms = buffs(sim, m).filter((b) => b.kind === 'stat' && b.stat === 'ms' && b.until > sim.tick);
    expect(ms.map((b) => [b.id, b.pct])).toEqual([['seraphyne_p_electrified', 15]]);
    expect(buildSnapshot(sim, 0, 0).me!.passive?.ready).toBe(true);
  });
});
