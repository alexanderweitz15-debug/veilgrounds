// Switch of the combat micro layer (A13, docs/agents/wave1-a13.md). The micro layer belongs to the beta brain
// (reflex layer + utility model): it is on exactly when the utility model is on. With the default brain no micro
// code runs, draws random numbers, writes memory or logs, so replays and bot-sim stay bit-identical.
// Measurement hooks (never a decision input): BOT_MICRO=0 turns the layer off for the beta brain (the beta brain
// then plays like before A13); BOT_MICRO_SKIP=dodge,combo turns single parts off (ablation runs);
// setMicroOverride lets tools/botHints/*Bench.ts play micro-on against micro-off inside one game (A/B on the same
// seed and sides).

import type { BotStatic } from '../bot/types';
import { utilityOn } from '../utility/flag';

declare const process: { env?: Record<string, string | undefined> } | undefined;

/** The parts of the micro layer that can be switched off singly (ablation measurements). */
export type MicroPart = 'aim' | 'dodge' | 'combo' | 'spacing' | 'focus' | 'peel';

const env = (name: string): string | undefined => {
  try {
    return typeof process !== 'undefined' ? process?.env?.[name] : undefined;
  } catch {
    return undefined;
  }
};

let skipCache: { raw: string | undefined; set: ReadonlySet<string> } | null = null;
const skipped = (): ReadonlySet<string> => {
  const raw = env('BOT_MICRO_SKIP');
  if (!skipCache || skipCache.raw !== raw) skipCache = { raw, set: new Set((raw ?? '').split(',').filter(Boolean)) };
  return skipCache.set;
};

let override: ((ctx: BotStatic) => boolean | undefined) | null = null;

/** Measurement hook: per bot true / false forces the micro layer on / off, undefined keeps the default. */
export function setMicroOverride(f: ((ctx: BotStatic) => boolean | undefined) | null): void {
  override = f;
}

/** True if this bot runs the combat micro layer (beta brain only), or the given part of it. */
export function microOn(ctx: BotStatic | undefined, part?: MicroPart): boolean {
  if (!ctx || !utilityOn(ctx)) return false;
  if (override) {
    const o = override(ctx);
    if (o !== undefined) return o && !(part && skipped().has(part));
  }
  if (env('BOT_MICRO') === '0') return false;
  return !(part && skipped().has(part));
}
