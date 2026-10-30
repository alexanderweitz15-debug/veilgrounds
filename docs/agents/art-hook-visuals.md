# art/hook-visuals - WIP checkpoint (agent stopped early, continue from this branch)

Branch: `art/hook-visuals` (from origin/main). Nothing was run: no tests, no tsc, no browser, no vite, no node_modules junction.

## Audit finding (important)
The ROADMAP row "Aurel ... Wren: nicht einzeln geprüft" is STALE. All 29 champions already have `ChampionHooks.visuals`
(passive badge, marks, objects, hints, aura, empowered) and tests/abilityVisuals{,A,B,C,D}.test.ts cover them.
Already present: Oleth wall + passive cooldown, Dagny wall + passive 3rd-auto + W shred marks, Hagen tolls/cooldown + peal ring + slow-stage pips,
Corvin drum + keg ring, Brom bleed pips (n/5), Gorvam 4th-hit counter + empowered glow, Lysa thread pips (n/8), Lio spark pips + rain hit counter,
Wren smoke/storm/burn marks, Vessa stacks + stalk + ambush mark, Thessaly free-cast timer + R execute hints, Kaelen follow-through + W hints,
Kiran thread/link, Nyx seeds/veil/ambush, Oda spring, Ottilie Hark/scout/leap, Tobin tether, Harrow waves/march/siege lifetime, Grimald traps/aura,
Mira counter, Ferris companion glow, Ilvane marks, Aurel wheel/rewind/pending R, Vargrim stacks/mist/riders.

## Real gaps found
1. Seraphyne R: strikes 2 and 3 (0.8 s apart, same circle) had no display. DONE in code: `seraphyne.ts` visuals -> object `seraphyne_r_strike`.
2. Renn W: blade lands 1.25 s after cast, no marker. DONE in code: `renn.ts` visuals -> object `renn_w_drop` (hidden: own team only), const `DROP_TICKS`.
3. Tags without own drawer (fell through to generic ring/dome): `isolde_anchor`, `tobin_q_range`, `ottilie_q_leap`, `vargrim_w_mist`.
   DONE in code: drawers in `src/render/abilityFx.ts` (+ the two new tags), all added to `ABILITY_FX_TAGS`.
4. Lysa E tripwire: generic zone event keeps drawing the wire after it triggered (`lysaWire.live=false`). NOT done (idea: `lysa_e_wire` object while live + suppress zone, or just note).
5. Marks on units (`src/ui/overlay.ts drawMarks`): all non-pip marks are the same purple diamond, no timer, no per-ability colour. NOT done.

## Next steps
1. `npx tsc --noEmit` and `npx vitest run tests/abilityFx.test.ts tests/abilityVisualsC.test.ts tests/abilityVisualsD.test.ts` (check which file tests Seraphyne/Renn; add snapshot tests: Seraphyne R shows `seraphyne_r_strike` with n 2 then 1 and none after; Renn W shows `renn_w_drop` for owner only and removes it when the blade lands).
2. Replace the hand-kept tag list in `tests/abilityFx.test.ts` (`await_tags()`, `generic` set) by a real source scan: read `src/sim/champions/*.ts`, collect `tag: '<champ>_...'` on lines with `shape:` and `addGroundObject` consts (TRAP/SEED/BLADE), fenna arcs; a tag is drawn if `case '<tag>'` occurs in abilityFx.ts / sevFx.ts / fennaFx.ts or it is a key of `STYLE` in groundObjects.ts (text scan, no three import). Drop `isolde_anchor/tobin_q_range/ottilie_q_leap` from the `generic` exemptions (now drawn). `corvin_keg` is a pet unit, not an object.
3. Mark styling: pure helper (e.g. `src/ui/marks.ts`: `markStyle(id, n, max)` -> pips or count, hue from `abilityHue(champ, slot)` via id prefix, passive `_p_` = gold, full stack = red) used by `overlay.ts drawMarks`; optional timer ring using max-left seen per `${entity}:${id}`. Unit test for the formatting.
4. Update ROADMAP "Fähigkeiten-Anzeige (Audit)" table: replace the open "Aurel ... Wren" row by per-champion rows (list above = ja), add rows for Seraphyne R, Renn W, the 4 drawers, Lysa E (offen), marks styling.
5. Log in `docs/agents/shared-changes.md` (only abilityFx.ts / sim champion visuals touched, no hot files).
6. One contact-sheet screenshot (sandbox, Seraphyne R, Renn W, Vargrim W, Tobin Q); close tab and vite right after. Then delete the node_modules junction with `(Get-Item <worktree>\node_modules).Delete()`.

## Files touched so far
`src/sim/champions/seraphyne.ts`, `src/sim/champions/renn.ts`, `src/render/abilityFx.ts`, this doc.
