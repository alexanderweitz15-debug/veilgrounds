// Side symmetry (docs/DECISIONS.md "Seiten-Fairness"): the map is point-mirrored for the structures and lanes, so a
// game without champions must stay point-mirrored, (x, y) -> (size - x, size - y), blue top lane <-> red bot lane.
// Each tick-order dependency (lower eids, i.e. blue spawns, acting first) used to break this within 90 s and pushed
// blue's waves. Also: two identical champions trading autos die on the same tick.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { createSim, step, type Sim } from '../src/sim/sim';
import { MAP_SIZE } from '../src/sim/map';
import { isMinion, isStructure } from '../src/sim/types';
import { CX, CY, NO_RUNES, makeSim, place } from './combat-helpers';

const S = MAP_SIZE;

/** Blue units without a point-mirrored red twin (same kind, position within 0.5, HP within 0.5). */
function unmatched(sim: Sim): string[] {
  const { Unit, Pos, Hp } = sim.c;
  const blue: number[] = [];
  const red: number[] = [];
  for (const e of query(sim.world, [Unit])) {
    if (!Unit.alive[e] || !(isMinion(Unit.kind[e]!) || isStructure(Unit.kind[e]!))) continue;
    if (Unit.team[e] === 0) blue.push(e);
    else if (Unit.team[e] === 1) red.push(e);
  }
  const out: string[] = [];
  if (blue.length !== red.length) out.push(`count ${blue.length} vs ${red.length}`);
  const used = new Set<number>();
  for (const b of blue) {
    const twin = red.find(
      (r) =>
        !used.has(r) &&
        Unit.kind[r] === Unit.kind[b] &&
        Math.abs(S - Pos.x[r]! - Pos.x[b]!) < 0.5 &&
        Math.abs(S - Pos.y[r]! - Pos.y[b]!) < 0.5 &&
        Math.abs(Hp.cur[r]! - Hp.cur[b]!) < 0.5,
    );
    if (twin === undefined) out.push(`kind ${Unit.kind[b]} at ${Pos.x[b]!.toFixed(1)},${Pos.y[b]!.toFixed(1)} hp ${Hp.cur[b]!.toFixed(1)}`);
    else used.add(twin);
  }
  return out;
}

describe('side symmetry', () => {
  it('minions + structures without champions stay point-mirrored for 6 minutes', () => {
    const sim = createSim({ seed: 3, mode: 'classic', players: [] });
    let fights = 0;
    while (sim.tick < 6 * 60 * 30) {
      step(sim);
      for (const ev of sim.events) if (ev.e === 'death') fights++;
      if (sim.tick % 30 === 0) {
        const bad = unmatched(sim);
        expect(bad, `tick ${sim.tick}`).toEqual([]);
      }
    }
    expect(fights).toBeGreaterThan(20); // waves met, minions died, eids got recycled
  }, 60_000);

  it('two identical champions trading autos land their hits simultaneously', () => {
    const sim = makeSim({
      players: [
        { slot: 0, team: 0, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
        { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
      ],
    });
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, CX - 100, CY);
    place(sim, b, CX + 100, CY);
    step(sim);
    step(sim, [
      { slot: 0, cmd: { t: 'attack', target: b } },
      { slot: 5, cmd: { t: 'attack', target: a } },
    ]);
    let guard = 0;
    while (sim.c.Unit.alive[a] && sim.c.Unit.alive[b] && guard++ < 30 * 120) {
      step(sim);
      expect(sim.c.Hp.cur[a]).toBeCloseTo(sim.c.Hp.cur[b]!, 6);
    }
    // the lower eid (blue) used to kill first and lose nothing: now both fall on the same tick
    expect(sim.c.Unit.alive[a]).toBe(0);
    expect(sim.c.Unit.alive[b]).toBe(0);
  });
});
