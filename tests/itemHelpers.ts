// Shared setup for item/rune effect tests (Agent I).
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, NO_RUNES, place, steps } from './combat-helpers';
import { createSim, step, type Sim } from '../src/sim/sim';
import type { PlayerSetup } from '../src/sim/types';
import { abilityOf, applyEffects } from '../src/sim/systems/abilities';
import { inventory } from '../src/sim/items/inventory';


const player = (slot: number, champion: string, runes = NO_RUNES): PlayerSetup => ({
  slot,
  team: slot < 5 ? 0 : 1,
  champion,
  role: 'mid',
  summoners: ['sprung', 'heilen'],
  isHuman: slot === 0,
  runes,
});

export interface Duel {
  sim: Sim;
  me: number;
  foe: number;
  allies: number[];
}

/** Me (slot 0) at the open-ground spot, an enemy champion 400 to the east, optional allies to the west. */
export function duel(o: { champ?: string; runes?: typeof NO_RUNES; allies?: number[]; items?: string[] } = {}): Duel {
  const allyDist = o.allies ?? [];
  const players = [player(0, o.champ ?? 'mira', o.runes), player(5, 'mira'), ...allyDist.map((_, i) => player(1 + i, 'mira'))];
  const sim = createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players });
  const me = sim.slots[0]!;
  const foe = sim.slots[5]!;
  const allies = allyDist.map((_, i) => sim.slots[1 + i]!);
  place(sim, me, CX, CY);
  place(sim, foe, CX + 400, CY);
  allyDist.forEach((d, i) => place(sim, allies[i]!, CX - d, CY));
  (o.items ?? []).forEach((id, i) => (inventory(sim, me)[i] = id));
  steps(sim, 1); // stats with items
  return { sim, me, foe, allies };
}

type Dmg = { src: number; dst: number; amount: number; type: string; crit?: boolean; tick: number };

/** Attack `foe` until `n` physical hits from me landed; returns all damage events me -> foe. */
export function autos(sim: Sim, me: number, foe: number, n: number, maxTicks = 900): Dmg[] {
  const out: Dmg[] = [];
  let hits = 0;
  step(sim, [{ slot: 0, cmd: { t: 'attack', target: foe } }]);
  for (let i = 0; i < maxTicks && hits < n; i++) {
    step(sim);
    for (const e of sim.events) {
      if (e.e !== 'damage' || e.src !== me || e.dst !== foe) continue;
      out.push({ ...e, tick: sim.tick });
      if (e.type === 'phys') hits++;
    }
  }
  return out;
}

/** One resolution of my Q's hit effects on `t` (fires onAbilityHit). Returns damage events it produced. */
export function abilityHit(sim: Sim, me: number, t: number): Dmg[] {
  const { Pos } = sim.c;
  const from = sim.events.length;
  applyEffects(sim, { caster: me, slot: 0, rank: 1, ability: abilityOf(sim, me, 0), hits: [t], x: Pos.x[t]!, y: Pos.y[t]!, target: t, phase: 'cast', dx: 1, dy: 0, cursorX: Pos.x[t]!, cursorY: Pos.y[t]! }, 'hit');
  return sim.events.slice(from).flatMap((e) => (e.e === 'damage' && e.src === me ? [{ ...e, tick: sim.tick }] : []));
}
