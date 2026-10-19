// Optional ban phase of the classic lobby (C5, FEATURE-GAP 4.3): the player bans up to MAX_BANS champions; bots that
// rolled a banned champion get the next free champion of their role (deterministic: lobby order), so the roll for
// everything else (names, ranks, playstyles) stays unchanged. Pure; the lobby applies it after classicConfig.
import type { PlayerSetup } from '../sim/types';
import { defaultRunes } from '../sim/items/runes';

/** LoL: five bans per team, ten in total; the player bans for both teams here. */
export const MAX_BANS = 10;

export function applyBans(players: PlayerSetup[], bans: ReadonlySet<string>, championsFor: (role: PlayerSetup['role']) => string[], all: readonly string[]): PlayerSetup[] {
  if (!bans.size) return players;
  const used = new Set(players.filter((p) => !bans.has(p.champion)).map((p) => p.champion));
  for (const p of players) {
    if (p.isHuman || !bans.has(p.champion)) continue;
    const pickFrom = (list: readonly string[]): string | undefined => list.find((c) => !bans.has(c) && !used.has(c));
    const next = pickFrom(championsFor(p.role)) ?? pickFrom(all);
    if (!next) continue; // every champion banned or taken: keep the roll rather than an invalid team
    p.champion = next;
    p.runes = defaultRunes(next); // the rolled page belonged to the banned champion
    used.add(next);
  }
  return players;
}

/** Toggle a ban; the player's own champion cannot be banned and at most MAX_BANS are kept. */
export function toggleBan(bans: Set<string>, id: string, own: string): void {
  if (id === own) return;
  if (bans.has(id)) bans.delete(id);
  else if (bans.size < MAX_BANS) bans.add(id);
}
