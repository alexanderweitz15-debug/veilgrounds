// Client-side match recorder for the post-game analysis (Phase 5): samples the own champion from every snapshot
// (CS, gold earned, level), own deaths and kills with time, damage dealt/taken per minute. Reads only fog-filtered
// snapshots, never the sim; no influence on the simulation or replays.
import type { Snapshot } from '../sim/snapshot';
import type { TrainerHud } from '../sim/trainer';
import { Kind, type SimConfig } from '../sim/types';
import { epicOf } from './objectives';

export interface StatSample {
  t: number;
  cs: number;
  gold: number;
  level: number;
  /** Cumulative XP (C6). */
  xp?: number;
  /** Item-value lead of the own team over the enemy team (both public in the scoreboard; C6). */
  lead?: number;
  /** Active player wards of the own team (vision proxy until the sim reports a vision score; C6). */
  wards?: number;
}

/** Objective moments for the post-game timeline (C6): towers / inhibitors destroyed, epic monsters slain. */
export interface ObjectiveMark {
  t: number;
  kind: 'tower' | 'inhib' | 'leviathan' | 'kesselbrut' | 'schleier';
  /** Scored by the own team. */
  own: boolean;
}

export interface MatchSummary {
  mode: SimConfig['mode'] | 'mock';
  champion: string;
  duration: number;
  samples: StatSample[];
  deaths: number[];
  kills: number[];
  /** Per minute (index = minute): damage dealt to champions, to everything, taken. */
  dealtChamp: number[];
  dealtAll: number[];
  taken: number[];
  winner: number | null;
  team: number;
  trainer: TrainerHud | null;
  /** Objective timeline (C6); absent in older summaries. */
  objectives?: ObjectiveMark[];
  /** Challenger-Geist timeline (src/ai/ghost.ts), absent if the mode has no ghost. */
  ghost?: import('../ai/ghost').GhostMoment[];
}

const SAMPLE_EVERY = 5; // seconds

export class MatchStats {
  private readonly s: MatchSummary;
  private nextSample = 0;
  private latest: StatSample | null = null;
  /** Champion eids seen so far (champion eids are never recycled): the killing blow's target is no longer in the snapshot. */
  private readonly champs = new Set<number>();
  /** Last seen radius / type per monster eid: tells epic monsters from camps near the pits (objective timeline). */
  private readonly monsters = new Map<number, { radius: number; variant?: string }>();

  constructor(config: SimConfig | null) {
    this.s = {
      mode: config?.mode ?? 'mock',
      champion: config?.players.find((p) => p.isHuman)?.champion ?? '',
      duration: 0,
      samples: [],
      deaths: [],
      kills: [],
      dealtChamp: [],
      dealtAll: [],
      taken: [],
      winner: null,
      team: 0,
      trainer: null,
      objectives: [],
    };
  }

  ingest(snap: Snapshot): void {
    const me = snap.me;
    const s = this.s;
    // match / trainer run over: the stats are final (a few more snapshots arrive before the sim stops)
    if (s.winner !== null || s.trainer?.done) return;
    for (const e of snap.entities) {
      if (e.kind === Kind.Champion) this.champs.add(e.id);
      else if (e.kind === Kind.Monster) this.monsters.set(e.id, { radius: e.radius, variant: e.variant });
    }
    for (const ev of snap.events) if (ev.e === 'death' && ev.kind === Kind.Champion) this.champs.add(ev.eid);
    s.duration = snap.time;
    s.team = snap.team;
    if (snap.trainer) s.trainer = snap.trainer;
    if (!me) return;
    let lead = 0;
    for (const p of snap.players) lead += p.team === snap.team ? p.itemValue : -p.itemValue;
    const wards = snap.entities.filter((e) => e.kind === Kind.Ward && e.ward && e.alive && e.team === snap.team).length;
    this.latest = { t: snap.time, cs: me.cs, gold: me.totalGold ?? me.gold, level: me.level, xp: me.xp, lead, wards };
    if (snap.time >= this.nextSample) {
      s.samples.push(this.latest);
      this.nextSample = Math.floor(snap.time / SAMPLE_EVERY) * SAMPLE_EVERY + SAMPLE_EVERY;
    }
    const minute = Math.floor(snap.time / 60);
    const add = (arr: number[], v: number): void => {
      while (arr.length <= minute) arr.push(0);
      arr[minute] = arr[minute]! + v;
    };
    for (const ev of snap.events) {
      if (ev.e === 'damage') {
        if (ev.src === me.eid) {
          add(s.dealtAll, ev.amount);
          if (this.champs.has(ev.dst)) add(s.dealtChamp, ev.amount);
        }
        if (ev.dst === me.eid) add(s.taken, ev.amount);
      } else if (ev.e === 'death' && ev.kind === Kind.Champion) {
        if (ev.eid === me.eid) s.deaths.push(snap.time);
        else if (ev.killer === me.eid) s.kills.push(snap.time);
      } else if (ev.e === 'death' && (ev.kind === Kind.Tower || ev.kind === Kind.Inhibitor) && ev.team <= 1) {
        s.objectives!.push({ t: snap.time, kind: ev.kind === Kind.Tower ? 'tower' : 'inhib', own: ev.team !== snap.team });
      } else if (ev.e === 'death' && ev.kind === Kind.Monster && (ev.killerTeam === 0 || ev.killerTeam === 1)) {
        const m = this.monsters.get(ev.eid);
        const which = epicOf(ev, m?.radius, m?.variant, snap.time);
        if (which) s.objectives!.push({ t: snap.time, kind: which, own: ev.killerTeam === snap.team });
      } else if (ev.e === 'gameOver') s.winner = ev.winner;
    }
  }

  /** Final summary (adds a closing sample). */
  summary(): MatchSummary {
    const s = this.s;
    const last = s.samples[s.samples.length - 1];
    if (this.latest && last && last.t < this.latest.t) s.samples.push(this.latest);
    for (const arr of [s.dealtAll, s.dealtChamp, s.taken]) while (arr.length < Math.ceil(s.duration / 60)) arr.push(0);
    return structuredClone(s);
  }
}
