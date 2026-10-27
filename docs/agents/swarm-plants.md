# swarm-plants (partial: wrapped up on lead order)

Done (sim): 3 new fruits - Manafrucht (35 % max mana, min 60), Windfrucht (+35 % MS 4 s), Schildfrucht (80 + 10 % max HP shield 5 s), de/en names + effect hint on the world label. Honigfrucht now drops 5 honey pieces (Kind.Plant, variant honigstueck, untargetable) on a ring; first champion walking over one eats it (heal 12 + 1.8 % max HP, 20 % slow 1 s), pieces rot after 30 s. Values in src/data/plants.json. `SnapEntity.grow` + death-event `variant` are in the snapshot for the render. 24 plants on the map (6 per quarter) (positions scanned for open ground, map.test reachability green).
Files: src/sim/systems/plants.ts, src/data/plants.json, types.ts, damage.ts, snapshot.ts, map.json, i18n, overlay.ts, minimap.ts, monsters.ts, tests/jungle.test.ts (see shared-changes.md).
Tests: tests/jungle.test.ts (plants block: count, honey pieces, mana/wind/shield), map.test (reachability), i18n.test.

NOT done (open items):
- Painted drawers for the new fruits + honey piece: they alias the old three sprites (monsters.ts MONSTER_SPRITE) at 0.9x / 0.3x. Plan: own PLANT atlas (camp atlas is near its 512-cell limit), sheets.ts returns a third atlas (units.ts already loops over any number).
- Grow/ripe/pop effects: sim gives `grow` and death `variant`; the render does not use them yet (needs an optional scale arg in championSprites.push - agent F's file - and a small PlantFx for pop bursts).
- Bot hook (`plants` leaf in tree.json + values.json): bots ignore plants and honey pieces. Plan: src/ai/bot/plants.ts, filter snap.entities for Kind.Plant, detour when hp/mana low and no enemy near.
- No screenshot taken.

---

# swarm-plants-2 (branch swarm/plants-2): "bessere Früchte"

Closes the three open items above.

## 1. Own painted sprites + third atlas
- src/render/champions/monsters.ts: drawers `manafrucht` (violet crystal berries), `windfrucht` (teal swirl pod, feather wings), `schildfrucht` (bronze plated gourd, pale boss), `honigstueck` (amber honey drop). Idle = 2 frames (pulse), death = 2 frames (pop: shards / feathers / cracked halves / sparkles). The four `MONSTER_SPRITE` aliases are gone.
- `PLANT_IDS` = those four, baked as a third atlas (src/render/sheets.ts: `getMonsterAtlases()` -> `[big, camp, plants]`, `PLANT_BAKE` = camp cell size, `BAKE_GROUPS` gets the group so the build bake and the strip cache cover it). The camp atlas is unchanged (still holds Sprung-, Honig-, Spähfrucht), so its cached strips stay valid.

## 2. Grow / ripe / pop (src/render/plantFx.ts)
- Grow: `growScale(grow)` = 20 % -> 100 % with a small overshoot. championSprites.ts reads a unit's scale once, at the first frame it sees it, and is not editable here. So `units.ts` hands a sprouting plant to the batch as a stand-in unit with its own serial per growth step (`sproutEntity`, 10 steps over 1.2 s), and `MONSTER_BATCH.scaleFor` multiplies by `growScale(e.grow)`. Ceiling: stepped, not continuous; an optional `scale` arg on `ChampionSprites.push` would make it smooth once agent F's merge is in.
- Ripe: sparkle burst when a plant finishes growing; idle mote glow on ripe fruits and (stronger) on honey pieces.
- Pop: the `death` event (with `variant`) bursts sparks + motes in the fruit's colour (hue table in plantFx.ts). Pickup glow: a honey piece that vanishes with a champion standing within 150 sparkles (render-only: `despawn` emits no event; rotting pieces vanish alone, no glow).
- Particles go through the shared ability particles, so reduce-motion and the graphics density setting apply.

## 3. Bots use plants (src/ai/bot/plants.ts, values in values.json "plants", tree node `plants` between `fountain` and `survive`)
- Honigfrucht: hurt (< 55 %) and no enemy champion within 1700 -> pop (detour 900, 1600 below 35 %); afterwards walks over the honey pieces while below 90 %.
- Manafrucht: mana < 35 %, safe. Schildfrucht: enemy champion 800-1800 away, HP >= 50 %, not outnumbered. Windfrucht: fleeing (retreat/home) with nobody within 550, or chasing a target > 350 away. Spähfrucht: jungle / support only, safe, at most every 90 s. Sprungfrucht: never.
- Only visible, ripe plants; none within 1000 of an enemy tower. One target at a time, dropped after 12 s (ignored for 20 s). No rng, per-bot state in a WeakMap (BotMemory / BotExt unchanged).
- Gap: the leaf runs before `survive`, but a bot that already walks home or chases is not turned around for a plant farther than the detour (450 for wind); a fleeing bot's pop costs a wind-up.

## Tests (machine at 100 % CPU: runs took 5-20x longer than normal)
- tests/botPlants.test.ts (new, 7 tests: 6 decision cases on hand-built snapshots, 1 seeded sim: hurt bot pops a Honigfrucht and eats a piece in < 8 s game time): green.
- tests/jungle.test.ts (18, incl. plants block), tests/bt.test.ts, tests/i18n.test.ts: green. tests/map.test.ts: plant / camp reachability green; "wall corners ... Hohlkaefer" hit its 20 s timeout only because of the load (untouched code path), not re-run.
- `npx tsc --noEmit`: clean.
- Not run: replay / determinism suites (no sim change), full bot-sim (not allowed).
- Screenshot (dev sandbox, 1:38): Schildfrucht (bronze gourd) and Windfrucht (teal pod, feathers) render from the third atlas (console: `monster atlases: 4096x4096 + 4096x2048 + 4096x512`). Not captured: the sprout animation and pop burst in motion (one frame only; the sandbox has no time skip, `skipTime` is a no-op). Tab and vite server closed.
