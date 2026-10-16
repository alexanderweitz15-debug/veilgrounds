// Feature flag of the utility model (docs/BRAIN-REWORK.md §12: "Nutzen-Gerüst hinter einem Feature-Flag
// (BOT_UTILITY=1)"). Off by default: with the flag off no utility code runs, draws random numbers, writes memory or
// logs, so replays and bot-sim stay bit-identical to main.
// Sources, first match wins: BotStatic.utility (proposed SimConfig.botUtility -> BotStatic, see
// docs/agents/shared-changes.md; read untyped until merged), then the environment variable BOT_UTILITY=1 (bot-sim,
// tests; absent in the browser).

import type { BotStatic } from '../bot/types';

declare const process: { env?: Record<string, string | undefined> } | undefined;

const envFlag = (): boolean => {
  try {
    return typeof process !== 'undefined' && process?.env?.BOT_UTILITY === '1';
  } catch {
    return false;
  }
};

const cache = new WeakMap<object, boolean>();

/** True if this bot runs the utility selector (constant for a game). */
export function utilityOn(ctx: BotStatic): boolean {
  let on = cache.get(ctx);
  if (on === undefined) {
    const own = (ctx as { utility?: boolean }).utility;
    on = own ?? envFlag();
    cache.set(ctx, on);
  }
  return on;
}
