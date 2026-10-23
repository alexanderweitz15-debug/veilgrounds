# swarm gfx-settings (PARTIAL - agent moved to brain-hp)

Branch `swarm/gfx-settings`. Foundation only; the UI, frame cap, overlay and auto-detect are NOT built.

## Done

- `src/settings.ts` (additive): `GraphicsPreset` (veryLow/low/medium/high/veryHigh), `GraphicsQuality` = preset | `'custom'`,
  `GRAPHICS_QUALITIES`; fields `gfxShadows`, `gfxShadowMap`, `gfxSoftShadows`, `gfxPixelRatio`, `gfxAntialias`,
  `gfxParticles` (percent), `gfxTerrainDetail`, `renderScale` (percent), `fpsCap` (0 = uncapped), `showFps`,
  `gfxAutoDetected`. Defaults = medium preset. Old saves (no `gfxAutoDetected`) are marked detected (no benchmark).
- `src/render/quality.ts`: 5 presets with new `particles` + `terrainDetail`; pure `presetFields`, `resolveQuality`
  (preset table, or the gfx* fields for `'custom'`, clamped), `matchPreset`, `effectivePixelRatio` (dpr cap x renderScale).
- `src/render/world.ts`: uses `resolveQuality`; render scale applied live (only resizes when the ratio changes);
  terrain detail passed to `buildTerrain` as `'medium'|'low'` (terrain.ts untouched, next match).
- `src/game/settingsIO.ts` (shared, 2 lines): graphics enum = `GRAPHICS_QUALITIES`.

## Open

1. `src/render/particles.ts`: add `density` multiplier in `Particles.emit` (`count * scale * density`); world sets it from
   `resolveQuality(settings).particles` (fx.ts overwrites `scale` every frame from reduceMotion, so do not reuse `scale`).
2. settingsPanel video section: preset select (`veryLow..veryHigh, custom`; picking a preset writes `presetFields(p)`),
   individual controls (write `graphics: matchPreset(fields)`), render scale slider (50..100, widen the `slider` key union),
   fps cap select (30/60/120/unlimited), fps overlay checkbox, "auto-detect" button (`gfxAutoDetected:false` = benchmark at
   next match start). settingsIO RANGES for `renderScale`, `fpsCap`, `gfxParticles`, `gfxPixelRatio`, `gfxShadowMap`.
3. Frame cap in `game.ts` `loop` (not `frame()`, the bench hook calls that): pure limiter, `interval=1000/cap`, tolerance
   `min(rafGapEMA/2, interval/2)`, `last += interval`, resync `last = now` after a stall. Tests: 16.67 ms rAF with cap 60 ->
   all frames, cap 30 -> every 2nd, cap 0 -> all, 500 ms gap -> one render.
4. FPS overlay: Action `fpsOverlay` (default F3) in keybinds.ts + `act.fpsOverlay` i18n; toggle `showFps` from a keydown
   listener in game.ts (controller ignores unknown actions; do not route through controller, paused state blocks it).
5. Auto-detect: in-game 3 s benchmark after the cover is gone (skip 1 s warm-up, cap off, preset temporarily `high`),
   pure `pickPreset({avgMs, p90Ms})`: p90 <= 19.2 ms -> high (veryHigh only if avg <= 9.2 ms), else scale avg by preset cost
   ratios (veryLow .3, low .48, medium .74, high 1, veryHigh 1.7) and take the highest with est <= 17.5 ms. rAF is vsync
   bound, so a 60 Hz display cannot reveal headroom beyond `high`.
6. i18n de+en keys (`set.gfx.*`, `set.fpsCap`, `set.renderScale`, `set.particles`, `set.terrainDetail`, `act.fpsOverlay`...).
   Existing `set.gfx.low` text says "(ohne Schatten)" - still true.
7. Tests (tests/quality.test.ts): preset mapping, resolveQuality custom/clamp, matchPreset, effectivePixelRatio, limiter.

## Tests

`tsc --noEmit` and settingsIO/i18n tests: see commit; no new test file yet.
