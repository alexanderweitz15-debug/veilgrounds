# Agent D "Darstellung & Trainer" - report

Branch `art/d-visuals` (main merged in at f7f7eb4 = origin/main 04a1eb5 incl. B). Spec: docs/AGENTS-PLAN.md §6.

## Ready for merge

All commits on art/d-visuals up to the last one: D1a, D1b, D2 (incl. B5/B1 render requests and C's skillshot
outline), D5 logic + panel, B7 load time (IndexedDB atlas + ground cache), Sev visuals (3beb128). Agent stopped
on the lead's request (max 3 agents); next steps in d-handoff.md. tsc green, touched tests green, full suite: see "Tests run".

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

### B7 - load time (2a9ff77, 5a1342a, 3b5d3dd)

- Persistent sprite cache in IndexedDB (src/render/atlasStore.ts, DB `veilgrounds-atlas`): every baked id is stored as a
  PNG strip with the build version (hash of the content-hashed chunk URL); the next build blits cached ids (scaled down
  when the atlas is crowded: 10 champions use 112 px cells, the cache holds 128 px) and only bakes the rest. First
  version used Cache Storage, but public/sw.js deletes every foreign cache on activate.
- Menu-idle precache: after the menu's minion atlas, all champions are baked into the store one by one (2 workers);
  stops as soon as a game requests its atlas and does not restart in the same session (a second game in the same
  session only gains from what the first game and the menu stored). Strips stored by a crowded 112 px atlas are
  re-baked at 128 by the precache.
- Painted ground: shared between the menu backdrop and the game in one session, kept in the same store (4096 PNG);
  a warm start decodes it (1.3-1.7 s, async under the loading cover) instead of painting 2.2 s on the main thread.
- Measured with vite preview, `?play=classic`, navigation -> game running (loading text gone), several agents on the
  CPU: before 23.6 s cold / 18.8 s warm; after: warm (menu precache finished, ~60-90 s idle after a new build) 4.0,
  4.1, 4.1, 4.5 s; cold 15-34 s depending on load (cold is unchanged by design). Longest main-thread task at start
  4.0 s -> 1.0 s. "Warm" = after one menu visit with the new build; the supervisor should measure the same way.
- Quality: `docs/ist/b7-sprite-zoom-{cold,warm}.jpg` (Aurel at camera distance 900, baked directly at 112 px vs
  scaled from the cached 128 px strip): no visible difference. `docs/ist/b7-cached-sprites-check.jpg`.
- Not done: first menu frame on a cold start is still dark (CSS placeholder belongs to C's menu files); pre-baked
  PNGs at build time (cold < 5 s) would need a browser bake step in the build (lead / package.json).

### Sev visuals left open by E (3beb128)

- Black flame: unit mark `sev_w` (Schwarzglut) and the burning decoy (`sev_w_decoy`) emit a new particle kind
  `blackflame` (dark, flickering, rising) plus copper ember sparks (`markParticles` / `tagParticles` in
  abilityMotifs.json, emitted in groundObjects.ts). On bright ground it reads, on dark cliffs it is subtle - next step:
  raise `light` / size of `blackflame` or add a copper rim if the user wants it stronger.
- Augenbann phantoms: three dark, flickering Sev sprites around the target, drawn only on the feared player's client
  (units.ts `phantoms`, from snapshot `sev_r_phantom` / `sev_r_bann`); the generic pins are gone for everyone, the
  ring stays. Dark screen vignette for the feared player (fx.ts, CC bit 256 or the bann ring on me).
- Fear glyph in `src/render/ccGlyphs.ts` (wide eye + sweat drop) for C's overlay wiring (overlay already maps 256).
- Screenshots: `docs/ist/d-sev-burn-{before,after}.jpg`, `docs/ist/d-sev-bann-victim-{before,after}.jpg` (victim view =
  frame rendered with snap.me.eid patched to the dummy; before = pre-change build, dummy at the cliff edge - the after
  shots use a second dummy on the lane, so framing differs).

## Tests run

- `npx tsc --noEmit` green after every package.
- Touched tests green: abilityMotifs, abilityVisuals*, telegraph, readability, spriteTiming, trainingPlan.
- Full suite on 9e661be (D1-D5 + B7 Cache-Storage version): 903 passed, 1 todo, 0 failed (74 files).

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
