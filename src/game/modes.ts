// Game mode presets for the Phase 1 menu.
import type { RuneChoice } from '../sim/items/runes';
import { Lane, type PlayerSetup, type SimConfig, type TrainerOpts } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { BUILDS } from '../ai/bot/builds';
import type { Rank } from '../ai/profiles/schema';

/** Champion id of Mira Quell (src/data/champions/mira.json). */
export const MIRA_ID = 'mira';

/**
 * Beside the blue fountain (r=650 at 900,900): >= 1100 from every blue lane path (minions acquire at 500 + spread, so
 * the own waves no longer stop to hit it at the base) and ~1500 from the nearest blue tower (nexus towers included).
 */
export const SANDBOX_DUMMY = { x: 1700, y: 600 } as const;

export type ModeId = 'lane' | 'sandbox' | 'mock';

/**
 * Client settings that every mode's config carries (not only the classic lobby): bot toxicity applies to the bots of
 * trainers and duels too. A value the config already has (classic lobby, replays) wins.
 */
export function withClientSettings(config: SimConfig, s: { botToxicity: boolean; lang: 'de' | 'en' }): SimConfig {
  return {
    ...config,
    ...(config.botToxicity === undefined ? { botToxicity: s.botToxicity } : {}),
    // bot chat follows the UI language (output only, not part of the sim state)
    botLang: s.lang,
  };
}

export function configFor(mode: 'lane' | 'sandbox', runes?: RuneChoice, champion = MIRA_ID, summoners: [string, string] = ['sprung', 'heilen']): SimConfig {
  const player = {
    slot: 0,
    team: 0 as const,
    champion,
    role: 'mid' as const,
    summoners,
    isHuman: true,
    ...(runes ? { runes } : {}),
  };
  const seed = (Math.random() * 2 ** 31) | 0;
  if (mode === 'sandbox') return { seed, mode: 'sandbox', players: [player], dummies: [{ ...SANDBOX_DUMMY, team: 1 }] };
  return { seed, mode: 'laneOnly', players: [player] };
}

// ---------------------------------------------------------------- Phase 5 trainers

/** Trainer modes selectable from the trainer menu. */
export type TrainerMode = 'lastHit' | 'dodge' | 'kite' | 'laneDuel' | 'jungleDuel' | 'arena';
export const TRAINER_MODES: TrainerMode[] = ['lastHit', 'dodge', 'kite', 'laneDuel', 'jungleDuel', 'arena'];

export interface TrainerSetup {
  mode: TrainerMode;
  opts: TrainerOpts;
  /** Duel / arena opponents. */
  botRank?: Rank;
  /** Arena: champions per team (1..5). */
  teamSize?: number;
}

export interface TrainerPick {
  champion: string;
  summoners: [string, string];
  runes?: RuneChoice;
}

/** Deterministic champion pick for bots: role-fitting champions, not the player's, rotated by the seed. */
function botChampions(seed: number, role: PlayerSetup['role'], exclude: string[], n: number): string[] {
  const all = Object.keys(CHAMPION_DATA).sort();
  const fit = all.filter((id) => (CHAMPION_DATA[id]!.roles as readonly string[]).includes(role) && !exclude.includes(id));
  const pool = [...fit, ...all.filter((id) => !fit.includes(id) && !exclude.includes(id))];
  const out: string[] = [];
  for (let i = 0; out.length < n && i < pool.length; i++) out.push(pool[(seed + i * 7) % pool.length]!);
  return [...new Set(out)];
}

/** Boots + first two core items of the champion's standard build (arena preset). */
export function arenaItems(champion: string): string[] {
  const b = BUILDS[champion];
  return b ? [b.standard.boots, ...b.standard.core.slice(0, 2)] : [];
}

export function trainerConfig(t: TrainerSetup, pick: TrainerPick, seed = (Math.random() * 2 ** 31) | 0): SimConfig {
  const role: PlayerSetup['role'] = t.mode === 'jungleDuel' ? 'jungle' : 'mid';
  // jungle duel: Bannen (smite) is required for a fair race; it replaces the second spell if not picked
  const summoners: [string, string] = role === 'jungle' && !pick.summoners.includes('bannen') ? [pick.summoners[0], 'bannen'] : pick.summoners;
  const player: PlayerSetup = { slot: 0, team: 0, champion: pick.champion, role, summoners, isHuman: true, ...(pick.runes ? { runes: pick.runes } : {}) };
  const rank: Rank = t.botRank ?? 'gold';
  const bot = (slot: number, team: 0 | 1, champion: string, r: PlayerSetup['role']): PlayerSetup => ({
    slot, team, champion, role: r, summoners: r === 'jungle' ? ['bannen', 'sprung'] : ['sprung', 'heilen'], isHuman: false, bot: { rank, variance: 'normal' },
  });
  const trainer: TrainerOpts = { ...t.opts };
  switch (t.mode) {
    case 'lastHit':
      return { seed, mode: 'lastHit', players: [player], minionLanes: [Lane.Mid], ...(t.opts.tower ? { minionTeams: [1] } : {}), trainer };
    case 'dodge':
    case 'kite':
      return { seed, mode: t.mode, players: [player], minionsEnabled: false, trainer };
    case 'laneDuel': {
      const [enemy] = botChampions(seed, 'mid', [pick.champion], 1);
      return { seed, mode: 'laneDuel', players: [player, bot(5, 1, enemy!, 'mid')], minionLanes: [Lane.Mid], trainer };
    }
    case 'jungleDuel': {
      const [enemy] = botChampions(seed, 'jungle', [pick.champion], 1);
      return { seed, mode: 'jungleDuel', players: [player, bot(5, 1, enemy!, 'jungle')], minionsEnabled: false, trainer };
    }
    case 'arena': {
      const n = Math.max(1, Math.min(5, t.teamSize ?? 3));
      const champs = botChampions(seed, 'mid', [pick.champion], n * 2 - 1);
      const players: PlayerSetup[] = [player];
      for (let i = 1; i < n; i++) players.push(bot(i, 0, champs[i - 1]!, 'mid'));
      for (let i = 0; i < n; i++) players.push(bot(5 + i, 1, champs[n - 1 + i]!, 'mid'));
      const items: Record<string, string[]> = {};
      for (const p of players) items[String(p.slot)] = arenaItems(p.champion);
      return { seed, mode: 'arena', players, minionsEnabled: false, trainer: { ...trainer, items } };
    }
  }
}
