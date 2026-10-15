// Client-side match recorder for the post-game analysis (Phase 5): samples the own champion from every snapshot
// (CS, gold earned, level), own deaths and kills with time, damage dealt/taken per minute. Reads only fog-filtered
// snapshots, never the sim; no influence on the simulation or replays.
import type { Snapshot } from '../sim/snapshot';
import type { TrainerHud } from '../sim/trainer';
import { Kind, type SimConfig } from '../sim/types';

export interface StatSample {
  t: number;
  cs: number;
  gold: number;
  level: number;
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
}

const SAMPLE_EVERY = 5; // seconds

export class MatchStats {
  private readonly s: MatchSummary;
  private nextSample = 0;
  private latest: StatSample | null = null;

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
    };
  }

  ingest(snap: Snapshot): void {
    const me = snap.me;
    const s = this.s;
    s.duration = snap.time;
    s.team = snap.team;
    if (snap.trainer) s.trainer = snap.trainer;
    if (!me) return;
    this.latest = { t: snap.time, cs: me.cs, gold: me.totalGold ?? me.gold, level: me.level };
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
          const dst = snap.entities.find((e) => e.id === ev.dst);
          if (dst?.kind === Kind.Champion) add(s.dealtChamp, ev.amount);
        }
        if (ev.dst === me.eid) add(s.taken, ev.amount);
      } else if (ev.e === 'death' && ev.kind === Kind.Champion) {
        if (ev.eid === me.eid) s.deaths.push(snap.time);
        else if (ev.killer === me.eid) s.kills.push(snap.time);
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
