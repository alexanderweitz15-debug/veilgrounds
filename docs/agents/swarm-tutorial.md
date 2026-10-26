# swarm-tutorial (branch swarm/tutorial-2)

Interactive tutorial as a sandbox-sim mode. 10 steps: move, attack-move, level an ability, Q/W/E/R on the dummy, shop, ward, recall, 5 last hits, destroy a tower, summoner spell.

## Files
- `src/ui/tutorialSteps.ts`: DOM-free engine (detection from snapshots + observed player commands, sandbox preparation via cheats, flash phase, skip, restart, resume, progress in localStorage with try/catch).
- `src/ui/tutorial.ts` + `tutorial.css`: step card (title, text with live key labels, n / total, tip after 25 s, skip / quit, finish card with restart), progress bar, highlight rings (own overlay, `getBoundingClientRect`, no classes on HUD nodes), progress saved on every engine change, mousedown/pointerdown stopped on the card.
- `src/game/modes.ts`: `tutorialConfig`, `isTutorialConfig` (marker `trainer.scenario === 'tutorial'`).
- Hooks (additive): `src/game/session.ts` (controller instead of SandboxPanel, `ingest`, `frame`, `watchLink`, `dispose`), `src/game/game.ts` (one line `extras.watchLink(this.link)`), `src/main.ts` (menu entry, `?play=tutorial`, tutorial sessions are not saved to match history).
- i18n de + en: `menu.tutorial*`, `tutorial.*`, `tutorial.step.<id>.title|text|tip` (same keys).

## Engine fixes found by running the tests
- Step starts right at `advance()` from the last snapshot (an action before the next snapshot no longer shifts the baseline).
- Recall: the sim shows `recallLeft` 0 for one tick before the teleport; done = bar ran out (last value <= 0.2 s) and player in fountain. Earlier bar end = interrupted, restart.

## Tests
- `npx vitest run tests/tutorial.test.ts tests/i18n.test.ts`: 29 + 3 pass (walk test ~12 s). `npx tsc --noEmit` clean.
- Walk test (real sim) covers every step except `tower`, which it skips via `skip()`; the tower-kill detection is unit tested only. A scripted tower kill took > 10000 ticks without success (script walks with the wave, not tuned).
- Worker crashes ("Worker exited unexpectedly", esbuild stopped) seen while the machine was overloaded; rerun passed.

## Open
- No screenshot taken (wrap-up order). UI not looked at in a browser: card position (top centre, 56 px), ring placement and key-label text untested visually.
- Tower step may take minutes for a human (wave walk, level 9 cheat); not verified end to end.
- Minions are enabled from the lastHit step on and stay on; later steps (tower) rely on that.
- Shop step text assumes the shop opens on `{shop}` key (P) and a purchase is a plain click flow.
