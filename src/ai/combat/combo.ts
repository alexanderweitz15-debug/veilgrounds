// Combos of the micro layer (A13): the choice of a combo from the champion's hints and its execution every tick.
//
// Choice: the hint combos (data combos plus derived poke / peel combos, src/data/bots/hints) are scored by what the
// bot can really do right now - own abilities ready and affordable (own cooldowns are known), the first ability in
// reach of the target. The rank's situationalAbilityPct decides how often the best one is taken instead of the
// champion's standard combo (an error rate: low ranks play the standard combo whatever the situation).
//
// Execution: the decision layer runs 2-8 times a second, a combo step takes 0.2-0.45 s. The reflex layer therefore
// issues the next ability of a running trade as soon as the previous cast is over (+ the rank's input gap: one
// action takes 60 / apmCap seconds, half of it between two combo keys), instead of waiting for the next decision.
// A missed decision (executes(), Iron 57 % .. Challenger 100 %) is rolled once per step and costs one input gap.

import type { Rng } from '../../sim/rng';
import type { BotAction, BotMemory, BotStatic, SnapEntity } from '../bot/types';
import type { View } from '../bot/perception';
import { castSlot, ready } from '../bot/combat';
import { dst } from '../bot/geo';
import { hintsOf, SLOT_INDEX, type ComboHint, type SlotKey } from '../../data/bots/hints';

const SLOT_OF = SLOT_INDEX as Readonly<Record<string, 0 | 1 | 2 | 3>>;

/** Ability tokens of a combo that the bot has learned. */
const learned = (v: View, tok: string): boolean => tok in SLOT_OF && (v.me.abilities[SLOT_OF[tok]!]?.rank ?? 0) > 0;

/** What a combo is worth against a target at `d` right now (0 = nothing to do). */
export function comboValue(v: View, ctx: BotStatic, combo: ComboHint, d: number): number {
  const h = hintsOf(ctx.champ);
  let mana = v.self.mana;
  let value = 0;
  let first = true;
  for (const tok of combo.sequence) {
    if (tok === 'AA') {
      value += 0.3;
      continue;
    }
    if (!(tok in SLOT_OF)) continue;
    const slot = SLOT_OF[tok]!;
    const hs = v.me.abilities[slot];
    if (!hs || hs.rank <= 0 || hs.cdLeft > 0 || (ctx.champ.abilities[slot]!.costType !== 'hp' && ctx.champ.abilities[slot]!.costType !== 'none' && mana < hs.cost)) continue;
    mana -= hs.cost;
    const ah = h.abilities[slot]!;
    if (first) {
      first = false;
      // the first spell has to be in reach after about half a second of walking
      if (d > ah.useRange[1] + (v.me.stats.ms * 0.5)) return 0;
    }
    value += (ah.damage ? 1 : 0) + ah.cc * 0.15 + (ah.roles.includes('ult') ? 0.2 : 0);
  }
  return value;
}

/** Combo for a trade / all-in against `t`: best of the hint combos of the kinds that fit, or the standard combo. */
export function chooseHintCombo(v: View, ctx: BotStatic, rng: Rng, kind: 'trade' | 'allin', t: SnapEntity): string[] {
  const h = hintsOf(ctx.champ);
  const fit: ComboHint['kind'][] = kind === 'allin' ? ['allin', 'engage', 'trade'] : ['trade', 'engage', 'poke'];
  const standard = h.combos.find((c) => c.source === 'data') ?? h.combos[0];
  if (!standard) return ['AA'];
  if (!rng.chance(ctx.profile.behavior.situationalAbilityPct / 100)) return standard.sequence;
  const d = dst(v.self, t);
  let best: ComboHint | null = null;
  let bestV = 0;
  for (const c of h.combos) {
    if (!fit.includes(c.kind)) continue;
    // an all-in is for the full burst; a trade does not spend the ultimate
    if (kind === 'trade' && c.sequence.includes('R')) continue;
    if (c.sequence.some((tok) => tok in SLOT_OF && !learned(v, tok))) continue;
    const val = comboValue(v, ctx, c, d);
    if (val > bestV) {
      bestV = val;
      best = c;
    }
  }
  return (best ?? standard).sequence;
}

// ------------------------------------------------------------------ per-tick execution

interface StepRoll {
  tr: object;
  step: number;
  /** Tick from which the step may fire (input gap, fumble). */
  from: number;
}
const ROLLS = new WeakMap<BotMemory, StepRoll>();

/** Ticks of one input of the rank (apmCap actions per minute); a combo key follows the previous one after half of it. */
const inputGap = (ctx: BotStatic): number => Math.max(1, Math.round((30 * 60) / Math.max(30, ctx.profile.behavior.apmCap) / 2));

export interface ComboCtx {
  ultKillThreshold: number;
  /** Probability that a decision executes (Iron 57 % .. Challenger 100 %). */
  executeChance: number;
}

/**
 * The next combo ability of the running trade, if it can be cast this tick; [] otherwise (the decision layer keeps
 * approaching, auto-attacking and the timeouts). Advances the trade's step like the decision layer does.
 */
export function comboTick(v: View, ctx: BotStatic, mem: BotMemory, rng: Rng, cc: ComboCtx): BotAction[] {
  const tr = mem.ext.trade;
  if (!tr || tr.comboDone) return [];
  const T = v.tick;
  if (T < mem.busyUntil || v.self.atkPhase === 1) return [];
  const t = v.enemies.find((e) => e.serial === tr.serial);
  if (!t) return [];
  let roll = ROLLS.get(mem);
  if (!roll || roll.tr !== tr || roll.step !== tr.step) {
    // new step: the rank's miss chance is paid once, as one input gap
    const miss = !rng.chance(cc.executeChance);
    roll = { tr, step: tr.step, from: T + (miss ? 2 * inputGap(ctx) : 0) };
    ROLLS.set(mem, roll);
  }
  if (T < roll.from) return [];
  while (!tr.comboDone) {
    const tok = tr.combo[tr.step];
    if (tok === undefined) {
      tr.comboDone = true;
      return [];
    }
    if (tok === 'FLASH') {
      tr.step++;
      continue;
    }
    if (tok === 'AA') return []; // the decision layer orbwalks
    const slot = SLOT_OF[tok as SlotKey];
    if (slot === undefined) {
      tr.step++;
      continue;
    }
    if (!ready(v, ctx, slot)) {
      tr.step++;
      tr.stepAt = T;
      continue;
    }
    if (slot === 3 && tr.kill !== undefined && tr.kill < cc.ultKillThreshold && v.enemies.filter((e) => dst(e, t) < 800).length < 2) {
      tr.step++;
      continue;
    }
    const a = castSlot(v, ctx, rng, t, slot, 'fight');
    if (!a) return [];
    tr.step++;
    tr.stepAt = T;
    ROLLS.delete(mem);
    // the same busy rule as brain.think: a cast with a wind-up stops the champion
    const ab = ctx.champ.abilities[slot]!;
    if (!(ab.movesWhileCasting && !ab.flags?.includes('channel'))) {
      mem.busyFrom = T;
      mem.busySlot = slot;
      mem.busyUntil = T + Math.ceil(ab.castTime * 30) + 1 + inputGap(ctx);
    }
    return [a];
  }
  return [];
}
