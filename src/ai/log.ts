// Decision log (spec-bots §1, §10): one entry per bot decision, capped per game (entries and bytes, oldest
// dropped), serialisable to NDJSON for replays (Replay.botLog) and the F9 overlay. Plus the fog-of-war checker for
// spec test 7: positions in inputs follow the convention documented on DecisionLogEntry.inputs (contract.ts).

import type { Snapshot } from '../sim/snapshot';
import { Kind } from '../sim/types';
import type { DecisionLog, DecisionLogEntry, ErrorId } from './contract';

const MAX_INPUT_KEYS = 32;
const MAX_SCORE_KEYS = 16;
const MAX_STR = 80;
const MAX_REASON = 200;

const round2 = (v: number): number => (Number.isInteger(v) ? v : Math.round(v * 100) / 100);
const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Shortened copy: capped key counts, rounded numbers, truncated strings (spec §10 "inputs (gekürzt)"). */
export function shortenEntry(e: DecisionLogEntry): DecisionLogEntry {
  const inputs: DecisionLogEntry['inputs'] = {};
  let n = 0;
  for (const [k, v] of Object.entries(e.inputs)) {
    if (n++ >= MAX_INPUT_KEYS) break;
    inputs[k] = typeof v === 'number' ? round2(v) : typeof v === 'string' ? cut(v, MAX_STR) : v;
  }
  const out: DecisionLogEntry = { tick: e.tick, bot: e.bot, node: cut(e.node, MAX_STR), inputs, chosen: cut(e.chosen, MAX_STR), reason: cut(e.reason, MAX_REASON) };
  if (e.scores) {
    const top = Object.entries(e.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SCORE_KEYS);
    out.scores = Object.fromEntries(top.map(([k, v]) => [cut(k, MAX_STR), round2(v)]));
  }
  if (e.injectedError) out.injectedError = e.injectedError;
  if (e.perceptionAgeMs !== undefined) out.perceptionAgeMs = Math.round(e.perceptionAgeMs);
  if (e.reactionMs !== undefined) out.reactionMs = Math.round(e.reactionMs);
  return out;
}

/** Per-game log. Spec cap 50 MB per game; ponytail: in-memory only, persisted with the replay (no IndexedDB rotation). */
export class BotDecisionLog implements DecisionLog {
  private buf: DecisionLogEntry[] = [];
  private sizes: number[] = [];
  private start = 0;
  private bytes = 0;
  /** Entries dropped by the caps (oldest first). */
  dropped = 0;

  constructor(
    readonly maxEntries = 100_000,
    readonly maxBytes = 50 * 1024 * 1024,
  ) {}

  push(e: DecisionLogEntry): void {
    const s = shortenEntry(e);
    const size = JSON.stringify(s).length + 1;
    this.buf.push(s);
    this.sizes.push(size);
    this.bytes += size;
    while (this.length > this.maxEntries || (this.bytes > this.maxBytes && this.length > 1)) {
      this.bytes -= this.sizes[this.start]!;
      this.start++;
      this.dropped++;
    }
    // compact the dead head now and then (amortised O(1))
    if (this.start > 1024 && this.start * 2 > this.buf.length) {
      this.buf = this.buf.slice(this.start);
      this.sizes = this.sizes.slice(this.start);
      this.start = 0;
    }
  }

  get length(): number {
    return this.buf.length - this.start;
  }

  /** Approximate NDJSON size in bytes. */
  get byteSize(): number {
    return this.bytes;
  }

  entries(bot?: number, fromTick = -Infinity): readonly DecisionLogEntry[] {
    const out: DecisionLogEntry[] = [];
    for (let i = this.start; i < this.buf.length; i++) {
      const e = this.buf[i]!;
      if ((bot === undefined || e.bot === bot) && e.tick >= fromTick) out.push(e);
    }
    return out;
  }

  /** Newest entry of a bot matching `pred` (scans backwards). */
  latest(bot: number, pred: (e: DecisionLogEntry) => boolean = () => true): DecisionLogEntry | undefined {
    for (let i = this.buf.length - 1; i >= this.start; i--) {
      const e = this.buf[i]!;
      if (e.bot === bot && pred(e)) return e;
    }
    return undefined;
  }

  /** One JSON object per line (logs/bots/<game>.ndjson, Replay.botLog). */
  toNDJSON(): string {
    let s = '';
    for (let i = this.start; i < this.buf.length; i++) s += JSON.stringify(this.buf[i]) + '\n';
    return s;
  }

  static fromNDJSON(text: string): DecisionLogEntry[] {
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as DecisionLogEntry);
  }
}

// ------------------------------------------------------------------ F9 overlay rows

/** Static facts about a bot for the overlay (runner side). */
export interface BotDebugInfo {
  slot: number;
  champ: string;
  rank: string;
  skill: number;
  archetype: string | null;
  rolled: boolean;
  /** Current behaviour mode (BotMemory.mode). */
  mode: string;
}

export interface BotDebugRow extends BotDebugInfo {
  tick: number;
  node: string;
  chosen: string;
  reason: string;
  /** Top 3 scores of the latest decision, highest first. */
  topScores: [string, number][];
  /** Latest injected error and its tick (if any). */
  injectedError?: ErrorId;
  errorTick?: number;
  reactionMs?: number;
  perceptionAgeMs?: number;
}

/** Overlay rows: latest decision per bot plus the latest injected error / reaction time. */
export function debugRows(log: BotDecisionLog, bots: readonly BotDebugInfo[]): BotDebugRow[] {
  return bots.map((b) => {
    const last = log.latest(b.slot);
    const err = log.latest(b.slot, (e) => !!e.injectedError);
    const react = log.latest(b.slot, (e) => e.reactionMs !== undefined);
    const age = log.latest(b.slot, (e) => e.perceptionAgeMs !== undefined);
    const row: BotDebugRow = {
      ...b,
      tick: last?.tick ?? -1,
      node: last?.node ?? '-',
      chosen: last?.chosen ?? '-',
      reason: last?.reason ?? '',
      topScores: last?.scores ? (Object.entries(last.scores).sort((x, y) => y[1] - x[1]).slice(0, 3) as [string, number][]) : [],
    };
    if (err) [row.injectedError, row.errorTick] = [err.injectedError, err.tick];
    if (react) row.reactionMs = react.reactionMs;
    if (age) row.perceptionAgeMs = age.perceptionAgeMs;
    return row;
  });
}

// ------------------------------------------------------------------ fog-of-war convention checker (spec test 7)

export const POSITION_SOURCES = ['seen', 'cloud', 'self', 'ally', 'static'] as const;
export type PositionSource = (typeof POSITION_SOURCES)[number];

/** Team-visibility history: where each team saw each enemy champion (from fog-filtered snapshots). */
export class SightingHistory {
  private readonly bySlot = new Map<string, { tick: number; x: number; y: number }[]>();

  record(team: number, slot: number, tick: number, x: number, y: number): void {
    const k = `${team}:${slot}`;
    let l = this.bySlot.get(k);
    if (!l) this.bySlot.set(k, (l = []));
    l.push({ tick, x, y });
  }

  /** Records every visible enemy champion of a snapshot (the snapshot is already fog-filtered for snap.team). */
  recordSnapshot(snap: Snapshot): void {
    for (const e of snap.entities) if (e.kind === Kind.Champion && e.team !== snap.team && e.alive) this.record(snap.team, e.slot, snap.tick, e.x, e.y);
  }

  /** Did `team` see enemy `slot` within `tol` of (x, y) at or before `tick`? */
  seenNear(team: number, slot: number, tick: number, x: number, y: number, tol: number): boolean {
    const l = this.bySlot.get(`${team}:${slot}`);
    if (!l) return false;
    const t2 = tol * tol;
    return l.some((s) => s.tick <= tick && (s.x - x) ** 2 + (s.y - y) ** 2 <= t2);
  }
}

export interface FogViolation {
  entry: DecisionLogEntry;
  key: string;
  problem: string;
}

/**
 * Checks every position in the entries' inputs against the convention (contract.ts DecisionLogEntry.inputs) and
 * the team's sightings: untagged X/Y pairs, unknown sources, 'seen' positions the team never saw there,
 * 'cloud' positions without a radius. teamOf maps a bot slot to its team (default: slots 0-4 blue).
 */
export function checkFogConvention(
  entries: readonly DecisionLogEntry[],
  sightings: SightingHistory,
  teamOf: (botSlot: number) => number = (s) => (s < 5 ? 0 : 1),
  tol = 60,
): FogViolation[] {
  const out: FogViolation[] = [];
  for (const e of entries) {
    const inp = e.inputs;
    for (const k of Object.keys(inp)) {
      if (!k.endsWith('X') || k.length < 2) continue;
      const p = k.slice(0, -1);
      const x = inp[k];
      const y = inp[`${p}Y`];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      const src = inp[`${p}Src`];
      const bad = (problem: string): void => void out.push({ entry: e, key: p, problem });
      if (src === undefined) bad('position without Src tag');
      else if (!(POSITION_SOURCES as readonly unknown[]).includes(src)) bad(`unknown Src "${String(src)}"`);
      else if (src === 'seen') {
        const slot = inp[`${p}Slot`];
        if (typeof slot !== 'number') bad("'seen' position without Slot");
        else if (!sightings.seenNear(teamOf(e.bot), slot, e.tick, x, y, tol)) bad(`enemy ${slot} at ${Math.round(x)},${Math.round(y)} never seen by the team`);
      } else if (src === 'cloud') {
        const r = inp[`${p}R`];
        if (typeof r !== 'number' || !(r > 0)) bad("'cloud' position without radius R > 0");
      }
    }
  }
  return out;
}
