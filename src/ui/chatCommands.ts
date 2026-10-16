// Chat commands (C4, LoL): /help, /mute <name|all>, /unmute <name|all>, /ff and /surrender, /all <text>.
// Pure parser: the chat box executes the result (mute = hide that player's chat lines and pings locally).
import type { PlayerSetup } from '../sim/types';
import { champName } from './names';

export type ChatAction =
  | { kind: 'send'; text: string }
  | { kind: 'help' }
  | { kind: 'mute'; slots: number[]; on: boolean; unknown?: string }
  | { kind: 'surrender' }
  | { kind: 'all'; text: string }
  | { kind: 'unknown'; cmd: string };

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Slots matching a name: bot name or champion name (case/accent-insensitive prefix), never the own slot. */
export function matchPlayers(name: string, players: readonly PlayerSetup[], mySlot: number): number[] {
  const n = norm(name);
  if (!n) return [];
  const others = players.filter((p) => p.slot !== mySlot);
  if (n === 'all' || n === 'alle') return others.map((p) => p.slot);
  const exact = others.filter((p) => norm(p.bot?.name ?? '') === n || norm(champName(p.champion)) === n || norm(p.champion) === n);
  if (exact.length) return exact.map((p) => p.slot);
  return others.filter((p) => norm(p.bot?.name ?? '').startsWith(n) || norm(champName(p.champion)).startsWith(n)).map((p) => p.slot);
}

export function parseChat(raw: string, players: readonly PlayerSetup[], mySlot: number): ChatAction {
  const text = raw.trim();
  if (!text.startsWith('/')) return { kind: 'send', text };
  const [cmd = '', ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd.toLowerCase()) {
    case 'help':
    case 'hilfe':
    case '?':
      return { kind: 'help' };
    case 'mute':
    case 'unmute': {
      const slots = matchPlayers(arg, players, mySlot);
      return { kind: 'mute', slots, on: cmd.toLowerCase() === 'mute', ...(slots.length ? {} : { unknown: arg }) };
    }
    case 'ff':
    case 'surrender':
    case 'aufgeben':
      return { kind: 'surrender' };
    case 'all':
      return { kind: 'all', text: arg };
    default:
      return { kind: 'unknown', cmd };
  }
}
