# Agent E handoff - Sev Aschenblick

State: Sev is playable and selectable (classic lobby mid/jungle, practice/sandbox), green core (tsc clean,
tests/sev.test.ts 16 tests, full vitest green except one CPU-load timing test in brainReflex). Branch `champ/e-sev`.
Details, commits, numbers and open items: `docs/agents/e.md`. Spec: `docs/champions/sev.md`.

Where things live:
- Data: `src/data/champions/sev.json`, `src/data/builds/sev.json`, `src/data/runePresets.json` (`sev`), motif row in
  `src/render/abilityMotifs.json`.
- Sim: `src/sim/champions/sev.ts` (all kit logic, helpers `hasNachbild`, `isEmbered`, `sevDecoy`, `sevBann`);
  generic extensions in buffs.ts (fear, uncleansable), movement.ts (flee), summoners.ts, abilities.ts (targetOk,
  summoner lock), damage.ts (onPetDamaged), summons.ts (petOwner/petTag/extendPet), snapshot.ts (`look`).
- Render: `src/render/champions/sev.ts` (props), kit entry at the end of `kits.ts`, Hold `palm` in anim.ts/types.ts,
  decoy sprite in `championSprites.ts`, fake champion bar in `src/ui/overlay.ts`.
- Tests: `tests/sev.test.ts`; touched: championData, abilityMotifs, botParams, items, telegraph (27), combos (fake
  step), sim/castMovement (Nachbild for R).
- Tools: `npm run bot-sim -- --champion=sev ...` (blue mid), `npx tsx tools/scratch/sevCasts.ts [games] [min] [rank]`.

Next steps (priority): ember-jump balance decision from more bot games; black-ember render on burning units;
Augenbann phantoms as Sev sprites + feared-player vignette; brain team wishes in docs/agents/issues.md.

Screenshots: headless Edge via CDP (`node shot.mjs <url> <steps.json>`, driver copied from the shared scratchpad),
steps: classic lobby -> Sev card; sandbox -> Sev, cheats setLevel 18 + noCooldowns, teleport next to the dummy,
hold Space (camera follow), then Q/W/E/R via `window.__vg.link.send` (needs `?bench`).
