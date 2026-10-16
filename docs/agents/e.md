# Agent E - new champion (status)

Branch: `champ/e-sev` (from main 68bc2f2). Stopped early on lead/user order.

## History
- Started as "Itachi" (id `itachi`). Spec changed by the user before any code was written: Itachi dropped completely.
  No Itachi files, names or branch remain (local `champ/e-itachi` deleted, never pushed).
- New target: "Sev Aschenblick (Fassung 2)", spec verbatim in `docs/champions/sev.md`.

## Done
- `docs/champions/sev.md` committed (commit "e: sev spec (Fassung 2, user verbatim)").
- Orientation of the champion wiring (see "Where a champion is wired" below).

## Not done (nothing of Sev is in code yet, registries untouched, main stays green)
Everything below is open. Recommended order (keep each commit green: `npx tsc --noEmit` + touched tests):

1. **Data** `src/data/champions/sev.json` (copy mira.json shape; schema `src/sim/champions/schema.ts`).
   Roles `["mid","jungle"]`, ranged, range 525, mana, radius 55. Abilities per spec:
   Q `sev_q` skillshot_line 950 width 60, dmg magic 70/110/150/190/230 +0.6 AP, CD 7, flag `recast` + hook for fake;
   W `sev_w` targeted 650 (champion or minion), hook `sev_w_ember`; E `sev_e` blink 450 + hook `sev_e_decoy`;
   R `sev_r` targeted 700, flag `channel` 0.5 s, hook `sev_r_bann`. Passive hooks `["nachbild"]`.
   Combos: W Q AA / E Q Q W / W R Q AA. Spike [6]. Add build `src/data/builds/sev.json` and rune preset in
   `src/data/runePresets.json` (check how mira is listed there).
2. **Registry**: `src/data/champions/index.ts` (import + `raw` entry), `src/sim/champions/index.ts` (hooks line).
   Then run `tests/championData.test.ts` (validate + missingHooks) and `tests/replay.test.ts`.
3. **Hooks** `src/sim/champions/sev.ts`:
   - Nachbild: mark on every ability hit, 3 s (use `{kind:'mark'}` effect or hookState map keyed by target eid +
     serial). `modifyDamage` / `onAutoHit`: autos on marked enemy +10-30 byLevel (+15 % AP) magic, extend Sev's
     ember dot by 0.5 s (`extendBuff` in buffs.ts).
   - Q fake: model on `src/sim/champions/gorvam.ts:36` -> `cancelCast(sim, eid, { refund: true, cooldownTicks: sec(2) })`
     when recast within 0.4 s of the wind-up (needs castTime >= 0.4 or a recast window via `openRecast`).
   - W ember: `addBuff(kind 'dot', period 1 s, amount per rank +0.22 AP, 4 s)` + `addBuff(kind 'grievous', pct 40)`.
     Jump on death: `onKill`/tick check -> nearest enemy within 300, once (flag in hook state).
     On own decoy: decoy burns 4 s, 50 % ember dps to enemies within 250 (onTick).
   - E decoy: `spawnPet` (src/sim/summons.ts:94) at the start position, hp 1, `ad 0`, lifetime 2.5 s
     (`trackLifetime`), render needs a "looks like Sev + fake HP bar" flag. Enemy ability hitting it -> Nachbild on
     the caster (needs an onDamageTaken-like hook on pets, check summons.ts).
   - R: channel 0.5 s (break on lost vision: `sees(sim, team, target)` in onTick), then 1.5 s fear, reveal,
     silence (abilities) + summoner lock, 50 % slow, end damage 180/300/420 +0.7 AP, x1.5 if target had ember.
4. **Sim extensions (agent B area, additive, log in shared-changes.md)**:
   - CC `fear` in `src/sim/buffs.ts` (`CcKind`, `HARD_CC`, `CC`, `canCast`=false, `canAttack`=false, `canMove` stays
     true but movement is forced away from `src`; hierarchy between root and stun; tenacity applies, so NOT in
     `NO_TENACITY`). Forced movement belongs in the movement/input system (look where 'stun' blocks orders).
   - Buff flag `uncleansable` on `Buff` (optional boolean); `src/sim/summoners.ts:65` cleanse and the ferris/oda
     slow-cleanses must skip it.
   - Summoner lock during fear: `src/sim/summoners.ts` cast check.
   - Decoy entity with fake HP bar (pet flag + snapshot field + render in units.ts).
5. **Tests** `tests/sev.test.ts`: each ability, Q fake refund/2 s CD, ember not cleansed + jumps once, decoy 2.5 s,
   R requires Nachbild, fear moves away + tenacity, ember bonus x1.5. Plus `tests/replay.test.ts` determinism and
   `sideMirror.test.ts`, `abilityVisuals*.test.ts`.
6. **Render/UI**: sprite (style variant A, docs/style-variants.md): charcoal floor-length high-collar coat with copper
   hem and grey ash swirls, collar to the nose, one hand out palm-up with a floating ember eye (primary silhouette
   feature), left eye copper-red with a three-armed crack. Must differ from Corvin. Files: src/render/champions/kits.ts
   + atlas.ts, src/render/sprites.ts, src/render/units.ts, src/stylelab/{champions,figures,scene}.ts,
   src/ui/classicLobby.ts, practiceLobby.ts, src/game/game.ts, modes.ts, src/sim/trainer/scenarios.ts, icons
   (src/ui/icons.ts / src/render/abilityTheme.ts), i18n de/en. Ember visual: black flame with copper core.
7. **Docs**: `docs/champion-hooks.md` entry, `docs/spec-champions.md` roster (27th), bot rules -> issues.md.
8. Balance: decide after the first bot-sim run whether to drop the ember jump (spec "Einwand").

## Where a champion is wired (files referencing `mira` outside src/ai)
src/data/builds/mira.json, src/data/champions/index.ts, src/data/runePresets.json, src/game/game.ts, src/game/modes.ts,
src/render/champions/atlas.ts, src/render/champions/kits.ts, src/render/sprites.ts, src/render/units.ts,
src/sim/champions/index.ts, src/sim/items/runes.ts, src/sim/trainer/scenarios.ts, src/stylelab/champions.ts,
src/stylelab/figures.ts, src/stylelab/scene.ts, src/ui/classicLobby.ts, src/ui/practiceLobby.ts, plus many tests
(tests/championData.test.ts is the validation one).

## Bot rules for the brain team (from the spec, not implemented, src/ai/** untouched)
- Q fakes from Platin against recognised dodge patterns.
- From Gold bots do not hit decoys with abilities (below Gold: 40 % of the time they do).
- Bots with Schwarzglut do not panic-recall; include the burn in `ExchangeEstimate`.
- Fear is treated like stun in the escape node.
(docs/agents/issues.md did not exist on this base; add these there when it does.)

## Shared-file edits
None.

## Tests / build
No code changed, so tsc/vitest/build/bot-sim were not run. No screenshots.

## DECISIONS proposals
- Fear = new CcKind `fear` between root and stun, tenacity applies, blocks attack/cast, forces movement away.
- `uncleansable` as an optional Buff flag, checked by every cleanse.
