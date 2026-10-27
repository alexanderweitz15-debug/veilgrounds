# swarm ui-polish (continued on swarm/ui-polish-2)

Continued from the stopped agent's WIP commit 11e239c (untested). Merged origin/main 5fc933b.

## Done (FEATURE-GAP rows updated)

- 1.17 pause/resume: F10 shows overlay "Pausiert von X", banner "Spiel pausiert / Spiel geht weiter", chat line (own toggle only). `Game.togglePause`, `Hud.announcePause`.
- 4.10 main menu first frame: map-toned gradient placeholder, canvas fades in after first rendered frame (`canvas.menu-bg.ready`).
- 1.11 camera after death: lock suspended while dead (free camera), Space snaps to death spot, overlay buttons "Zum Todesort" / "Zum Brunnen" (`HudHooks.focusCamera`).
- 1.15 cast-fail: `src/ui/castFailText.ts`; ability / summoner / item names, cooldown seconds, mana owned/needed, item texts `castFail.item.*`, red item-slot flash.
- 1.9 / 1.10 buffs: `SnapEntity.auraLeft` + `buffs`; chips show time left, tooltip with ability text + "Noch X s" (`timed:` tooltip spec); enemy buffs on target frame; chips update per second without rebuilding (tooltip stays open).

## Fixed from the WIP

- `src/ui/tooltip.ts` and `src/ui/targetFrame.ts` contained raw newlines inside string literals (tsc syntax error). Now `split(/\r?\n/)` and `\n`.

## Tests

- `npx tsc --noEmit`: clean.
- `npx vitest run tests/i18n.test.ts tests/snapshot.test.ts tests/uiPolish.test.ts`: 10 passed.
- No browser check (shared-machine rules): 4.10, 1.11 camera and 1.17 overlay are unverified visually.

## Open

- No Restzeit-Ring on buff chips (seconds text only). No 3-s resume countdown, no bot reaction to pause.
- Target frame still lacks AD/armor (not in snapshot).
- Shared edits listed in docs/agents/shared-changes.md under "ui-polish".

## swarm/ui-polish-3 (open items from ui-polish, summoners, s1, pings, s2, tutorial)

Done
- Buff chips: time-left ring (`.chip-ring`, conic gradient; fraction = left / longest value seen on the node, `ringFraction` in targetFrame.ts; seconds text stays).
- Pause: resume now runs a 3 s countdown ("Weiter in N ..." under "Pausiert"); F10 during the countdown cancels (stays paused). Bots already pause: the worker stops stepping while paused and bots only act on sim ticks (`performance.now` only in worker.ts), so no bot change needed.
- Target frame: new row AD / AP / Ruest. / MR / Tempo with full-name tooltips. Snapshot `SnapEntity.st` (champions only, rounded).
- Bots: SUMMONERS table top `['geist','teleport']`, adc `['sprung','barriere']` (per role, no per-bot spread; the human lobby pick is unchanged).
- Tutorial tower: `SimConfig.towerMult` (hp x0.4, dmg x0.12, no plates), only `tutorialConfig` sets it; tower step now starts 1200 in front of the enemy outer tower (`Geo.enemyTower`). Finding: the allied wave never reached the enemy tower in 150 s (waves clash mid lane), so the step cannot rely on minions; with dmg x0.4 / x0.2 a level-9 Mira still died before the kill. Texts de/en rewritten. Shop step: text uses `{shop}` = `keyLabel(binds.shop)` (default P), matches the real keybind.
- Visual fixes found in the browser: F3 overlay sat on the score bar (now top right); ping wheel opened at the minimap was clipped at the window edge (wheel centre now clamped into the window, dead zone measured from the press point).

Tests (all green, singleFork)
- `tests/uiPolish.test.ts` (+ring fraction, +`st` on champions only, +bot summoners), `tests/tutorial.test.ts` (+tower step: one player kills the tower within 60 s without dying), i18n, snapshot, pings: pass. Seeded bot files with the new summoners: bots, botParams, surrender, rage, allChat, lobbyBans, summonersBarrier, bughunt, replay: 55 + 34 pass, no re-baseline needed. `tsc --noEmit` clean.

Browser check (one session, vite on 5181 from this worktree, tab + server closed afterwards)
- OK: resume countdown text (3, 2, then resume; verified by state + overlay text), target frame with stats, F3 overlay, settings graphics section, death recap card ("Getoetet von Turm", damage list, respawn overlay with camera buttons), replay viewer (bar renders, 8x advanced 480 ticks in 2 s), tutorial card + progress bar + rings on the inventory (shop step).
- Not verified: surrender panel (classic only from 15:00, no cheat to skip time; panel code only); minimap ping wheel sounds; tutorial tower step in a browser; buff ring look (no buff active during the check, CSS only).
- Minor, left: respawn overlay overlaps the sandbox panel (sandbox only); the F3 overlay keeps "Grafiktest laeuft ..." while the pane is hidden (rAF throttled).
