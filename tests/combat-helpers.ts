// Shared setup for Agent B combat tests. Open ground at (6000, 8750): walkable +-1500 in x, +-800 in y, far from towers.
import { createSim, step, type Sim } from '../src/sim/sim';
import type { Command, SimConfig } from '../src/sim/types';

export const CX = 6000;
export const CY = 8750;

export function makeSim(extra: Partial<SimConfig> = {}, summonerCd?: Record<string, number>): Sim {
  return createSim({
    seed: 1,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, summonerCd }],
    ...extra,
  });
}

export const mira = (sim: Sim): number => sim.slots[0]!;

export function place(sim: Sim, eid: number, x: number, y: number): void {
  const { Pos } = sim.c;
  Pos.x[eid] = Pos.px[eid] = x;
  Pos.y[eid] = Pos.py[eid] = y;
}

export function cmd(sim: Sim, c: Command): void {
  step(sim, [{ slot: 0, cmd: c }]);
}

export function steps(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) step(sim);
}

/** Damage events from src collected while stepping n ticks (first tick may carry a command). */
export function collect(sim: Sim, n: number, src: number, first?: Command): { tick: number; dst: number; amount: number; crit?: boolean }[] {
  const out: { tick: number; dst: number; amount: number; crit?: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const t = sim.tick;
    step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
    for (const e of sim.events) if (e.e === 'damage' && e.src === src) out.push({ tick: t, dst: e.dst, amount: e.amount, crit: e.crit });
  }
  return out;
}
