// Sprite state machine (src/render/anim/machine.ts): the animation follows the sim, never decides it.
import './loaderEnv';
import { describe, expect, it } from 'vitest';
import { CHAMP_FPS, FRAMES, LEGACY_FRAMES, LOOP } from '../src/render/champions/anim';
import { AFTER_MS } from '../src/render/spriteTiming';
import { CC_INTERRUPT, STOP_GRACE_MS, TICK_MS, UnitAnim, buildClipSet, newInput, type AnimEventName, type AnimInput, type ClipSet } from '../src/render/anim';

const champ = (): ClipSet => buildClipSet('t', { frames: { ...FRAMES }, fps: { ...CHAMP_FPS }, hit: 2, loop: { ...LOOP } }, {});
const minion = (): ClipSet => buildClipSet('m', { frames: { ...LEGACY_FRAMES }, fps: { ...CHAMP_FPS }, hit: 1, loop: { ...LOOP } }, {});

interface Rec {
  name: AnimEventName;
  t: number;
  slot: number;
  foot: number;
}
function rig(cs: ClipSet = champ(), eid = 0) {
  const log: Rec[] = [];
  let now = 1000;
  const u = new UnitAnim(eid, cs.id, (name, _u, slot, _kind, foot) => log.push({ name, t: now, slot, foot }), now);
  const inp: AnimInput = newInput();
  const step = (ms = TICK_MS, patch: Partial<AnimInput> = {}): void => {
    Object.assign(inp, patch);
    now += ms;
    u.update(inp, cs, now);
  };
  const names = (): string[] => log.map((r) => r.name);
  return { u, inp, step, log, names, now: () => now };
}

describe('attack: the strike frame lands on the sim damage tick', () => {
  it('spreads the wind-up over the exact sim wind-up and holds the last anticipation frame', () => {
    const r = rig();
    const wind = 9 * TICK_MS; // 270 ms
    r.step(TICK_MS, { atkPhase: 1, atkStart: 100, atkEnd: 109 });
    expect(r.u.state).toBe('windup');
    expect(r.u.anim).toBe('attack');
    const frames: number[] = [];
    for (let t = TICK_MS; t < wind - 1; t += TICK_MS) {
      r.step(TICK_MS);
      frames.push(r.u.frame);
    }
    expect(frames[0]).toBeLessThanOrEqual(1);
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]!);
    expect(Math.max(...frames)).toBeLessThanOrEqual(1); // hit = 2: anticipation is frames 0..1
    // the sim is late: still held on the last anticipation frame, no early strike
    r.step(300);
    expect(r.u.frame).toBe(1);
    expect(r.names()).not.toContain('hitFrame');
    // damage tick: atkPhase 2
    r.step(TICK_MS, { atkPhase: 2, atkStart: 100, atkEnd: 124 });
    expect(r.u.frame).toBe(2);
    expect(r.u.state).toBe('release');
    expect(r.names().filter((n) => n === 'hitFrame')).toHaveLength(1);
  });

  it('a slow first swing is timed by atkEnd - atkStart, not by a guess', () => {
    const slow = rig();
    slow.inp.windGuess = 100; // wrong guess
    slow.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 30 }); // one second wind-up
    slow.step(400);
    expect(slow.u.frame).toBe(0); // 40 % through: still on the first anticipation frame
    slow.step(500);
    expect(slow.u.frame).toBe(1);
  });

  it('attack speed compresses the backswing (still shows the strike first)', () => {
    const fast = rig();
    fast.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 4 }); // 133 ms wind-up
    fast.step(TICK_MS * 4, { atkPhase: 1 });
    fast.step(TICK_MS, { atkPhase: 2, atkStart: 0, atkEnd: 9 }); // whole cycle 300 ms: 167 ms left for 3 frames
    expect(fast.u.state).toBe('release');
    // natural backswing is 3 * AFTER_MS = 285 ms; compressed it is over well before that
    fast.step(200, { atkPhase: 2 });
    expect(fast.u.frame).toBe(4);
    const slow = rig();
    slow.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 8 });
    slow.step(TICK_MS * 8, { atkPhase: 1 });
    slow.step(TICK_MS, { atkPhase: 2, atkStart: 0, atkEnd: 60 }); // slow attacker: natural speed
    slow.step(200, { atkPhase: 2 });
    expect(slow.u.frame).toBeLessThan(4);
  });

  it('walking cancels the follow-through after the strike hold (orbwalk), standing finishes it', () => {
    const r = rig();
    r.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 6 });
    r.step(TICK_MS * 6, { atkPhase: 1 });
    r.step(TICK_MS, { atkPhase: 2, atkStart: 0, atkEnd: 40 });
    r.step(AFTER_MS + 20, { atkPhase: 2, moving: true });
    expect(r.u.state).toBe('walk');
    expect(r.u.anim).toBe('run');
  });

  it('a cancelled wind-up drops straight back to idle', () => {
    const r = rig();
    r.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 9 });
    r.step(TICK_MS, { atkPhase: 0 });
    expect(r.u.state).toBe('idle');
    expect(r.names()).toEqual(['windup']);
  });

  it('minions (legacy layout, hit frame 1) strike on frame 1', () => {
    const r = rig(minion());
    r.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 8 });
    r.step(TICK_MS * 8, { atkPhase: 1 });
    expect(r.u.frame).toBe(0);
    r.step(TICK_MS, { atkPhase: 2, atkStart: 0, atkEnd: 30 });
    expect(r.u.frame).toBe(1);
  });
});

describe('walking', () => {
  it('walk -> attack mid-stride starts the anticipation at once; the stride phase survives', () => {
    const r = rig();
    for (let i = 0; i < 20; i++) r.step(TICK_MS, { moving: true, speed: 340 });
    expect(r.u.state).toBe('walk');
    r.step(TICK_MS, { moving: false, atkPhase: 1, atkStart: 0, atkEnd: 8 });
    expect(r.u.state).toBe('windup');
  });

  it('a single dropped moving flag does not flicker to idle, a real stop does', () => {
    const r = rig();
    for (let i = 0; i < 6; i++) r.step(TICK_MS, { moving: true, speed: 340 });
    r.step(TICK_MS, { moving: false });
    expect(r.u.state).toBe('walk');
    r.step(STOP_GRACE_MS + 10, { moving: false });
    expect(r.u.state).toBe('idle');
    expect(r.u.frame).toBe(0); // idle restarts on the neutral rest frame
  });

  it('run cycle speed follows the real movement speed (no foot sliding when slowed)', () => {
    const run = (speed: number): number => {
      const r = rig();
      for (let i = 0; i < 30; i++) r.step(TICK_MS, { moving: true, speed });
      return r.u.frame;
    };
    expect(run(170)).toBeLessThan(run(340));
    expect(run(680)).toBeGreaterThan(run(340));
  });

  it('raises two footsteps per run cycle on the contact frames, not when entering the run', () => {
    const r = rig();
    r.step(TICK_MS, { moving: true, speed: 340 });
    expect(r.names()).not.toContain('footstep');
    for (let i = 0; i < 90; i++) r.step(TICK_MS, { moving: true, speed: 340 }); // 3 s at 14 fps = 42 frames = 5.25 cycles
    const steps = r.log.filter((l) => l.name === 'footstep');
    expect(steps.length).toBeGreaterThanOrEqual(9);
    expect(steps.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.foot).not.toBe(steps[i - 1]!.foot);
  });

  it('an instant self buff while walking keeps the stride but still raises its events', () => {
    const r = rig();
    for (let i = 0; i < 5; i++) r.step(TICK_MS, { moving: true, speed: 340 });
    r.u.onCast(r.now(), 0, 'self', 1);
    r.step(TICK_MS, { moving: true, speed: 340 });
    expect(r.u.state).toBe('walk');
    expect(r.names()).toEqual(expect.arrayContaining(['castStart', 'release']));
  });
});

describe('cast', () => {
  it('releases on the sim cast end: gather frame before, release frame after, one release event', () => {
    const r = rig();
    r.u.onCast(r.now(), 250, 'directed', 2);
    r.step(TICK_MS);
    expect(r.u.state).toBe('cast');
    expect(r.u.frame).toBe(0);
    r.step(200);
    expect(r.u.frame).toBe(0);
    expect(r.names()).not.toContain('release');
    r.step(80);
    expect(r.u.frame).toBe(1);
    expect(r.log.find((l) => l.name === 'release')?.slot).toBe(2);
    r.step(2000);
    expect(r.u.state).toBe('idle');
    expect(r.names().filter((n) => n === 'release')).toHaveLength(1);
  });

  it('self casts flex, dash casts lunge', () => {
    const a = rig();
    a.u.onCast(a.now(), 0, 'self');
    a.step(TICK_MS);
    expect(a.u.frame).toBe(3);
    const b = rig();
    b.u.onCast(b.now(), 0, 'dash');
    b.step(TICK_MS);
    expect(b.u.frame).toBe(1);
  });

  for (const bit of CC_INTERRUPT.toString(2).split('').reverse().map((c, i) => (c === '1' ? 1 << i : 0)).filter(Boolean)) {
    it(`CC bit ${bit} during the wind-up cancels the cast: no release, back to idle`, () => {
      const r = rig();
      r.u.onCast(r.now(), 400, 'directed', 0);
      r.step(100);
      expect(r.u.state).toBe('cast');
      r.step(TICK_MS, { cc: bit });
      expect(r.u.state).toBe('idle');
      r.step(600, { cc: 0 });
      expect(r.names()).toEqual(['castStart', 'castCancel']);
      expect(r.u.state).toBe('idle');
    });
  }

  it('slow or root does not cancel a cast', () => {
    const r = rig();
    r.u.onCast(r.now(), 400, 'directed');
    r.step(100, { cc: 4 | 2 });
    expect(r.u.state).toBe('cast');
  });

  it('CC after the release does not cancel the follow-through', () => {
    const r = rig();
    r.u.onCast(r.now(), 100, 'directed');
    r.step(150);
    r.step(TICK_MS, { cc: 1 });
    expect(r.names()).not.toContain('castCancel');
  });

  it('death during a cast drops it: no release afterwards', () => {
    const r = rig();
    r.u.onCast(r.now(), 400, 'directed');
    r.step(100);
    r.u.onDeath();
    r.step(600);
    expect(r.names()).toEqual(['castStart', 'death']);
    expect(r.u.state).toBe('idle');
  });

  it('a cast overrides a running wind-up (the sim cancels the auto)', () => {
    const r = rig();
    r.step(TICK_MS, { atkPhase: 1, atkStart: 0, atkEnd: 9 });
    r.u.onCast(r.now(), 100, 'directed');
    r.step(TICK_MS, { atkPhase: 0 });
    expect(r.u.state).toBe('cast');
  });
});

describe('recall, hit', () => {
  it('recall plays the gather then holds the flex pose; moving ends it; edges raise events', () => {
    const r = rig();
    r.step(TICK_MS, { recalling: true });
    expect(r.u.state).toBe('recall');
    expect(r.u.anim).toBe('cast');
    expect(r.u.frame).toBe(0);
    r.step(400);
    expect(r.u.frame).toBe(3);
    r.step(TICK_MS, { recalling: false, moving: true });
    expect(r.u.state).toBe('walk');
    expect(r.names()).toEqual(['recallStart', 'recallEnd']);
  });

  it('units without a cast clip (minions) never recall-pose', () => {
    const r = rig(minion());
    r.step(TICK_MS, { recalling: true });
    expect(r.u.state).toBe('idle');
  });

  it('hit flinch is rate limited, points away from the source and is smaller while winding up', () => {
    const r = rig();
    r.step(TICK_MS, { x: 100, y: 0 });
    r.u.onHit(r.now(), 0, 0);
    r.step(60);
    expect(r.u.ox).toBeGreaterThan(0);
    expect(Math.abs(r.u.oy)).toBeLessThan(1e-9);
    const idle = r.u.ox;
    r.u.onHit(r.now(), 0, 0); // within the gap: ignored
    expect(r.names().filter((n) => n === 'hit')).toHaveLength(1);
    r.step(400);
    expect(r.u.ox).toBe(0);
    const w = rig();
    w.step(TICK_MS, { x: 100, y: 0, atkPhase: 1, atkStart: 0, atkEnd: 30 });
    w.u.onHit(w.now(), 0, 0);
    w.step(60);
    expect(w.u.ox).toBeLessThan(idle);
  });
});
