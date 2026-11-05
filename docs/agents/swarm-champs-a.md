# swarm/champs-a: three new champions + items

Branch `swarm/champs-a` (from main 5f8eb20, merged 2f72f4f). One commit per champion.

## 1. Gneis Mauerherz, der Wandelnde Fels (`gneis`, top, wall tank)
- Kit: passive Bedrock (+12 armor/MR per own wall within 450, max 2), Q Boulder (knock 260; slam into wall/terrain = stun +
  40 % bonus damage), W Earth Wall (blockTerrain line wall, 3..5 s), E Shoulder (dash stops at first enemy, shoves it 300; slam =
  stun), R Landslide (circle, crater rim with opening toward Gneis, enemies thrown outward into the rim = stun).
  Numbers: `src/data/champions/gneis.json`, tunables `gneis.values.json`; hooks `src/sim/champions/gneis.ts`; slam helper `slamPush`.
- Sprite kit: paper-doll stone body (`kits.ts`, props in `src/render/champions/golem.ts`: rock hump, boulder fists, rune cracks, moss);
  motion spec (stomp gait, heavy idle), cast family lob/slam `abba`, abilityMotifs row (bomb, shield, boot, gem), voice lines,
  rune presets, trainer pool TOP, bot hints (generated), bot build `src/data/builds/gneis.json`.
- Ability visuals: `src/render/champsAFx.ts` (walls as rock slabs with crumble, crater rim ring of chunks with the gap).
- Bot mechanic: `offensiveCast` (src/ai/bot/combat.ts) casts a wall-type W (`line: perpendicular`) before Q (wall, then boulder). Data driven:
  tests/a13Hints forbids champion ids in bot code.
- Item **Schollenpanzer / Slabplate** (legendary 2800 G, kettenhemd + wetterhorn; armor 60, hp 300, haste 15): passive Strata, ability hits on
  enemy champions add a stack (max 4, 5 s), +6 armor and MR each. Item-engine rules only (addStack + onComputeStats). Icon `fist`@30.
- Tests: `tests/gneis.test.ts` (12). Full `npm test`: 134 files / 1629 tests green, tsc clean.
