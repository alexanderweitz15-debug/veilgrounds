// Shared setup for Agent B combat tests. Open ground at design (6000, 8750): walkable +-1500 in x, +-800 in y (design
// units, times MAP_SCALE on the 14900 map), far from towers.
import { createSim, step, type Sim } from '../src/sim/sim';
import { MAP_SCALE } from '../src/sim/map';
import type { Command, SimConfig } from '../src/sim/types';

export const CX = Math.round(6000 * MAP_SCALE);
export const CY = Math.round(8750 * MAP_SCALE);

/** Empty rune page (unknown rune ids are ignored): kit/engine tests run without Prägungen unless they pass a page. */
export const NO_RUNES = { keystone: 'none', minor: ['none', 'none', 'none'] as [string, string, string] };

export function makeSim(extra: Partial<SimConfig> = {}, summonerCd?: Record<string, number>): Sim {
  const cfg: SimConfig = {
    seed: 1,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, summonerCd }],
    ...extra,
  };
  return createSim({ ...cfg, players: cfg.players.map((p) => (p.runes ? p : { ...p, runes: NO_RUNES })) });
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
