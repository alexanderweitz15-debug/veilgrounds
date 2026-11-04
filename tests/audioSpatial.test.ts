// Spatial mix (src/audio/spatial.ts): attenuation, pan, off-screen, own champion, priority order.
import { describe, expect, it } from 'vitest';
import { createListener, priorityOf, Rel, spatialize, type Spatial } from '../src/audio/spatial';
import { PRIORITY_OWN } from '../src/audio/voices';

const l = { ...createListener(), x: 1000, y: 1000 };
const out = (): Spatial => ({ gain: 0, pan: 0, nearness: 0 });

describe('spatialize', () => {
  it('is full at the listener and falls monotonically with distance', () => {
    let prev = Infinity;
    for (let d = 0; d <= 2500; d += 100) {
      const o = out();
      const ok = spatialize(l, 1000 + d, 1000, Rel.Neutral, o);
      if (!ok) {
        expect(d).toBeGreaterThan(l.screenRadius);
        break;
      }
      expect(o.gain).toBeLessThanOrEqual(prev);
      prev = o.gain;
    }
    const o = out();
    spatialize(l, 1000, 1000, Rel.Neutral, o);
    expect(o.gain).toBe(1);
  });

  it('pans left/right by the side relative to the camera and is centred straight ahead', () => {
    const r = out();
    const lft = out();
    const c = out();
    spatialize(l, 1600, 1000, Rel.Neutral, r);
    spatialize(l, 400, 1000, Rel.Neutral, lft);
    spatialize(l, 1000, 1500, Rel.Neutral, c);
    expect(r.pan).toBeGreaterThan(0.3);
    expect(lft.pan).toBeLessThan(-0.3);
    expect(c.pan).toBe(0);
  });

  it('off-screen sounds are clearly quieter than on-screen ones and are culled beyond the hearing radius', () => {
    const on = out();
    const off = out();
    spatialize(l, 1000 + l.screenRadius * 0.9, 1000, Rel.Neutral, on);
    spatialize(l, 1000 + l.screenRadius * 1.6, 1000, Rel.Neutral, off);
    expect(off.gain).toBeLessThan(on.gain * 0.6);
    expect(spatialize(l, 1000 + l.hearRadius + 50, 1000, Rel.Neutral, out())).toBe(false);
  });

  it('the own champion is always audible, with a limited pan', () => {
    const o = out();
    expect(spatialize(l, 1000 + 5000, 1000, Rel.Own, o)).toBe(true);
    expect(o.gain).toBeGreaterThanOrEqual(0.85);
    expect(Math.abs(o.pan)).toBeLessThanOrEqual(0.5);
  });
});

describe('priorityOf', () => {
  it('orders own > enemy champion near > ally champion > minion, and near beats far', () => {
    const own = priorityOf(25, Rel.Own, 3, PRIORITY_OWN);
    const enemyNear = priorityOf(30, Rel.Enemy, 0.2, PRIORITY_OWN);
    const allyNear = priorityOf(30, Rel.Ally, 0.2, PRIORITY_OWN);
    const minion = priorityOf(5, Rel.Neutral, 0.2, PRIORITY_OWN);
    const enemyFar = priorityOf(30, Rel.Enemy, 2, PRIORITY_OWN);
    expect(own).toBe(PRIORITY_OWN);
    expect(own).toBeGreaterThan(enemyNear);
    expect(enemyNear).toBeGreaterThan(allyNear);
    expect(allyNear).toBeGreaterThan(minion);
    expect(enemyNear).toBeGreaterThan(enemyFar);
  });

  it('nothing but the own champion reaches the own priority', () => {
    expect(priorityOf(99, Rel.Enemy, 0, PRIORITY_OWN)).toBeLessThan(PRIORITY_OWN);
  });
});
