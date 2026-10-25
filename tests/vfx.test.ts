// A4 VFX: effect definitions (format, validation, migration of the six legacy kinds), GPU particle system caps and
// pooling, trigger bus. Headless: THREE without a canvas (shaders are never compiled here).
import { describe, expect, it } from 'vitest';
import { EFFECTS, VFX_ERRORS, effectDef, effectHandle } from '../src/render/vfx/registry';
import { CLASS_CAP, CLASS_FRAME_BUDGET, CURVE_SAMPLES, VFX_CLASSES, validateEffect } from '../src/render/vfx/schema';
import { VfxSystem, buildCurveTable } from '../src/render/vfx/system';
import { VfxBus } from '../src/render/vfx/bus';
import { PARTICLE_KIND_IDS } from '../src/render/abilityTheme';

const GOOD = {
  id: 'test_fx',
  class: 'hit',
  blend: 'add',
  glyph: 'spark',
  life: [100, 200],
  count: 4,
  size: [50, 60],
  alphaOverLife: [[0, 1], [1, 0]],
};

describe('effect definitions', () => {
  it('every file under vfx/effects loads and validates (no errors, id = file name)', () => {
    expect(VFX_ERRORS).toEqual([]);
    const files = Object.keys(import.meta.glob('../src/render/vfx/effects/*.json'));
    expect(EFFECTS.length).toBe(files.length);
    expect(new Set(EFFECTS.map((d) => d.id)).size).toBe(EFFECTS.length);
  });

  it('covers projectiles, hits, auras, ground telegraphs and ultimates', () => {
    for (const c of VFX_CLASSES) expect([c, EFFECTS.some((d) => d.class === c)]).toEqual([c, true]);
  });

  it('every effect respects the hard caps of its class', () => {
    for (const d of EFFECTS) {
      expect([d.id, d.maxLive <= CLASS_CAP[d.class]]).toEqual([d.id, true]);
      expect([d.id, d.count <= CLASS_FRAME_BUDGET[d.class]]).toEqual([d.id, true]);
    }
  });

  it('rejects malformed definitions with a message each', () => {
    expect(validateEffect(GOOD, 'x').errors).toEqual([]);
    const bad = (patch: Record<string, unknown>): string[] => validateEffect({ ...GOOD, ...patch }, 'x').errors;
    expect(bad({ class: 'boss' })[0]).toMatch(/class must be one of/);
    expect(bad({ glyph: 'banana' })[0]).toMatch(/glyph/);
    expect(bad({ lifetime: [1, 2] })[0]).toMatch(/unknown key lifetime/);
    expect(bad({ life: [300, 100] })[0]).toMatch(/life/);
    expect(bad({ maxLive: 5000 }).length).toBeGreaterThan(0);
    expect(bad({ maxLive: 2000 })[0]).toMatch(/class cap/);
    expect(bad({ count: 399 })[0]).toMatch(/per-frame budget/);
    expect(bad({ alphaOverLife: [[0, 1]] })[0]).toMatch(/alphaOverLife/);
    expect(bad({ alphaOverLife: [[0, 1], [0.6, 0.5], [0.4, 0.2], [1, 0]] })[0]).toMatch(/ascending/);
    expect(bad({ alphaOverLife: [[0.1, 1], [1, 0]] })[0]).toMatch(/first stop/);
    expect(bad({ colorOverLife: [[0, 'red'], [1, '#fff']] })[0]).toMatch(/colorOverLife/);
    expect(bad({ emitter: { shape: 'ring' } })[0]).toMatch(/radius/);
    expect(bad({ emitter: { shape: 'blob' } })[0]).toMatch(/emitter\.shape/);
    expect(bad({ id: 'Bad Id' })[0]).toMatch(/id must match/);
    expect(validateEffect(null, 'x').def).toBeNull();
  });
});

describe('migration of the six D1b particle kinds', () => {
  // values of the former abilityMotifs.json particleKinds (life ms, speed, rise, gravity, back, size, HSL lightness %, flicker, additive)
  const LEGACY: Record<string, [number, number, number, number, number, number, number, boolean, boolean]> = {
    ember: [700, 45, 110, 0, 0, 140, 52, true, false],
    spark: [260, 300, 0, 0, 0, 100, 78, true, true],
    drip: [520, 80, 70, 520, 0, 110, 66, false, false],
    mote: [1200, 22, 28, 0, 0, 120, 72, false, false],
    shard: [320, 140, 0, 260, 160, 90, 74, false, false],
    blackflame: [700, 30, 160, 0, 0, 150, 12, true, false],
  };
  it('each legacy kind has an effect definition with the old ranges (life 0.7..1.3x, speed 0.4..1x, rise 0.6..1.4x)', () => {
    expect(Object.keys(LEGACY).sort()).toEqual([...PARTICLE_KIND_IDS].sort());
    for (const [id, [life, speed, rise, gravity, back, size, light, flicker, additive]] of Object.entries(LEGACY)) {
      const d = effectDef(id)!;
      expect(d, id).toBeDefined();
      expect(d.life[0]).toBeCloseTo(life * 0.7, 6);
      expect(d.life[1]).toBeCloseTo(life * 1.3, 6);
      expect(d.velocity.speed[0]).toBeCloseTo(speed * 0.4, 6);
      expect(d.velocity.speed[1]).toBeCloseTo(speed, 6);
      expect(d.velocity.rise[0]).toBeCloseTo(rise * 0.6, 6);
      expect(d.velocity.rise[1]).toBeCloseTo(rise * 1.4, 6);
      expect(d.gravity).toBe(gravity);
      expect(d.velocity.back).toBe(back);
      expect(d.size).toEqual([size, size]);
      expect(d.tint).toMatchObject({ mode: 'hue', lightness: light / 100, lightnessJitter: 0.08, hueJitter: 12 });
      expect(d.flicker > 0).toBe(flicker);
      expect(d.blend).toBe(additive ? 'add' : 'normal');
      expect(d.emitter).toMatchObject({ shape: 'point', jitter: 8, jitterH: 6 });
    }
  });
});

describe('curve table', () => {
  it('samples size, colour and alpha over life and keeps the parameters in row 3 of each effect', () => {
    const defs = [validateEffect({ ...GOOD, sizeOverLife: [[0, 2], [1, 0]], alphaOverLife: [[0, 0], [0.5, 1], [1, 0]], gravity: 100, drag: 2, flicker: 0.25 }, 'x').def!];
    const t = buildCurveTable(defs);
    const at = (row: number, i: number, ch: number): number => t[(row * CURVE_SAMPLES + i) * 4 + ch]!;
    expect(at(1, 0, 0)).toBeCloseTo(2, 6);
    expect(at(1, CURVE_SAMPLES - 1, 0)).toBeCloseTo(0, 6);
    expect(at(0, 0, 3)).toBeCloseTo(0, 6);
    expect(at(0, 7, 3)).toBeGreaterThan(0.8); // t = 7/15, near the 0.5 peak
    expect([at(2, 0, 0), at(2, 0, 1), at(2, 0, 3)]).toEqual([100, 2, 0.25]);
    expect(at(2, 0, 2)).toBe(1); // glyph index of "spark"
  });
});

describe('VfxSystem caps and pooling', () => {
  it('spawn budget per class and frame, refilled by update', () => {
    const sys = new VfxSystem();
    const h = effectHandle('ember'); // maxLive 640 > the projectile class budget
    const n = sys.emit(h, 0, 0, 0, 0, { count: 1000 });
    expect(n).toBe(CLASS_FRAME_BUDGET.projectile);
    expect(sys.stats.dropped).toBe(1000 - CLASS_FRAME_BUDGET.projectile);
    expect(sys.emit(h, 0, 0, 0, 0, { count: 5 })).toBe(0); // budget used up this frame
    sys.update(16);
    expect(sys.emit(h, 0, 0, 0, 16, { count: 5 })).toBe(5);
  });

  it('maxLive of an effect is never exceeded, however much is asked', () => {
    const sys = new VfxSystem();
    const d = effectDef('hit_spark')!;
    let t = 0;
    for (let f = 0; f < 200; f++) {
      sys.emit('hit_spark', 0, 0, 0, t, { count: 100 });
      t += 4; // 250 fps: far more than maxLive in the particles' lifetime
      sys.update(t);
      expect(sys.live).toBeLessThanOrEqual(d.maxLive);
    }
    expect(sys.live).toBeGreaterThan(0);
    expect(sys.stats.dropped).toBeGreaterThan(0);
  });

  it('class pools are rings: live particles per class stay below the class cap (per blend layer), the oldest are overwritten', () => {
    const sys = new VfxSystem();
    let t = 0;
    for (let f = 0; f < 300; f++) {
      for (const id of ['ember', 'spark', 'drip', 'mote', 'shard', 'blackflame']) sys.emit(id, 0, 0, 0, t, { count: 40, hue: 20 });
      t += 16;
      sys.update(t);
    }
    const by = sys.liveByClass();
    for (const c of VFX_CLASSES) expect(by[c]).toBeLessThanOrEqual(2 * CLASS_CAP[c]); // the cap is per blend layer (alpha + additive)
    expect(by.projectile).toBeGreaterThan(0);
  });

  it('particles live for their life only (headless clock)', () => {
    const sys = new VfxSystem();
    sys.emit('ember', 100, 100, 50, 0, { count: 10, hue: 22 });
    sys.emit('shard', 100, 100, 50, 0, { count: 5, hue: 35, dx: 1, dy: 0 });
    expect(sys.live).toBe(15);
    sys.update(100);
    expect(sys.live).toBe(15);
    sys.update(5000);
    expect(sys.live).toBe(0);
  });

  it('unknown effects are ignored; reduce-motion scale thins the burst', () => {
    const sys = new VfxSystem();
    expect(sys.emit('nope_nothing', 0, 0, 0, 0)).toBe(0);
    sys.seed(7);
    sys.scale = 0.25;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      n += sys.emit('hit_spark', 0, 0, 0, i * 20, { count: 4 });
      sys.update(i * 20 + 10);
    }
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(500); // 400 calls x 4 x 0.25 = 400 expected
  });

  it('is deterministic for a seed and writes spawns to the packed buffer (position, velocity, life, tint)', () => {
    const run = (): Float32Array => {
      const sys = new VfxSystem();
      sys.seed(42);
      sys.emit('hit_spark', 500, 700, 60, 1000, { count: 3, team: 'enemy' });
      const geo = (sys.group.children[1] as unknown as { geometry: { attributes: { position: { data: { array: Float32Array } } } } }).geometry;
      const hit = CLASS_CAP.projectile * 16; // the hit class segment follows the projectile segment
      return geo.attributes.position.data.array.slice(hit, hit + 16 * 4);
    };
    const a = run();
    const b = run();
    expect(Array.from(a)).toEqual(Array.from(b));
    // first particle: x near 500 (jitter 6), world z = -y near -700, life 0.14..0.26 s, effect index of hit_spark
    expect(Math.abs(a[0]! - 500)).toBeLessThanOrEqual(6);
    expect(Math.abs(a[2]! + 700)).toBeLessThanOrEqual(6);
    expect(a[7]!).toBeGreaterThanOrEqual(0.14 - 1e-6);
    expect(a[7]!).toBeLessThanOrEqual(0.26 + 1e-6);
    expect(a[8]).toBe(effectHandle('hit_spark'));
    expect(a[12]! > a[14]!).toBe(true); // enemy tint is warm (red > blue)
  });

  it('draw calls are fixed at two (alpha + additive layer), buffers are allocated once', () => {
    const sys = new VfxSystem();
    expect(sys.group.children.length).toBe(2);
    expect(sys.stats.drawCalls).toBe(2);
    const arrays = sys.group.children.map((c) => (c as unknown as { geometry: { attributes: { position: { data: { array: Float32Array } } } } }).geometry.attributes.position.data.array);
    for (let i = 0; i < 100; i++) sys.emit('ult_ring', 0, 0, 0, i, { count: 40 });
    const after = sys.group.children.map((c) => (c as unknown as { geometry: { attributes: { position: { data: { array: Float32Array } } } } }).geometry.attributes.position.data.array);
    expect(after[0]).toBe(arrays[0]);
    expect(after[1]).toBe(arrays[1]);
  });

  it('emitting allocates (almost) nothing per call (hot path)', async () => {
    const sys = new VfxSystem();
    const h = effectHandle('hit_spark');
    // 50 ms per call: particles die and new ones really spawn (with 1 ms steps the maxLive cap blocked most spawns)
    const burn = (n: number, team: 'own' | 'enemy'): void => {
      const o = { count: 6, hue: 30, team, dx: 1, dy: 0 };
      for (let i = 0; i < n; i++) {
        sys.emit(h, 100, 100, 50, i * 50, o);
        if (i % 4 === 0) sys.update(i * 50);
      }
    };
    burn(20000, 'own'); // warm up the JIT
    expect(sys.live).toBeGreaterThan(0);
    // A forced GC before each round makes the number deterministic (the old heuristic without GC flaked under load).
    // Integrator (wave 1 gate): Color.set(paletteString) per emit cost ~110 bytes per call; team tints are now parsed
    // once per palette string (~3 bytes per call left). The cap catches an object/array literal per call or particle.
    // No @types/node in this project: typed dynamic imports (same trick as tools/botSim.ts).
    const v8 = (await import('node:' + 'v8')) as { setFlagsFromString(f: string): void };
    const vm = (await import('node:' + 'vm')) as { runInNewContext(code: string): unknown };
    const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    for (const team of ['own', 'enemy'] as const) {
      const perCall: number[] = [];
      for (let r = 0; r < 3; r++) {
        gc();
        const before = proc.memoryUsage().heapUsed;
        burn(60000, team);
        perCall.push((proc.memoryUsage().heapUsed - before) / 60000);
      }
      expect(Math.min(...perCall)).toBeLessThan(32);
    }
  });
});

describe('trigger bus', () => {
  it('plays the bound effects of a trigger and calls subscribers (unsubscribe works)', () => {
    const sys = new VfxSystem();
    const bus = new VfxBus(sys);
    expect(bus.bound('hitFrame').length).toBeGreaterThan(0);
    expect(bus.bound('release').length).toBeGreaterThan(0);
    const got: string[] = [];
    const off = bus.on('hitFrame', (ev) => got.push(`hit@${ev.x}`));
    const n = bus.trigger('hitFrame', { x: 5, y: 6, team: 'own', now: 0 });
    expect(n).toBeGreaterThan(0);
    expect(sys.live).toBe(n);
    expect(got).toEqual(['hit@5']);
    off();
    bus.trigger('hitFrame', { x: 7, y: 6, now: 10 });
    expect(got).toEqual(['hit@5']);
    expect(bus.trigger('some_free_form_trigger', { x: 0, y: 0 })).toBe(0);
  });

  it('slot filter: the ultimate bindings only play for slot 3+', () => {
    const sys = new VfxSystem();
    const bus = new VfxBus(sys, { ult: [{ effect: 'ult_pillar', minSlot: 3 }], side: [{ effect: 'hit_spark', team: ['enemy'] }] });
    expect(bus.trigger('ult', { x: 0, y: 0, slot: 1, now: 0 })).toBe(0);
    expect(bus.trigger('ult', { x: 0, y: 0, slot: 3, now: 0 })).toBeGreaterThan(0);
    expect(bus.trigger('side', { x: 0, y: 0, team: 'own', now: 0 })).toBe(0);
    expect(bus.trigger('side', { x: 0, y: 0, team: 'enemy', now: 0 })).toBeGreaterThan(0);
  });

  it('every binding in bindings.json names a known effect', () => {
    const bus = new VfxBus(new VfxSystem());
    for (const t of ['hitFrame', 'impact', 'release', 'ultimate', 'death', 'levelUp']) {
      expect(bus.bound(t).length, t).toBeGreaterThan(0);
      for (const b of bus.bound(t)) expect(effectHandle(b.effect), b.effect).toBeGreaterThanOrEqual(0);
    }
  });
});
