// A2 bug hunt (docs/BUGS.md): command fuzz. Ten champions of a classic 5v5 get random (also hostile) commands through
// the sim's input path (stale / dead / non-existent eids, NaN, Infinity, huge or negative coordinates, bad slots);
// nothing may throw and the state must stay finite and inside the map.
// structuresHelpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { newSim } from './structuresHelpers';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { createSim, step, type Sim } from '../src/sim/sim';
import { CHAMPION_DATA } from '../src/sim/champions';
import { Kind, PING_KINDS, type Command, type PlayerSetup, type TickInput } from '../src/sim/types';
import { buildSnapshot } from '../src/sim/snapshot';

void newSim;

/** Tiny seeded generator (the sim's own rng must not be touched). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ROLES: PlayerSetup['role'][] = ['top', 'jungle', 'mid', 'adc', 'support'];

function randomCommand(r: () => number): Command {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const coord = (): number => pick([r() * 16000, r() * 16000, r() * 16000, -500, 17000, 1e9, -1e9, NaN, Infinity, 0, 8000]);
  const eid = (): number => pick([-1, -5, 0, 1, 7, 33, 50, 120, 400, 4095, 4096, 99999, Math.floor(r() * 300)]);
  const t = pick(['move', 'move', 'attack', 'attackMove', 'stop', 'cast', 'cast', 'cast', 'spell', 'levelUp', 'recall', 'buy', 'sell', 'item', 'ward', 'trinket', 'ping', 'chat', 'ultChoice'] as const);
  switch (t) {
    case 'move':
    case 'attackMove':
      return { t, x: coord(), y: coord() };
    case 'attack':
      return { t, target: eid() };
    case 'stop':
    case 'recall':
      return { t };
    case 'cast':
      return { t, slot: pick([0, 1, 2, 3, 4, -1, 9] as unknown as (0 | 1 | 2 | 3)[]), x: coord(), y: coord(), ...(r() < 0.5 ? { target: eid() } : {}) };
    case 'spell':
      return { t, slot: pick([0, 1, 2, 3, -1] as unknown as (0 | 1 | 2)[]), x: coord(), y: coord(), ...(r() < 0.5 ? { target: eid() } : {}) };
    case 'levelUp':
      return { t, slot: pick([0, 1, 2, 3, 7] as unknown as (0 | 1 | 2 | 3)[]) };
    case 'buy':
      return { t, item: pick(['siegelward', 'nope', '', 'potion', 'dolch']) };
    case 'sell':
      return { t, slot: pick([0, 1, 5, 6, -1, 99]) };
    case 'item':
      return { t, slot: pick([0, 1, 2, 5, 6, -1]), ...(r() < 0.5 ? { x: coord(), y: coord() } : {}) };
    case 'ward':
      return { t, x: coord(), y: coord() };
    case 'trinket':
      return { t, id: pick(['schleierward', 'suchfeuer', 'bogus'] as unknown as ('schleierward' | 'suchfeuer')[]) };
    case 'ping':
      return { t, kind: pick([...PING_KINDS, 'bogus' as never]), x: coord(), y: coord(), ...(r() < 0.5 ? { target: eid() } : {}) };
    case 'chat':
      return { t, text: pick(['hi', '', 'x'.repeat(500)]) };
    case 'ultChoice':
      return { t, choice: pick([0, 1, 2, 3, -1] as unknown as (0 | 1 | 2)[]) };
  }
}

function checkState(sim: Sim, tag: string): string[] {
  const { Pos, Unit, Hp } = sim.c;
  const bad: string[] = [];
  for (const e of query(sim.world, [Unit, Pos, Hp])) {
    if (!Unit.alive[e] || Unit.kind[e] === Kind.Projectile) continue;
    if (!Number.isFinite(Pos.x[e]!) || !Number.isFinite(Pos.y[e]!) || Pos.x[e]! < -1 || Pos.y[e]! < -1 || Pos.x[e]! > 16001 || Pos.y[e]! > 16001) bad.push(`${tag}: kind ${Unit.kind[e]} eid ${e} at ${Pos.x[e]},${Pos.y[e]}`);
    if (!Number.isFinite(Hp.cur[e]!)) bad.push(`${tag}: kind ${Unit.kind[e]} eid ${e} hp ${Hp.cur[e]}`);
  }
  return bad;
}

describe('command fuzz', () => {
  it('3 seeds x 4000 ticks of hostile commands: no exception, finite positions and HP, snapshots build', () => {
    const ids = Object.keys(CHAMPION_DATA);
    const bad: string[] = [];
    for (const seed of [1, 2, 3]) {
      const r = lcg(seed * 7919);
      const players: PlayerSetup[] = [];
      for (let i = 0; i < 10; i++) players.push({ slot: i, team: i < 5 ? 0 : 1, champion: ids[Math.floor(r() * ids.length)]!, role: ROLES[i % 5]!, summoners: ['sprung', 'heilen'], isHuman: true });
      const sim = createSim({ seed, mode: 'classic', players });
      for (let tick = 0; tick < 4000; tick++) {
        const inputs: TickInput[] = [];
        for (let slot = 0; slot < 10; slot++) if (r() < 0.25) inputs.push({ slot, cmd: randomCommand(r) });
        // level up early so abilities exist
        if (tick % 40 === 0) for (let slot = 0; slot < 10; slot++) inputs.push({ slot, cmd: { t: 'levelUp', slot: (tick / 40) % 4 as 0 | 1 | 2 | 3 } });
        try {
          step(sim, inputs);
          if (tick % 100 === 0) {
            buildSnapshot(sim, 0, 0);
            buildSnapshot(sim, 1, 5);
          }
        } catch (e) {
          bad.push(`seed ${seed} tick ${tick}: threw ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(0, 4).join('\n')}`);
          break;
        }
        if (tick % 50 === 0) bad.push(...checkState(sim, `seed ${seed} tick ${tick}`));
        if (bad.length) break;
      }
    }
    expect(bad).toEqual([]);
  });
});
