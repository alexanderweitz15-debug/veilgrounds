# Agent C handoff

- Branch: `ui/c-features` (origin), base `0bbc3d0`. Last commit: see `git log origin/ui/c-features -1`.
- Done: C1, C2, C3, C4, C6 part 1 (details and commits in docs/agents/c.md).
- Half-done: nothing in code (stopped on the lead's wind-down request before C5/C7). All screenshots captured.
- Next steps (details in c.md "Open"): C5 lobby, C7 settings (needs the src/settings.ts decision in
  docs/agents/shared-changes.md), then A3-dependent parts (playstyle mini-scales in the scoreboard, post-game error
  list, rank calibration) once A3 publishes `rankCalibration` and a player-error log format (brain/a3-humanize has
  `injectedError:` / `detected:` bot log lines only). When B's snapshot fields land (proposal in shared-changes.md),
  nothing has to change: `src/game/objectives.ts` and `scoreboard.ts` already read them first; then remove the "?"
  note for enemy Kesselbrut in FEATURE-GAP 1.2.
- Issues filed for others: docs/agents/issues.md (portrait crops -> D, "Nochmal" in main.ts -> lead, item cast-fail
  events -> B).

## How to take screenshots (1280x720, built game)

1. `npx vite build --outDir <scratch>/after --emptyOutDir` and `npx vite preview --outDir <scratch>/after --port 4792
   --strictPort` (background). Use ports other than 5173/4173; other agents use 5187-5195.
2. Headless Edge over CDP: script `shot.mjs` (copy in the C scratchpad; ~70 lines: spawn msedge `--headless=new
   --remote-debugging-port`, `Emulation.setDeviceMetricsOverride` 1280x720, steps `{wait, run, delay, out}`,
   prints console errors/warnings). `?play=classic&bench` starts a classic game and exposes `window.__vg`
   (`state`, `hud`, `link`). Example: `__vg.hud.togglePanel('scoreboard', true)`,
   `__vg.hud.target.select(eid)`, `__vg.link.send({t:'move', x, y})`.
3. Wrap step scripts in an IIFE: top-level `const` in two steps collides (SyntaxError -> `run -> undefined`).
4. Stop servers afterwards; on Windows TaskStop leaves the node child: kill `node.exe` with `vite preview ... --port
   479x` by PID.

## Known traps

- Snapshot events happened in the tick before `snap.tick` (sim.step increments last): timers use `snap.tick - 1`.
- `.minimap-wrap` is scaled by `--ui`; anything attached to the minimap must live inside it.
- `t()` now replaces every placeholder occurrence; strings may repeat `{max}` etc.
- Node tests cannot import modules that touch the DOM at load (icons.ts pulls the render atlas): keep logic in
  src/game/* or pure ui modules (chatCommands.ts) and test those.
