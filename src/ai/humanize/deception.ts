// Deception susceptibility: the lower the rank, the easier a bot is fooled by what it sees (rank curves in
// data/bots/values.json "deception"). Only the bot's own fog-filtered snapshot is used - no omniscience.
//
// Decoys (Sev W clone: a Kind.Pet with `look` = owner's champion id, a fake champion health bar). Bots ignore pets, so
// without this a clone never fools anyone. When a bot first sees an enemy decoy it rolls once (decoyFooledPct):
// - fooled: for decoySpotMs the decoy counts as the champion (a Kind.Champion copy of the entity in the View, same id,
//   so attacks and skillshots go to the clone) and the real owner is "lost" (reaction delay decoyLoseRealMs, via
//   mem.aware.from) - also after the clone bursts;
// - not fooled, or spotted after decoySpotMs: ignored as before.
// The roll is made in think (perceive); the reflex view only reads the stored verdict.

import { Kind } from '../../sim/types';
import { VALUES, rankCurve } from '../utility/values';
import type { Rng } from '../../sim/rng';
import type { BotMemory, BotStatic, SnapEntity } from '../bot/types';

interface Verdict {
  /** Fooled until this tick (exclusive); 0 = not fooled. */
  until: number;
  /** Champion id the decoy imitates. */
  look: string;
}
const verdicts = new WeakMap<BotMemory, Map<number, Verdict>>();
/** Owner champion id -> tick until which the real champion is lost (a fooled bot looks at the clone instead). */
const lost = new WeakMap<BotMemory, Map<string, number>>();

const ms = (t: number): number => Math.max(0, Math.round((t * 30) / 1000));

/** The decoy as the champion it imitates, if this bot is (still) fooled by it; null = ignore the entity. */
export function fooledBy(e: SnapEntity, tick: number, ctx: BotStatic, mem: BotMemory, rng: Rng | null): SnapEntity | null {
  if (e.kind !== Kind.Pet || e.team === ctx.team || !e.alive) return null;
  let m = verdicts.get(mem);
  if (!m) verdicts.set(mem, (m = new Map()));
  let v = m.get(e.serial);
  if (!v) {
    if (!rng || !e.look) return null; // reflex view (no `look` there): no verdict yet, the next think rolls it
    const D = VALUES.deception;
    const skill = ctx.params.skill;
    v = { look: e.look, until: rng.chance(rankCurve(D.decoyFooledPct, skill) / 100) ? tick + ms(rankCurve(D.decoySpotMs, skill)) : 0 };
    m.set(e.serial, v);
    if (v.until) {
      let l = lost.get(mem);
      if (!l) lost.set(mem, (l = new Map()));
      l.set(v.look, Math.max(l.get(v.look) ?? 0, tick + ms(rankCurve(D.decoyLoseRealMs, skill))));
    }
  }
  if (tick >= v.until) return null;
  const real = ctx.players.find((p) => p.team !== ctx.team && p.champion === v.look);
  return { ...e, kind: Kind.Champion, champ: v.look, slot: real?.slot ?? e.slot };
}

/** Tick until which the real champion `champ` is lost to this bot (0 = not). */
export const lostUntil = (mem: BotMemory, champ: string | null): number => (champ ? lost.get(mem)?.get(champ) ?? 0 : 0);
