// Agent F: per-champion locomotion data (src/render/champions/motion.ts) and the runtime sprite springs
// (src/render/spriteDynamics.ts). Both are canvas-free.
import { describe, expect, it } from 'vitest';
import { cadenceFor, MOTION_IDS, motionOf, MS, UNIT } from '../src/render/champions/motion';
import { KICKS, newDyn, stepDyn } from '../src/render/spriteDynamics';
import { champions } from '../src/data/champions';

describe('motion specs', () => {
  it('every roster champion has its own spec and the MS table matches the data', () => {
    for (const id of Object.keys(champions)) {
      expect([id, MOTION_IDS.includes(id)]).toEqual([id, true]);
      expect([id, MS[id]]).toEqual([id, champions[id]!.base.ms]);
    }
  });

  it('no two champions share the same gait numbers or the same idle numbers', () => {
    const gaits = new Map<string, string>();
    const idles = new Map<string, string>();
    for (const id of MOTION_IDS) {
      const m = motionOf({ id, hold: 'relaxed' });
      const g = JSON.stringify(m.gait);
      const i = JSON.stringify(m.idle);
      expect([id, gaits.get(g)]).toEqual([id, undefined]);
      expect([id, idles.get(i)]).toEqual([id, undefined]);
      gaits.set(g, id);
      idles.set(i, id);
    }
    // at least 8 different gait styles and 8 idle styles across the roster
    expect(new Set(MOTION_IDS.map((id) => motionOf({ id, hold: 'relaxed' }).gait.style)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(MOTION_IDS.map((id) => motionOf({ id, hold: 'relaxed' }).idle.style)).size).toBeGreaterThanOrEqual(8);
  });

  it('run cadence follows movement speed and stride (feet do not slide): steps/s x 4 frames', () => {
    for (const id of MOTION_IDS) {
      const g = motionOf({ id, hold: 'relaxed' }).gait;
      if (g.stride <= 0 || g.style === 'gallop') continue; // hovering / hand-set gallop cadence
      const stepsPerSec = MS[id]! / (2 * g.stride * UNIT);
      const want = Math.max(9, Math.min(22, stepsPerSec * 4));
      expect(Math.abs(g.cadence - want)).toBeLessThan(0.2);
      expect(g.cadence).toBeGreaterThanOrEqual(9);
      expect(g.cadence).toBeLessThanOrEqual(22);
    }
    expect(cadenceFor(340, 24)).toBeCloseTo(15.9, 1);
    expect(cadenceFor(340, 10)).toBe(22); // cap: 8 frames cannot carry more
    // heavy stompers take big slow steps
    for (const id of ['gorvam', 'grimald', 'brom']) expect([id, motionOf({ id, hold: 'hook' }).gait.cadence <= 18]).toEqual([id, true]);
    expect(motionOf({ id: 'aurel', hold: 'cane' }).gait.cadence).not.toBe(motionOf({ id: 'mira', hold: 'bow' }).gait.cadence);
  });

  it('kits without a spec fall back to the legacy buckets', () => {
    expect(motionOf({ id: 'melee0', gait: 'heavy', hold: 'relaxed' }).gait.cadence).toBe(14);
    expect(motionOf({ id: 'x', gait: 'light', hold: 'guard' }).idle.bob).toBe(1.6);
  });
});

describe('sprite springs', () => {
  it('a kick overshoots once and settles back to rest within ~0.6 s', () => {
    const d = newDyn(0);
    KICKS.runStop(d, 1);
    let min = 1;
    let max = 1;
    let t = 0;
    for (; t <= 700; t += 16) {
      const o = stepDyn(d, t);
      min = Math.min(min, o.sy);
      max = Math.max(max, o.sy);
      // volume: a squash widens, a stretch narrows
      expect(Math.sign(o.sx - 1)).toBe(-Math.sign(o.sy - 1) || 0);
    }
    expect(min).toBeLessThan(0.93); // visible squash
    expect(max).toBeGreaterThan(1.01); // one overshoot
    expect(min).toBeGreaterThan(0.77); // clamp: health bars stay put
    const o = stepDyn(d, 700);
    expect(Math.abs(o.sy - 1)).toBeLessThan(0.01);
    expect(Math.abs(o.lean)).toBeLessThan(0.01);
  });

  it('is stable across long frame gaps and leans along the given direction', () => {
    const d = newDyn(0);
    KICKS.runStart(d, 1);
    const o = stepDyn(d, 40);
    expect(o.lean).toBeGreaterThan(0);
    expect(o.sy).toBeGreaterThan(1);
    stepDyn(d, 2000); // 2 s gap: integrator clamps dt, no blow-up
    for (let t = 2016; t < 3000; t += 16) {
      const q = stepDyn(d, t);
      expect(Number.isFinite(q.sy) && Math.abs(q.sy - 1) < 0.3).toBe(true);
    }
    const l = newDyn(0);
    KICKS.hit(l, 1);
    expect(stepDyn(l, 40).lean).toBeLessThan(0); // tips away from a source on the right
  });
});
