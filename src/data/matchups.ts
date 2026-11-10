// Champion-select matchup hints (data: matchups.json, generated lists by tools/matchups/generate.mjs).
// matchupOf(id) -> who this champion is strong / weak against, with the reason text in de/en.
import data from './matchups.json';

export interface MatchupEntry {
  /** Opposing champion id. */
  id: string;
  /** Relation key ("assassin>poke"); the reason text is in `reason`. */
  why: string;
  reason: { de: string; en: string };
}

export interface Matchup {
  /** Matchup class of the champion (poke, assassin, tank, ...) and its display name. */
  cls: string;
  clsName: { de: string; en: string };
  strong: MatchupEntry[];
  weak: MatchupEntry[];
}

type Raw = { id: string; why: string };
const D = data as unknown as {
  classInfo: Record<string, { de: string; en: string }>;
  relations: Record<string, { de: string; en: string }>;
  classes: Record<string, string>;
  champions: Record<string, { strong: Raw[]; weak: Raw[] }>;
};

const entry = (r: Raw): MatchupEntry => ({ ...r, reason: D.relations[r.why]! });

/** Matchup hints of a champion, or null for an unknown id. */
export function matchupOf(id: string): Matchup | null {
  const c = D.champions[id];
  const cls = D.classes[id];
  if (!c || !cls) return null;
  return { cls, clsName: D.classInfo[cls]!, strong: c.strong.map(entry), weak: c.weak.map(entry) };
}

/** Is `a` strong against `b` according to the class relations (ignores the 3-entry cap)? */
export const strongAgainst = (a: string, b: string): boolean => `${D.classes[a]}>${D.classes[b]}` in D.relations;
