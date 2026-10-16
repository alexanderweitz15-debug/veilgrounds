// Ability display audit, batch D: hook visuals of oda, oleth, ottilie, thessaly, tobin, vessa, wren.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step, type Sim } from '../src/sim/sim';
import { addBuff } from '../src/sim/buffs';
import { levelAbility } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { missingHooks } from '../src/sim/champions';
import { buildSnapshot } from '../src/sim/snapshot';
import { petsOf } from '../src/sim/summons';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { CX, CY, cmd, makeSim, place, steps } from './combat-helpers';

const D_CHAMPS = ['oda', 'oleth', 'ottilie', 'thessaly', 'tobin', 'vessa', 'wren'];
const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

function setup(champion: string, withR = false): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion)] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of withR ? [0, 1, 2, 3] : [0, 1, 2]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, ...(target !== undefined ? { target } : {}) });
const snap = (sim: Sim) => buildSnapshot(sim, 0, 0);
const marksOn = (sim: Sim, eid: number): string[] => (snap(sim).entities.find((s) => s.id === eid)?.marks ?? []).map((k) => k.id);

describe('batch D hook visuals', () => {
  it('hook ids complete', () => {
    for (const id of D_CHAMPS) expect([id, missingHooks(id)]).toEqual([id, []]);
  });

  it('Oleth: R wall with timer, faith-wall cooldown on the passive badge', () => {
    const { sim, m } = setup('oleth', true);
    expect(snap(sim).me!.passive).toMatchObject({ ready: true, cdTotal: 10 });
    cmd(sim, cast(3, CX + 350, CY));
    steps(sim, sec(1.2));
    const w = snap(sim).objects.find((o) => o.tag === 'oleth_r_wall');
    expect(w?.shape).toBe('wall');
    expect(w!.left!).toBeGreaterThan(3);
    expect(Math.hypot(w!.x2! - w!.x, w!.y2! - w!.y)).toBeCloseTo(800, 0);
    steps(sim, sec(4.2));
    expect(snap(sim).objects.some((o) => o.tag === 'oleth_r_wall')).toBe(false);
    // passive: big burst -> shield + 10 s cooldown on the badge
    const d = spawnDummy(sim, CX + 150, CY, 1);
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]!;
    addBuff(sim, m, { kind: 'dot', id: 'test_burn', src: d, amount: 0.2 * sim.c.Hp.max[m]!, period: 1, dmgType: 'true', ticks: 2 });
    steps(sim, 3);
    const p = snap(sim).me!.passive!;
    expect(p.ready).toBe(false);
    expect(p.cdLeft!).toBeGreaterThan(9);
  });

  it('Oda: 800 spring ring, badge counts hurt allies inside', () => {
    const { sim, m } = setup('oda');
    const ring = snap(sim).objects.find((o) => o.tag === 'oda_p_spring');
    expect(ring?.r).toBe(800);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, ready: false });
    sim.c.Hp.cur[m] = sim.c.Hp.max[m]! * 0.5;
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 1, ready: true });
  });

  it('Tobin: Q tether line + mark on the target, sea legs badge after W', () => {
    const { sim, m } = setup('tobin');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    cmd(sim, cast(0, CX + 400, CY));
    let line = false;
    let mark = false;
    for (let i = 0; i < 30 && !(line && mark); i++) {
      step(sim);
      line ||= snap(sim).objects.some((o) => o.tag === 'tobin_q_tether' && o.follow === d);
      mark ||= marksOn(sim, d).some((id) => id.startsWith('tobin_q_tether'));
    }
    expect([line, mark]).toEqual([true, true]);
    expect(snap(sim).objects.find((o) => o.tag === 'tobin_q_range')?.r).toBe(650);
    expect(snap(sim).me!.passive?.ready).toBe(false);
    cmd(sim, cast(1, CX - 300, CY));
    steps(sim, 20);
    expect(snap(sim).me!.passive?.ready).toBe(true);
    expect(m).toBeGreaterThanOrEqual(0);
  });

  it('Thessaly: free-cast timer on the badge, R execute hint below 30 % HP', () => {
    const { sim, m } = setup('thessaly', true);
    expect(snap(sim).me!.passive).toMatchObject({ ready: true, cdTotal: 12 });
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    expect(snap(sim).me!.hints ?? []).toEqual([]);
    sim.c.Hp.cur[d] = 0.2 * sim.c.Hp.max[d]!;
    step(sim);
    expect(snap(sim).me!.hints?.map((h) => [h.slot, h.ok])).toEqual([[3, true]]);
    cmd(sim, cast(2, CX + 500, CY));
    steps(sim, 15);
    const p = snap(sim).me!.passive!;
    expect(p.ready).toBe(false);
    expect(p.cdLeft!).toBeGreaterThan(10);
    expect(m).toBeGreaterThanOrEqual(0);
  });

  it('Ottilie: Hark alive badge, W scout pin, R mark on Hark, respawn timer', () => {
    const { sim, m } = setup('ottilie', true);
    steps(sim, 2);
    const h = petsOf(sim, m, 'ottilie_hark')[0]!;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(snap(sim).me!.passive?.ready).toBe(true);
    cmd(sim, cast(1, CX + 1200, CY));
    steps(sim, 10);
    const pin = snap(sim).objects.find((o) => o.tag === 'ottilie_w_scout');
    expect(pin?.shape).toBe('pin');
    expect(pin!.left!).toBeGreaterThan(4);
    cmd(sim, cast(3, CX, CY));
    steps(sim, 15);
    expect(marksOn(sim, h)).toContain('ottilie_r_call');
    steps(sim, sec(9));
    sim.c.Hp.cur[h] = 0;
    sim.c.Unit.alive[h] = 0;
    steps(sim, 3);
    const p = snap(sim).me!.passive!;
    expect(p.ready).toBe(false);
    expect(p.cdTotal).toBe(30);
  });

  it('Vessa: trail stacks on the badge, E stalk aura', () => {
    const { sim, m } = setup('vessa');
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 0, max: 10 });
    (sim.state.vessa as Map<number, { stacks: number }>).get(m)!.stacks = 4;
    step(sim);
    expect(snap(sim).me!.passive).toMatchObject({ stacks: 4, max: 10 });
    cmd(sim, cast(2, CX, CY));
    steps(sim, 10);
    expect(snap(sim).entities.find((s) => s.id === m)?.auras ?? []).toContain('vessa_e');
  });

  it('Wren: E smoke cloud, R storm with strikes left, burn marks', () => {
    const { sim } = setup('wren', true);
    const d = spawnDummy(sim, CX + 800, CY, 1);
    cmd(sim, cast(2, CX + 300, CY));
    steps(sim, 8);
    const smoke = snap(sim).objects.find((o) => o.tag === 'wren_e_smoke');
    expect(smoke?.r).toBe(250);
    expect(smoke!.left!).toBeGreaterThan(1);
    steps(sim, sec(2.5));
    cmd(sim, cast(3, CX + 800, CY));
    let storm: number | undefined;
    for (let i = 0; i < 20 && storm === undefined; i++) {
      step(sim);
      storm = snap(sim).objects.find((o) => o.tag === 'wren_r_storm')?.n;
    }
    expect(storm).toBe(4);
    expect(marksOn(sim, d)).toContain('wren_embers');
    steps(sim, sec(2.5));
    expect(snap(sim).objects.some((o) => o.tag === 'wren_r_storm')).toBe(false);
  });
});
