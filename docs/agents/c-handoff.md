# Agent C handoff

- Branch: `ui/c-picking` (origin), merged main `660c54e` on 22 Oct. Last commit: `git log origin/ui/c-picking -1`.
  The old `ui/c-features` is checked out in a stale worktree; do not use it.
- Done: C1-C7 except the A3-/B-dependent parts; block 6 (22 Oct): C8 picking (src/input/picking.ts, one-time
  pass on `World.pick()`), target-champions-only key, hover outline + sword cursor, attack-move target prediction +
  highlight, D2 overlay wiring (CC glyphs, bar stacking). Details, numbers, screenshots: docs/agents/c.md block 6.
- Half-done: nothing.
- Next steps: D5 training plan wiring (shared-changes.md 2026-10-19 D5: part 2 trainerMenu.ts + part 3 i18n keys are
  C's; part 1 `afterGame` history recording is in src/main.ts = lead); A3-dependent parts (scoreboard playstyle
  scales + rank calibration, post-game error list); full test suite run on `ui/c-picking` (not run in block 6, the
  machine was shared; C8 test files, settingsIO and i18n are green, tsc 0).
- src/settings.ts is open to C for additive keys (lead, 19 Oct); log every addition in shared-changes.md.
- Issues for others: docs/agents/issues.md.

## Picking (C8) in one paragraph

`pickUnit()` ranks [hostile first] x [HP bar > drawn sprite (front-most) > sim radius + 8 px (closest drawn body)].
Hover, right click, left click, casts and pings all read `InputController.hover`; the HUD highlight reads
`InputController.highlight` (= predicted attack-move target while A is armed). Bar geometry lives in
src/ui/hpBarGeom.ts (overlay + picker); stacked bar lifts are shared through `barLift`. Measurement:
tests/pickingMeasure.test.ts (fixture recorder tools/recordPickWave.ts). Sprite heights in tests/pickingHelpers.ts
were probed in the built game (`__vg.world.unitHeight`); re-probe if D changes the atlases.

## How to take screenshots (1280x720, built game)

1. `npx vite build --outDir <scratch>/after --emptyOutDir`, then `npx vite preview --outDir <scratch>/after --port 4395
   --strictPort` (background). Restart the preview after every rebuild. Kill leftover `vite preview` node processes
   (PowerShell `Get-CimInstance Win32_Process` filter on the command line) - TaskStop leaves the child alive.
2. Headless Edge over CDP: scratchpad `c8/shot.mjs` (steps `{wait, run, delay, out, mouseExpr, clickExpr, cdp}`,
   prints console errors/warnings). `?play=classic&bench` exposes `window.__vg` (`state`, `world`, `link`, `hud`);
   `__vg.link.pause(true)` freezes the sim without the pause UI; `__vg.world.pick(state, sx, sy, accept)` is the live
   picker. Generators: `c8/pick-steps.mjs` (picking before/after), `c8/am-steps.mjs` (attack-move check).
3. Headless captures show no OS cursor: draw a marker / the computed CSS cursor image in the step script and say so.

## Known traps

- Snapshot events happened in the tick before `snap.tick` (sim.step increments last): timers use `snap.tick - 1`.
- `.minimap-wrap` is scaled by `--ui * --mm`; anything attached to the minimap must live inside it.
- `t()` replaces every placeholder occurrence; a `|` inside FEATURE-GAP cells breaks the table.
- Node tests cannot import modules that touch the DOM at load: keep logic in pure modules (src/input/picking.ts,
  attackMove.ts, src/ui/hpBarGeom.ts, src/game/*).
- tools/*.ts are type-checked without @types/node: declare `process`, import `node:fs` dynamically (see botSim.ts).
- Python heredocs with `'\\n'` inside a TS string literal write a real newline: use the Edit tool for such lines.
