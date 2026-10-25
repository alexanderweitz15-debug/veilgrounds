// A4 VFX bench: synthetic teamfight in the production build (vite preview). Usage:
//   node tools/scratch/a4VfxBench.cjs <baseUrl> <label> [shotPath]
// Starts a classic 5v5 match (?play=classic&bench), runs the sim at 8x until a few minutes in, then measures two
// windows with the identical frame hooks: (1) the scene as it is (10 champions, minion waves, natural effects),
// (2) the scene plus a synthetic teamfight load driven through the Fx API that exists in both builds
// (cast events with telegraphs, zones, 20 missile trails with impact bursts, ambient zone particles).
// SwiftShader is a software GPU: compare before/after relatively, these are not absolute FPS claims.
const { chromium } = require('playwright');

const base = process.argv[2];
const label = process.argv[3] || 'run';
const shot = process.argv[4];
const WINDOW_MS = Number(process.env.WINDOW_MS || 40000);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 480), height: Number(process.env.VH || 270) } });
  const origin = new URL(base).origin;
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) r.continue();
    else r.abort();
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => {
    const W = window.Worker;
    window.__workers = [];
    window.Worker = class extends W {
      constructor(...a) {
        super(...a);
        window.__workers.push(this);
      }
    };
  });
  await page.goto(base + '?play=classic&bench', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vg && window.__vg.state.snap && window.__vg.state.me(), null, { timeout: 240000 });
  console.log(label, 'match started');
  // fast-forward the sim worker to a few minutes in
  await page.evaluate(() => window.__workers.forEach((w) => w.postMessage({ type: 'speed', speed: 8 })));
  await page.waitForFunction(() => window.__vg.state.snap.tick >= 30 * 200, null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => window.__workers.forEach((w) => w.postMessage({ type: 'speed', speed: 1 })));

  await page.evaluate(() => {
    const vg = window.__vg;
    const w = vg.world;
    const r = w.renderer;
    const gl = r.getContext();
    const st = (window.__st = { on: false, load: false, render: [], calls: [], tri: [], pts: [], gap: [], fxup: [], last: 0, live: [] });
    const orig = r.render.bind(r);
    r.render = (s, c) => {
      const t0 = performance.now();
      orig(s, c);
      gl.finish();
      const t1 = performance.now();
      if (st.on) {
        st.render.push(t1 - t0);
        st.calls.push(r.info.render.calls);
        st.tri.push(r.info.render.triangles);
        st.pts.push(r.info.render.points);
        if (st.last) st.gap.push(t0 - st.last);
      }
      st.last = t0;
    };
    // synthetic teamfight load (same Fx API in both builds)
    const fx = w.fx;
    const rnd = Math.random;
    const missiles = Array.from({ length: 20 }, (_, i) => ({ x: 0, y: 0, dx: 1, dy: 0, t: -i * 50, kind: ['ember', 'spark', 'drip', 'mote', 'shard', 'blackflame'][i % 6], hue: (i * 47) % 360 }));
    const zones = Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 0, r: 250 + 40 * i, kind: ['ember', 'spark', 'drip', 'mote', 'shard', 'blackflame'][i % 6], hue: (i * 83) % 360, until: 0 }));
    let nextCast = 0;
    let ci = 0;
    let lastNow = 0;
    const fu = fx.update.bind(fx);
    fx.update = (state, now, showRange) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      const snap = state.snap;
      if (st.load && snap) {
        const champs = snap.entities.filter((e) => e.kind === 1 && e.alive);
        let cx = 0, cy = 0;
        for (const c of champs) (cx += c.x), (cy += c.y);
        cx /= Math.max(1, champs.length);
        cy /= Math.max(1, champs.length);
        st.cx = cx; st.cy = cy;
        w.rig.focus(cx, cy);
        if (now >= nextCast && champs.length) {
          nextCast = now + 70; // 10 champions ~ every 700 ms each
          const src = champs[ci++ % champs.length];
          const enemies = champs.filter((e) => e.team !== src.team);
          const tgt = enemies.length ? enemies[Math.floor(rnd() * enemies.length)] : src;
          const slot = ci % 3;
          fx.onEvent({ e: 'cast', src: src.id, slot, x: tgt.x, y: tgt.y, rank: 3 }, state, now);
          if (slot === 1) {
            const t = snap.tick - 1;
            fx.onEvent({ e: 'zone', src: src.id, team: src.team, x: tgt.x, y: tgt.y, r: 300, start: t, at: t + 12, until: t + 70 }, state, now);
          }
        }
        for (const m of missiles) {
          m.t += dt * 1000;
          if (m.t > 900) {
            if (m.t < 1e9 && m.t > 900 + 1) fx.particles.emit(m.kind, m.x, m.y, 90, m.hue, fx.particles.kind(m.kind).burst, now);
            const a = rnd() * Math.PI * 2;
            m.x = cx + (rnd() - 0.5) * 1200;
            m.y = cy + (rnd() - 0.5) * 800;
            m.dx = Math.cos(a);
            m.dy = Math.sin(a);
            m.t = 0;
          }
          m.x += m.dx * 1800 * dt;
          m.y += m.dy * 1800 * dt;
          fx.particles.emit(m.kind, m.x, m.y, 90, m.hue, fx.particles.kind(m.kind).trail * dt, now, { dx: m.dx, dy: m.dy }, 0.5);
        }
        for (const z of zones) {
          if (now > z.until) {
            z.x = cx + (rnd() - 0.5) * 1200;
            z.y = cy + (rnd() - 0.5) * 800;
            z.until = now + 2500;
          }
          const kd = fx.particles.kind(z.kind);
          const rate = kd.ambient * 2 * Math.max(1, z.r / 100) * dt;
          for (let i = 0; i < 3; i++) {
            const a = rnd() * Math.PI * 2;
            const rr = z.r * Math.sqrt(rnd());
            fx.particles.emit(z.kind, z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, 10, z.hue, rate / 3, now, undefined, 0.5);
          }
        }
      }
      const t0 = performance.now();
      fu(state, now, showRange);
      if (st.on) st.fxup.push(performance.now() - t0);
      if (st.on) st.live.push(fx.particles.live);
    };
    void vg;
  });

  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / Math.max(1, s.length), p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
  };
  const f = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);
  const result = {};
  for (const phase of ['scene', 'load', 'load2']) {
    await page.evaluate((p) => {
      const st = window.__st;
      st.load = p !== 'scene';
      for (const k of ['render', 'calls', 'tri', 'pts', 'gap', 'fxup', 'live']) st[k].length = 0;
      st.on = true;
    }, phase);
    await page.waitForTimeout(WINDOW_MS);
    const d = await page.evaluate(() => {
      const st = window.__st;
      st.on = false;
      const vg = window.__vg;
      const ents = vg.state.snap.entities;
      return { render: st.render, calls: st.calls, tri: st.tri, pts: st.pts, gap: st.gap, fxup: st.fxup, live: st.live, champs: ents.filter((e) => e.kind === 1).length, minions: ents.filter((e) => e.kind === 2 || e.kind === 3 || e.kind === 4).length, ents: ents.length, tick: vg.state.snap.tick, perfWorld: vg.perf.world };
    });
    if (phase === 'load' && shot) {
      // canvas grab right after a synchronous frame (page.screenshot times out under the software GPU)
      const url = await page.evaluate(() => {
        window.__st.load = true;
        window.__vg.frame(performance.now());
        return window.__vg.world.canvas.toDataURL('image/png');
      });
      require('fs').writeFileSync(shot, Buffer.from(url.split(',')[1], 'base64'));
    }
    result[phase] = {
      frames: d.render.length,
      entities: d.ents, champions: d.champs, tick: d.tick,
      renderMs: Object.fromEntries(Object.entries(stats(d.render)).map(([k, v]) => [k, f(v)])),
      frameGapMs: Object.fromEntries(Object.entries(stats(d.gap)).map(([k, v]) => [k, f(v)])),
      fxUpdateMs: Object.fromEntries(Object.entries(stats(d.fxup)).map(([k, v]) => [k, f(v)])),
      drawCalls: Object.fromEntries(Object.entries(stats(d.calls)).map(([k, v]) => [k, f(v)])),
      points: f(stats(d.pts).mean),
      liveParticles: Object.fromEntries(Object.entries(stats(d.live)).map(([k, v]) => [k, f(v)])),
      perfWorldCpuMs: f(d.perfWorld),
    };
  }
  console.log(JSON.stringify({ label, ...result }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
