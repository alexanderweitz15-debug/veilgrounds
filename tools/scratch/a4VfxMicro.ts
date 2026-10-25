// A4 VFX micro benchmark (Node, no GPU): CPU cost per frame of the particle layer for a synthetic teamfight, old
// CPU-simulated Points pools (tools/scratch/a4old = copies of particles.ts / abilityTheme.ts / abilityMotifs.json from
// the commit before A4: `git show <base>:src/render/<file>`) against the new GPU particle system.
//   npx tsx tools/scratch/a4VfxMicro.ts
// Load per frame at 60 fps: 20 missiles with trails and impact bursts, 6 zones with ambient particles (3 emits each),
// a cast flourish every 70 ms. Reported: ms per frame for emit calls + update, bytes uploaded to the GPU per frame,
// vertices drawn, live particles. Same emit calls for both (the legacy facade signature).
import { Particles as OldParticles } from './a4old/particles';
import { Particles as NewParticles } from '../../src/render/particles';
import { PARTICLE_KIND_IDS, type ParticleKindId } from '../../src/render/abilityTheme';

interface P {
  emit(id: ParticleKindId, x: number, y: number, h: number, hue: number, count: number, now: number, dir?: { dx: number; dy: number }, spread?: number, cls?: string): void;
  update(now: number, dt: number): void;
  kind(id: ParticleKindId): { trail: number; burst: number; ambient: number };
  live: number;
}

const FRAMES = 4000;
const DT = 1 / 60;

function run(make: () => P, uploadBytes: (p: P) => number, drawn: (p: P) => number): Record<string, number> {
  const p = make();
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const kinds = PARTICLE_KIND_IDS;
  const missiles = Array.from({ length: 20 }, (_, i) => ({ x: 8000, y: 8000, dx: 1, dy: 0, t: -i * 50, kind: kinds[i % kinds.length]!, hue: (i * 47) % 360 }));
  const zones = Array.from({ length: 6 }, (_, i) => ({ x: 8000, y: 8000, r: 250 + 40 * i, kind: kinds[i % kinds.length]!, hue: (i * 83) % 360, until: 0 }));
  const dir = { dx: 1, dy: 0 };
  const frame: number[] = [];
  const upd: number[] = [];
  let bytes = 0;
  let live = 0;
  let nextCast = 0;
  const WARM = 600;
  for (let f = 0; f < FRAMES + WARM; f++) {
    const now = f * DT * 1000;
    const t0 = performance.now();
    for (const m of missiles) {
      m.t += DT * 1000;
      if (m.t > 900) {
        p.emit(m.kind, m.x, m.y, 90, m.hue, p.kind(m.kind).burst, now, undefined, 1, 'hit');
        const a = rnd() * Math.PI * 2;
        m.x = 8000 + (rnd() - 0.5) * 1200;
        m.y = 8000 + (rnd() - 0.5) * 800;
        m.dx = Math.cos(a);
        m.dy = Math.sin(a);
        m.t = 0;
      }
      m.x += m.dx * 1800 * DT;
      m.y += m.dy * 1800 * DT;
      dir.dx = m.dx;
      dir.dy = m.dy;
      p.emit(m.kind, m.x, m.y, 90, m.hue, p.kind(m.kind).trail * DT, now, dir, 0.5);
    }
    for (const z of zones) {
      if (now > z.until) {
        z.x = 8000 + (rnd() - 0.5) * 1200;
        z.y = 8000 + (rnd() - 0.5) * 800;
        z.until = now + 2500;
      }
      const rate = p.kind(z.kind).ambient * 2 * Math.max(1, z.r / 100) * DT;
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = z.r * Math.sqrt(rnd());
        p.emit(z.kind, z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, 10, z.hue, rate / 3, now, undefined, 0.5, 'aura');
      }
    }
    if (now >= nextCast) {
      nextCast = now + 70;
      const k = kinds[Math.floor(rnd() * kinds.length)]!;
      p.emit(k, 8000 + (rnd() - 0.5) * 1000, 8000 + (rnd() - 0.5) * 700, 50, rnd() * 360, p.kind(k).burst * 0.6, now, undefined, 0.7, 'hit');
    }
    const t1 = performance.now();
    p.update(now, DT);
    const t2 = performance.now();
    if (f >= WARM) {
      frame.push(t2 - t0);
      upd.push(t2 - t1);
      bytes += uploadBytes(p);
      live += p.live;
    }
  }
  const stat = (a: number[]): [number, number] => {
    const s = [...a].sort((x, y) => x - y);
    return [s.reduce((x, y) => x + y, 0) / s.length, s[Math.floor(s.length * 0.95)]!];
  };
  const [fm, f95] = stat(frame);
  const [um, u95] = stat(upd);
  return {
    frameMsMean: +fm.toFixed(4), frameMsP95: +f95.toFixed(4), updateMsMean: +um.toFixed(4), updateMsP95: +u95.toFixed(4),
    uploadKBPerFrame: +(bytes / FRAMES / 1024).toFixed(2), verticesDrawn: drawn(p), liveMean: Math.round(live / FRAMES),
  };
}

const oldRes = run(
  () => new OldParticles() as unknown as P,
  (p) => {
    // every pool with live particles re-uploads position (640 x 3) and colour (640 x 4) floats each frame
    const pools = [...((p as unknown as { pools: Map<string, { live: number }> }).pools.values())];
    return pools.filter((q) => q.live > 0).length * (640 * 3 + 640 * 4) * 4;
  },
  (p) => [...((p as unknown as { pools: Map<string, unknown> }).pools.values())].length * 640,
);
type Layer = { buf: { updateRanges: { start: number; count: number }[]; clearUpdateRanges(): void }; total: number };
let lastNew: NewParticles | null = null;
const newRes = run(
  () => (lastNew = new NewParticles()) as unknown as P,
  (p) => {
    let b = 0;
    for (const l of (p as unknown as { vfx: { layers: Layer[] } }).vfx.layers) {
      for (const r of l.buf.updateRanges) b += r.count * 4;
      l.buf.clearUpdateRanges();
    }
    return b;
  },
  (p) => (p as unknown as { vfx: { layers: Layer[] } }).vfx.layers.reduce((n, l) => n + l.total, 0),
);
console.log(JSON.stringify({ frames: FRAMES, old: oldRes, new: newRes, newDropped: (lastNew as unknown as { vfx: { stats: unknown } }).vfx.stats }, null, 1));
