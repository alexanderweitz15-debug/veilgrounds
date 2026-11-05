# swarm/champs-c: three new champions (Svea, Truda, Knarr)

Branch `swarm/champs-c` (from main 2f72f4f). One commit + push per champion; wired like `sev` / `vargrim` / `fenna`.

## Built

| Champion | Role | Unique mechanic | Item |
|---|---|---|---|
| **Svea Böenhall**, die Sturmschützin (`svea`) | ADC | Walking 500 units charges a gust: the next auto adds 25-70 magic damage + 20 % slow. W Wind Wall: enemy line skillshots inside are bent aside once and fly at half speed. E dash charges the gust. R Hurricane Arrow (2500, airborne). | **Windschwinge** (legendary 2850 G, eiferschwert + kaltstahl; +55 AD, +25 % AS, +7 % MS; Featherstep: auto hits on champions give +20 % MS 1.5 s) |
| **Truda Sporenhauch**, die Pilzhexe (`truda`) | Mid control mage | Spore fields (Q lob, W root) poison + slow and spread to adjacent ground after an enemy stood in them 0.5 s (cap 6, 2 generations); E spreads all at once; R bursts every field (damage once per enemy + stun, no fields = refund). Passive: autos on poisoned enemies +8-36. | **Fäulnisstab** (legendary 2650 G, uhrwerk + lehrlingsstab; +80 AP, +15 haste; Rot: ability hits -40 % healing 3 s) |
| **Knarr Zangenfels**, der Gezeitenpanzer (`knarr`) | Top tank, giant crab | W toggles Fortress (default; -20 % MS, +30-70 armor/MR, taunts enemy champions within 450 for 1-1.4 s on entering) and Sidestep (+15 % MS, autos +10-26 %, E is a 420 leap instead of 150). Q Claw Grab pulls + roots. R Pincer Break stun + shield. +3 armor/MR per nearby enemy champion. | **Seeigelpanzer** (legendary 2650 G, zauberschutzmantel + kettenhemd; +55 armor, +45 MR, +250 HP; Spine Coat: 25 (+15 % armor) magic damage to auto attackers) |

Per champion (all three): `src/data/champions/<id>.json` (de/en names, titles, texts, voice lines) + hook file `src/sim/champions/<id>.ts`
(Knarr numbers in `knarr.values.json`), data/sim index, painted sprite kit, motion spec + cast family (tests enforce uniqueness),
`abilityMotifs.json` row, `voiceLines.json` entry, rune presets, bot build (`src/data/builds/<id>.json` + `builds.ts`), generated bot
hints, trainer pool (ADC / MID / TOP in `scenarios.ts`), kit test file, ability visuals, 1 new item with icon row, docs
(`spec-champions.md` 28-30, `champion-hooks.md` table).

- Sprites: Svea = humanoid kit, props `windStreamers`, `featherCrest`, `gustBow`, `gustSwirl` (`src/render/champions/svea.ts`).
  Truda = humanoid kit, huge red mushroom cap hat, staff with toadstool, back shrooms, spore motes (`truda.ts`). Knarr = non-human
  `SpriteDrawer` (`crab.ts`, registered in `atlas.ts` DRAWERS, Kit stub for icon colours like Vargrim): six IK legs, crusher claw + pincer,
  eye stalks, barnacles, idle 6 / run 8 / attack 5 (hit 2) / cast 4 / death 3.
- Visuals: `src/render/swarmCFx.ts` (`svea_w_zone`, `truda_field`, `truda_burst`, `knarr_taunt`), hooked into `groundObjects.ts`
  with one prefix block.
- Bots: no champion branches in the brain (`a13Hints` test forbids them). Svea's passive works through orbwalking, Wind Wall is cast
  as a normal zone at the target; Truda's R refunds itself without fields; Knarr's W toggles whenever the generic cast logic fires
  (cooldown 8-4 s, so it swaps stance every few seconds in a fight). A smarter stance choice would need a generic hint field.

## Tests (all green)

- New: `tests/svea.test.ts` (8), `tests/truda.test.ts` (8), `tests/knarr.test.ts` (9): every ability, the unique mechanic, kit/frames,
  item price (85-115 % gold efficiency) and passive.
- Also run after each champion: `npx tsc --noEmit` clean, motion, casts, championData, itemIcons, abilityMotifs, items, animData,
  assetManifest, runePresets, castMovement, a13Hints; `npm test` (fast set): see the final run in the lead message.
- Visual check: kit contact sheet (`tools/scratch/champLab.html?mode=sheet`) on a vite server from the worktree, tab and server closed
  afterwards. No in-game sandbox screenshot: the sandbox has no champion parameter, so the new champions only appear there as bots.

## Open / decisions

- Knarr's stances apply from level 1 (rank 0 uses the rank-1 numbers) so `castMovement` (unlearned baseline vs. learned) stays equal.
- Fortress is the default stance; the base 340 MS means 272 in Fortress, 391 in Sidestep.
- `truda_field` objects use the ability's snapshot `n` for the generation (paler children).
- Rune presets were copied from tobin / aurel / brom (Knarr's build runes follow his first preset: test requires default = build).
- The roster/atlas tests count the data; the full roster still fits in one atlas (planAtlas shrinks the frame when needed).
