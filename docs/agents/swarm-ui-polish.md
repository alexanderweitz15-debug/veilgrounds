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
