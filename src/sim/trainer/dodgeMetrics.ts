// Dodge trainer measurements (FEATURE-GAP 7.4). Pure bookkeeping over plain data, no Sim access: dodge.ts feeds it the
// shots it fires, the player's position and move orders once per tick, and the hits. State is plain objects/arrays
// (sim.state.trainer.dodge.metrics is walked by stateHash). Deterministic: + - * / sqrt only.
//
// Definitions (all against the straight-line model of the trainer shots):
// - A shot THREATENS the player when it would hit him if he stood still on his current spot from now on.
// - Reaction latency: ticks from the spawn of a threatening shot to the first move order (or blink) after which the
//   player, walking straight to the order's target at his move speed, would no longer be hit by it.
// - Panic dodge: a move order while nothing relevant flies: no shot that threatens or passes close, no ground zone
//   on or near him. Orders less than panicGapTicks apart count as one episode.
// - Unnecessary dodge: a move order while a shot that never threatened him passes close (within nearFactor x its
//   hit radius). Counted once per such shot.
// - Hit rate: hits / threatening shots (shots that threatened him at some tick or hit him), per speed / width bucket.

import { DT } from '../types';
import { segDist2 } from '../vec';
import cfg from './dodgeMetrics.json';

export interface ReviewHit {
  /** Seconds into the run. */
  t: number;
  kind: 'shot' | 'zone';
  /** idle: no order since the shot appeared; wrongWay: orders, none left its path; changed: an order left the path, then he turned back. */
  cause: 'idle' | 'wrongWay' | 'changed' | 'zone';
  /** Player at the impact and his hit radius. */
  px: number;
  py: number;
  pr: number;
  /** Player positions before the impact, oldest first, flat [x, y, x, y, ...], the last pair is the impact spot. */
  path: number[];
  /** Shot: start, impact point of the shot centre, width, speed. */
  shot?: { x0: number; y0: number; hx: number; hy: number; w: number; speed: number };
  /** Zone: centre and radius. */
  zone?: { x: number; y: number; r: number };
  /** Reaction latency of that shot in ms, -1 = it was never left. */
  latencyMs: number;
}

export interface BucketStat {
  /** Lower bound (inclusive) and upper bound (exclusive, -1 = open) of the bucket. */
  lo: number;
  hi: number;
  threats: number;
  hits: number;
}

/** What the HUD / post-run screen sees (Snapshot.trainer.dodge). `review` only once the run is over. */
export interface DodgeReport {
  /** Median reaction latency in ms, -1 = no reaction measured yet. */
  reactionMs: number;
  /** Fastest reaction in ms, -1 = none. */
  reactionBestMs: number;
  reactions: number;
  panic: number;
  unnecessary: number;
  /** Shots that threatened the player, and how many of them hit. */
  threats: number;
  shotHits: number;
  zoneHits: number;
  /** shotHits / threats in percent, -1 = no threatening shot yet. */
  hitRate: number;
  speedBuckets: BucketStat[];
  widthBuckets: BucketStat[];
  review?: ReviewHit[];
}

export interface MetricShot {
  id: number;
  t0: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  speed: number;
  width: number;
  maxDist: number;
  /** Threatened the player at some tick. */
  threat: boolean;
  /** Left its path after a threat. */
  reacted: boolean;
  /** Latency in ticks once reacted. */
  lat: number;
  /** Move orders seen while it flew. */
  cmds: number;
  unnecessary: boolean;
  done: boolean;
}

export interface DodgeMetrics {
  shots: MetricShot[];
  nextId: number;
  /** Reaction latencies in ticks. */
  latencies: number[];
  panic: number;
  unnecessary: number;
  lastPanic: number;
  zoneHits: number;
  speed: { threats: number; hits: number }[];
  width: { threats: number; hits: number }[];
  hits: ReviewHit[];
  /** Player position per tick, newest last, flat x, y. */
  log: number[];
}

/** What dodge.ts observed of the player this tick. */
export interface PlayerObs {
  x: number;
  y: number;
  r: number;
  /** Move speed in units per second. */
  ms: number;
  /** Order given or blink made this tick, if any: walking target (move) or none (blink: he is where he is). */
  ev: { tx: number; ty: number } | 'blink' | null;
}

export interface ZoneObs {
  x: number;
  y: number;
  r: number;
  at: number;
}

export interface ShotSpec {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  speed: number;
  width: number;
  maxDist: number;
}

const SB = cfg.speedBuckets;
const WB = cfg.widthBuckets;

export function newMetrics(): DodgeMetrics {
  return {
    shots: [],
    nextId: 1,
    latencies: [],
    panic: 0,
    unnecessary: 0,
    lastPanic: -1e9,
    zoneHits: 0,
    speed: Array.from({ length: SB.length + 1 }, () => ({ threats: 0, hits: 0 })),
    width: Array.from({ length: WB.length + 1 }, () => ({ threats: 0, hits: 0 })),
    hits: [],
    log: [],
  };
}

const bucketOf = (bounds: readonly number[], v: number): number => {
  let i = 0;
  while (i < bounds.length && v >= bounds[i]!) i++;
  return i;
};

/** Distance a shot has flown at tick k (it moves from the tick after its spawn on). */
const flown = (s: MetricShot, k: number): number => Math.min(s.maxDist, s.speed * DT * Math.max(0, k - s.t0));

/** Position of the shot centre at tick k. */
export function shotPos(s: MetricShot, k: number): [number, number] {
  const d = flown(s, k);
  return [s.x0 + s.dx * d, s.y0 + s.dy * d];
}

const hitR = (s: MetricShot, pr: number): number => pr + s.width / 2;

/** Would the shot hit a player who stays at (x, y) from tick k on? */
export function threatens(s: MetricShot, k: number, x: number, y: number, pr: number): boolean {
  const [ax, ay] = shotPos(s, k);
  const r = hitR(s, pr);
  return segDist2(x, y, ax, ay, s.x0 + s.dx * s.maxDist, s.y0 + s.dy * s.maxDist) <= r * r;
}

/** Closest approach of the rest of the shot's path to (x, y), squared. */
const approach2 = (s: MetricShot, k: number, x: number, y: number): number => {
  const [ax, ay] = shotPos(s, k);
  return segDist2(x, y, ax, ay, s.x0 + s.dx * s.maxDist, s.y0 + s.dy * s.maxDist);
};

/**
 * Would the shot still hit a player who is at (x, y) at tick k and walks straight to (tx, ty) at ms units/s
 * (tx undefined = stands)? Steps tick by tick against the shot's per-tick sweep, like the projectile system.
 */
export function hitsOnPath(s: MetricShot, k: number, x: number, y: number, pr: number, ms: number, tx?: number, ty?: number): boolean {
  const r = hitR(s, pr);
  const r2 = r * r;
  const step = ms * DT;
  let dx = 0;
  let dy = 0;
  let left = 0;
  if (tx !== undefined && ty !== undefined && step > 0) {
    const ex = tx - x;
    const ey = ty - y;
    left = Math.sqrt(ex * ex + ey * ey);
    if (left > 0) {
      dx = ex / left;
      dy = ey / left;
    }
  }
  const last = Math.min(cfg.predictMaxTicks, Math.ceil((s.maxDist - flown(s, k)) / Math.max(1e-6, s.speed * DT)));
  let px = x;
  let py = y;
  let walked = 0;
  for (let j = 1; j <= last; j++) {
    const [ax, ay] = shotPos(s, k + j - 1);
    const [bx, by] = shotPos(s, k + j);
    if (segDist2(px, py, ax, ay, bx, by) <= r2) return true;
    const m = Math.min(step, left - walked);
    if (m > 0) {
      walked += m;
      px += dx * m;
      py += dy * m;
    }
  }
  return false;
}

/** A shot was fired at tick k. Returns its id (to be carried in the projectile payload). */
export function metricsShotFired(m: DodgeMetrics, k: number, spec: ShotSpec, p: PlayerObs): number {
  const s: MetricShot = { id: m.nextId++, t0: k, ...spec, threat: false, reacted: false, lat: -1, cmds: 0, unnecessary: false, done: false };
  s.threat = threatens(s, k, p.x, p.y, p.r);
  m.shots.push(s);
  return s.id;
}

function finish(m: DodgeMetrics, s: MetricShot, hit: boolean): void {
  if (s.done) return;
  s.done = true;
  if (!s.threat && !hit) return;
  const sb = m.speed[bucketOf(SB, s.speed)]!;
  const wb = m.width[bucketOf(WB, s.width)]!;
  sb.threats++;
  wb.threats++;
  if (hit) {
    sb.hits++;
    wb.hits++;
  }
}

/** Once per trainer tick k (after this tick's hits): position log, threat marking, order classification. */
export function metricsTick(m: DodgeMetrics, k: number, p: PlayerObs, zones: readonly ZoneObs[]): void {
  m.log.push(Math.round(p.x), Math.round(p.y));
  if (m.log.length > cfg.logTicks * 2) m.log.splice(0, 2);
  for (const s of m.shots) {
    if (s.done) continue;
    if (flown(s, k) >= s.maxDist) {
      finish(m, s, false);
      continue;
    }
    if (!s.threat && threatens(s, k, p.x, p.y, p.r)) s.threat = true;
  }
  m.shots = m.shots.filter((s) => !s.done);
  if (!p.ev) return;
  const tx = p.ev === 'blink' ? undefined : p.ev.tx;
  const ty = p.ev === 'blink' ? undefined : p.ev.ty;
  let relevant = false;
  for (const s of m.shots) {
    s.cmds++;
    const now = threatens(s, k, p.x, p.y, p.r);
    if (now) {
      relevant = true;
      if (!s.reacted && !hitsOnPath(s, k, p.x, p.y, p.r, p.ms, tx, ty)) {
        s.reacted = true;
        s.lat = k - s.t0;
        m.latencies.push(s.lat);
      }
      continue;
    }
    const r = hitR(s, p.r) * cfg.nearFactor;
    if (s.threat || approach2(s, k, p.x, p.y) <= r * r) {
      relevant = true;
      if (!s.threat && !s.unnecessary) {
        s.unnecessary = true;
        m.unnecessary++;
      }
    }
  }
  for (const z of zones) {
    if (z.at <= k) continue;
    const reach = (z.r + p.r) * cfg.zoneNear;
    const dx = p.x - z.x;
    const dy = p.y - z.y;
    if (dx * dx + dy * dy <= reach * reach) relevant = true;
  }
  if (!relevant) {
    if (k - m.lastPanic > cfg.panicGapTicks) m.panic++;
    m.lastPanic = k;
  }
}

function pushHit(m: DodgeMetrics, h: ReviewHit): void {
  m.hits.push(h);
  if (m.hits.length > cfg.reviewCount) m.hits.shift();
}

/** The path of the last logTicks ticks sampled every pathStep ticks, ending with the exact impact spot. */
function pathOf(m: DodgeMetrics, px: number, py: number): number[] {
  const n = m.log.length / 2;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= cfg.pathStep) out.unshift(m.log[i * 2]!, m.log[i * 2 + 1]!);
  out.push(Math.round(px), Math.round(py));
  return out;
}

/** A shot hit the player (counted hit): hx, hy = centre of the shot at the impact; id from the payload. */
export function metricsShotHit(m: DodgeMetrics, runT: number, id: number | undefined, hx: number, hy: number, p: PlayerObs): void {
  const s = id === undefined ? undefined : m.shots.find((q) => q.id === id);
  if (!s) return;
  const cause = s.cmds === 0 ? 'idle' : s.reacted ? 'changed' : 'wrongWay';
  pushHit(m, {
    t: Math.round(runT * 10) / 10, kind: 'shot', cause, px: Math.round(p.x), py: Math.round(p.y), pr: p.r, path: pathOf(m, p.x, p.y),
    shot: { x0: Math.round(s.x0), y0: Math.round(s.y0), hx: Math.round(hx), hy: Math.round(hy), w: s.width, speed: Math.round(s.speed) },
    latencyMs: s.reacted ? Math.round(s.lat * DT * 1000) : -1,
  });
  s.threat = true;
  finish(m, s, true);
  m.shots = m.shots.filter((q) => !q.done);
}

/** A ground zone caught the player. */
export function metricsZoneHit(m: DodgeMetrics, runT: number, z: { x: number; y: number; r: number }, p: PlayerObs): void {
  m.zoneHits++;
  pushHit(m, {
    t: Math.round(runT * 10) / 10, kind: 'zone', cause: 'zone', px: Math.round(p.x), py: Math.round(p.y), pr: p.r, path: pathOf(m, p.x, p.y),
    zone: { x: Math.round(z.x), y: Math.round(z.y), r: z.r }, latencyMs: -1,
  });
}

const median = (v: readonly number[]): number => {
  if (!v.length) return -1;
  const a = [...v].sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h]! : (a[h - 1]! + a[h]!) / 2;
};

const ms = (ticks: number): number => (ticks < 0 ? -1 : Math.round(ticks * DT * 1000));

function buckets(bounds: readonly number[], data: readonly { threats: number; hits: number }[]): BucketStat[] {
  return data.map((d, i) => ({ lo: i === 0 ? 0 : bounds[i - 1]!, hi: i < bounds.length ? bounds[i]! : -1, threats: d.threats, hits: d.hits }));
}

/** Report for the HUD; the hit review is attached only when `final`. */
export function metricsReport(m: DodgeMetrics, final: boolean): DodgeReport {
  let threats = 0;
  let hits = 0;
  for (const b of m.speed) {
    threats += b.threats;
    hits += b.hits;
  }
  // shots still flying that already threatened count as threats too (pending), not as hits
  const r: DodgeReport = {
    reactionMs: ms(median(m.latencies)),
    reactionBestMs: ms(m.latencies.length ? Math.min(...m.latencies) : -1),
    reactions: m.latencies.length,
    panic: m.panic,
    unnecessary: m.unnecessary,
    threats,
    shotHits: hits,
    zoneHits: m.zoneHits,
    hitRate: threats > 0 ? Math.round((hits / threats) * 1000) / 10 : -1,
    speedBuckets: buckets(SB, m.speed),
    widthBuckets: buckets(WB, m.width),
  };
  if (final) r.review = m.hits;
  return r;
}
