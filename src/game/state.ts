// Client-side view of the match: newest snapshot for positions, accumulated tallies from every snapshot's events.
import type { SnapEntity, Snapshot } from '../sim/snapshot';
import { Kind, TICK_HZ, type SimEvent } from '../sim/types';

const TICK_MS = 1000 / TICK_HZ;
/** Moves longer than this in one tick are teleports/respawns: snap, do not sweep across the map. */
const SNAP_DIST2 = 250 * 250;

export interface KillFeedEntry {
  at: number;
  text: string;
  team: number;
}

export class ClientState {
  snap: Snapshot | null = null;
  recvAt = 0;
  readonly byId = new Map<number, SnapEntity>();
  myTeam = 0;
  /** Champion kills scored by team i. */
  kills: [number, number] = [0, 0];
  /** Enemy towers destroyed by team i. */
  towers: [number, number] = [0, 0];
  winner: number | null = null;
  paused = false;
  /** Interpolation factor for the current frame (0..1), set by beginFrame. */
  alpha = 1;
  /** Interpolated positions for the current frame, keyed by eid. */
  readonly ix = new Map<number, number>();
  readonly iy = new Map<number, number>();

  /** Ingest one snapshot; returns its events for the fx/HUD dispatch. */
  ingest(s: Snapshot, now: number): SimEvent[] {
    this.snap = s;
    this.recvAt = now;
    this.myTeam = s.team;
    this.byId.clear();
    for (const e of s.entities) this.byId.set(e.id, e);
    for (const ev of s.events) {
      if (ev.e === 'death') {
        const scorer = ev.team === 0 ? 1 : 0;
        if (ev.kind === Kind.Champion && ev.team <= 1) this.kills[scorer]++;
        if (ev.kind === Kind.Tower && ev.team <= 1) this.towers[scorer]++;
      } else if (ev.e === 'gameOver') this.winner = ev.winner;
    }
    return s.events;
  }

  beginFrame(now: number): void {
    this.alpha = this.paused ? 1 : Math.min(1, Math.max(0, (now - this.recvAt) / TICK_MS));
    this.ix.clear();
    this.iy.clear();
    if (!this.snap) return;
    const a = this.alpha;
    for (const e of this.snap.entities) {
      const dx = e.x - e.px;
      const dy = e.y - e.py;
      const jump = dx * dx + dy * dy > SNAP_DIST2;
      this.ix.set(e.id, jump ? e.x : e.px + dx * a);
      this.iy.set(e.id, jump ? e.y : e.py + dy * a);
    }
  }

  me(): SnapEntity | undefined {
    const m = this.snap?.me;
    return m ? this.byId.get(m.eid) : undefined;
  }

  x(e: SnapEntity): number {
    return this.ix.get(e.id) ?? e.x;
  }
  y(e: SnapEntity): number {
    return this.iy.get(e.id) ?? e.y;
  }
}
