# swarm/a11y - WIP checkpoint (stopped by coordinator, continue in a new agent from this branch)

## Finding
Most of the task already existed: `colorMode` (deuteranopia/protanopia/tritanopia via `REL_PALETTES`), `reduceMotion`, `highContrast` (HUD + outlined HP bars), `uiScale`. There is no screen shake in the game, so nothing to damp there.

## Done (committed, untested except the a11y test)
- `src/settings.ts`: new `textScale` (default 100), `textScaleFactor()`, `txtPx(px)` (canvas font helper, not yet used).
- `src/game/settingsIO.ts`: `textScale` range 90..150 (one line).
- `src/ui/settingsPanel.ts`: text-size slider row (one line + union type).
- `src/i18n/{de,en}.json`: `set.textScale`.
- `src/ui/display.ts`: sets CSS `--txt`; ping override logic moved to pure `pingColors(mode)` in `src/render/palette.ts`.
- `src/render/palette.ts`: `allySeal`/`enemySeal` added to `RelPalette` (normal keeps old yellow/orange); `me`/`meBar` in deuteranopia/protanopia changed from yellow to white (yellow vs orange enemy was only delta-E 25-28 under simulation).
- `src/ui/minimap.ts`: seals use `REL.allySeal/enemySeal` (were hard-coded).
- `src/ui/a11y.css`: `--txt`, `--uit = --ui * --txt`; text-heavy panels zoom by `--uit`; `.menu-screen > :not(canvas)` zooms by `--txt`.
- `tests/a11yPalette.test.ts`: Machado CVD simulation + CIE76 delta-E >= 30 for ally/enemy, shots, texts, clicks, homing, seals, me vs ally/enemy per mode; ping mapping; textScale default + import clamp. Result: 9/9 pass.

## Next steps
1. `src/ui/overlay.ts`: wrap canvas font sizes with `txtPx()` (lines ~121, 205, 256, 270, 377, 383, 396, 415: `ctx.font = ...`). Also `src/ui/cues.ts` if it has fixed canvas fonts.
2. Verify layout at textScale 150 (menu `.modes` uses `100vw - 56px`, may overflow; fix with `/ var(--txt)` if so).
3. Optional: monster bar colour `#d8a64a` in overlay.ts vs enemy under protan; ping colours `PING_COLOR` other kinds not covered by test.
4. `npx tsc --noEmit` once; `npx vitest run tests/a11yPalette.test.ts tests/settingsIO.test.ts tests/i18n*.test.ts`.
5. One screenshot per palette (sandbox game, `colorMode` set via settings), close tab + vite server right after.
6. Add to `docs/agents/shared-changes.md` (heading `swarm/a11y`): settings.ts +textScale, settingsIO.ts +1 range line, settingsPanel.ts +1 row, i18n +set.textScale.
7. Delete node_modules junction: `(Get-Item <worktree>\node_modules).Delete()`.
