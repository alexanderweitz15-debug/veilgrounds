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

## 2. Kerrin Fesselschatten, die Kettenschattin (`kerrin`, jungle, chain assassin)
- Kit: passive Chain Mark (ability hits on champions: marks max 3 / 6 s, +4 % damage each), Q Hook Throw (unit hit = pulled to it, wall = pulled over
  it up to 450; the passive `onCast` shortens the fresh hook projectile at the first non-walkable cell, `expire` phase does the leap), W Chain Whirl
  (self AoE + slow), E Shadow Shackle (next-auto root + speed), R Headsman Chains (leap + execute at 3 marks and HP <= 18/24/30 %).
  Data `kerrin.json` + `kerrin.values.json`, hooks `src/sim/champions/kerrin.ts`.
- Execute line on the health bar: additive `exec` on `UnitMark` (hooks.ts) / `SnapMark` (snapshot.ts, passed through in addVisuals), drawn in
  `overlay.ts drawMarks` (white tick, red when marks are full; only once R is learned).
- Sprite kit: paper-doll kit + props `src/render/champions/chains.ts` (chain mantle, wrist manacles, hook blade on a chain). Motion spec, cast family
  draw/spin `abba`, motifs (hook, chain, ring, axe), voice lines, rune presets, JG trainer pool, hints (generated), build `kerrin.json`.
- Ability visuals: `kerrin_q_chain` in `src/render/champsAFx.ts` (chain with links during the pull).
- Bot mechanic: `offensiveCast` holds an execute ultimate (target mark carries `exec`) until the marks are full and the target is within 12 points of
  the line (data driven, no champion id in bot code).
- Item **Fesselklinge / Fetterblade** (legendary 2900 G, klingenbrecher + kaltstahl; ad 50, lethality 15, haste 15): Fetter Bite, +8 % damage to
  champions per slow / root / stun (item engine `modifyDamage` rules, `hasBuff`). Icon `chainBall`@350.
- Tests: `tests/kerrin.test.ts` (15). Practice dummies never die (reset to full), execute tests check that.

## 3. Henrike Federwerk, die Uhrenschmiedin (`henrike`, ADC, clockwork marksman)
- Kit: passive Mainspring (autos wind the spring: +3 % AS each, max 5, decays after 4 s; full tension overwinds the next ability: +40 % ability
  damage for 2 s and 30 % cooldown back), Q Spring Bolt (line + slow), W Clockwork Turret (deployable, hook state not a pet: pets with HP render as
  Hark; shoots her target every 0.75 s for 6 s, overwound deploy +40 %), E Spring Hop (dash 300 + ms), R Hour Strike (delayed circle + slow).
  Data `henrike.json` + `henrike.values.json`, hooks `src/sim/champions/henrike.ts` (module `onTick` runs the turret).
- Sprite kit: paper-doll kit + props `src/render/champions/clockwork.ts` (brass spring drum with a T-shaped winding key, coil crossbow, hip gears).
  Motion spec, cast family draw/lob `abbb`, motifs (arrow, gear, boot, bell), voice lines, rune presets (copied from Mira), ADC trainer pool, hints
  (generated), build `henrike.json` (Mira's build with Hemmwerk).
- Ability visuals: `henrike_w_turret` (brass base, spinning teeth ring, orange halo while overwound) and `henrike_w_shot` in `src/render/champsAFx.ts`.
- Bot mechanic: generic summon casting puts the turret at the target; her autos wind the spring (no champion id in bot code).
- Item **Hemmwerk / Escapement** (legendary 2900 G, eiferschwert + kaltstahl; ad 40, as 30 %, haste 10): Even Tempo, every 3rd auto hit within 4 s
  deals 35 (+20 % AD) magic damage (item engine addStack + stacksAtLeast + clearStack). Icon `wingBlade`@48 + gear.
- Tests: `tests/henrike.test.ts` (14).
