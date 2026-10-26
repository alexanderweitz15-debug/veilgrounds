// Client interpolation: jittery snapshot delivery (worker timer + postMessage, a few ms) must not make a unit that
// moves at constant speed stutter on a 60 Hz display — no frozen frames, never backwards, even steps.
import { describe, expect, it } from 'vitest';
import { ClientState, EXTRAPOLATE_TICKS } from '../src/game/state';
import { Kind } from '../src/sim/types';
import type { Snapshot } from '../src/sim/snapshot';

const TICK = 1000 / 30;
const FRAME = 1000 / 60;
const SPEED = 10; // units per tick
const snap = (tick: number): Snapshot =>
  ({
    tick,
    time: tick / 30,
    team: 0,
    entities: [{ id: 1, serial: 1, kind: Kind.MinionMelee, team: 0, x: tick * SPEED, y: 0, px: (tick - 1) * SPEED, py: 0 }],
    projectiles: [],
    objects: [],
    me: null,
    events: [],
    audio: [],
    players: [],
  }) as unknown as Snapshot;

function steps(jitterMs: (tick: number) => number): number[] {
  const st = new ClientState();
  const arrive = (t: number): number => 1000 + t * TICK + jitterMs(t);
  const xs: number[] = [];
  let next = 0;
  for (let now = 1000; now < 3000; now += FRAME) {
    while (arrive(next) <= now) st.ingest(snap(next), arrive(next)), next++;
    if (!st.snap) continue;
    st.beginFrame(now);
    xs.push(st.ix.get(1)!);
  }
  return xs.slice(11).map((v, i) => v - xs.slice(10)[i]!);
}

describe('client interpolation', () => {
  it('jittered arrivals (0–12 ms) give smooth, monotonic motion at 60 Hz', () => {
    // deterministic pseudo-jitter
    const s = steps((t) => ((t * 7919) % 13) * 0.92);
    const ideal = SPEED * (FRAME / TICK); // 5 units per frame
    expect(Math.min(...s)).toBeGreaterThan(ideal * 0.4); // no frozen frames
    expect(Math.max(...s)).toBeLessThan(ideal * 1.6); // no catch-up jumps
  });
});

describe('G/A4: late snapshots extrapolate instead of freezing', () => {
  it('a 45 ms late snapshot leaves no frozen frame and no backwards step', () => {
    // one outlier: snapshot 40 arrives 45 ms late, the following ones on time (first-minute jitter, max measured 71 ms)
    const s = steps((t) => (t === 40 ? 45 : 0));
    const ideal = SPEED * (FRAME / TICK);
    expect(Math.min(...s)).toBeGreaterThan(0); // never frozen, never backwards
    expect(Math.max(...s)).toBeLessThan(ideal * 2.2);
  });
  it('a stopped unit overshoots by at most half a step on a late snapshot', () => {
    const st = new ClientState();
    // moves until tick 5, then stands at x = 50
    const snapAt = (tick: number): Snapshot => {
      const s = snap(tick);
      const e = s.entities[0]!;
      e.x = Math.min(5, tick) * SPEED;
      e.px = Math.min(5, tick - 1) * SPEED;
      return s;
    };
    for (let t = 0; t <= 5; t++) st.ingest(snapAt(t), 1000 + t * TICK);
    // snapshot 6 is 60 ms late: frames in between must not run past 50 + SPEED * EXTRAPOLATE_TICKS
    let maxX = 0;
    for (let now = 1000 + 5 * TICK; now < 1000 + 6 * TICK + 60; now += FRAME) {
      st.beginFrame(now);
      maxX = Math.max(maxX, st.ix.get(1)!);
    }
    expect(maxX).toBeLessThanOrEqual(50 + SPEED * EXTRAPOLATE_TICKS + 1e-9);
    st.ingest(snapAt(6), 1000 + 6 * TICK + 60);
    st.beginFrame(1000 + 7 * TICK);
    expect(st.ix.get(1)).toBe(50);
  });
});
