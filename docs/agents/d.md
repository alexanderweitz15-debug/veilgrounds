# Agent D "Darstellung & Trainer" - report

Branch `art/d-visuals` (base main e0f40bb). Spec: docs/AGENTS-PLAN.md §6 (D1-D6).

## Ready for merge

- D1a ability motifs (605f29d), D1b ability particles (7cd2928), D2 readability part 1 (e22dc8e), D2 part 2 helpers +
  stealth look (ec3c4e0): ready. tsc green, touched tests green (list below); full suite see "Tests run".

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
- Screenshots: `docs/ist/d1-ability-icons-before.jpg` (main 68bc2f2), `docs/ist/d1-ability-icons-after.jpg`
  (browser-pane captures of an icon grid built from the encyclopedia, 800 px wide).

### D1b - particle language per ability ("eigene Partikel-/Formsprache statt nur Farbe")

- `src/render/particles.ts`: one pooled `THREE.Points` per kind (ember / spark / drip / mote / shard; 640 each,
  ring buffer, soft dot texture, sparks additive, the others alpha-blended so the colour holds on bright ground).
- Values in `abilityMotifs.json` (`particleKinds`: life, speed, rise, gravity, back-spray, size, light, trail rate,
  burst, ambient, flicker, additive; `motifParticles`: motif -> kind). Every champion uses >= 2 kinds (test).
- Emitters: ability missile trails + impact burst where the missile ends, cast flourish at the caster (fx.ts),
  particles over ability zones (burst on resolve, ambient while persistent), ambient particles on hook ground objects
  by tag (groundObjects.ts: rim of rings/domes, area of discs, along walls/lines).
- Screenshots (canvas captures, 1280x720, fixed camera at (4900, 4600), same cast script; before = main e0f40bb +
  D1a, after = + D1b): `docs/ist/d1-particles-wren-{before,after}.jpg` (embers rising on the ash carpet, purple
  motes in the smoke cloud, storm rim), `docs/ist/d1-particles-seraphyne-{before,after}.jpg` (rain drops in the
  weather field, sparks at the cast).
- Cost: 4.6 ms/frame total with particles active, 4.3 ms with all 3200 particles alive (Mira sandbox, `__vg.frame`
  loop) - 60 FPS budget holds. No console errors from the game (see "Open": PWA fetch messages).

### D2 - combat readability (render side)

- Tower/Nexus shot: elongated energy lance (length 3.4, team colour) + spark trail instead of a round blob
  (`docs/ist/d2-tower-shot-{before,after}.jpg`). Champion basic attacks leave a faint shard streak.
- Hit flash: at most one per unit per 250 ms (4/s), minion targets weaker (0.55 vs 1.6) - `FlashGate`, `flashAmp`.
- Facing: sprites turn 180 deg in 80 ms through the in-between directions (`turnToward`, championSprites.ts) instead
  of flipping in one tick (AGENTS-PLAN B5: decided render-side, sim facing unchanged).
- Knock-up hop: sprite lifted on a parabola (70 units) while the airborne CC bit is set (ccEnd gives the length);
  optional B5 fields `airborne` / `dashing` (0..1) + `dashLen` are rendered when present (`MotionFlags` in units.ts),
  dashes stay flat until B ships the flag. Shadow stays on the ground.
- CC symbols (`src/render/ccGlyphs.ts`, one shape per CC type) and HP-bar stacking (`src/render/barLayout.ts`) are
  ready, the wiring lives in src/ui/overlay.ts (agent C) -> diff in docs/agents/shared-changes.md (D, 2026-10-19).
- B1 request done: own stealthed wards / traps / seeds translucent, revealed enemy ones with a reveal ring
  (wards.ts, groundObjects.ts). Screenshots: `docs/ist/d2-ward-stealth-{before,after}.jpg` (own Schleierward, gem 0.95 -> 0.6 opacity).
- Values in `src/render/readability.json`; tests `tests/readability.test.ts`.

## Tests run

- `npx tsc --noEmit` green (after every package).
- `tests/abilityMotifs.test.ts`, `tests/abilityVisuals*.test.ts`, `tests/telegraph.test.ts`, `tests/readability.test.ts`,
  `tests/spriteTiming.test.ts`: green.
- Full suite: see d-handoff.md (run at the end). Baseline on 68bc2f2 under load: 771/773, 2 timeouts (bughunt M2 60 s,
  telegraph Fx smoke 5 s), both pre-existing; telegraph passes alone.

## Open (next steps)

- D2: screenshot of the knock-up hop (needs an airborne enemy champion in a
  fight); dash arc waits for B5 `dashing`; overlay wiring by C (shared-changes).
- D5 trainer: src/stats/ does not exist; A3 has no rankCalibration API yet -> local adapter
  src/stats/rankCalibration.ts, trainingPlan.ts, history.ts (src/store/kv.ts). New scenarios live in
  src/sim/trainer/scenarios.ts (not D's files) -> proposal. UI mount in C's trainer menu -> proposal.
- D3 scale/map (terrain.ts cliffs, minion size), D4 silhouette test 64 px for all 26, D6 texts (data in
  assets/text/*.json, wiring by B/C).
- Console: "An unknown error occurred when fetching the script" in `vite preview` after unregistering the service
  worker (PWA sw.js); not from D's code, worth a look by whoever owns src/pwa.ts.

## Proposals

- ROADMAP "Fähigkeiten-Anzeige": replace the row "Aurel ... Wren | Einzel-Audit | offen" by "ja - hook visuals for all
  23 (cc3eecc, tests A-D), four distinct motifs per champion (D1a), particle language per ability (D1b)".
  "Mechanik-Feeling, noch offen": "Fähigkeiten-Effekte individueller" -> done (D1b); "Blickrichtung dreht in einem
  Tick um 180°" -> done render-side (D2); "Treffer-Aufhellung flackert" -> done render-side (D2); dashes/knock-ups ->
  knock-up hop done, dash arc waits for B5.
- IST-ZUSTAND: §2/§5 "Fähigkeits-Icons sehr ähnlich" fixed; §7 "Turm-Schuss optisch schwach" improved (lance + sparks);
  Kampf-Lesbarkeit 3 -> 3.5 (4 once C wires CC symbols + bar stacking).
- DECISIONS: (1) "Fähigkeits-Motive: Tabelle pro Champion (src/render/abilityMotifs.json) statt nur Stichwort-Regeln;
  Regeln bleiben Fallback für neue Champions (z. B. Sev)." (2) "Blickrichtung wird im Render geglättet (180° in 80 ms),
  die Sim bleibt bei sofortiger Drehung (Determinismus, Bots unverändert)." (3) "Treffer-Aufhellung: Render drosselt
  auf 4/s pro Einheit; die Sim-Events bleiben ungedrosselt (Death-Recap braucht jedes Event)."
