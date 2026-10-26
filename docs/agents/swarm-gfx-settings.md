# swarm gfx-settings (finished in `swarm/gfx-settings-2`)

Continues the partial `swarm/gfx-settings` (settings fields, presets, resolveQuality); merged with main 5fc933b.

## Built

- Presets: veryLow / low / medium / high / veryHigh + `custom`. Pure logic moved to `src/render/gfxPreset.ts` (no three.js, so the
  settings panel in the main bundle does not pull three into it); `src/render/quality.ts` re-exports it and keeps the PCF patch.
  `currentFields` = what the panel shows (preset values unless `custom`).
- `world.ts` applies `resolveQuality(settings)` live (shadows, shadow map, render scale = `effectivePixelRatio`, particle density);
  `Particles.density` (new, separate from `scale` which fx.ts overwrites for reduce-motion) multiplies `emit`.
- Settings panel, video section: preset select; individual toggles (shadows, shadow map, soft shadows, max pixel ratio, antialias,
  particle density, detailed ground); changing one writes `graphics: matchPreset(fields)` (custom, or the preset again if the values
  match); render scale slider 50-100; FPS cap select 30/60/120/unlimited; FPS overlay checkbox; "test at next match" button.
- FPS cap: `FrameLimiter` in `src/game/gfxTune.ts`, used in `Game.loop` (not `frame()`, the bench hook calls that).
- FPS / frame-time overlay: `showFps` setting + Action `fpsOverlay` (default F3, rebindable, `act.fpsOverlay`); `.fps-overlay` in
  gamePanels.css; shows `FPS, frame ms, CPU ms`, updated once per second.
- Auto-detect: `gfxAutoDetected` false (new installs, or the panel button) -> after the boot cover fades the game sets preset `high`,
  measures rAF gaps for 3 s (1 s warm-up skipped, stalls >250 ms ignored, frame cap off meanwhile, overlay shows the note), then
  `pickPreset({avgMs,p90Ms})` writes the preset + its fields. Old saves count as detected (no surprise benchmark).
- settingsIO: RANGES for renderScale, fpsCap, gfxParticles, gfxPixelRatio, gfxShadowMap. i18n de + en.

## Files

New: `src/render/gfxPreset.ts`, `src/game/gfxTune.ts`, `tests/quality.test.ts`.
Edited: `src/render/quality.ts`, `world.ts`, `particles.ts`, `src/settings.ts`, `src/game/game.ts`, `settingsIO.ts`,
`src/input/keybinds.ts`, `src/ui/settingsPanel.ts`, `src/ui/gamePanels.css`, `src/i18n/{de,en}.json`. Not touched: champions/**, championSprites.ts.

## Tests

`npx vitest run tests/quality.test.ts tests/settingsIO.test.ts tests/i18n.test.ts`: all green (quality: presets round trip, custom clamp,
matchPreset, effectivePixelRatio, limiter at 60/30 on 60 Hz and 144 Hz, jitter, 500 ms stall, benchmark pick/warm-up/hidden tab).
`npx tsc --noEmit`: clean. No browser run (rules); the in-game benchmark and overlay are untested visually.

## Open / decisions

- The benchmark runs at `high`, but antialiasing, soft-shadow filter and ground detail are fixed at renderer/terrain creation, so they
  stay at the previous (medium default) values during the test; cost ratios in `pickPreset` are rough estimates from the preset table.
- rAF is vsync bound: a 60 Hz display never yields veryHigh (needs avg <= 9.2 ms, i.e. >= 108 Hz). Intended.
- Closing the tab mid-benchmark leaves `graphics: 'high'` saved with `gfxAutoDetected: false`; the test reruns next match.
- Frame cap uses rAF skipping, so caps above the display rate have no effect.
