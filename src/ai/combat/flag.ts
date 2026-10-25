// Switch of the combat micro layer (A13, docs/agents/wave1-a13.md). The micro layer belongs to the beta brain
// (reflex layer + utility model): it is on exactly when the utility model is on. With the default brain no micro
// code runs, draws random numbers, writes memory or logs, so replays and bot-sim stay bit-identical.
// Measurement hooks (never a decision input): BOT_MICRO=0 turns the layer off for the beta brain (the beta brain
// then plays like before A13), and setMicroOverride lets tools/botHints/combatBench.ts play micro-on against
// micro-off inside one game (A/B on the same seed and sides).

import type { BotStatic } from '../bot/types';
import { utilityOn } from '../utility/flag';

declare const process: { env?: Record<string, string | undefined> } | undefined;

const envOff = (): boolean => {
  try {
    return typeof process !== 'undefined' && process?.env?.BOT_MICRO === '0';
  } catch {
    return false;
  }
};

let override: ((ctx: BotStatic) => boolean | undefined) | null = null;

/** Measurement hook: per bot true / false forces the micro layer on / off, undefined keeps the default. */
export function setMicroOverride(f: ((ctx: BotStatic) => boolean | undefined) | null): void {
  override = f;
}

/** True if this bot runs the combat micro layer (beta brain only). */
export function microOn(ctx: BotStatic | undefined): boolean {
  if (!ctx || !utilityOn(ctx)) return false;
  if (override) {
    const o = override(ctx);
    if (o !== undefined) return o;
  }
  return !envOff();
}
