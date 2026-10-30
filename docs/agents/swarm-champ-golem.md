# swarm/champ-golem: stone golem tank (WIP checkpoint, research only, no code yet)

Branch `swarm/champ-golem` (from origin/main 23c7f08). Stopped by the coordinator after research; nothing implemented, no
browser/server started, no node_modules junction created.

## Decisions (design)
- id `gneis`, name "Gneis Mauerherz", title de "der Wandelnde Fels" / en "the Walking Cliff", roles ["top"], archetype `wall_tank`,
  melee range ~150, radius ~75, mana. Stats near Brom/Oleth: hp 700/+116, armor 40/+5.0, mr 32/+2.05, ad 58/+3.2, as 0.6, ms 330.
- Passive `gneis_foundation` (Grundmauer): +12 armor and MR per own earth wall within 450 (max 2), via onComputeStats.
- Q Felsbrocken (skillshot_line ~850, w 110, speed 1100): damage + hook `gneis_q_boulder`: knockback ~260; if the path hits a
  non-walkable nav cell the target stops there and is stunned (ability `duration` Ranked 0.9..1.3 s) + 40 % bonus damage.
- W Erdwall (zone, line perpendicular, range 650, radius 190, width 100, delay 0.45, duration 3..4 s): damage + airborne, hook
  `gneis_w_wall` copies Oleth R (`blockTerrain(sim, wallCells(...), ticks)`), records the wall in hookState for passive and visuals.
- E Steinschulter (dash ~475, stopAtEnemy via dashStart hook like `oleth_e_stop_on_enemy`): shield + shove the hit enemy 300 along the
  dash; same wall-slam helper. Dashes stop at walls already (stepMoves `blocked`, only `through`/leapTo ignore walls).
- R Bergsturz (skillshot_circle, range ~900, radius 300, delay 0.9): damage + knock enemies outward + crater rim of walls
  (`ringCells` radius ~330, thickness ~100, with an opening facing the caster, filter cells by dot product, no atan2) -> outward knock
  into the rim slams/stuns.
- Shared helper in the hook file: `slamPush(sim, src, t, dx, dy, dist, stunSecs)`: march from the target in 10-unit steps with
  `walkable(sim.map.nav, ...)`; free distance = last clear step; `displaceTo(...)` there; if blocked, `addBuff stun` + bonus damage.
  Sim code must stay deterministic (no Math.random/sin/cos/atan2/pow). Hook state only via `hookState`.
- Item: legendary `schollenpanzer` (en "Slabplate"), from kettenhemd + wetterhorn + lederweste (unique recipe, checked against
  items.json and docs/IDEAS-FEEL-SHOP.md), ~2800 G, stats armor 60 / hp 300 / haste 15 (efficiency ~98 %), passive hook
  `stone_plate` (add to `ITEM_HOOKS` in src/sim/items/itemHooks.ts): `onAbilityHit` on enemy champions adds a stack (max 4, 5 s,
  +6 armor and +6 MR each via same-id stat buffs with `flat`). Icon row: glyph `fist`, hue 30, sat 18, accent `shield` (check the
  glyph@hue pair is unused; `fist` is only used by `zaehigkeit` at hue 120).

## Registries to touch (grep'd from vargrim/fenna/sev)
- src/data/champions/gneis.json + index.ts (import + `raw`), src/sim/champions/gneis.ts + index.ts (import + CHAMPION_HOOKS)
- src/data/builds/gneis.json (copy oleth, template tank, add schollenpanzer to core) + src/ai/bot/builds.ts (import + BUILDS)
- src/data/runePresets.json: copy the `oleth` block (4 presets standard/aggressiv/sicher/gegen_magie, file is UTF-8 BOM, LF, mojibake text, edit as text) as `gneis`
- src/data/voiceLines.json: 8 keys (pick move1 move2 attack ability kill death recall), de+en, each <= 80 chars, move1 != move2
- src/render/abilityMotifs.json `champions.gneis`: 4 distinct motifs, e.g. [["bomb",32],["shield",38],["boot",24],["gem",28]]; optional `tagParticles` rows for `gneis_*` tags
- src/render/champions/casts.ts: `gneis: F(a, b, 'xxxx')` with two different styles, both used; self abilities must use stomp/raise/ring/spin/slam
- src/render/champions/motion.ts: `MS.gneis` = base ms (test checks), `SPECS.gneis` with unique gait JSON, unique idle JSON, unique drag/asym/impact triple (tests/motion.test.ts); stride ~26 for cadence ~14
- src/render/champions/golem.ts (new, non-human drawer like cavalry.ts: wide boulder body, tiny head, huge fists, rune glow, moss; frames idle 6/run 8/attack 5/cast 4/death 3, `GNEIS_KIT` stub + `GNEIS_DRAWER`), kits.ts (import + `kit(GNEIS_KIT)`), atlas.ts (import + `gneis: GNEIS_DRAWER` in DRAWERS). One-line registry additions only; do not touch championSprites.ts, sheets.ts, particles, audio, game.ts.
- Ground objects: src/render/golemFx.ts (like fennaFx.ts) + 3-line hook in src/render/groundObjects.ts for tags `gneis_w_wall`, `gneis_r_rim` (shape `wall`, visuals via ChampionVisuals.objects)
- src/sim/trainer/scenarios.ts: add `gneis` to `TOP` (line 73); tests/championData.test.ts ROSTER list is additive only
- docs: docs/champion-hooks.md (hook table + total count line), docs/spec-champions.md (roster entry 29/30 + Rollen Top list)
- Items: src/data/items.json, src/data/itemIcons.json, src/sim/items/itemHooks.ts (+ exported constants), German + English texts

## Tests to write
- tests/gneis.test.ts (use tests/combat-helpers.ts, tests/vargrim.test.ts and tests/fenna.test.ts as templates; import combat-helpers first): every ability, wall blocks a path / dash, boulder into wall stuns, boulder in open ground does not stun, R rim slams, passive armor near wall, item stack passive.
- Run only: `npx vitest run tests/gneis.test.ts tests/championData.test.ts tests/casts.test.ts tests/motion.test.ts tests/abilityMotifs.test.ts tests/voiceLines.test.ts tests/itemIcons.test.ts tests/items.test.ts tests/goldEfficiency.test.ts tests/replay.test.ts` (replay once), then `npx tsc --noEmit` once before the final push.
- Needs the node_modules junction (PowerShell `New-Item -ItemType Junction`), delete it at the end with `(Get-Item <worktree>\node_modules).Delete()`.
- One sandbox screenshot at the end, then close tab + server + headless browsers.

## Engine facts verified (so the next agent need not re-read)
- Terrain walls: `blockTerrain/wallCells/ringCells` in src/sim/summons.ts (CELL = 50; units inside are pushed out to the nearest walkable cell). Oleth R (`src/sim/champions/oleth.ts`) is the pattern incl. visuals.
- Displacement and dashes stop at non-walkable cells (`moveUnit` / `stepMoves` in src/sim/systems/abilities.ts); no engine event for "hit a wall", so the slam check is done in the hook.
- Projectile hit ctx carries `dx,dy` (cast direction); zone ctx `x,y` = line centre, `radius` = half length, `width` = thickness.
- Hook ids must be unique per champion; ability ids start with `<id>_`; max 1 dash per champion; castTime <= 0.5.

## Status
Nothing implemented. Next agent: start at "Registries to touch" in the order data JSON -> hook file -> tests -> render kit -> items -> docs.
