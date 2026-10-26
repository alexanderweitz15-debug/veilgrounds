// Post-game error list (S2, FEATURE-GAP 6.3): the bots' named errors and attention windows (Replay.botLog, slimmed by
// slimBotLog) next to the player's own patterns (Replay.player, src/stats/playerPatterns.ts). Pure data, no DOM; the
// post-game screen renders it and every row jumps to its moment in the replay.
import type { Replay } from '../replay/replay';
import type { PatternEvent } from './playerPatterns';

export interface BotError {
  slot: number;
  champ: string;
  /** errors.json id. */
  id: string;
  tick: number;
  /** How long the bot stayed in the mistake before it noticed (injected duration), seconds. */
  durS: number;
  /** Seconds until the bot noticed; null = never noticed before the game ended. */
  detectedAfterS: number | null;
  /** The bot said "My bad". */
  myBad: boolean;
}

export interface BotAttention {
  slot: number;
  champ: string;
  windows: number;
  distractedS: number;
  /** Share of the game spent distracted, 0..100. */
  pct: number;
  /** Most frequent cause (minimap, killfeed, shop, chat, random, tilt). */
  top: string;
  /** Tick of the longest window (jump target). */
  longestTick: number;
}

export interface ErrorList {
  bots: BotError[];
  attention: BotAttention[];
  you: PatternEvent[];
}

interface Line {
  tick: number;
  bot: number;
  node: string;
  chosen: string;
  inputs?: Record<string, number | string | boolean>;
}

const TPS = 30;
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function buildErrorList(r: Replay): ErrorList {
  const champ = (slot: number): string => r.config.players.find((p) => p.slot === slot)?.champion ?? '?';
  const lines: Line[] = [];
  for (const l of (r.botLog ?? '').split('\n')) {
    if (!l) continue;
    try {
      lines.push(JSON.parse(l) as Line);
    } catch {
      /* damaged line: skip */
    }
  }
  lines.sort((a, b) => a.tick - b.tick);

  const bots: BotError[] = [];
  const open = new Map<string, BotError>(); // `${slot}|${id}` -> latest undetected error
  const att = new Map<number, { windows: number; ticks: number; until: number; longest: number; longestTick: number; why: Record<string, number> }>();
  for (const l of lines) {
    if (l.node === 'error') {
      if (l.chosen.startsWith('detected:')) {
        const e = open.get(`${l.bot}|${l.chosen.slice(9)}`);
        if (e) {
          e.detectedAfterS = r1((l.tick - e.tick) / TPS);
          e.myBad = l.inputs?.myBad === true;
          open.delete(`${l.bot}|${e.id}`);
        }
      } else {
        const e: BotError = { slot: l.bot, champ: champ(l.bot), id: l.chosen, tick: l.tick, durS: Number(l.inputs?.durS ?? 0), detectedAfterS: null, myBad: false };
        bots.push(e);
        open.set(`${l.bot}|${l.chosen}`, e);
      }
    } else if (l.node === 'attention') {
      const a = att.get(l.bot) ?? { windows: 0, ticks: 0, until: 0, longest: 0, longestTick: 0, why: {} };
      att.set(l.bot, a);
      const until = Number(l.inputs?.until ?? l.tick);
      const reason = String(l.inputs?.reason ?? 'random');
      if (l.chosen.includes('+')) {
        a.ticks += Math.max(0, until - a.until); // window extended
      } else {
        a.windows++;
        a.ticks += Math.max(0, until - l.tick);
        a.longestTick = a.longest >= until - l.tick ? a.longestTick : l.tick;
        a.longest = Math.max(a.longest, until - l.tick);
      }
      a.until = until;
      a.why[reason] = (a.why[reason] ?? 0) + 1;
    }
  }
  const attention: BotAttention[] = [...att].map(([slot, a]) => ({
    slot,
    champ: champ(slot),
    windows: a.windows,
    distractedS: r1(a.ticks / TPS),
    pct: Math.min(100, Math.round((a.ticks / Math.max(1, r.ticks)) * 100)),
    top: Object.entries(a.why).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'random',
    longestTick: a.longestTick,
  }));
  attention.sort((a, b) => b.pct - a.pct);
  return { bots, attention, you: [...(r.player ?? [])].sort((a, b) => a.tick - b.tick) };
}
