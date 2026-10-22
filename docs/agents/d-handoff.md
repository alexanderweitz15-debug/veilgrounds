# Agent D handoff

- Branch: `art/d-visuals` (pushed after every commit; origin/main merged in at f7f7eb4). Last commit: see
  `git log -1 origin/art/d-visuals`.
- Done: D1a, D1b, D2 (+ B5/B1/C7 render requests), D5 logic + panel, B7 (docs/agents/d.md).
- Half-done: nothing uncommitted.
- Next steps (order): D3 scale/map (src/render/terrain.ts: cliff height <= 1.5x champion height, minion size, fountain
  plaza, buff monsters) with before/after canvas captures; D4 silhouette sheet 64 px for all 26; D6 texts as data in
  assets/text/; D5 scenario proposals (src/sim/trainer/scenarios.ts is B's); knock-up arc screenshot.
- Screenshot pipeline: `node tools/scratch/shotServer.mjs` (port 4399, saves POSTed canvas JPEGs to docs/ist/);
  serve builds with `node node_modules/vite/bin/vite.js preview --port 43xx --strictPort [--outDir <dir>]`
  (run_in_background); dev server `--port 4393`; in the page `await import('http://localhost:4393/tools/scratch/dshot.js')`
  then `__dsetup('Wren')` (sandbox, level 18, dummy), `__dshot(name, x, y, seq)`, `__dtower(name)`, `__dward(name)`.
  Before-builds: `git archive <commit> | tar -x -C <scratch>/src-base`, junction node_modules there, build with
  `--outDir`. Unregister the service worker on preview ports before after-shots (stale bundle otherwise).
- Traps: a hidden browser pane pauses rAF and throttles timers (the atlas loader stalls at "Lade Champions 0 %"):
  dshot.js waits through a MessageChannel and pumps frames; showing the pane helps. preview_start only knows the main
  checkout's launch.json. Node tests have no canvas/Path2D: keep data/layout modules canvas-free (atlasStrip.ts,
  readability.ts, barLayout.ts). tests/brainReflex reflex-cost test fails under CPU load (not D).
