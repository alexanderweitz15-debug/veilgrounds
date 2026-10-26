# swarm elemental-drakes

Branch `swarm/elemental-drakes`. Status: sim + snapshot + data DONE, client UI NOT DONE (wrapped up on lead's request).

## Built
- `src/data/drakes.json`: 5 elements (Glut, Flut, Fels, Wind, Arkan; ids glut/flut/fels/wind/arkan, colors), `perKill` and `soul` stat bonuses, `soulAt` 4, `elder` (Uralt-Leviathan: 7500 HP, 130 AD, radius 140, respawn 360 s, buff 150 s, execute below 20 % HP).
- `src/sim/drakes.ts`: state, rotation, bonus. Rotation: spawn 1 random; after kill 1 the next element is announced (spawn 2, differs); spawn 3 = soul/map element (differs from 1+2, revealed after kill 2); later random, never repeating the previous. Kills of both teams advance the rotation.
- Stacking: each kill adds its element `perKill` to the killing team (through `inventory.bonusStats`). 4th kill of a team = soul (soul element = map element) adds the element `soul` bonus; the pit then spawns the Uralt-Leviathan (360 s after the soul kill and after each elder). Elder kill: living champions of the killer team get mark `uralt` (150 s); their hits execute enemy champions below 20 % HP (`damage.ts`).
- Snapshot (additive): `objectives.drake`, `SnapEntity.elem`. `game/objectives.ts` exposes drakes/soulElem/elderLeft.
- i18n de/en: names, `buff.uralt` (HUD buff bar shows the execute buff).

## Tests
- `tests/sim/elementalDrakes.test.ts` (6 tests, pass): rotation over 6 seeds (announced next, third = soul type, no repeats), spawn = announced, kill stacking + stats, soul at 4, elder spawn/respawn, elder execute buff.
- `tests/objectives.test.ts`, `tests/sim/snapshotBots.test.ts` pass. `tsc --noEmit` clean.
- `tests/replay.test.ts` / `tests/jungle.test.ts` NOT verified: vitest worker crashed / timed out under machine load. Lead please run them (the only rng use is `sim.rng` at Leviathan spawn/kill, deterministic).

## Open items (not done)
- Scoreboard/objective-bar element icons (`ui/scoreboard.ts`, `ui/icons.ts` drakeIcon; colors in drakes.json; use `TeamObjectives.drakes/soulElem`), de/en announcements (next element, soul, elder spawn/kill; keys `ann.drake*`), per-element tint on the monster (needs an RGB tint in `championSprites.ts`, owned by agent F; alternative: colored ground ring in `render/units.ts` via `SnapEntity.elem`), minimap badge color.
- Bot team AI values by element in `src/data/bots/values.json` + `ai/utility/value.ts` `objectiveValue` (soul/elder bonus); bot respawn timers (`ai/perception/perceive.ts`, `ai/ganks/common.ts`) still assume 300 s, elder is 360 s.
- Decision: stat-based effects only (no combat hooks) to stay cheap and deterministic; numbers are in drakes.json for tuning. Old flat +6 % AD/AP per stack replaced.
