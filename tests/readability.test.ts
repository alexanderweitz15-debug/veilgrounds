// D2 combat readability helpers: facing smoothing, hit-flash throttle, knock-up / dash lift.
import { describe, expect, it } from 'vitest';
import { FlashGate, READ, airborneLift, dashLift, flashAmp, turnToward } from '../src/render/readability';

describe('facing smoothing', () => {
  it('turns 180 deg in facingMs180, never overshoots, takes the short way round', () => {
    let a = 0;
    a = turnToward(a, Math.PI, READ.facingMs180 / 2);
    expect(Math.abs(a)).toBeCloseTo(Math.PI / 2, 5);
    a = turnToward(a, Math.PI, READ.facingMs180);
    expect(a).toBe(Math.PI);
    // 350 deg -> 10 deg is a 20 deg turn, not 340
    const b = turnToward((350 / 180) * Math.PI, (10 / 180) * Math.PI, 1);
    expect(b).toBeGreaterThan((350 / 180) * Math.PI);
  });
});

describe('hit flash', () => {
  it('at most one flash per unit per gap (4/s), units independent', () => {
    const g = new FlashGate();
    let n = 0;
    for (let t = 0; t < 1000; t += 33) if (g.accept(7, t)) n++;
    expect(n).toBe(Math.ceil(1000 / READ.hitFlash.minGapMs));
    expect(g.accept(8, 500)).toBe(true);
    expect(flashAmp('minion', false)).toBeLessThan(flashAmp('champion', false));
    expect(flashAmp('champion', true)).toBe(READ.hitFlash.ampReduceMotion);
  });
});

describe('lift', () => {
  it('knock-up and dash arcs are 0 at both ends and peak in the middle', () => {
    expect(airborneLift(0)).toBe(0);
    expect(airborneLift(1)).toBe(0);
    expect(airborneLift(0.5)).toBe(READ.airborne.height);
    expect(dashLift(0.5, 10000)).toBe(READ.dash.maxHeight);
    expect(dashLift(0.5, 100)).toBeCloseTo(READ.dash.heightPer100, 5);
  });
});
