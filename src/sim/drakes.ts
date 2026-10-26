// Elemental Leviathans: data (src/data/drakes.json), element rotation and the team bonus of kills / soul.
// Pure functions of the drake state; jungle.ts owns the state, inventory.bonusStats reads `drakeBonus`.
import raw from '../data/drakes.json';
import type { Rng } from './rng';

export type DrakeStats = Partial<Record<string, number>>;
export interface DrakeElement {
  id: string;
  color: string;
  perKill: DrakeStats;
  soul: DrakeStats;
}
export const ELEMENTS: readonly DrakeElement[] = raw.elements;
export const ELDER = raw.elder;
export const SOUL_AT = raw.soulAt;
/** Element index of the Uralt-Leviathan (snapshot `elem`, drake `cur` / `next`). */
export const ELDER_ELEM = ELEMENTS.length;

export interface DrakeState {
  /** Element index of every Leviathan each team killed (index = team). */
  kills: [number[], number[]];
  /** All Leviathans killed so far (both teams). */
  total: number;
  /** Element of the current / last spawned Leviathan (-1 before the first spawn; ELDER_ELEM for the elder). */
  cur: number;
  /** Element of the next spawn, public once the first one died (-1 = not decided yet). */
  next: number;
  /** Soul (map) element: the third spawn; -1 until decided. */
  soulType: number;
  /** Soul element a team owns (-1 = none). */
  soul: [number, number];
  /** A soul was claimed: the pit spawns the Uralt-Leviathan from now on. */
  elder: boolean;
}

export const newDrakeState = (): DrakeState => ({ kills: [[], []], total: 0, cur: -1, next: -1, soulType: -1, soul: [-1, -1], elder: false });

/** Random element out of all except `skip`. */
const pick = (rng: Rng, skip: number[]): number => {
  const pool = ELEMENTS.map((_, i) => i).filter((i) => !skip.includes(i));
  return pool[rng.int(pool.length)]!;
};

/** Element of the spawn that happens now (the announced one; the very first is random). */
export const spawnElement = (rng: Rng, d: DrakeState): number => (d.elder ? ELDER_ELEM : d.next >= 0 ? d.next : pick(rng, []));

/**
 * After a champion kill: count it and decide the next element. The 2nd spawn is announced after the first kill, the
 * 3rd is the soul element (differs from 1 and 2), later ones are random without repeating the previous element.
 */
export function noteKill(rng: Rng, d: DrakeState, team: 0 | 1): void {
  if (d.cur >= 0 && d.cur < ELDER_ELEM) d.kills[team].push(d.cur);
  d.total++;
  if (d.kills[team].length >= SOUL_AT && d.soul[team] < 0 && d.soulType >= 0) {
    d.soul[team] = d.soulType;
    d.elder = true;
  }
  if (d.elder) d.next = ELDER_ELEM;
  else if (d.total === 1) {
    d.next = pick(rng, [d.cur]);
    d.soulType = pick(rng, [d.cur, d.next]);
  } else if (d.total === 2) d.next = d.soulType;
  else d.next = pick(rng, [d.cur]);
}

/** Summed team bonus of a team's kills plus its soul. Keys are BonusStat names. */
export function drakeBonus(d: DrakeState | undefined, team: number): DrakeStats {
  const out: DrakeStats = {};
  if (!d || (team !== 0 && team !== 1)) return out;
  const add = (s: DrakeStats): void => {
    for (const k in s) out[k] = (out[k] ?? 0) + s[k]!;
  };
  for (const e of d.kills[team]) add(ELEMENTS[e]!.perKill);
  if (d.soul[team] >= 0) add(ELEMENTS[d.soul[team]]!.soul);
  return out;
}
