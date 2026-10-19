# Agent D handoff

- Branch: `art/d-visuals` (pushed after every commit). Last commit: see `git log -1 origin/art/d-visuals`.
- Done: D1a ability motifs (docs/agents/d.md).
- Half-done: nothing uncommitted.
- Next step: D1b particles - new `src/render/particles.ts` (one THREE.Points pool, additive, per-particle colour,
  velocity, life), styles per motif in `src/render/abilityMotifs.json` (`particles`: ember / spark / drip / mote /
  shard), emitters in `src/render/fx.ts` (missile trail per frame, impact burst when a projectile id disappears, cast
  flourish on the `cast` event) and `src/render/groundObjects.ts` (ambient particles on hook objects by tag motif).
- Screenshot pipeline: before build in scratchpad (`npx vite build --outDir <dir>`), serve both builds with
  `node node_modules/vite/bin/vite.js preview --port 4391|4392 --strictPort [--outDir <dir>]` (run_in_background),
  open in the browser pane, `?play=sandbox&bench` exposes `window.__vg` (link.send cheats, world, state).
- Traps: preview_start only knows the main checkout's launch.json; tests/telegraph.test.ts Fx smoke test times out
  (5 s) under CPU load - run it alone; Node tests have no canvas/Path2D (keep data modules canvas-free).
