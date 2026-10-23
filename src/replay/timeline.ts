// Pure helpers for the replay timeline: score tallies at a tick (ClientState after a seek), marker lookup, time format.
import type { Replay, ReplayMarker } from './replay';

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;

export interface Tally {
  /** Champion kills / towers scored by team i. */
  kills: [number, number];
  towers: [number, number];
  /** Tick of the last Leviathan / Schleierwaechter kill before the position (-1 = none). */
  epic: { leviathan: number; schleier: number };
}

/** Score state at `tick` from the recorded markers (a marker counts once its tick is below `tick`). */
export function tallyAt(markers: readonly ReplayMarker[], tick: number): Tally {
  const t: Tally = { kills: [0, 0], towers: [0, 0], epic: { leviathan: -1, schleier: -1 } };
  for (const m of markers) {
    if (m.tick >= tick) break;
    if (m.kind === 'kill') t.kills[m.team === 1 ? 1 : 0]++;
    else if (m.kind === 'tower') t.towers[m.team === 1 ? 1 : 0]++;
    else if (m.kind === 'epic') {
      if (m.champ === 'leviathan') t.epic.leviathan = m.tick;
      else if (m.champ === 'schleierwaechter') t.epic.schleier = m.tick;
    }
  }
  return t;
}

/** mm:ss of a tick. */
export function clockOf(tick: number): string {
  const s = Math.max(0, Math.floor(tick / 30));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Marker nearest to `tick` within `within` ticks, else undefined. */
export function nearestMarker(markers: readonly ReplayMarker[], tick: number, within: number): ReplayMarker | undefined {
  let best: ReplayMarker | undefined;
  for (const m of markers) {
    const d = Math.abs(m.tick - tick);
    if (d <= within && (!best || d < Math.abs(best.tick - tick))) best = m;
  }
  return best;
}

/** Lead-in before a jump target so the viewer sees the situation develop (5 s). */
export const LEAD_IN_TICKS = 150;

/** Tick to open the replay at for a moment at `tick` (clamped to the replay). */
export function momentTick(r: Pick<Replay, 'ticks'>, tick: number): number {
  return Math.max(0, Math.min(r.ticks, tick - LEAD_IN_TICKS));
}
