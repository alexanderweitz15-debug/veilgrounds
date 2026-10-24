// Atlas layout: no sprite atlas may exceed the canvas area a strict browser (Safari/iOS: 16,777,216 px) still draws.
// Regression for "champions invisible on Safari": the 10-champion atlas was planned as 8192x4096 = 33.5 Mpx.
import './loaderEnv';
import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_AREA } from '../src/render/loader/layout';
import { planAtlas } from '../src/render/champions/atlas';

const TEN = ['mira', 'renn', 'aurel', 'brom', 'corvin', 'dagny', 'ferris', 'gorvam', 'grimald', 'ottilie'];
const area = (p: { width: number; height: number }): number => p.width * p.height;

describe('atlas layout vs canvas area limit', () => {
  it('the safe limit is the 4096x4096 canvas of iOS Safari', () => {
    expect(MAX_CANVAS_AREA).toBe(16_777_216);
  });

  it('a 10-champion match (+Hark) at 152 px cells stays within the safe area when capped', () => {
    const p = planAtlas(TEN, { frame: 152, maxSize: 8192, maxArea: MAX_CANVAS_AREA });
    expect(p.list).toContain('hark');
    expect(area(p)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(p.width).toBeLessThanOrEqual(8192);
    expect(p.height).toBeLessThanOrEqual(8192);
    // every job (+ the reserved placeholder cell) has a place in the grid
    expect(p.perRow * Math.floor(p.height / p.frame)).toBeGreaterThanOrEqual(p.jobs.length + 1);
    // not shrunk further than needed
    expect(p.frame).toBeGreaterThanOrEqual(96);
  });

  it('without a cap (browsers that draw big canvases) the layout is unchanged: 8192x4096 @152', () => {
    const p = planAtlas(TEN, { frame: 152, maxSize: 8192 });
    expect([p.width, p.height, p.frame]).toEqual([8192, 4096, 152]);
    expect(area(p)).toBeGreaterThan(MAX_CANVAS_AREA); // the case the cap exists for
  });

  it('a single champion needs no shrinking', () => {
    const p = planAtlas(['mira'], { frame: 152, maxSize: 8192, maxArea: MAX_CANVAS_AREA });
    expect(p.frame).toBe(152);
    expect(area(p)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it('whole roster in one atlas still respects the cap', () => {
    const all = ['ilvane', 'thessaly', 'kaelen', 'renn', 'aurel', 'seraphyne', 'brom', 'oleth', 'harrow', 'isolde', 'dagny', 'vessa', 'nyx', 'grimald', 'lio', 'ottilie', 'mira', 'corvin', 'lysa', 'tobin', 'wren', 'ferris', 'gorvam', 'hagen', 'kiran', 'oda', 'sev', 'vargrim'];
    const p = planAtlas(all, { frame: 152, maxSize: 8192, maxArea: MAX_CANVAS_AREA });
    expect(area(p)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it('minion and monster atlases (4096x4096 at most) are within the limit', () => {
    const minions = planAtlas(['melee0', 'melee1', 'caster0', 'caster1', 'siege0', 'siege1', 'super0', 'super1'], { frame: 96, maxArea: MAX_CANVAS_AREA });
    expect(area(minions)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    const big = planAtlas(['dornenbock', 'glutwaechter', 'leviathan', 'schleierwaechter'], { frame: 200, maxArea: MAX_CANVAS_AREA, autoHark: false });
    expect(area(big)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });
});
