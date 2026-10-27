// Damage pipeline: outgoing modifiers, mitigation, damage reduction, shields, last-hit credit, death, champion hook
// events (modifyDamage, onDamageTaken, onKill, onTakedown). Every damage source goes through dealDamage.

import type { Sim } from './sim';
import { MAX_ENT } from './ecs';
import { despawn } from './sim';
import { Kind, VARIANTS, isStructure, sec, type DamageType } from './types';
import { onDeath } from './systems/economy';
import { damageDealtMult, damageTakenMult, hasBuff, healMult, statMods } from './buffs';
import { ELDER } from './drakes';
import { passiveHooksOf } from './champions';
import { KESSELBRUT_STRUCT_PCT, isEpicMonster, kesselbrutStacks } from './systems/jungle';
import { petOwner } from './summons';
import TOWER_DATA from '../data/towers.json';

export interface DamageOpts {
  isAuto?: boolean;
  crit?: boolean;
  /** Skip armor/MR (already-mitigated values, e.g. tower %-HP shots against minions). */
  raw?: boolean;
  /** Damage-over-time tick (buffs.ts): hit flash throttled. */
  dot?: boolean;
}

/** Hit flash (B5): champion hits always flash, every other hit (DoT ticks, minions, towers, monsters) at most every this many ticks per target (4/s). */
export const FLASH_MIN_TICKS = 8;

/** Takedown window for onTakedown (champion damaged the victim within this many ticks). */
export const TAKEDOWN_TICKS = sec(3);

interface CombatLog {
  /** Last tick a champion dealt / took damage (for "out of combat" checks). */
  dealt: Map<number, number>;
  taken: Map<number, number>;
  /** Champion victim -> (champion source -> last damage tick). */
  pair: Map<number, Map<number, number>>;
  /** Re-entrancy depth: hook events fire only for top-level damage (no reflect ping-pong). */
  depth: number;
  /** Last hit-flash tick per target eid. */
  flash: Int32Array;
  /** Damage dealt to enemy champions per champion eid (scoreboard). */
  champDmg: Map<number, number>;
}

function combatLog(sim: Sim): CombatLog {
  let s = sim.state.damage as CombatLog | undefined;
  if (!s) sim.state.damage = s = { dealt: new Map(), taken: new Map(), pair: new Map(), depth: 0, flash: new Int32Array(MAX_ENT).fill(-1000), champDmg: new Map() };
  return s;
}

/** Damage a champion dealt to enemy champions so far (after mitigation). Read-only. */
export function champDamage(sim: Sim, eid: number): number {
  return (sim.state.damage as CombatLog | undefined)?.champDmg.get(eid) ?? 0;
}

/** Tick `src` last damaged `dst` (both champions), or -1e9. */
export function lastDamageTick(sim: Sim, src: number, dst: number): number {
  return combatLog(sim).pair.get(dst)?.get(src) ?? -1e9;
}

/** Last tick the champion dealt or took damage, or -1e9. */
export function lastCombatTick(sim: Sim, eid: number): number {
  const s = combatLog(sim);
  return Math.max(s.dealt.get(eid) ?? -1e9, s.taken.get(eid) ?? -1e9);
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
      if (a > 0) a *= (1 - Stats.armorPenPct[src]!) * (1 - Math.min(100, statMods(sim, src, 'armorPen')[0]) / 100);
      // ponytail: lethality as flat pen 1:1 (LoL scales with level); refine with items in Phase 2.
      if (a > 0) a = Math.max(0, a - Stats.lethality[src]!);
    }
    return a;
  }
  if (type === 'magic') {
    let m = Stats.mr[dst]!;
    if (src >= 0 && m > 0) m = Math.max(0, m * (1 - Stats.magicPenPct[src]!) - Stats.magicPen[src]!); // % pen, then flat (LoL order)
    return m;
  }
  return 0;
}

/** Applies damage, returns damage actually dealt to HP+shield. src may be -1 (environment). */
export function dealDamage(sim: Sim, src: number, dst: number, amount: number, type: DamageType, opts: DamageOpts = {}): number {
  const { Unit, Hp, LastHit } = sim.c;
  if (!Unit.alive[dst] || Unit.invulnerable[dst] || amount <= 0) return 0;
  if (sim.flags.towersInvulnerable && Unit.kind[dst]! >= Kind.Tower && Unit.kind[dst]! <= Kind.Nexus) return 0;
  if (Unit.kind[dst] === Kind.Ward || Unit.kind[dst] === Kind.Plant) {
    // wards (src/sim/wards.ts) lose exactly 1 HP per basic attack; nothing else damages them.
    // Jungle plants (src/sim/systems/plants.ts): the same, but only champion basic attacks pop them.
    if (!opts.isAuto) return 0;
    if (Unit.kind[dst] === Kind.Plant && (src < 0 || Unit.kind[src] !== Kind.Champion)) return 0;
    amount = 1;
    opts = { ...opts, raw: true, crit: false };
  }
  const log = combatLog(sim);
  const top = log.depth === 0;
  log.depth++;
  try {
    const ward = Unit.kind[dst] === Kind.Ward || Unit.kind[dst] === Kind.Plant;
    if (top && src >= 0 && !ward) for (const h of passiveHooksOf(sim, src)) if (h.modifyDamage) amount = h.modifyDamage(sim, src, dst, amount, type, !!opts.isAuto);
    if (src >= 0 && !ward) amount *= damageDealtMult(sim, src);
    // Kesselbrut team stacks: champions deal more damage to structures (jungle.ts)
    if (src >= 0 && Unit.kind[src] === Kind.Champion && isStructure(Unit.kind[dst]!)) amount *= 1 + (KESSELBRUT_STRUCT_PCT / 100) * kesselbrutStacks(sim, Unit.team[src]!);
    if (amount <= 0) return 0;
    let dmg = opts.raw || type === 'true' ? amount : amount * mitigation(effectiveResist(sim, src, dst, type));
    if (!ward) dmg *= damageTakenMult(sim, dst);
    // Fortification (towers.json): early outer towers take reduced damage
    if (Unit.kind[dst] === Kind.Tower && sim.c.Tower.tier[dst] === 0 && sim.tick < sec(TOWER_DATA.fortification.untilSec)) dmg *= TOWER_DATA.fortification.damageMult;
    const absorbed = Math.min(Hp.shield[dst]!, dmg);
    Hp.shield[dst] = Hp.shield[dst]! - absorbed;
    const toHp = dmg - absorbed;
    Hp.cur[dst] = Hp.cur[dst]! - toHp;
    // Uralt-Leviathan buff: enemy champions below the execute threshold die to the next hit of the holder
    if (src >= 0 && Hp.cur[dst]! > 0 && Unit.kind[src] === Kind.Champion && Unit.kind[dst] === Kind.Champion && Unit.team[src] !== Unit.team[dst] && Hp.cur[dst]! < Hp.max[dst]! * (ELDER.executePct / 100) && hasBuff(sim, src, 'mark', 'uralt')) Hp.cur[dst] = 0;
    if (src >= 0) {
      LastHit.eid[dst] = src;
      LastHit.serial[dst] = Unit.serial[src]!;
      LastHit.tick[dst] = sim.tick;
    }
    const srcChamp = src >= 0 && Unit.kind[src] === Kind.Champion;
    if (srcChamp) log.dealt.set(src, sim.tick);
    if (Unit.kind[dst] === Kind.Champion) {
      log.taken.set(dst, sim.tick);
      if (srcChamp && Unit.team[src] !== Unit.team[dst]) {
        let m = log.pair.get(dst);
        if (!m) log.pair.set(dst, (m = new Map()));
        m.set(src, sim.tick);
        log.champDmg.set(src, (log.champDmg.get(src) ?? 0) + dmg);
      }
    }
    const flash = (srcChamp && !opts.dot) || sim.tick - log.flash[dst]! >= FLASH_MIN_TICKS;
    if (flash) log.flash[dst] = sim.tick;
    sim.events.push({ e: 'damage', src, dst, amount: dmg, type, crit: opts.crit, ...(opts.isAuto ? { auto: true as const } : {}), ...(flash ? { flash: true as const } : {}) });
    if (top && dmg > 0) for (const h of passiveHooksOf(sim, dst)) h.onDamageTaken?.(sim, dst, src, { amount: dmg, absorbed, type, isAuto: !!opts.isAuto });
    if (top && dmg > 0 && Unit.kind[dst] === Kind.Pet) {
      const owner = petOwner(sim, dst); // Sev E decoy: enemy ability hits mark the attacker
      if (owner >= 0) for (const h of passiveHooksOf(sim, owner)) h.onPetDamaged?.(sim, owner, dst, src, { amount: dmg, absorbed, type, isAuto: !!opts.isAuto });
    }
    if (Hp.cur[dst]! <= 0 && Unit.alive[dst]) {
      if (Unit.kind[dst] === Kind.Dummy) {
        Hp.cur[dst] = Hp.max[dst]!; // practice dummy never dies
      } else {
        kill(sim, dst, src);
      }
    }
    return dmg;
  } finally {
    log.depth--;
  }
}

/** Heals (grievous wounds apply here, so regen and every heal honour them). */
export function heal(sim: Sim, dst: number, amount: number): number {
  const { Hp, Unit } = sim.c;
  if (!Unit.alive[dst]) return 0;
  const before = Hp.cur[dst]!;
  Hp.cur[dst] = Math.min(Hp.max[dst]!, before + amount * healMult(sim, dst));
  return Hp.cur[dst]! - before;
}

export function kill(sim: Sim, victim: number, killer: number): void {
  const { Unit, Hp, Pos } = sim.c;
  if (!Unit.alive[victim]) return;
  Hp.cur[victim] = 0;
  // champion ids ride along: the victim leaves the (fog-filtered) snapshot in this very tick, so clients could not
  // name it otherwise (kill feed, announcer, death recap)
  const champOf = (e: number): string | undefined => (e >= 0 && Unit.kind[e] === Kind.Champion ? sim.championIds[Unit.champ[e]!] : undefined);
  const vChamp = champOf(victim);
  const kChamp = champOf(killer);
  sim.events.push({
    e: 'death', eid: victim, kind: Unit.kind[victim]!, team: Unit.team[victim]!, killer, x: Pos.x[victim]!, y: Pos.y[victim]!,
    ...(vChamp !== undefined ? { champ: vChamp } : {}),
    ...(Unit.kind[victim] === Kind.Plant ? { variant: VARIANTS[Unit.variant[victim]!] } : {}),
    ...(killer >= 0 ? { killerKind: Unit.kind[killer]!, killerTeam: Unit.team[killer]! } : {}),
    ...(kChamp !== undefined ? { killerChamp: kChamp } : {}),
    ...(Unit.kind[victim] === Kind.Monster && isEpicMonster(sim, victim) ? { epic: true as const } : {}),
  });
  onDeath(sim, victim, killer); // rewards, respawn timers, structure state (economy.ts)
  // hook events while the victim's position is still valid
  if (killer >= 0 && Unit.kind[killer] === Kind.Champion) for (const h of passiveHooksOf(sim, killer)) h.onKill?.(sim, killer, victim);
  if (Unit.kind[victim] === Kind.Champion) {
    const log = combatLog(sim);
    const parts = new Set<number>();
    if (killer >= 0 && Unit.kind[killer] === Kind.Champion && Unit.team[killer] !== Unit.team[victim]) parts.add(killer);
    for (const [c, t] of log.pair.get(victim) ?? []) if (sim.tick - t <= TAKEDOWN_TICKS) parts.add(c);
    log.pair.delete(victim);
    for (const c of [...parts].sort((a, b) => a - b)) for (const h of passiveHooksOf(sim, c)) h.onTakedown?.(sim, c, victim);
    Unit.alive[victim] = 0; // entity stays; economy respawns it
    sim.paths.delete(victim);
  } else {
    despawn(sim, victim);
  }
}
