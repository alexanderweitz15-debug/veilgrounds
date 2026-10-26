# swarm/fenna-kit: Fenna sprite kit, ability visuals, Duskband

Branch `swarm/fenna-kit` (from main 5fc933b).

## Built
- **Sprite kit** `fenna` (src/render/champions/kits.ts + new src/render/champions/fenna.ts): humanoid paper-doll kit, tall slim
  moth-folk support (H 188, pale lilac skin, long cream hair, plum dress with cream panel, gold belt). Four props:
  `mothWings` (four dusty wings with dusk-violet eye-spots behind her; flutter in idle, swept back when running, wide open on
  cast, dust motes), `antennae` (two feathery antennae), `flameLamp` (gold Chosen-Flame light over the right hand, flares on
  cast), `lightThread` (glowing Lightbond thread from the left hand). hold `relaxed`, attack `throw`, cast `raise`, gait light.
  All five animations (idle 4, run 8, attack 5, cast 4, death 3 frames) bake; 64 px silhouette = wide wing triangle + two
  antennae, unlike every other champion. The stand-in warning in atlas.ts no longer fires for her (it stays as the safety net).
- **Ability visuals** src/render/fennaFx.ts (+ 5 lines in groundObjects.ts): `fenna_p_bond` (gold thread, running light
  beads), `fenna_p_slack` (thin lilac), `fenna_q_arc` / `fenna_w_arc` (dust bounce lilac-gold, shield hand-over clear gold,
  fade with the arc's life), `fenna_e_pool` (violet pool, dashed turning rim, rising dust), `fenna_r_cocoon` (pale gold dome,
  silk net, upright cocoon). The abilityMotifs.json row (wing / lamp / ring / moon) already existed and drives icons,
  missile colour and particles.
- **Item** `daemmerband` / Duskband (legendary, 2700 G, hueterlampe + lehrlingsstab; +45 AP, +20 haste, +8 % heal/shield power,
  +50 % mana regen, ~97 % gold efficiency). Passive Bond Spark (`dusk_band`): shields/heals you give another champion grant
  her +12 % move speed for 1.5 s, once per ally every 6 s. Fits Fenna's tether/shield play and every enchanter. Added to
  Fenna's standard bot build (replaces Frostkern).

## Tests (all green)
- tests/fennaKit.test.ts (new, 4): every champion in the data has a sprite kit, Fenna's kit/props/animations, Duskband price
  and Bond Spark (spark, internal cooldown, no spark on self).
- tests/fenna.test.ts 7/7, items.test.ts, items.effects.test.ts, goldEfficiency, abilityMotifs, championData, i18n,
  inventory: green. `npx tsc --noEmit` clean.
- Visual check: kit contact sheet (tools/scratch/champLab.html on a vite server from the worktree) and one sandbox
  screenshot with Fenna; tab and server closed afterwards.

## Open / decisions
- `modifyHeal` carries the Bond Spark side effect (no dedicated on-heal hook exists); commented with `ponytail:`.
- tests/items.test.ts counts relaxed to `>=` (parallel agents add items).
- The Browser pane is shared between agents: another agent navigated my first tab; I used my own tab.
- The E pool / R cocoon look was not captured live (cast fired, cursor was over the HUD); code path reviewed only.
