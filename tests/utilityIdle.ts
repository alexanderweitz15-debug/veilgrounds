// Test 7 measurement (docs/BRAIN-REWORK.md §10): idle stretches (> 45 ticks: alive, not moving, no attack target or
// wind-up, not recalling / in the fountain) while an enemy minion or champion is within auto reach + 200, and the
// intent decision that governed each stretch (latest 'intent' log entry of the bot at the stretch start).

import { Kind } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import type { DecisionLogEntry } from '../src/ai/contract';
import { INTENT_NODE } from '../src/ai/utility/select';
import { runUtilityGame } from './utilityHarness';

export interface IdleStretch {
  slot: number;
  from: number;
  len: number;
  /** Governing intent entry (null: none logged before the stretch). */
  entry: DecisionLogEntry | null;
  /** §9 attention window (node 'attention', distracted until >= the stretch start) covering the stretch, if any. */
  attention: DecisionLogEntry | null;
}

export function measureIdle(config: SimConfig, ticks: number, fromTick = 105 * 30): { stretches: IdleStretch[]; idleTicks: number; aliveTicks: number } {
  const since = new Map<number, number>();
  const stretches: IdleStretch[] = [];
  let idleTicks = 0;
  let aliveTicks = 0;
  const g = runUtilityGame(config, ticks, (sim) => {
    if (sim.tick < fromTick) return;
    const { Unit, Pos, Atk, Champ, Stats } = sim.c;
    const units: [number, number, number][] = [];
    for (let e = 0; e < Unit.kind.length; e++) {
      const k = Unit.kind[e];
      if (!Unit.alive[e] || (k !== Kind.MinionMelee && k !== Kind.MinionCaster && k !== Kind.MinionSiege && k !== Kind.MinionSuper && k !== Kind.Champion)) continue;
      units.push([Unit.team[e]!, Pos.x[e]!, Pos.y[e]!]);
    }
    for (const p of config.players) {
      const eid = sim.slots[p.slot]!;
      const alive = !!Unit.alive[eid];
      const f = sim.map.sides[p.team === 1 ? 1 : 0].fountain;
      const inF = (Pos.x[eid]! - f.x) ** 2 + (Pos.y[eid]! - f.y) ** 2 < f.r * f.r;
      if (!alive || inF || Champ.recallAt[eid]! > 0) {
        since.delete(p.slot);
        continue;
      }
      aliveTicks++;
      const moving = sim.c.Move.mode[eid] !== 0;
      const busy = moving || Atk.target[eid]! >= 0 || Atk.phase[eid] !== 0;
      const reach = (Stats.range[eid] ?? 125) + 200;
      const target = units.some(([t, x, y]) => t !== p.team && (x - Pos.x[eid]!) ** 2 + (y - Pos.y[eid]!) ** 2 <= reach * reach);
      if (busy || !target) {
        const s = since.get(p.slot);
        if (s !== undefined && sim.tick - s > 45) stretches.push({ slot: p.slot, from: s, len: sim.tick - s, entry: null, attention: null });
        since.delete(p.slot);
        continue;
      }
      idleTicks++;
      if (!since.has(p.slot)) since.set(p.slot, sim.tick);
    }
  });
  const log = g.bots.log;
  for (const s of stretches) {
    let e: DecisionLogEntry | null = null;
    let a: DecisionLogEntry | null = null;
    for (const x of log.entries(s.slot)) {
      if (x.tick > s.from + 1) break;
      if (x.node === INTENT_NODE) e = x;
      if (x.node === 'attention' && typeof x.inputs.until === 'number' && x.inputs.until >= s.from) a = x;
    }
    s.entry = e;
    s.attention = a;
  }
  return { stretches, idleTicks, aliveTicks };
}
