# Agent D "Darstellung & Trainer" - report

Branch `art/d-visuals` (main merged in at f7f7eb4 = origin/main 04a1eb5 incl. B). Spec: docs/AGENTS-PLAN.md §6.

## Ready for merge

All commits on art/d-visuals up to the last one: D1a, D1b, D2 (incl. B5/B1 render requests and C's skillshot
outline), D5 logic + panel, B7 load time. tsc green, touched tests green, full suite: see "Tests run".

## Done

### D1a - four distinct ability motifs per champion (605f29d)

- Finding: the sim side of D1 (hook `visuals` for all 23 unchecked champions: Oleth wall + Q-stun window, Dagny wall,
  Hagen bells, Corvin keg ring + drum, marks of Brom/Gorvam/Lysa/Lio/Wren, Tobin tether, Kiran thread/link, Aurel
  rewind pin, Ottilie Hark) was already done by the earlier batch (cc3eecc, tests/abilityVisualsA-D.test.ts).
- `src/render/abilityMotifs.json` (Q/W/E/R motif + hue per champion), read first by `abilityTheme.ts`: ability icons
  (src/ui/icons.ts unchanged) and missile / ground hues. Before: Aurel 3x gear, Gorvam/Vessa/Renn/Kiran/Oda/Thessaly 4x
  the same motif. Test `tests/abilityMotifs.test.ts` (4 distinct drawable motifs; passive HUD state for all 26).
- `docs/ist/d1-ability-icons-{before,after}.jpg` (icon grid of all 26 from the encyclopedia, browser pane, 800 px).

### D1b - particle language per ability (7cd2928)

- `src/render/particles.ts`: pooled `THREE.Points` per kind (ember / spark / drip / mote / shard, 640 each). Values in
  `abilityMotifs.json` (`particleKinds`, `motifParticles`). Emitters: missile trails + impact bursts, cast flourish,
  ability zones, ambient on hook ground objects. Every champion uses >= 2 kinds (test).
- `docs/ist/d1-particles-{wren,seraphyne}-{before,after}.jpg` (canvas 1280x720, fixed camera (4900, 4600)).
- Cost: 4.6 ms/frame with particles, 4.3 ms with all 3200 alive -> 60 FPS holds.

### D2 - combat readability (e22dc8e, ec3c4e0, 5967509, 6ccaffc)

- Tower/Nexus shot = energy lance + spark trail (`docs/ist/d2-tower-shot-{before,after}.jpg`); champion autos leave a
  faint shard streak.
- Hit flash: only events with B5 `ev.flash` (sim throttle 4/s) + render gate (250 ms) and weaker on minions.
- Facing: 180 deg in 80 ms through the in-between directions (render side; B: sim keeps exact facing).
- Flight arcs from B5 `SnapEntity.air` (knock-up parabola 70) and `dash` (height from the dash length, estimated from
  distance covered / progress); airborne CC bit + ccEnd as fallback for old replays. No screenshot yet (needs a
  knock-up in a fight).
- CC symbols (`src/render/ccGlyphs.ts`) + HP-bar stacking (`src/render/barLayout.ts`) ready; wiring in
  src/ui/overlay.ts is C's -> diff in shared-changes.md (D, 2026-10-19).
- B1 stealth look: own stealthed wards / traps / seeds translucent, revealed enemy ones with a reveal ring
  (`docs/ist/d2-ward-stealth-{before,after}.jpg`).
- C7 request: `settings.enemySkillshotOutline` -> enemy previews / zones / flight strips get a 22-unit border in the
  enemy colour at >= 0.9 alpha (`docs/ist/d2-enemy-outline-{off,on}.jpg`, dev server, own casts rendered as the enemy
  team). Removed the "(Darstellung folgt durch Agent D)" suffix from `set.enemySkillshotOutline` in de/en.json as C
  asked in shared-changes.
- Values in `src/render/readability.json`; tests `tests/readability.test.ts`.

### D5 - training plan + history (103819b, 7c361d1)

- `src/stats/rankCalibration.ts` = LOCAL ADAPTER (A3 has no rankCalibration API yet): fractional rank index 0..9 of a
  match metric on the Table A targets of src/data/bots/profiles (farming = CS@10, economy = gold/min, survival =
  deaths/30 min, fighting = kills/30 min). Types `RankCalibration` / `CategoryCalibration` are the contract.
- `src/stats/history.ts`: metrics from the post-game MatchSummary, IndexedDB history (src/store/kv.ts, cap 200),
  series per metric, streaks (wins, CS up, days). `src/stats/trainingPlan.ts`: three drills from the weakest
  categories of the last 10 calibrated games (drills in `src/stats/trainingData.json`), provisional below 3 games.
- Panel `src/modes/trainingPlanView.ts` (+ css, `planStrings.json` de/en fallback): cards with start button, rank bars,
  sparklines, streak chips. Dev render with synthetic history: `docs/ist/d5-training-plan-dev.jpg`. Not mounted yet:
  wiring (main.ts record save, trainerMenu mount, i18n keys) proposed in shared-changes.md.
- Test `tests/trainingPlan.test.ts`.

### B7 - load time (2a9ff77)

- Persistent sprite cache: every baked id is stored as a PNG strip in Cache Storage (`vg-atlas-<hash of the built
  chunk URL>`); the next build blits cached ids (scaled down when the atlas is crowded) and only bakes the rest.
- Menu-idle precache: after the menu's minion atlas, all champions are baked into the cache one by one (2 workers);
  stops as soon as a game requests its atlas. Dev server always bakes.
- Measured with vite preview, `?play=classic`, navigation -> game running (loading text gone), ~5 agents on the CPU:
  before 23.6 s cold / 18.8 s warm; after 15.0 s cold, 4.0 s and 4.1 s warm (after the menu precache; champion atlas
  2.4 s from cache, minions 0.4 s). Goal < 5 s warm met. `docs/ist/b7-cached-sprites-check.jpg` (sprite from cache).
- Not done: first menu frame dark on a cold start (needs a CSS placeholder in C's menu files; with a warm cache the
  minion backdrop is ready in ~0.4 s). Pre-baked PNGs at build time (cold < 5 s) would need a browser bake step in the
  build (lead / package.json).

## Tests run

- `npx tsc --noEmit` green after every package.
- Touched tests green: abilityMotifs, abilityVisuals*, telegraph, readability, spriteTiming, trainingPlan.
- Full suite on f234b1b (before D5/B7): 868 passed, 2 skipped, 1 todo, 1 failed = tests/brainReflex.test.ts reflex
  cost timing (A1 wall-clock limit 0.05 ms under CPU load; B reports the same failure; not D code).

## Open (next steps)

- D2: screenshot of a knock-up / dash arc in a fight; C wires CC glyphs + bar stacking.
- D5: wiring by C / lead; scenario trainer moments (wave under tower with gank threat, Baron call with lead,
  shove-and-recall timing) live in src/sim/trainer/scenarios.ts (B's area) -> proposal still to write; dodge-trainer
  measurements (latency per projectile, panic dodges, replay of last 10 hits) not started.
- D3 scale/map (terrain.ts cliffs <= 1.5x champion height, minion size, fountain plaza, buff monsters).
- D4 silhouette test 64 px for all 26 + before/after sheets; D6 LoL-style ability texts, 6 voice lines per champion,
  loading tips (data in assets/text/*.json, wiring by B/C).
- Console: "An unknown error occurred when fetching the script" in `vite preview` (PWA sw.js fetch); not D code.

## Proposals

- ROADMAP "Fähigkeiten-Anzeige": row "Aurel ... Wren | Einzel-Audit | offen" -> "ja - hook visuals for all 23
  (cc3eecc, tests A-D), four distinct motifs per champion (D1a), particle language per ability (D1b)".
  "Mechanik-Feeling, noch offen": "Fähigkeiten-Effekte individueller" -> done; "Blickrichtung dreht in einem Tick um
  180°" -> done (render); "Treffer-Aufhellung flackert" -> done (B5 flag + render gate); "Dashes und Knock-ups sehen
  nach Rutschen aus" -> done (arcs from B5 `dash` / `air`).
- ROADMAP Phase 5 "Trainingsplan, Verlauf": logic + panel done, mount pending (C/lead).
- IST-ZUSTAND: §2/§5 icons fixed; §7 tower shot improved; §4 load time: warm start 4 s; Kampf-Lesbarkeit 3 -> 3.5
  (4 once C wires CC symbols + bar stacking).
- DECISIONS: (1) motif table per champion, keyword rules stay the fallback (new champions, e.g. Sev). (2) facing is
  smoothed in the render only. (3) hit flash = sim flag (B5) + render gate. (4) atlas cache in Cache Storage per sprite
  id, versioned by the chunk hash; menu-idle precache instead of a build-time bake (no Node canvas / browser in CI).
  (5) training plan runs on a local calibration adapter until A3's API exists.
