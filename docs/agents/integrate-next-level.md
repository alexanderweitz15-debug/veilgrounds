# integrate/next-level: merge of `claude/veilgrounds-next-level-f6na23` into main (23c7f08 + d122da5, 48a4c31)

Branch `integrate/next-level` (pushed; main untouched). 50 next-level commits, 18 files with content conflicts (50 hunks).
Rule used: keep both sides; where two systems did the same job keep one and leave a `ponytail:` comment.

## Conflicts and how they were resolved

| File | Resolution |
|---|---|
| `public/sw.js` | same-origin only + cache status 200 only (next-level v2, self-hosted fonts); main's `/atlas/` bypass (baked strips live in IndexedDB) kept. |
| `src/ai/utility/select.ts` | next-level `clearForcedWave` import; **no `sevQFake`** (removed on main on purpose). |
| `src/audio/sfx.ts`, `eventSounds.ts` | next-level audio manager (buses, voice limits, spatial) is the base. Main's cues re-added to the new cue table: 7 ping voices (`pingDanger`..`pingOk`, `pingCue()`), `buy`, `sell`. `playFizzle` stays (ping spam lockout, used in game.ts) but the fake-cancel use in `eventSounds` is gone. |
| `src/game/settingsIO.ts`, `ui/settingsPanel.ts` | union of ranges / slider keys: main's gfx (`renderScale`, `fpsCap`, `gfxParticles`, `gfxPixelRatio`, `gfxShadowMap`) + next-level's bus volumes. |
| `src/sim/damage.ts` | both imports (`TOWER_DATA` for fortification/towerMult, `ItemHook` for `onShieldBreak`). |
| `src/sim/systems/minions.ts` | main's aggro tiers 1..8 + catch-up speed kept; BUG-01 (`nearest(..., seen=true)`, bushed minions) and BUG-03 (skip a lane vertex between two friendly bodies) applied on top, using main's tier numbers (6 minion / 7 structure / 8 champion). |
| `src/sim/items/itemHooks.ts` | next-level data-driven item engine is the base (code hooks gone). Main's additions re-applied: undo ledger calls (`clearUndo` on leaving the fountain and on `useItem`), and **Duskband** as a small code hook (`DUSK_BAND`) because `modifyHeal` rules in data may only return `healMult`. `"hook": "dusk_band"` removed from `items.json`; `tests/fennaKit.test.ts` adjusted. |
| `src/sim/items/schema.ts`, `inventory.ts` | penetration and tenacity were built twice (main G/V1 in `systems/stats.ts`, next-level A7 as delta in `applySecondaryStats` + a `TENACITY` hook). Kept main's: item stats `armorPenPct`, `magicPen`, `magicPenPct`, `tenacity`. Next-level's `tenacityPct`, its `PEN` delta block and `TENACITY` hook dropped (they would double count). `tests/fixtures/itemEngineItems.json` and `docs/ITEMS-FORMAT.md` renamed `tenacityPct` -> `tenacity`. |
| `src/render/particles.ts`, `vfx/system.ts` | next-level GPU particle system is the base; main's `density` (gfx particle setting) moved into `VfxSystem` (`emit` multiplies `scale * density`) with a `Particles.density` accessor, so `world.ts applyQuality` works unchanged. |
| `src/render/fx.ts` | next-level VFX bus + enemy-telegraph draw order (`setEnemy`, warning sparks, `READ`) is the base. Main kept: `lolTelegraphs` thin outline (computed inside `ShapeView.show` as `enemy && settings.lolTelegraphs`), tower target marks (`towerMarks`), element-coloured drake particles, missile shapes. |
| `src/render/spriteTiming.ts` | both sets of helpers kept. One run-pacing system: the machine uses `runSpeedScale`, which now uses main's feel-tuned clamp 0.75..1.5 (next-level had 0.55..1.7; `tests/animData.test.ts` updated). `runRate` / `windupMsOf` stay exported for their tests. |
| `src/render/world.ts` | next-level `castKindOf(type, champ, slot)`. |
| `src/render/championSprites.ts` | **next-level state machine (`anim/machine.ts`) is the base; main's feel hooks ported onto it**: intent facing on click, F squash/stretch/lean springs (`KICKS` on hit, turn, strike via `hitFrame` event, cast release via `release` event, run start/stop), `groundBlob` contact shadow, champion flinch 13 (`UnitAnim.flinch`), cast pose ends early while walking (`castPoseActive` in the machine), two cast families per slot (`castFamily`/`castSelfPose` in `castFrame`). Distance-paced run phase seeded once = the machine's `runMs` (same behaviour, one system). Wind-up from the snapshot = machine's exact `atkStart/atkEnd`. |
| `src/render/champions/atlas.ts` | next-level `layoutAtlas`/placeholders/`missing`/`applyRateOverrides` + main's `still` option (stand-in atlas), motion-based `rateOf`, `GALLOP_FPS`. |
| `src/render/sheets.ts` | main's baked-strip cache (`staticStrip`, `ART_VER`), three monster atlases [big, camp, plants], progress listeners, stand-in atlas; every bake goes through next-level's `bakeChecked` (canvas-area cap, blank-canvas rebake, 20 s worker stall watchdog). IndexedDB guarded with `atlasStoreAvailable()`. |
| `src/game/game.ts` | one loader: A1 preloader steps (shared per session, watchdog, hard limit, checkerboard fallback, `onLate` swap) with main's staged start. New `preloadChampions` / `preloadMinions` / `preloadMonsters` in `render/loader/preloader.ts`; clock starts after the champion step, stand-in atlas after 2.5 s, minions +2.5 s, monsters last. `preloadMatch` (all steps, lobby loading screen) kept; monsters step now returns 3 atlases. Replay `opts.link`, `silent`, `GameOpts` kept. Fixed a duplicated `soundForEvent` call from the auto-merge. |

Auto-merged without conflict, checked: i18n, `main.ts`, `classicLobby.ts` (lobby waits for the whole preloader), `units.ts`, `settings.ts`, docs.

## Dropped (and why)

- `sevQFake`, fake-cancel fizzle (main removed it on purpose).
- Next-level `tenacityPct` / `PEN` delta / `TENACITY` hook (duplicate of main's item stats).
- Next-level run clamp 0.55..1.7 (main's tuned 0.75..1.5 wins).
- Main's inline attack/cast/run frame logic in `championSprites.ts` (replaced by the machine, features ported).
- `docs/agents/wave1-a7.md` and `docs/REQUESTS.md` still say `tenacityPct` (historical notes).

## Follow-ups

- Hard-coded `3` for the flex frame in `tests/animMachine.test.ts` was from the 4-frame cast layout; now `CAST_FLEX`.
- Bot hints regenerated for Vargrim (main changed Vargrim after the hints were generated).

## Tests

- `npx tsc --noEmit`: clean.
- Full suite (140 files) in 4 chunks. First run: chunks 1 and 3 green; chunk 0 and 2 had 12 failing tests in 8 files, all stale tests, none a sim/determinism regression:
  - `animMachine`, `animData`, `loaderWorker`, `loaderLayout`: hard-coded 4-frame idle/cast layout from before agent F (now `FRAMES` / `CAST_FLEX`, atlas for 10 champions is 8192x8192 uncapped).
  - `assetManifest`: Fenna has a kit on main now (no known art gap; the placeholder test uses a made-up id), plants are 7 not 3 -> manifest got a `monstersPlants` group from `PLANT_IDS`.
  - `a2SimBugs` BUG-01: bush coordinates from the old map, now derived from the nearest bush.
  - `a13Hints`: Vargrim hints regenerated (`npx tsx tools/botHints/generate.ts`) after main's Vargrim change.
  After the fixes all of these files, plus `replay.test.ts`, `bots.test.ts`, `fennaKit`, `itemEngine`, `loaderPipeline`, pass (12 files / 179 tests).
- `BAKE_SPRITES=0 npx vite build`: ok (35 s).
- Determinism: `replay.test.ts` and `bots.test.ts` green. The merged sim differs from main by design (BUG-01..03 change match hashes; item engine is bit-identical per next-level's golden tests, which pass).
- Not run: in-browser check of the merged render path (sprite machine + springs + staged loader). Do one visual pass before merging to main.
- Merged `origin/main` again at the end (d122da5 Vargrim Q on the move / E rideAlong, 48a4c31): no conflicts.
