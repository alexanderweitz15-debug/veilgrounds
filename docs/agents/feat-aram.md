# feat/aram - state at checkpoint (no code written yet, research only)

Task: new mode "Nebelbruecke" (ARAM-like): one long lane map, 5v5 bots, random champion per player (one reroll),
more gold at a higher start level, no recall, health relics, towers + inhibitor + nexus per side, snowball/mark
summoner instead of Smite, faster waves. Menu entry + lobby option, de/en, tests, one screenshot, this report.

Branch `feat/aram` created from `origin/main` (23c7f08). No source edits, no browser, no vite server, no node_modules
junction were created.

## Findings (what the code does today)

- Map: `src/sim/map.ts` loads `src/data/map.json` at module level (`raw`, `MAP_SIZE`, `MAP_SCALE`, `k`, `pt`, `circ`).
  `loadMap()` has no parameter and is called from `sim.ts` (createSim), `game.ts` (lines ~117 and ~389), `ghost.ts`,
  `runner.ts`, `mock.ts`, `tutorial.ts`, `bakeEntry.ts`. Plan: `loadMap(id = 'main')`, parametrise `buildSide` and the
  wall/bush code over the raw object, add `id`, `jungle: boolean`, `activeLanes`, `relics` to `MapData`. Keep `size`
  14900 so camera, minimap, fog and coords (which use `MAP_SIZE`) stay valid. Add `SimConfig.map?: 'aram'` (or derive
  from `mode: 'aram'`) and call `loadMap(...)` in `createSim`.
- Structures: `towersSystem.init` loops `LANES` (3 lanes x 3 towers + inhibitor) + nexus towers + nexus.
  `updateProtection` uses `[0,1,2].some(dead inhibitor)`, `superCount` in `waves.ts` uses all three lanes. Both must use
  `map.activeLanes` (a lane without structures counts as "dead" otherwise, which opens nexus towers at once).
  Provide top/bot lane data as copies of mid in the map JSON so lane-iterating code (teamai, perception, terrain) stays valid.
- Waves: `waves.ts` honours `config.minionLanes` (use `[Lane.Mid]`). Intervals via `waveInterval(tick)` (30 s / 25 s /
  20 s): for ARAM add a config-driven factor (data in a new `src/data/aram.json`). `SPAWN_DIST.mid` is relative to the nexus.
- Jungle: `jungleState` adds camps from `map.sides[].camps` and always adds leviathan/kesselbrut/schleierwaechter/
  nebelschleicher from `map.objectives` -> guard with `map.jungle`. Plants read `sides[].plants` (empty array = none).
- Economy (`src/sim/systems/economy.ts`): `START_GOLD = 500`, `FOUNTAIN_HEAL` applied every tick in the fountain,
  `startRecall` via the `recall` command in `input.ts`. ARAM: start gold/level from aram.json (init sets level, skillPoints,
  xp = CUM_XP[level], gold), skip fountain heal (respawn already restores full HP), ignore `recall` command.
  Shop rule `canShop` (inventory.ts) is already "dead or in fountain" - nothing to change.
- Relics: reuse the honey-piece pattern in `plants.ts` (`Kind.Plant`, variant `honigstueck`, untargetable +
  invulnerable) for the visual, but own pickup logic in a new `src/sim/aram.ts` system (heal % max HP + mana, no slow,
  respawn timer, positions from `map.relics`). Register the system in `src/sim/systems/index.ts`.
- Mode id: add `'aram'` to `SimConfig.mode`; extend the `classic || laneOnly` checks where they matter:
  `announce.ts` WAVE_MODES, `main.ts` line ~187/199, `postGame.ts` 138/167, `hud.ts` (epics/jungle only for classic - keep off).
- Render: `terrain.ts` hardcodes the river (`riverDist`, anti-diagonal) and adds camp/objective sites from `map.objectives`
  (lines ~144-148, 380). Use a diagonal lane (x = y) so the river crosses the centre (fits "bridge"); guard objectives/
  camps with `map.jungle`. Ground texture cache `groundImg` and the IndexedDB bake are keyed by size only: key by map id
  and skip the bake store for the aram map (paint at runtime). `World(canvas, map)` already takes the map.
- Map generation: write `tools/genAramMap.mjs` that emits `src/data/mapAram.json` (same format as map.json). Walls as two
  big polygons (above/below the corridor, clipped to the square, split into moderate pieces for nav-build cost) in
  `neutral.walls`, empty `quarter`. Corridor half-width ~700 design units, base plazas at the ends. Suggested layout:
  nexus (4500,4500), fountain (3600,3600) r 650, lane length ~8500 design units, towers outer/inner/inhib along the
  diagonal, relics in side nooks on the lane. `buildNav` cost grows with polygon bbox x edges, cache the aram MapData.
- Bots: `BotStatic.lane` comes from role; `laneOnly` is just `minionLanes: [Mid]` + cheats, no special bot logic. For ARAM
  all bots must take lane `mid`, never `jungle` mode (brain.ts line ~322 sets `mem.mode='jungle'`), no recall (tree.json
  `recall` threshold, `utility/select.ts` and `intents.ts` recall intents - HOT file select.ts: tiny additive guard on
  `ctx.mode === 'aram'`). Roles for the 10 players: assign `mid`/`adc`/`top`/`support` but force the lane; no jungler.
  Bots still shop when dead/at fountain (`shop.ts` once per fountain visit).
- Summoner: add a snowball/mark spell to `src/data/summoners.json` + `src/sim/summoners.ts` (HOT-adjacent), use
  `['sprung','schneeball']`-like default and replace `bannen` in aram configs.
- Lobby/random pick: `modes.ts` gets `aramConfig(seed, humanPick?)` (distinct random champions for all 10 slots from the
  seeded rng, one reroll helper `rerollChampion(config, slot)` that is allowed once). UI: menu entry in `main.ts` +
  lobby option (look at `renderPracticeLobby`, `src/ui/lobby*.ts`, `src/i18n/de.json` + `en.json` same keys).

## Next steps (in order)

1. `src/data/aram.json` (startGold 1400, startLevel 3, waveFactor, relic heal pct/respawn/first spawn, snowball cooldown).
2. `tools/genAramMap.mjs` + `src/data/mapAram.json`; `map.ts` refactor (`loadMap(id)`), `activeLanes`, `jungle`, `relics`.
3. Sim: `SimConfig.mode 'aram'`, `src/sim/aram.ts` (rules + relic system), edits in towers.ts, waves.ts, jungle.ts,
   economy.ts, input.ts (log every shared-file edit in `docs/agents/shared-changes.md`).
4. Summoner (snowball/mark), `modes.ts` `aramConfig` + reroll, bot tweaks (lane forced to mid, no recall/jungle).
5. Terrain guards + ground cache key; menu entry, lobby option, i18n de/en.
6. Tests: `tests/aramMap.test.ts` (walkable path nexus to nexus via `findPath`, point symmetry of towers/walls/nav),
   `tests/aramRules.test.ts` (recall ignored, random distinct picks + one reroll, relic heal, start gold/level),
   `tests/aramGame.test.ts` (short headless bot game, tower falls or fast-forward progress within ~1-2 min).
   Run only `npx vitest run tests/aram*.test.ts`; `npx tsc --noEmit` once before push.
7. One screenshot, close tab + vite, delete junction with `(Get-Item <worktree>\node_modules).Delete()`.

## Rules reminder

Commits with `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com commit`, push to `feat/aram`.
HOT files (tiny additive edits only): game.ts, settingsIO.ts, settingsPanel.ts, championSprites.ts, sheets.ts, atlas.ts,
particles.ts, fx.ts, world.ts, src/audio/*, damage.ts, minions.ts, src/sim/items/*, ai/utility/select.ts.
