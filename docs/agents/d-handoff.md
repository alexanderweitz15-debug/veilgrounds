# Agent D handoff

- Branch: `art/d-visuals`, pushed; origin/main (incl. 9ed4070 feet depth / frame 152) merged in at 22b929a.
- Done: D1a, D1b, D2 (+ B5/B1/C7 render requests), D5 logic + panel, B7 (IndexedDB atlas + ground cache, menu
  precache), Sev visuals E left open (docs/agents/d.md).
- Half-done: nothing uncommitted. Agent stopped on the lead's request (max 3 agents).
- Next steps (exact):
  1. Re-measure B7 warm start on main after 9ed4070 (frame 152 / master 240, ATLAS_MAX): game and precache both use
     CHAMP_MASTER / CHAMP_FRAME (checked after the merge), so keys match; bigger strips cost more decode time - the
     4.0-4.5 s warm numbers in d.md were measured with 128 px cells.
  2. Black flame strength on dark ground (abilityMotifs.json `blackflame` light/size) - user taste.
  3. C wires ccGlyphs (incl. fear) + barLayout into src/ui/overlay.ts; C / lead mount the training plan
     (shared-changes.md, D entries 2026-10-19).
  4. D3 scale/map (terrain.ts cliff height <= 1.5x champion height, minion size, fountain plaza, buff monsters) with
     canvas before/after captures; D4 silhouette sheet 64 px; D6 texts as data in assets/text/; D5 scenario proposals
     (src/sim/trainer/scenarios.ts is B's); knock-up arc screenshot.
- Screenshot pipeline: `node tools/scratch/shotServer.mjs` (port 4399, saves POSTed canvas JPEGs to docs/ist/);
  `node node_modules/vite/bin/vite.js preview --port 43xx --strictPort [--outDir <dir>]` and dev `--port 4393`
  (run_in_background); in the page `await import('http://localhost:4393/tools/scratch/dshot.js')`, then
  `__dsetup('Sev')`, `__dshot(name, x, y, seq)`, `__dtower(name)`, `__dward(name)`, `__dsev(name, asVictim)`.
  Before-builds: `git archive <commit> | tar -x -C <scratch>/src-base` + node_modules junction + `--outDir`.
- Traps: a hidden browser pane pauses rAF / throttles timers (dshot.js pumps frames through a MessageChannel; showing
  the pane helps the atlas loader). The PWA service worker deletes foreign Cache Storage caches -> atlas store is
  IndexedDB. Node tests have no canvas/Path2D (keep atlasStrip.ts, readability.ts, barLayout.ts canvas-free).
  tests/brainReflex reflex-cost test can fail under CPU load (not D).
