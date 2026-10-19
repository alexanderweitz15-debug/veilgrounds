# Agent D "Darstellung & Trainer" - report

Branch `art/d-visuals` (base main e0f40bb). Spec: docs/AGENTS-PLAN.md §6 (D1-D6).

## Ready for merge

- D1a ability motifs (commit "d1: four distinct ability motifs per champion"): ready.

## Done

### D1a - four distinct ability motifs per champion (icons + missile/ground colours)

- Finding: the sim side of D1 (hook `visuals` for all 23 unchecked champions: Oleth wall + Q-stun window, Dagny wall,
  Hagen bells, Corvin keg ring + drum, marks of Brom/Gorvam/Lysa/Lio/Wren, Tobin tether, Kiran thread/link, Aurel
  rewind pin, Ottilie Hark) was already done by the earlier batch (cc3eecc, tests/abilityVisualsA-D.test.ts, 33 green).
  The ROADMAP table row "Einzel-Audit ... offen" is stale.
- New: `src/render/abilityMotifs.json` (per champion Q/W/E/R motif + element hue, list of drawable glyphs),
  `src/render/abilityTheme.ts` reads it before the keyword rules. Effect: ability icons (src/ui/icons.ts, unchanged)
  and missile / ground-object hues. Before: Aurel 3x gear, Gorvam/Vessa/Renn/Kiran/Oda/Thessaly 4x the same motif.
- Test: `tests/abilityMotifs.test.ts` - all 26 roster champions have 4 distinct drawable motifs; every champion sends a
  passive HUD state (Wren's badge added by the lead on main).
- Screenshots (encyclopedia icons of all 26, built game): `docs/ist/d1-ability-icons-before.jpg` (main 68bc2f2),
  `docs/ist/d1-ability-icons-after.jpg`.
- Deviation: screenshots are browser-pane captures (800 px wide, viewport emulated 1280x720 and scaled to the pane),
  not native 1280x720 files.

## Tests run

- `npx tsc --noEmit` green; `tests/abilityMotifs.test.ts` + `tests/abilityVisuals*.test.ts` 35/35 green.
- Baseline full suite on 68bc2f2 (under load): 771/773, 2 timeouts (bughunt M2 60 s, telegraph Fx smoke 5 s), both
  pre-existing.

## Open (next steps)

- D1b render individualisation: own particle/form language per motif (trail + impact + cast flourish, ambient
  particles on hook ground objects) - see d-handoff.md.
- D2 combat readability: tower beam, arrow/cannonball/bolt geometry, CC glyphs + HP-bar overlap (both in
  src/ui/overlay.ts = agent C -> shared-changes proposal), dash/knock-up arc (optional `dashing`/`airborne` fields,
  fallback from CC bit 16), render-side hit-flash throttle (max 4/s per unit) and facing smoothing (180° in 80 ms) in
  src/render/units.ts.
- D5 trainer: src/stats/ does not exist; A3 has no rankCalibration API yet -> local adapter src/stats/rankCalibration.ts,
  trainingPlan.ts, history.ts (src/store/kv.ts). New scenarios live in src/sim/trainer/scenarios.ts (not D's files) ->
  proposal.
- D3 scale/map, D4 silhouette test 64 px, D6 texts (data in assets/text/*.json, wiring by B/C).

## Proposals

- ROADMAP "Fähigkeiten-Anzeige": replace the row "Aurel ... Wren | Einzel-Audit | offen" by "ja - hook visuals for all
  23 (cc3eecc, tests A-D), four distinct motifs per champion (D1a)".
- IST-ZUSTAND §2/§5 "Fähigkeits-Icons pro Champion sehr ähnlich": fixed (see screenshots), Menüs & Lobby stays 4.
- DECISIONS: "Fähigkeits-Motive: Tabelle pro Champion (src/render/abilityMotifs.json) statt nur Stichwort-Regeln,
  damit Q/W/E/R nie dasselbe Motiv teilen; Regeln bleiben Fallback für neue Champions (z. B. Sev)."
