// A4 VFX A/B: GPU/raster cost of the particle layer alone, in the production build under a software GPU.
//   node tools/scratch/a4VfxAB.cjs <baseUrl> <label>
// Sandbox match (?play=sandbox&bench). A synthetic teamfight load (20 missile trails + bursts, 6 ambient zones, cast
// flourishes; ~1100 live particles) is emitted through the Fx particle API that both builds have; then the scene is
// rendered directly (renderer.render + gl.finish) with the particle group visible and hidden, alternating per
// iteration so drift cancels. The difference is the particle layer's cost. Also reports draw calls with / without it.
const { chromium } = require('playwright');

const base = process.argv[2];
const label = process.argv[3] || 'run';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 960), height: Number(process.env.VH || 540) } });
  const origin = new URL(base).origin;
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) r.continue();
    else r.abort();
  });
  await page.goto(base + '?play=sandbox&bench', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vg && window.__vg.state.snap && window.__vg.state.me(), null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(() => {
    const vg = window.__vg;
    const w = vg.world;
    const fx = w.fx;
    const r = w.renderer;
    const gl = r.getContext();
    const me = vg.state.me();
    w.rig.focus(me.x, me.y);
    w.rig.apply();
    vg.frame(performance.now()); // one real frame: uniforms, shadow map, textures
    const kinds = ['ember', 'spark', 'drip', 'mote', 'shard', 'blackflame'];
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const missiles = Array.from({ length: 20 }, (_, i) => ({ x: me.x, y: me.y, dx: 1, dy: 0, t: -i * 50, kind: kinds[i % 6], hue: (i * 47) % 360 }));
    const zones = Array.from({ length: 6 }, (_, i) => ({ x: me.x, y: me.y, r: 250 + 40 * i, kind: kinds[i % 6], hue: (i * 83) % 360, until: 0 }));
    const dir = { dx: 1, dy: 0 };
    let T = performance.now();
    let nextCast = 0;
    const DT = 1 / 60;
    const step = () => {
      T += DT * 1000;
      for (const m of missiles) {
        m.t += DT * 1000;
        if (m.t > 900) {
          fx.particles.emit(m.kind, m.x, m.y, 90, m.hue, fx.particles.kind(m.kind).burst, T, undefined, 1, 'hit');
          const a = rnd() * Math.PI * 2;
          m.x = me.x + (rnd() - 0.5) * 1200;
          m.y = me.y + (rnd() - 0.5) * 700;
          m.dx = Math.cos(a);
          m.dy = Math.sin(a);
          m.t = 0;
        }
        m.x += m.dx * 1800 * DT;
        m.y += m.dy * 1800 * DT;
        dir.dx = m.dx;
        dir.dy = m.dy;
        fx.particles.emit(m.kind, m.x, m.y, 90, m.hue, fx.particles.kind(m.kind).trail * DT, T, dir, 0.5);
      }
      for (const z of zones) {
        if (T > z.until) {
          z.x = me.x + (rnd() - 0.5) * 1200;
          z.y = me.y + (rnd() - 0.5) * 700;
          z.until = T + 2500;
        }
        const rate = fx.particles.kind(z.kind).ambient * 2 * Math.max(1, z.r / 100) * DT;
        for (let i = 0; i < 3; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = z.r * Math.sqrt(rnd());
          fx.particles.emit(z.kind, z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, 10, z.hue, rate / 3, T, undefined, 0.5, 'aura');
        }
      }
      if (T >= nextCast) {
        nextCast = T + 70;
        const k = kinds[Math.floor(rnd() * 6)];
        fx.particles.emit(k, me.x + (rnd() - 0.5) * 1000, me.y + (rnd() - 0.5) * 600, 50, rnd() * 360, fx.particles.kind(k).burst * 0.6, T, undefined, 0.7, 'hit');
      }
      fx.particles.update(T, DT);
    };
    for (let i = 0; i < 240; i++) step(); // reach steady state (~4 s of fake time)
    const on = [];
    const off = [];
    const calls = { on: 0, off: 0 };
    const timeRender = (visible) => {
      fx.particles.group.visible = visible;
      const t0 = performance.now();
      r.render(w.scene, w.rig.camera);
      gl.finish();
      const dt = performance.now() - t0;
      (visible ? on : off).push(dt);
      calls[visible ? 'on' : 'off'] = r.info.render.calls;
    };
    for (let i = 0; i < 80; i++) {
      step();
      if (i % 2) {
        timeRender(true);
        timeRender(false);
      } else {
        timeRender(false);
        timeRender(true);
      }
    }
    fx.particles.group.visible = true;
    const stat = (a) => {
      const s = [...a].sort((x, y) => x - y);
      return { mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), min: +s[0].toFixed(2) };
    };
    return { particlesOn: stat(on), particlesOff: stat(off), calls, live: fx.particles.live, points: r.info.render.points };
  });
  console.log(JSON.stringify({ label, ...res }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
