# Agent C handoff

- Branch: `ui/c-features` (origin), merged main `e0f40bb` on 19 Oct (fast-forward), then block 2 on top. Last commit:
  `git log origin/ui/c-features -1`.
- Done: C1, C2 (+ kesselbrutTeams), C3, C4, C5 own rune page, C6 part 1, C7 gold efficiency, loading tips, minimap
  size/side, settings export/import, per-key cast modes. Details, commits, screenshots: docs/agents/c.md.
- Half-done: nothing.
- Next steps (c.md "Open after block 2"): 4.3 bans + 4.4 role swap (classicLobby.ts), 4.1 screenshot, 2.1/2.3 pings,
  minimap-left overlap above ~115 %, A3-dependent parts (scoreboard playstyle scales + rank calibration, post-game
  error list) once A3 publishes `rankCalibration` and a player-error log format, B-dependent fields (enemy items -
  UI already reads any row's `items`; ally summoner CDs `ScoreRow.summonerCds`; vision score; Teleport slot).
- src/settings.ts is open to C for additive keys (lead, 19 Oct); log every addition in shared-changes.md.
- Issues for others: docs/agents/issues.md (portrait crops -> D, "Nochmal" in main.ts -> lead, item cast-fail -> B).

## How to take screenshots (1280x720, built game)

1. `npx vite build --outDir <scratch>/after --emptyOutDir`, then `npx vite preview --outDir <scratch>/after --port 4792
   --strictPort` (background). Restart the preview after every rebuild (sirv caches the file list -> 404s). Ports
   other than 5173/4173; other agents use 5187-5195.
2. Headless Edge over CDP: `shot.mjs` in the C scratchpad (spawn msedge `--headless=new --remote-debugging-port`,
   `Emulation.setDeviceMetricsOverride` 1280x720, steps `{wait, run, delay, out}`, prints console errors/warnings).
   `?play=classic&bench` starts a classic game and exposes `window.__vg` (`state`, `hud`, `link`):
   `__vg.hud.togglePanel('scoreboard', true)`, `__vg.hud.target.select(eid)`, `__vg.link.send({t:'move', x, y})`.
   Menus: click `.mode-row` (classic), `.nav-item` (settings); `location.href = '/?play=classic&bench'` keeps the
   IndexedDB settings of the same headless profile.
3. Wrap step scripts in an IIFE (top-level `const` in two steps collides -> `run -> undefined`).
4. On Windows TaskStop leaves the node child alive: kill `node.exe` with `vite preview ... scratchpad/after|before`.

## Known traps

- Snapshot events happened in the tick before `snap.tick` (sim.step increments last): timers use `snap.tick - 1`.
- `.minimap-wrap` is scaled by `--ui * --mm`; anything attached to the minimap must live inside it. The chat box is
  zoomed by `--ui` (a11y.css): its offsets are unzoomed px.
- `t()` replaces every placeholder occurrence; a `|` inside FEATURE-GAP cells breaks the table.
- Node tests cannot import modules that touch the DOM at load (icons.ts pulls the render atlas): keep logic in
  src/game/* (objectives, runePages, settingsIO, minimapPing) or pure ui modules (chatCommands, goldEfficiency).
