// Damage pipeline: mitigation, shields, last-hit credit, death. Every damage source goes through dealDamage.

import type { Sim } from './sim';
import { despawn } from './sim';
import { Kind, type DamageType } from './types';
import { onDeath } from './systems/economy';

export interface DamageOpts {
  isAuto?: boolean;
  crit?: boolean;
  /** Skip armor/MR (already-mitigated values, e.g. tower %-HP shots against minions). */
  raw?: boolean;
}

/** LoL mitigation: 100/(100+R) for R >= 0, 2 - 100/(100-R) for R < 0. */
export function mitigation(resist: number): number {
  return resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist);
}

/** Effective resist after penetration (order: % pen, then flat pen/lethality). */
export function effectiveResist(sim: Sim, src: number, dst: number, type: DamageType): number {
  const { Stats } = sim.c;
  if (type === 'phys') {
    let a = Stats.armor[dst]!;
    if (src >= 0) {
      if (a > 0) a *= 1 - Stats.armorPenPct[src]!;
      // ponytail: lethality as flat pen 1:1 (LoL scales with level); refine with items in Phase 2.
      if (a > 0) a = Math.max(0, a - Stats.lethality[src]!);
    }
    return a;
  }
  if (type === 'magic') {
    let m = Stats.mr[dst]!;
    if (src >= 0 && m > 0) m = Math.max(0, m - Stats.magicPen[src]!);
    return m;
  }
  return 0;
}

/** Applies damage, returns damage actually dealt to HP+shield. src may be -1 (environment). */
export function dealDamage(sim: Sim, src: number, dst: number, amount: number, type: DamageType, opts: DamageOpts = {}): number {
  const { Unit, Hp, LastHit } = sim.c;
  if (!Unit.alive[dst] || Unit.invulnerable[dst] || amount <= 0) return 0;
  if (sim.flags.towersInvulnerable && Unit.kind[dst]! >= Kind.Tower && Unit.kind[dst]! <= Kind.Nexus) return 0;
  let dmg = opts.raw || type === 'true' ? amount : amount * mitigation(effectiveResist(sim, src, dst, type));
  const absorbed = Math.min(Hp.shield[dst]!, dmg);
  Hp.shield[dst] = Hp.shield[dst]! - absorbed;
  const toHp = dmg - absorbed;
  Hp.cur[dst] = Hp.cur[dst]! - toHp;
  if (src >= 0) {
    LastHit.eid[dst] = src;
    LastHit.serial[dst] = Unit.serial[src]!;
    LastHit.tick[dst] = sim.tick;
  }
  sim.events.push({ e: 'damage', src, dst, amount: dmg, type, crit: opts.crit });
  if (Hp.cur[dst]! <= 0) {
    if (Unit.kind[dst] === Kind.Dummy) {
      Hp.cur[dst] = Hp.max[dst]!; // practice dummy never dies
    } else {
      kill(sim, dst, src);
    }
  }
  return dmg;
}

export function heal(sim: Sim, dst: number, amount: number): number {
  const { Hp, Unit } = sim.c;
  if (!Unit.alive[dst]) return 0;
  const before = Hp.cur[dst]!;
  Hp.cur[dst] = Math.min(Hp.max[dst]!, before + amount);
  return Hp.cur[dst]! - before;
}

export function kill(sim: Sim, victim: number, killer: number): void {
  const { Unit, Hp, Pos } = sim.c;
  if (!Unit.alive[victim]) return;
  Hp.cur[victim] = 0;
  sim.events.push({ e: 'death', eid: victim, kind: Unit.kind[victim]!, team: Unit.team[victim]!, killer, x: Pos.x[victim]!, y: Pos.y[victim]! });
  onDeath(sim, victim, killer); // rewards, respawn timers, structure state (economy.ts)
  if (Unit.kind[victim] === Kind.Champion) {
    Unit.alive[victim] = 0; // entity stays; economy respawns it
    sim.paths.delete(victim);
  } else {
    despawn(sim, victim);
  }
}
