// Named error injections (spec-bots §6): rank-dependent probability per opportunity, data in
// data/bots/errors.json. Rolled with the bot's own Rng; the returned id goes into DecisionLogEntry.injectedError.

import errorsJson from '../data/bots/errors.json';
import type { Rng } from '../sim/rng';
import { PROFILES } from './profiles';
import type { BotParams, ErrorId } from './contract';

export const ERROR_IDS = Object.keys(errorsJson.errors) as ErrorId[];
const TABLE = errorsJson.errors as Record<ErrorId, { p: number[]; note: string }>;
const ANCHORS = PROFILES.map((p) => p.skill);

/** Probability (0..1) of error `id` at a continuous skill: linear between the rank anchors. */
export function errorChance(id: ErrorId, skill: number): number {
  const p = TABLE[id]?.p;
  if (!p) return 0;
  if (skill <= ANCHORS[0]!) return p[0]!;
  for (let i = 1; i < ANCHORS.length; i++) {
    if (skill <= ANCHORS[i]!) {
      const t = (skill - ANCHORS[i - 1]!) / (ANCHORS[i]! - ANCHORS[i - 1]!);
      return p[i - 1]! + (p[i]! - p[i - 1]!) * t;
    }
  }
  return p[p.length - 1]!;
}

/**
 * Roll error `id` for this bot (skill after variance). Returns the id when the bot makes the mistake (truthy,
 * assign it to injectedError), else undefined. Always draws exactly one number so the bot's Rng stream does
 * not depend on the rates.
 */
export function maybeInject(params: Pick<BotParams, 'skill'>, id: ErrorId, rng: Rng): ErrorId | undefined {
  const r = rng.next();
  return r < errorChance(id, params.skill) ? id : undefined;
}
