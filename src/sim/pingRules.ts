// Ping spam rules shared by the sim (authoritative) and the client (so the player gets feedback instead of a silent
// drop). LoL-like: a short burst is fine, then pings are refused until the window slides on.
import { TICK_HZ } from './types';

/** Sliding window in ticks (4 s) and the pings allowed inside it, per player. */
export const PING_WINDOW = TICK_HZ * 4;
export const PING_MAX = 6;
/** Longest context label ("Blitz nicht bereit (2:10)") that travels with a ping. */
export const PING_LABEL_MAX = 40;

/** True if a player with the given recent ping ticks may ping at `tick`. */
export function pingAllowed(recent: readonly number[], tick: number): boolean {
  let n = 0;
  for (const t of recent) if (tick - t < PING_WINDOW) n++;
  return n < PING_MAX;
}

/** Context label of a ping: printable text only, trimmed, capped; undefined when nothing is left. */
export function cleanPingLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PING_LABEL_MAX).trim();
  return s || undefined;
}
