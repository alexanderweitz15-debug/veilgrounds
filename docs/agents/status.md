# Agent status (both prompts: docs/BRAIN-REWORK.md, docs/AGENTS-PLAN.md)

Updated 2026-10-19 by S (supervisor). main = e0f40bb (integration merge e576592 of all branches on the user's
request, without gate review; DECISIONS "Integration aller Agenten-Branches ohne Gate-Review"). "Measured" = measured
by S or the lead; everything else is what the reports and the code show. Agents are resumed and merge `origin/main`
first; A3 idles until A1/A2 wire its hooks or Phase 4 lands.

## What is on main but inactive in the game

| Component | Switch | Why off |
|---|---|---|
| Reflex layer + attack scheduler (A1 Phase 1) | `RunnerOptions.reflex`; `src/sim/worker.ts` builds `new BotRunner(config)` without it; on only in `runLaneAlone()` and `bot-sim --reflex=true` | gate red, farms worse than the old laneLeaf (lead: Gold seed 1, 12 min, `--variance=0`: CS/min off 3.08, on 2.68) |
| Utility model + §6 combat changes (A2) | `BOT_UTILITY=1` env (never set in the browser) or `BotStatic.utility` | A2-1/A2-2 tree integration still a proposal; with the flag CS/min 3.33 but recalls 1.36/min, roams 0 |
| Attention model, error episodes, tilt-via-attention (A3) | nothing calls `observeAttention` / `startErrorEpisode`; `withTilt` default `'legacy'` | wiring A3-4..A3-9 belongs to A1/A2 |

Active on main: A1 Phase 0 metrics (`--report`, csLossByCause, `--scenario=laneAlone`, `--variance=0`), B1 ward
stealth rule, B2 movesWhileCasting data + sim, B3 snapshot fields (plates, revealed/exposed, kesselbrutTeams, reveals,
atkTarget masked), C1-C4 + C6 UI, D motif JSON, F9 overlay columns (show "-" until filled).

## Per agent

| Agent | Done (on main) | NOT done | Gate state | Next |
|---|---|---|---|---|
| A1 Reflex & Laning | Phase 0 complete (metrics, report, lane-alone scenario, Iron baseline 8 games); Phase 1 implemented: src/ai/reflex/{reflex,view,state}.ts, plan.ts, lasthit.ts per-tick windows, laneLeaf uses the scheduler, seven §4.7 profile fields in all ten JSONs; plan-api.md "Changes" answers review findings 1, 3, 5 | Gold/Diamond/Challenger baseline numbers in a1.md are placeholders (`SEE_BASELINE_TABLE`, `LA_*`, `GATE_TEXT`); Iron lane-alone 69 (< 70), Gold out_of_range cancels, Challenger < 100 (window collisions), reflex cost 0.10 ms (target 0.05); Phase 2 not started | Phase 1 **red**: tests 2 + 4 skipped (tests/brainReflex.test.ts), 1/3/11/12 green (11 as regression bound only); reflex-on CS/min below reflex-off in a full game | fill the report placeholders; `margin()` cap for wide windows (Iron), stand-point fix (Gold out_of_range), collision check at plan creation over 3 windows (Challenger); make reflex-on at least not worse than off in `bot-sim --rank=gold --games=4 --minutes=20 --reflex=true`; then Phase 2 (B1-B3 are on main now) |
| A2 Utility & Macro & Combat | values.json, src/ai/utility/** (candidates, selector, intent subtrees, world inputs), §6 chase abort / dive aggro swap / focus hysteresis / commit rule, tests/utility*.ts, intent log node `utility`; flag-off bit-identity checked by hash | tree integration (A2-1 utilitySelector node, A2-2 `SimConfig.botUtility`, A2-3 retreat goHome) still proposals; value calibration first guess (recall loop with the flag); Kesselbrut candidate, jungler plate dive, siege from 11:00, `convert:` log, team-AI interval by rank, idle_after_shove under utility; full vitest never run by A2 (lead ran it after the merge) | Phase 3/4 **not measured** (CS@15 >= 6.0, absence <= 15 %, first tower <= 15, idle <= 12 %; kills 45-55) | S decides A2-1..A2-3 (recommendation below); with the flag on: recall/roam calibration against the wave value, then Phase 3 gate run; combat changes stay flag-gated until Phase 4 is measured |
| A3 Humanize & Rank | attention.ts, error episodes (errors.ts + errors.json durS/detect), attention.json, 8 profile fields + utilityNoisePct, util* knobs, F9 columns, tests/attention.test.ts; S review: suite 784 green, bot-sim CSV identical to main (no behaviour change) | wiring (A1/A2), test 10 clause 3 (todo), Phase 5 gate in real games, Phase 6 tuning, BRAIN-IST.md rewrite | Phase 5 **not measurable** until wired | idle; when A1 wires A3-4/A3-5: turn the todo into a test, measure the share per rank with bot-sim |
| B Sim & Mechanics | B1 (one stealth rule for wards/seeds/traps/wire, Siegelward reveal 450, tests/sim/wardStealth), B2 (movesWhileCasting + castTime for 26x4 + summoners, docs/ability-cast-audit.md, tests/sim/castMovement), B3 (snapshot fields, atkTarget masking, tests/sim/snapshotBots) | full suite after B3 and the branch bot-sim were never finished; B4 Teleport, B5 mechanic feel, B6 Kesselbrut objective, B7 load time, B8 per-merge runs | B1-B3 merged; AGENTS-PLAN B8 pre-merge runs (determinism, sideMirror, phase1, bot-sim Gold 4 games) **not done for B3** | merge origin/main; run B8 on main once (S can do it); then B4 (tpUnlocked event) and B6 (epic flag, A2 needs it) before B5/B7 |
| C UI & Features | C1 FEATURE-GAP (70 rows: 22 da / 31 teilweise / 22 fehlt), C2 scoreboard objectives + death timers + summoner timers, C3 target frame / objective timers / last-seen ghosts, C4 chat commands / mute / pings, C6 post-game charts + timeline, i18n key-equality test, revealed-ward minimap symbol; screenshots in docs/ist/c2-*, c3-*, c6-* | C5 lobby (rune pages, ban phase, role swap), C7 settings (needs src/settings.ts decision), shop undo (B), "Nochmal" after classic (one-liner, issues.md), playstyle scales + error list (after A3), exact enemy Kesselbrut (B) | S browser check (5-min game, console, HUD overlap, load time) **not done** | C5 then C7; S: browser check on the built main |
| D Visuals & Trainer | abilityMotifs.json + abilityTheme.ts (WIP, lead fixed the JSON cast), tests/abilityMotifs.test.ts | D1 audit of 23 champions, D2-D6; sprite-revision local files (docs/style/revision/_strike.jpg, _zoom.jpg) still uncommitted in the main checkout; portrait crops (issues.md) | no screenshots before/after yet -> nothing accepted | push the local sprite-revision files; D1 with abilityVisuals tests; every visible change with 1280x720 before/after under docs/ist/ |
| E Champion Sev | docs/champions/sev.md (spec, Fassung 2), e.md with the full wiring plan; Itachi dropped, no remnants | all code: sev.json, registry, hooks (Nachbild, Q fake, Schwarzglut, Trugbild decoy, R Bann), sim extensions fear CC + `uncleansable` (B area -> shared-changes), tests, sprite/UI, bot rules (issues.md) | - | data + registry first (championData test), then hooks; fear/uncleansable as shared-change proposal before touching src/sim/buffs.ts |
| S Supervisor | review-checklist, plan-api review, A3 review, fog-guard patch (file cdb56e7; verified on main e0f40bb: applies cleanly, both static guards green while now really scanning src/ai/reflex, utility, humanize, errors.ts - lead may `git apply docs/agents/supervisor-fog-guards.patch`), DECISIONS entry for the merge, this file, ROADMAP rows | no gate measured; browser check for C; B8 run for B3. Patched no-omniscience tests pass on main (scripted 1000 states + headless Diamond 5 min), but the headless run exercises only the old nodes plus `wave` - `reflex`/`utility`/`attention` log nothing while their switches are off, so the extended check becomes real only when the gate runs use `--reflex=true` / `BOT_UTILITY=1` | - | review incoming commits per checklist; measure Phase 1 when A1 reports |

## Merge-risk notes for the next round (branches now all based on main e0f40bb)

- Shared files touched by two or more agents in the last round: `docs/agents/shared-changes.md` (all), `src/i18n/de.json` + `en.json` (A3, C; C's tests/i18n.test.ts enforces key equality - every new key in both files). Expect the same again plus `src/sim/snapshot.ts` (B3 fields, C's objective proposal, A1's lite view) and `src/sim/types.ts` (A3-8 ping kind, A2-2 `botUtility`, E's fear CC).
- Flags that must stay off in the game until their gate is green: `reflex` (worker.ts), `BOT_UTILITY` (never set in the browser), `withTilt` mode `'attention'` (leaves.ts, with A3-4 only).
- A2-1 (utilitySelector node in tree.json + leaves.ts) and A2-3 (retreat goHome under the flag) are flag-gated and bit-identical with the flag off: S recommends approving them now so A2 can measure Phase 3 without a local adapter; A2-2 (`SimConfig.botUtility`) too, so the lobby can switch it later.
- B's brain.ts note (do not set `busyUntil` for `movesWhileCasting` casts) is an A1/A2 shared-file edit; nobody owns it yet - assign to A1 with the Phase 2 work.
- Recommended merge order when the next round reports: B (B8 run first) -> A1 (Phase 1 gate) -> A2 (flag-gated integration) -> A3 (wiring follow-ups) -> C -> D -> E; at most three merges per cycle per track.

## Decisions needed from the lead / user

1. Approve A2-1, A2-2, A2-3 now (flag-gated) - S recommends yes.
2. Who edits brain.ts for B's `movesWhileCasting`/`busyUntil` note (S recommends A1, Phase 2 commit).
3. Reflex layer in the game: keep off until the Phase 1 gate is green and reflex-on is not worse than reflex-off in a 4-game Gold run (S recommends; otherwise the live bots get worse).
4. C7 needs `src/settings.ts` opened to C (additive fields) - S recommends yes, logged in shared-changes.
5. Sev: fear CC and `uncleansable` touch src/sim/buffs.ts + summoners.ts (B's area). Either B implements them from E's spec or E gets a one-time pass for those two files - decide before E starts hooks.

## Questions for the user (collected)

- ANSWERED 19 Oct: Lysa E wire visible to enemies (B).
- ANSWERED 19 Oct: show enemy items like LoL, last state seen while visible (B snapshot, C UI).
- ANSWERED (spec): Sev ember jump decided after the first bot-sim run (E).
