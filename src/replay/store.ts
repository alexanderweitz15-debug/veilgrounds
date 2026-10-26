// Replay storage (S2, FEATURE-GAP 6.6): one blob per replay (`replay:v1:<id>`) plus an index of summary rows
// (`replays:v1`), capped like src/stats/history.ts (oldest dropped). IndexedDB via src/store/kv.ts; the backend is
// injectable so tests run without IndexedDB.
import { kvDel, kvGet, kvSet } from '../store/kv';
import type { Replay } from './replay';

export const REPLAY_CAP = 12;
const INDEX_KEY = 'replays:v1';
const blobKey = (id: string): string => `replay:v1:${id}`;

export interface ReplayMeta {
  /** Unique: time + champion. */
  id: string;
  /** Wall-clock ms when the game ended. */
  at: number;
  mode: string;
  champion: string;
  humanSlot: number;
  team: number;
  durationS: number;
  /** Human team won; null = not decided (trainer run). */
  win: boolean | null;
  kills: number;
  deaths: number;
  ticks: number;
  players: { slot: number; team: number; champion: string; role: string }[];
}

export interface Backend {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

const idb: Backend = { get: kvGet, set: kvSet, del: kvDel };

export function metaOf(r: Replay, at: number): ReplayMeta {
  const slot = r.humanSlot ?? 0;
  const me = r.config.players.find((p) => p.slot === slot) ?? r.config.players[0]!;
  const mk = r.markers ?? [];
  return {
    id: `${at.toString(36)}-${me.champion}`,
    at,
    mode: r.config.mode,
    champion: me.champion,
    humanSlot: slot,
    team: me.team,
    durationS: Math.round(r.ticks / 30),
    win: r.winner === undefined || r.winner === null ? null : r.winner === me.team,
    kills: mk.filter((m) => m.kind === 'kill' && m.killer === slot).length,
    deaths: mk.filter((m) => m.kind === 'kill' && m.victim === slot).length,
    ticks: r.ticks,
    players: r.config.players.map((p) => ({ slot: p.slot, team: p.team, champion: p.champion, role: p.role })),
  };
}

/** Index with `meta` added (newest last, oldest dropped beyond the cap); `dropped` = ids whose blob must go. */
export function addMeta(index: readonly ReplayMeta[], meta: ReplayMeta, cap = REPLAY_CAP): { index: ReplayMeta[]; dropped: string[] } {
  const all = [...index.filter((m) => m.id !== meta.id), meta].sort((a, b) => a.at - b.at);
  const cut = Math.max(0, all.length - cap);
  return { index: all.slice(cut), dropped: all.slice(0, cut).map((m) => m.id) };
}

export async function listReplays(b: Backend = idb): Promise<ReplayMeta[]> {
  return (await b.get<ReplayMeta[]>(INDEX_KEY)) ?? [];
}

export async function loadReplay(id: string, b: Backend = idb): Promise<Replay | undefined> {
  return b.get<Replay>(blobKey(id));
}

/** Stores a finished game's replay; returns its meta. */
export async function saveReplay(r: Replay, at = Date.now(), b: Backend = idb): Promise<ReplayMeta> {
  const meta = metaOf(r, at);
  await b.set(blobKey(meta.id), r);
  const { index, dropped } = addMeta(await listReplays(b), meta);
  await b.set(INDEX_KEY, index);
  for (const id of dropped) await b.del(blobKey(id));
  return meta;
}

export async function deleteReplay(id: string, b: Backend = idb): Promise<void> {
  await b.set(INDEX_KEY, (await listReplays(b)).filter((m) => m.id !== id));
  await b.del(blobKey(id));
}
