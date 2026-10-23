# swarm-tutorial (partial, dropped for brain-lane)

Branch `swarm/tutorial`. Task: interactive tutorial as trainer mode. State: logic + config + tests written, nothing run, UI missing.

## Done (uncommitted-before, now committed, never executed)

- `src/ui/tutorialSteps.ts`: DOM-free engine. 10 steps (move, attackMove, levelUp, cast, shop, ward, recall, lastHit, tower, summoners), detection from `Snapshot` + observed player commands (`onCommand`), state-driven sandbox preparation (teleport/setLevel/gold/learn/noCooldowns/minions via cheats), flash phase, skip, restart, resume, saved progress (`loadProgress`/`saveProgress`, localStorage in try/catch).
- `src/game/modes.ts`: `TUTORIAL_MARK`, `isTutorialConfig`, `tutorialConfig` (sandbox sim, `trainer.scenario === 'tutorial'` marker, minions off, mid lane only). Additive.
- `tests/tutorial.test.ts`: unit tests per step + real-sim scripted walk. NOT RUN. Will fail until i18n keys exist.

## Open

1. i18n de+en (same keys): `menu.tutorial/Desc/Meta`, `tutorial.*` UI keys, `tutorial.step.<id>.title|text|tip` for all 10 ids. Text placeholders must be in the step's `keys` (test checks). lastHit text uses `{total}` -> add `'total'` to that step's `keys` or drop it.
2. `src/ui/tutorial.ts` + `tutorial.css`: card (title, text, n/total, tip after `showTip`, skip/quit/restart buttons, finish card), highlight rings from `step.highlight` selectors (own overlay div, `getBoundingClientRect`, not classes on HUD nodes), stop mousedown/pointerdown propagation on the card, persist via `saveProgress` on `engine.onChange`.
3. Hooks (additive, list in shared-changes.md): `src/game/session.ts` - for `isTutorialConfig(config)` create the controller instead of `SandboxPanel`, `ingest(snap)` per snapshot (events!), `frame()` per frame, `watchLink(link)` that wraps `link.send` to call `engine.onCommand`; `src/game/game.ts` one line calling `extras.watchLink(this.link)`; `src/main.ts` menu entry `menu.tutorial` -> `start(tutorialConfig(runes))` + `?play=tutorial`.
4. Run `npx vitest run tests/tutorial.test.ts tests/i18n.test.ts`; the real-sim walk may need tuning (lastHit/tower scripts, tower step duration at level 9).
5. Known risks: tutorial sessions >= 60 s are saved to match history (sandbox mode, same as normal sandbox); tower step may take minutes (minion wave walk); `cast` step R needs level 6 (prepared by cheat).
