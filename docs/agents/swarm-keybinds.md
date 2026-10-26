# swarm-keybinds (FEATURE-GAP 3.1, LoL hotkey menu)

Branch `swarm/keybinds`. Stopped early by lead (agent moved to brain-lasthit); the champion task (blood mage) was
dropped, not started.

## Done

- `src/input/keybinds.ts`: primary + alternate key per action (`binds`, `altBinds`; alternate saved under kv key
  `keybindsAlt`, old saves load unchanged). `setBind(action, code, slot)` returns `{ok, reason, displaced}`: a key
  used elsewhere moves and the loser is reported (conflict warning); modifier keys and Esc/Pause/Enter are refused.
  Invariant: no alternate without a primary (HUD reads `binds`). `findConflicts`, `sanitizeBinds` (load), `clearBind`,
  `applyBinds` / `exportBindMap` (alternates travel as `<action>:alt` through the unchanged settings file format).
- Modifiers: `resolveKey(event, {selfCastMod, levelUpMod})` is the controller's dispatch entry. Self-cast
  (default Alt; alt/ctrl/shift/none) on abilities, summoners, items (not the ward). Level-up (default
  `ctrlOrShift` = old behaviour; ctrl/shift/alt) on Q/W/E/R. Level-up wins on overlap; `modifierConflict` warns.
- Cast modes per key extended from Q/W/E/R to D/F/Teleport, item1-6, trinket (`src/input/castMode.ts`): abilities
  default to the global `castIndicator`, the others to quick. Non-ability keys have no aim indicator (crosshair
  cursor in normal-cast mode only).
- Presets: "LoL-Standardlayout laden" (`applyLolPreset`: LoL keys, no alternates, Alt self-cast, strict Ctrl level-up;
  cast modes untouched) and "Standard wiederherstellen" (`applyDefaults`: keys, alternates, modifiers, castModes {}).
  The shipped defaults already equal LoL's layout, so the key table is the same; kept as separate constants.
- Camera lock toggle (Y), center camera (Space hold), attack move on cursor already existed; unchanged.
- `src/input/controller.ts`: only key dispatch (`keyDown`, `act`, new `fire`, aiming type, mouseDown/keyUp call
  `fire`). Ping cases untouched.
- Panel: 4-column grid (action, key, second key, cast mode), modifier selects, red marker on duplicate keys,
  warning line, hint, two buttons. Backspace/Delete clears a slot while capturing.
- Tests: `tests/keybinds.test.ts` (22), `tests/settingsIO.test.ts`, `tests/i18n.test.ts` pass; `npx tsc --noEmit` clean.

## Open

- No browser check of the panel layout (no screenshot taken, per resource rules).
- Aim indicator for summoner/item/ward keys missing (needs render/fx change).
- Old unused i18n key `set.castMode` remains.
- Mouse buttons not bindable.
