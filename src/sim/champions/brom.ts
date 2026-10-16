// Brom Eisenwurz hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dealDamage, heal } from '../damage';
import { addBuff, hasBuff } from '../buffs';
import { dist2 } from '../vec';
import { champAbil, effectAmount, setCooldown } from '../systems/abilities';
import type { ChampionHooks, UnitMark } from './hooks';
import { hookState, peekState } from './util';

interface Bleed {
  serial: number;
  stacks: number;
  until: number;
  next: number;
}

const MAX_STACKS = 5;
const BLEED_DPS = 8;
const BLEED_TICKS = sec(5);

/** Bleeds applied by one Brom: target eid -> bleed. */
const bleeds = (sim: Sim, brom: number): Map<number, Bleed> => {
  const m = hookState<Map<number, Bleed>>(sim, 'bromBleed');
  let b = m.get(brom);
  if (!b) m.set(brom, (b = new Map()));
  return b;
};

export function bleedStacks(sim: Sim, brom: number, t: number): number {
  const b = bleeds(sim, brom).get(t);
  return b && b.serial === sim.c.Unit.serial[t] && b.until > sim.tick ? b.stacks : 0;
}

function addStacks(sim: Sim, brom: number, t: number, n: number): void {
  if (!sim.c.Unit.alive[t]) return;
  const m = bleeds(sim, brom);
  const cur = bleedStacks(sim, brom, t);
  const old = m.get(t);
  m.set(t, {
    serial: sim.c.Unit.serial[t]!,
    stacks: Math.min(MAX_STACKS, cur + n),
    until: sim.tick + BLEED_TICKS,
    next: cur > 0 && old ? old.next : sim.tick + sec(1),
  });
}

/** E passive armor pen buff. No `brom_` prefix: the snapshot would otherwise draw a permanent E aura ring. */
const E_PEN_ID = 'bromEPen';

export const hooks: ChampionHooks = {
  // Bleed stacks as pips on each target; passive badge = highest stack count, glowing while one target is at 5 (heals).
  visuals(sim, eid) {
    const { Unit } = sim.c;
    const marks: UnitMark[] = [];
    let top = 0;
    for (const [t, b] of peekState<Map<number, Bleed>>(sim, 'bromBleed')?.get(eid) ?? []) {
      if (b.serial !== Unit.serial[t] || !Unit.alive[t] || b.until <= sim.tick || b.stacks <= 0) continue;
      marks.push({ target: t, id: 'brom_p_bleed', n: b.stacks, max: MAX_STACKS, left: b.until - sim.tick });
      top = Math.max(top, b.stacks);
    }
    return { marks, passive: { stacks: top, max: MAX_STACKS, ready: top >= MAX_STACKS } };
  },
  passive: {
    // Every ability hit adds a bleed stack (8 phys/s per stack, 5 s, max 5); at 5 stacks each tick heals Brom.
    brom_bleed: {
      onAbilityHit(sim, eid, target) {
        addStacks(sim, eid, target, 1);
      },
    },
  },
  onTick(sim, eid) {
    const { Unit, Hp } = sim.c;
    // E passive: 25 % armor penetration while E is learned (buff is lost on death, re-added here)
    if (Unit.alive[eid] && champAbil(sim, eid).ranks[2]! > 0 && !hasBuff(sim, eid, 'stat', E_PEN_ID))
      addBuff(sim, eid, { kind: 'stat', stat: 'armorPen', id: E_PEN_ID, src: eid, pct: 25, ticks: 1 << 30 });
    const m = bleeds(sim, eid);
    for (const [t, b] of [...m]) {
      if (b.serial !== Unit.serial[t] || !Unit.alive[t] || b.until < sim.tick) {
        m.delete(t);
        continue;
      }
      if (sim.tick < b.next) continue;
      b.next += sec(1);
      dealDamage(sim, eid, t, BLEED_DPS * b.stacks, 'phys');
      if (b.stacks >= MAX_STACKS && Unit.alive[eid]) heal(sim, eid, 0.02 * b.stacks * Hp.max[eid]!);
    }
  },
  effects: {
    // Targets 250-400 from the centre: +50 % Q damage and one extra bleed stack.
    brom_q_outer_ring(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      for (const t of ctx.hits) {
        if (!sim.c.Unit.alive[t] || dist2(Pos.x[t]!, Pos.y[t]!, ctx.x, ctx.y) < 250 * 250) continue;
        const d = effectAmount(sim, ctx, t);
        dealDamage(sim, ctx.caster, t, 0.5 * d.amount, d.type);
        addStacks(sim, ctx.caster, t, 1);
      }
    },
    // Empowered auto: +30 % damage (the slow is the generic effect).
    brom_w_next_auto(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'empowered' && ctx.empowered && t !== undefined) dealDamage(sim, ctx.caster, t, 0.3 * ctx.empowered.damage, 'phys', { isAuto: true });
    },
    // ponytail: the armor penetration is a permanent buff maintained by onTick while E is learned.
    brom_e_armor_pen() {},
    // R true damage x (1 + 0.2 per bleed stack): the extra part as a second true-damage instance.
    brom_r_stack_bonus(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase !== 'cast' || t === undefined || !sim.c.Unit.alive[t]) return;
      const stacks = bleedStacks(sim, ctx.caster, t);
      if (stacks > 0) dealDamage(sim, ctx.caster, t, effectAmount(sim, ctx, t).amount * 0.2 * stacks, 'true');
    },
    // R champion kill resets its cooldown.
    brom_r_reset(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'cast' && t !== undefined && sim.c.Unit.kind[t] === Kind.Champion && !sim.c.Unit.alive[t]) setCooldown(sim, ctx.caster, 3, 0);
    },
  },
};
