// Animation data table (src/render/anim/data.ts): defaults match the baked atlas for every sprite id, overrides apply.
import './loaderEnv';
import { describe, expect, it } from 'vitest';
import { champions } from '../src/data/champions';
import { CHAMP_FPS, FRAMES, LOOP } from '../src/render/champions/anim';
import { ANIMS, framesOf, hitOf, rateOf, rendererOf } from '../src/render/champions/atlas';
import { MINION_IDS, BIG_MONSTER_IDS, CAMP_MONSTER_IDS } from '../src/render/champions';
import { buildClipSet, defaultEvents, layoutKey, validateClipSet, type AnimOverride } from '../src/render/anim';
import { AFTER_MS, backswingScale, runSpeedScale } from '../src/render/spriteTiming';

function baseOf(id: string) {
  const frames = Object.fromEntries(ANIMS.map((a) => [a, framesOf(id, a)])) as Record<(typeof ANIMS)[number], number>;
  return { frames, fps: rateOf(id), hit: hitOf(id), loop: { ...LOOP } };
}

describe('clip sets of every baked sprite id', () => {
  const ids = [...Object.keys(champions), 'hark', ...MINION_IDS, ...BIG_MONSTER_IDS, ...CAMP_MONSTER_IDS].filter((id) => rendererOf(id) !== null);
  it('covers a real roster', () => {
    expect(ids.length).toBeGreaterThan(40);
  });
  for (const id of ids) {
    it(`${id}: valid (events inside the clip, one hitFrame, one release)`, () => {
      const cs = buildClipSet(id, baseOf(id));
      expect(validateClipSet(cs)).toEqual([]);
      expect(cs.hit).toBe(hitOf(id));
    });
  }
});

describe('defaults and overrides', () => {
  it('champion layout: footsteps on 0 and 4, hit on 2, release on 1, land on the last death frame', () => {
    const cs = buildClipSet('x', { frames: { ...FRAMES }, fps: { ...CHAMP_FPS }, hit: 2, loop: { ...LOOP } }, {});
    expect(cs.clips.run.events.map((e) => e.frame)).toEqual([0, 4]);
    expect(cs.hit).toBe(2);
    expect(cs.release).toBe(1);
    expect(cs.flex).toBe(3);
    expect(cs.clips.death.events).toEqual([{ frame: 2, name: 'land' }]);
  });

  it('an override replaces fps, loop and events; its hitFrame moves the strike frame', () => {
    const ov: Record<string, AnimOverride> = { x: { clips: { attack: { events: [{ frame: 3, name: 'hitFrame' }] }, run: { fps: 20 } }, refSpeed: 400, castKinds: { 2: 'dash' } } };
    const cs = buildClipSet('x', { frames: { ...FRAMES }, fps: { ...CHAMP_FPS }, hit: 2, loop: { ...LOOP } }, ov);
    expect(cs.hit).toBe(3);
    expect(cs.clips.run.fps).toBe(20);
    expect(cs.refSpeed).toBe(400);
    expect(cs.castKinds[2]).toBe('dash');
    expect(cs.castKinds[0]).toBeUndefined();
    expect(validateClipSet(cs)).toEqual([]);
  });

  it('validation catches an event outside the clip and a missing hitFrame', () => {
    const ov: Record<string, AnimOverride> = { x: { clips: { attack: { events: [{ frame: 9, name: 'hitFrame' }] }, cast: { events: [] } } } };
    const cs = buildClipSet('x', { frames: { ...FRAMES }, fps: { ...CHAMP_FPS }, hit: 2, loop: { ...LOOP } }, ov);
    const problems = validateClipSet(cs);
    expect(problems.some((p) => p.includes('attack') && p.includes('frame 9'))).toBe(true);
    expect(problems.some((p) => p.includes('cast') && p.includes('release'))).toBe(true);
  });

  it('defaultEvents is empty for anims without frames', () => {
    for (const a of ANIMS) expect(defaultEvents(a, 0, 1)).toEqual([]);
  });

  it('layoutKey changes with any frame count (atlas cache fingerprint)', () => {
    const a = layoutKey({ ...FRAMES });
    expect(a).toBe('4.8.5.4.3');
    expect(layoutKey({ ...FRAMES, attack: 6 })).not.toBe(a);
  });
});

describe('timing helpers', () => {
  it('backswingScale only compresses, within bounds', () => {
    expect(backswingScale(1000, 3)).toBe(1);
    expect(backswingScale(0, 3)).toBe(1);
    expect(backswingScale(3 * AFTER_MS * 0.7, 3)).toBeCloseTo(0.7);
    expect(backswingScale(10, 3)).toBe(0.45);
  });
  it('runSpeedScale follows speed within bounds, unknown speed is nominal', () => {
    expect(runSpeedScale(0, 340)).toBe(1);
    expect(runSpeedScale(340, 340)).toBe(1);
    expect(runSpeedScale(170, 340)).toBe(0.55);
    expect(runSpeedScale(2000, 340)).toBe(1.7);
  });
});
