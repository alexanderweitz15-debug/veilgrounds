# Agent status (both prompts: docs/BRAIN-REWORK.md, docs/AGENTS-PLAN.md)

Updated 2026-10-22 by S (supervisor). main = f343d7b (all branches merged: A1 4ce5cc5, A2 20c5fc1, A3 e08e396,
B b358b80, C d40055f, D 2a9ff77, E 902dc8c) + beta switch "Neues Bot-Gehirn" (b3870d0, off by default) + test
fixes for hitbox 65. "Measured" = measured by S; the rest is what the reports and the code show. Gate measurements
by S so far: Phase 1 (DECISIONS "Phase 1 – Gate-Messung"); browser checks: C merges (19 Oct), beta switch (22 Oct).

## In the game (deploy)

| Component | State |
|---|---|
| Old brain (laneLeaf, tree selector) | default |
| Reflex layer + utility model (A1/A2) | behind Settings -> "Neues Bot-Gehirn (Beta)" (`settings.newBrain` -> `SimConfig.botReflex` + `botUtility`); verified in a real game 22 Oct: F9 shows intents with all candidate scores, reflex lane intents, last-hit plans with countdown, 30-s utilisation; 0 console errors in 3 min |
| Attention model / error episodes (A3) | on main, not wired (A3-4..A3-9); overlay column "Aufmerksamkeit" stays "-" |
| B1-B6, hitbox 65, C blocks 1-5, D1-D2, Sev | active |

## Measured by S (Gold, 4 x 20 min, seeds 101-104, --variance=0, main f343d7b)

| Metric | reflex off | reflex on | target |
|---|---|---|---|
| Laner CS/min @15 / end | 3.52 / 3.80 | **3.80 / 4.33** | 6.5 / 6.8 |
| Attack utilisation 2-14 min | 0.29 | **0.39** | > 0.50 |
| Idle share | 0.101 | **0.042** | <= 0.10 |
| Kills / game, first tower | 16.0, 17.1 min | 14.5, 16.6 min | 50, 14 |
| Plates / team by 14:00 | 4.0 | 2.25 | 4 |
| Harass autos / laner by 14:00 | 1.3 | 4.2 | >= 40 (Phase 2) |
| Absence CS loss | 27 % | 30 % | <= 12 % |
| Reflex cost ms/bot/tick | - | 0.150 under load (A1 alone 0.04) | 0.05 |

A2's own calibration with the utility flag (a2.md, same setup, seeds 1-4): CS 3.20 ~ off 3.18, idle 6 %, deaths
without a champion 1.6 %, plates 1.25 vs 3.38, kills 14.5 vs 16.8. Both halves of the beta are "not worse on CS,
better on idle, worse on plates"; the Table A targets are far away because the lane execution (Phase 2) and the
farm intent on top of the scheduler (Phase 3) are not there yet.

## Per agent

| Agent | Done (on main) | NOT done | Gate | Next |
|---|---|---|---|---|
| A1 Reflex & Laning | Phase 0 + Phase 1 (reflex layer, per-tick last-hit planner, scheduler with joint filler protection, stand point, orbwalk plan, window preparation), harass filler in the reflex (Phase 2 start), test 11 as regression bound + target in `--report`, baseline table in DECISIONS. A1's lane-alone (branch, before hitbox 65): Iron 75 / Gold 89.7 / Challenger 100.7 | S lane-alone on main f343d7b (after hitbox 65, seeds 1-3, measured): Iron 80.7 ok, Gold 88.0 just on the line (seed 3 = 80), **Challenger 96.3 < 100**; 5v5 utilisation 0.39 < 0.50; test 4 skipped (Gold stand point, 1 `out_of_range`); test 5 skipped (harass 11 autos / 3 min, 4 minions lost); wave states as target picture, freeze conditions, aggro check; brain.ts `busyUntil` for `movesWhileCasting` casts (B's note); reflex cost hot spot `buildTeamEntities` | Phase 1 **not green** (DECISIONS): Iron/Gold lane-alone met, Challenger misses after hitbox 65, 5v5 not worse than off, utilisation criterion open | re-calibrate lane-alone for radius 65 (stand-point buffer, window prep: `window_collision` doubled to 1.9 %), test 4 fix; Phase 2 in parallel: harass budget to >= 40 autos / laner by 14:00 without CS loss (test 5), wave states, cost; then Phase 2 gate run by S (kills >= 42, CS@15 >= 5.0) incl. Challenger lane-alone >= 100 |
| A2 Utility & Macro & Combat | values.json, utility selector + intent subtrees in the tree (A2-1..A2-3), Kesselbrut objective, siege from 11:00, `convert:` log, jungler plate after gank, idle_after_shove under utility, §6 combat (chase abort, dive aggro swap, focus hysteresis, commit rule), recall lock + roam prize, calibration runs; flag off bit-identical (hash a5913c9c) | plates lose to shove-and-recall after a crash (1.25 vs 3.38); farm intent still runs the classic laneLeaf - now that the reflex is on main the farm intent should set the reflex lane intent; value tuning; A2-4 disengage intent kind; strict test 7 is `it.fails` | Phase 3/4 **not measured** | wire farm intent -> reflex scheduler (with A1), fix the plate/recall competition, then Phase 3 gate run by S (8 x 25 min, flag on) |
| A3 Humanize & Rank | attention model, error episodes, profile/axes/errors data, F9 columns (visible in the game now), tests | wiring A3-4..A3-9 (A1: runner `observeAttention` + `attentionProbe`, lasthit `LAPSE_SHARE` removal; A2: error episodes at call sites; ping "Mein Fehler"); test 10 clause 3 todo; Phase 5 gate; Phase 6 tuning; BRAIN-IST rewrite | Phase 5 **not measurable** | idle until A1 wires A3-4/A3-5 (could be part of A1 Phase 2); cosmetic: overlay table wider than the panel at 1280 px |
| B Sim & Mechanics | B1 ward stealth (Lysa wire visible again per user), B2 movesWhileCasting (104 abilities), B3 snapshot fields, B4 Teleport sim side + `tpUnlocked`, B5 sim side (knock-up/dash flags, hit-flash throttle data, attack-move cursor), B6 Kesselbrut epic flag, ranged hitbox 65, tests under tests/sim/ | B5 `dashing` flag for D's arc (check b.md), B7 moved to D; B8 pre-merge runs were done by the lead's merge instead | - | support items from A1 (busyUntil), E (fear/uncleansable reviewed), D (dash flag) |
| C UI & Features | C1 FEATURE-GAP, C2 scoreboard (now with enemy items, vision, damage, ally summoner CDs), C3 HUD + the three browser-check fixes, C4 pings/chat + '?' key + item ping, C5 ban phase + role swap + bot config, C6 post-game, C7 HP-bar style, skillshot outline setting, minimap fit, B4 HUD slot; full suite 894 passed on 71cd27c | C5 rune page editor, C7 settings export/import + remaining items, shop undo (B sim command), FEATURE-GAP rows still "teilweise" (see c.md), D's overlay wiring (CC glyphs, bar stacking) | browser check 19 Oct green; 22 Oct green | C5/C7 rest, overlay wiring for D |
| D Visuals & Trainer | D1a motifs (4 distinct per champion), D1b particle language, D2 readability (tower lance, hit-flash gate, facing turn, knock-up hop, CC glyphs + bar layout helpers, stealth look), readability.json + tests, screenshots docs/ist/d1-*, d2-* | D2 wiring in overlay.ts (C), dash arc (needs B flag), D3 scale/map, D4 silhouette test + sprite revision (local files docs/style/revision/_strike.jpg, _zoom.jpg still uncommitted in the main checkout), D5 trainer plan/history (needs src/stats + A3 calibration API), D6 texts, B7 load time (now D's) | screenshots present; S acceptance in the built game **open** | S: screenshot acceptance of D1/D2 on the built main; D: B7 (atlas baking: 10.4 s cold / 7.0 s warm measured by S), D3-D6 |
| E Champion Sev | sev.json, sev.ts hooks (Nachbild, Q fake, Schwarzglut dot + jump, Trugbild decoy with champion look, Augenbann fear), fear CC + `uncleansable` + `targetOk` + `onPetDamaged` in the sim, sprite kit, tests/sev.test.ts, docs (hooks, roster #27) | balance of the ember jump (sevCasts.ts run), black-flame visual + Augenbann phantoms (D), fear icon, sounds, bot rules (issues.md), trainer pools, cast-audit rows | - | balance run first; bot rules go to A2 (ExchangeEstimate burn, R only on marked) and A1 (fear = hard CC in escape) |
| S Supervisor | Phase 1 gate measured + DECISIONS entry; DECISIONS entries beta switch + hitbox 65; browser checks C (19 Oct) and beta switch (22 Oct) with screenshots; A2 and A3 reviews; fog guards on main | Phase 2/3/4/5 gates (no candidates yet); D screenshot acceptance; B8-style run for later B merges | - | next gate: A1 Phase 2 (harass + wave states), then A2 Phase 3 |

## Merge-risk notes (next round)

- Everyone is on main f343d7b now; the next overlapping files are `src/ai/bot/brain.ts` (A1 busyUntil, A2 farm intent -> reflex), `src/ai/bot/lasthit.ts` (A1 cost, A3-5 lapse removal), `src/ai/runner.ts` (A1 cost, A3-4 wiring), `src/ui/overlay.ts` (C wiring D's glyphs). Order: A1 Phase 2 first, A2 rebases on it, A3 wiring rides with A1.
- Flags: `newBrain` stays off by default until Phase 2 + Phase 3 gates are green (DECISIONS "Beta-Schalter"); `withTilt` mode 'attention' only with A3-6.
- Hitbox 65 changed skillshot timing: any test that checks CC/hit "one tick after" needs the hit-moment form (lead fixed Corvin keg / Vessa R).

## Decisions needed from the lead / user

1. A3 wiring (A3-4/A3-5/A3-6) as part of A1's Phase 2 commit series, so A3 can measure Phase 5 - S recommends yes.
2. A2's question: §6 combat changes stay flag-gated until the Phase 4 gate - S recommends yes (bit-identity off).
3. Test 11 (reflex cost): keep the regression bound in the suite, target only in `--report` - S agrees with A1's deviation; the 0.05 ms target then has to be checked by S on an idle machine at each A1 gate.
4. Sev ember jump: E proposes to keep it until the brain plays around it; balance run `sevCasts.ts 10 20 gold` first - decide after that run.

## Questions for the user (collected)

- none new (Lysa wire and enemy items answered 19 Oct)
