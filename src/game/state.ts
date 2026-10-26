// Client-side view of the match: newest snapshot for positions, accumulated tallies from every snapshot's events.
import type { SnapEntity, Snapshot } from '../sim/snapshot';
import { Kind, TICK_HZ, type PingKind, type SimEvent } from '../sim/types';
import { ObjectiveTracker } from './objectives';
import { CampTimers } from './campTimers';
import { JungleTracker } from './jungleTracker';

const TICK_MS = 1000 / TICK_HZ;
/** Moves longer than this in one tick are teleports/respawns: snap, do not sweep across the map. */
const SNAP_DIST2 = 250 * 250;
/** Render this many ticks behind the newest snapshot (absorbs delivery jitter; +16 ms input-to-screen latency). */
const BUFFER_TICKS = 0.5;
/**
 * G/A4: a snapshot later than the buffer no longer freezes the scene: units keep their last tick velocity for up to
 * this many ticks past the segment end (measured first-minute jitter p99 28 ms, max 71 ms vs. the 17 ms buffer).
 * Small cap: a unit that stopped on that tick overshoots by at most half a step (~5 u) and settles on the next one.
 */
export const EXTRAPOLATE_TICKS = 0.5;

type DeathEvent = Extract<SimEvent, { e: 'death' }>;

/** Victim champion id of a death event (the event carries it; older events fall back to the last-seen entity). */
export function deathVictimChamp(ev: DeathEvent, state: ClientState): string | null {
  return ev.champ ?? state.entity(ev.eid)?.champ ?? null;
}

/** Killer champion id of a champion kill by an enemy champion, else null (tower/minion/monster execution). */
export function deathKillerChamp(ev: DeathEvent, state: ClientState): string | null {
  if (ev.killerChamp !== undefined) return ev.killerTeam !== ev.team ? ev.killerChamp : null;
  const k = ev.killer >= 0 ? state.entity(ev.killer) : undefined;
  return k && k.kind === Kind.Champion && k.team !== ev.team ? k.champ : null;
}

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
  /** Live team pings (newest last), kept for PING_KEEP_MS. */
  pings: { id: number; kind: PingKind; x: number; y: number; slot: number; target: number; at: number; label?: string }[] = [];
  private pingSeq = 0;
  paused = false;
  /** Interpolation factor for the current frame (0..1), set by beginFrame. */
  alpha = 1;
  /** Snapshot arrival baseline in ms (see ingest). */
  private base = Number.NaN;
  private readonly prev2 = new Map<number, [number, number]>();
  /** Units whose auto attack fired in the newest snapshot (wind-up -> backswing). */
  readonly fired: SnapEntity[] = [];
  private readonly phase = new Map<number, number>();
  /** Interpolated positions for the current frame, keyed by eid. */
  readonly ix = new Map<number, number>();
  readonly iy = new Map<number, number>();
  /**
   * Last snapshot entity seen per eid (kind/team/champ of units that are now hidden or dead), for the death recap
   * and announcements. Minion eids get reused; the entry is overwritten when the new unit is seen.
   */
  readonly known = new Map<number, SnapEntity>();
  /** Slots muted with /mute (chat lines and pings hidden locally; C4). */
  readonly muted = new Set<number>();
  /** Tick a champion (eid) was last in the snapshot: minimap "last seen" ghosts (C3). */
  readonly seenAt = new Map<number, number>();
  /** Respawn timers, Leviathan/Kesselbrut/Schleierwaechter, inhibitor respawns of both teams (scoreboard, C2). */
  readonly objectives = new ObjectiveTracker();
  /** Respawn timers of the normal camps seen cleared (context pings). */
  readonly camps = new CampTimers();
  /** Jungle camp timers from what this team saw (jungleTracker.ts); minimap, world labels and the Jungle-Tracker panel read it. */
  readonly jungle = new JungleTracker();

  /** Replay seek: forget everything derived from earlier snapshots (the next snapshot is not a successor of the last). */
  resetForSeek(): void {
    this.snap = null;
    this.byId.clear();
    this.prev2.clear();
    this.phase.clear();
    this.fired.length = 0;
    this.known.clear();
    this.seenAt.clear();
    this.pings.length = 0;
    this.kills = [0, 0];
    this.towers = [0, 0];
    this.winner = null;
    this.base = Number.NaN;
  }

  /** Ingest one snapshot; returns its events for the fx/HUD dispatch. */
  ingest(s: Snapshot, now: number): SimEvent[] {
    // positions two ticks back (= previous snapshot's px) for the interpolation buffer
    this.prev2.clear();
    if (this.snap && s.tick === this.snap.tick + 1) for (const e of this.snap.entities) this.prev2.set(e.id, [e.px, e.py]);
    this.snap = s;
    this.recvAt = now;
    // Arrival clock: earliest observed (arrival - tick * TICK_MS). Interpolating against this steady clock instead of
    // "time since the last message" removes the stutter of early/late/bursty snapshot delivery. Early arrivals pull
    // the baseline down at once, late ones raise it slowly (clock drift); big jumps (pause, speed change) reset it.
    const m = now - s.tick * TICK_MS;
    if (Number.isNaN(this.base) || m < this.base || m - this.base > 250) this.base = m;
    else this.base += (m - this.base) * 0.02;
    this.myTeam = s.team;
    this.byId.clear();
    // autos that left the wind-up this snapshot (phase 1 -> 2 = projectile launch / melee hit): fire sounds
    this.fired.length = 0;
    for (const e of s.entities) {
      if (e.atkPhase === 2 && this.phase.get(e.id) === 1) this.fired.push(e);
      this.phase.set(e.id, e.atkPhase);
    }
    if (this.phase.size > s.entities.length * 4) for (const id of this.phase.keys()) if (!s.entities.some((e) => e.id === id)) this.phase.delete(id);
    for (const e of s.entities) {
      this.byId.set(e.id, e);
      this.known.set(e.id, e);
      if (e.kind === Kind.Champion) this.seenAt.set(e.id, s.tick);
    }
    for (const ev of s.events) {
      if (ev.e === 'death') {
        const scorer = ev.team === 0 ? 1 : 0;
        if (ev.kind === Kind.Champion && ev.team <= 1) this.kills[scorer]++;
        if (ev.kind === Kind.Tower && ev.team <= 1) this.towers[scorer]++;
        if (ev.kind === Kind.Monster && !ev.epic) this.camps.noteDeath(ev.x, ev.y, s.tick - 1);
      } else if (ev.e === 'gameOver') this.winner = ev.winner;
      else if (ev.e === 'ping' && !this.muted.has(ev.slot)) this.pings.push({ id: ++this.pingSeq, kind: ev.kind, x: ev.x, y: ev.y, slot: ev.slot, target: ev.target, at: now, ...(ev.label ? { label: ev.label } : {}) });
    }
    this.objectives.ingest(s, (eid) => this.known.get(eid));
    this.jungle.ingest(s, (eid) => this.known.get(eid));
    return s.events;
  }

  beginFrame(now: number): void {
    while (this.pings.length && now - this.pings[0]!.at > 3000) this.pings.shift();
    // ticks since the newest snapshot was due, minus a half-tick buffer: a snapshot up to ~16 ms late no longer
    // freezes units (they are still moving through the previous segment)
    const v = this.snap && !this.paused ? (now - this.base) / TICK_MS - this.snap.tick - BUFFER_TICKS : 1;
    this.alpha = Math.min(1, Math.max(0, v));
    this.ix.clear();
    this.iy.clear();
    if (!this.snap) return;
    // past the segment end: extrapolate a little instead of standing still (a > 1 only when the snapshot is late)
    const a = this.paused ? this.alpha : Math.min(1 + EXTRAPOLATE_TICKS, Math.max(0, v));
    const b = Math.max(0, v + 1); // position inside the previous segment (tick-2 .. tick-1) while v < 0
    for (const e of this.snap.entities) {
      const dx = e.x - e.px;
      const dy = e.y - e.py;
      if (dx * dx + dy * dy > SNAP_DIST2) {
        this.ix.set(e.id, e.x);
        this.iy.set(e.id, e.y);
        continue;
      }
      const p2 = v < 0 ? this.prev2.get(e.id) : undefined;
      if (p2 && (e.px - p2[0]) ** 2 + (e.py - p2[1]) ** 2 <= SNAP_DIST2) {
        this.ix.set(e.id, p2[0] + (e.px - p2[0]) * b);
        this.iy.set(e.id, p2[1] + (e.py - p2[1]) * b);
      } else {
        this.ix.set(e.id, e.px + dx * a);
        this.iy.set(e.id, e.py + dy * a);
      }
    }
  }

  /** Entity of this snapshot, else the last one seen with that eid (units that died or vanished into the fog). */
  entity(eid: number): SnapEntity | undefined {
    return this.byId.get(eid) ?? this.known.get(eid);
  }

  /**
   * Enemy champions that are alive (scoreboard) but not in the current snapshot, at their last seen position, seen at
   * most `maxAge` seconds ago (minimap ghosts). Fog-safe: only positions this team actually saw.
   */
  lastSeenEnemies(maxAge: number): { champ: string; x: number; y: number; age: number }[] {
    const snap = this.snap;
    if (!snap) return [];
    const out: { champ: string; x: number; y: number; age: number }[] = [];
    for (const [eid, at] of this.seenAt) {
      if (this.byId.has(eid)) continue;
      const e = this.known.get(eid);
      if (!e || e.kind !== Kind.Champion || e.team === this.myTeam || !e.champ) continue;
      const age = (snap.tick - at) / TICK_HZ;
      if (age > maxAge) continue;
      const row = snap.players.find((p) => p.team === e.team && p.champ === e.champ);
      if (!row || row.dead) continue;
      out.push({ champ: e.champ, x: e.x, y: e.y, age });
    }
    return out;
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
