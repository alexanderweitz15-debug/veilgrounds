# swarm-plants (partial: wrapped up on lead order)

Done (sim): 3 new fruits - Manafrucht (35 % max mana, min 60), Windfrucht (+35 % MS 4 s), Schildfrucht (80 + 10 % max HP shield 5 s), de/en names + effect hint on the world label. Honigfrucht now drops 5 honey pieces (Kind.Plant, variant honigstueck, untargetable) on a ring; first champion walking over one eats it (heal 12 + 1.8 % max HP, 20 % slow 1 s), pieces rot after 30 s. Values in src/data/plants.json. `SnapEntity.grow` + death-event `variant` are in the snapshot for the render. 24 plants on the map (6 per quarter) (positions scanned for open ground, map.test reachability green).
Files: src/sim/systems/plants.ts, src/data/plants.json, types.ts, damage.ts, snapshot.ts, map.json, i18n, overlay.ts, minimap.ts, monsters.ts, tests/jungle.test.ts (see shared-changes.md).
Tests: tests/jungle.test.ts (plants block: count, honey pieces, mana/wind/shield), map.test (reachability), i18n.test.

NOT done (open items):
- Painted drawers for the new fruits + honey piece: they alias the old three sprites (monsters.ts MONSTER_SPRITE) at 0.9x / 0.3x. Plan: own PLANT atlas (camp atlas is near its 512-cell limit), sheets.ts returns a third atlas (units.ts already loops over any number).
- Grow/ripe/pop effects: sim gives `grow` and death `variant`; the render does not use them yet (needs an optional scale arg in championSprites.push - agent F's file - and a small PlantFx for pop bursts).
- Bot hook (`plants` leaf in tree.json + values.json): bots ignore plants and honey pieces. Plan: src/ai/bot/plants.ts, filter snap.entities for Kind.Plant, detour when hp/mana low and no enemy near.
- No screenshot taken.
