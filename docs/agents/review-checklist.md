# Supervisor review checklist (S, both prompts)

Applies to every merge candidate from A1/A2/A3 (docs/BRAIN-REWORK.md §12.1-2) and B/C/D (docs/AGENTS-PLAN.md §2).
S measures, S does not believe reports. Every gate result goes to docs/DECISIONS.md (before/after, seeds, commit)
and the merge recommendation to docs/agents/status.md. Written 16 Oct 2026, main at 0bbc3d0.

## 0. Measuring in a clean worktree (PowerShell)

The local `brain/*`, `sim/*`, `ui/*` branches are checked out in locked `.claude/worktrees/agent-*` worktrees, so
`git worktree add <dir> brain/a1-reflex` fails ("already checked out"). Always add a detached worktree from the
pushed ref:

```powershell
$wt = "C:\Users\Alex\AppData\Local\Temp\claude\C--Users-Alex-Documents-Moba\aba13fc4-a91c-4600-bf36-e5fc8691a0d6\scratchpad\s-gate"
git -C C:\Users\Alex\Documents\Moba fetch origin
git -C C:\Users\Alex\Documents\Moba worktree add --detach $wt origin/brain/a1-reflex   # or origin/sim/b-mechanics ...
New-Item -ItemType Junction -Path "$wt\node_modules" -Target "C:\Users\Alex\Documents\Moba\node_modules"
Set-Location $wt
git log --oneline -1            # record the commit hash in DECISIONS
npm run typecheck
npm test                         # background, > 3 min
npm run bot-sim -- --rank=gold --games=4 --minutes=20 --seed=1 --out=$wt\gate-gold4.csv   # "not worse" check
npm run bot-sim -- --rank=gold --games=8 --minutes=25 --seed=1 --report --out=$wt\gate-gold8.csv  # Phase 0+
# teardown: delete the JUNCTION first, never Remove-Item -Recurse (it would follow into main's node_modules)
(Get-Item "$wt\node_modules").Delete()
git -C C:\Users\Alex\Documents\Moba worktree remove --force $wt
```

Rules: every bot-sim or full `npm test` run goes to the background with `--out=<file>` / `> log 2>&1`; fixed
`--seed`, recorded in DECISIONS; `--mirror` needs `--vs`; at most one bot-sim at a time while agents run (CPU is
shared with up to five agents). `--report` does not exist on main yet (A1 Phase 0 delivers it): the Phase 0
commit (metrics only, no behaviour change) is the reference for all "before" numbers; before Phase 0 the
baseline is DECISIONS "Spieltempo" (Gold seeds 1-4: CS/min@15 2.83, kills/game ~34, first tower 18.1 min,
Gold vs Silver 5/8, Diamond vs Gold 3/8).

## 1. Every merge, both prompts

| # | Check | How |
|---|---|---|
| 1 | Branch rebased on current main, small named commits (`a1: ...`, `b1: ...`), no bundle commits across packages | `git log --oneline main..origin/<branch>` |
| 2 | File area respected; shared files only via docs/agents/shared-changes.md with approval | `git diff --stat main...origin/<branch>` against AGENTS-PLAN §7 matrix |
| 3 | Typecheck, `npm test` (~495 `it` blocks on main; vitest's count differs where tests are generated in loops), build green | `npm run typecheck; npm test; npm run build` |
| 4 | Determinism: `tests/bots.test.ts -t "bot determinism"` (bots included), `tests/bughunt.test.ts -t "M2"` (recorded bot game replays to same hash), `tests/replay.test.ts -t "determinism"` (sim only), `tests/trainer.test.ts -t "trainer determinism"` | `npx vitest run <file> -t "<name>"` |
| 5 | Fog / no omniscience (every merge touching sim/** or ai/**): `tests/botPerception.test.ts -t "no omniscience"` (spec test 7, 1000 random states + headless Diamond game), `tests/botPerception.test.ts -t "fog guard"` (static import guard), `tests/bots.test.ts -t "bot fog of war"` (Brain type + static guard + hidden-enemy snapshot check), `tests/botLog.test.ts -t "convention checker"`, `tests/jungle.test.ts -t "jungle fog"`, `tests/summonersWards.test.ts -t "invisible to enemies"`, `tests/snapshot.test.ts` | same |
| 6 | Static guard coverage: the globs in tests/bots.test.ts (`src/ai/bot/*.ts`, `src/ai/bt/*.ts`) and tests/botPerception.test.ts (perception, ganks, roams) do NOT cover `src/ai/reflex/**`, `src/ai/plan.ts`, `src/ai/utility/**`, `src/ai/humanize/**`. Before the first merge that adds one of these directories the glob must include it (and the `Math.random|Date.now|performance.now` pattern must hold: perf timing lives in harness/runner only, never in brain code). `checkFogConvention` only inspects `L_NODES` (escape, gankRisk, jungleGank, counterGank, roam, enemyRoam): new log nodes (`reflex`, `intent`, `wave`, `plan`, `attention`) must be added or their x/y inputs are unchecked. Supervisor fix (< 30 lines, `supervisor:`) or assigned to the agent - decided per merge | grep the test files |
| 7 | No new value in code: count numeric literals per file and compare with the main baseline; every new literal needs a reason in the report (free passes: `30` ticks/s, geometry, array indices). Baseline on 0bbc3d0 (`grep -oE '\b(0\.[0-9]+\|[1-9][0-9]{1,3})\b' <f> \| wc -l`): laning.ts 50, lasthit.ts 40, brain.ts 128, macro.ts 122, trade.ts 112, kite.ts 28, combat.ts 36, teamfight.ts 40, errors.ts 0 | rerun on candidate |
| 8 | Every new rank/style parameter sits in `src/data/bots/profiles/*.json` (all ten files, `profileAt` interpolates over the keys of the lower anchor), `playstyleAxes.json`, `errors.json` or `values.json`; the schema (`src/ai/profiles/schema.ts`) has the field; `tests/profiles.test.ts` green | diff of src/data/bots/** |
| 9 | Every decision logged: new behaviour has `ctx.log`/`n.log` entries with node, chosen, reason, scores; positions in inputs follow the `<key>X/<key>Y/<key>Src(+Slot/+R)` convention so the fog checker can read them | spot-check log of a 5-min headless game |
| 10 | Log volume: per-tick entries (plan cancels, scheduler) must not exhaust the 100k entries / 50 MB cap (`LOG_DEDUP_TICKS` only dedups identical entries; a plan id in inputs defeats it) | `runner.log.length` after a 25-min game < 60 % of cap |
| 11 | `npm run bot-sim -- --rank=gold --games=4 --minutes=20 --seed=1` not worse than the stand before (CS/min@15, kills, first tower, max idle) | compare with previous DECISIONS row |
| 12 | Report in docs/agents/<name>.md: files, commits, numbers before/after with seeds, open points, deviations with reason, questions | read |
| 13 | DECISIONS entry prepared (agent proposes, S writes the final one), ROADMAP line updated by S after merge | - |
| 14 | Root cause, not symptom (§2 of BRAIN-REWORK): see per-phase questions below. If the stand just moved to another node (same idle, different log reason), the gate is red regardless of numbers | replay + log |

## 2. Brain phases (A1/A2/A3): gate numbers and root-cause questions

Common to every phase gate: §1 above + 3 replays watched with F9 (once A3's overlay lands; before that the
decision log of 3 bots over 5 min): no bot standing without a logged negative reason, nothing robotic
(same stand point for 6 s, attack cancelled by move, instant 180-degree reversals).

### Phase 0 (A1): measurement base
- Gate: `--report` writes a Markdown summary with every §10 metric against the targets of §1, 4.7, 6.4, 7.1, 8, red outside +-10 %; CSV per bot and per game; `csLossByCause` sums per lane and game to (lane minions died in the bot's lane) - (bot's CS), checked in a test or in the report footer.
- Baseline run by S on the Phase 0 commit: Iron/Gold/Diamond/Challenger, 8 games, 25 min, seeds 1-8, stored under docs/agents/baseline-<rank>.md (numbers copied into DECISIONS).
- Metric sanity: attackUtilization uses "minions or enemies within range + 200"; idleShare counts > 45 ticks without command; reflexCostMs/thinkCostMs measured, not estimated; `--variance=0` exists and is logged (§8).
- Root cause: metrics come from sim events in the harness (full access is allowed there), never from the brain reading the sim.
- Also needed from A1 before Phase 1 can be gated: a rank-parametrised lane-alone scenario (real brain, 10 min, autos only; `tests/phase1.test.ts` uses a scripted last-hitter, `tests/botLastHit.test.ts` a 10-min Gold game) - as test or `bot-sim --scenario=laneAlone --rank=<r>`.

### Phase 1 (A1): reflex layer + attack scheduler (§3, 4.1, 4.2, 4.4)
- Gate: test cases 1-4, 11, 12 (§10) green; lane-alone 10 min CS Iron >= 70, Gold >= 88, Challenger >= 100 (of 107); attack utilisation Gold > 50 % (2:00-14:00); determinism green.
- Greps that must return zero hits in `src/ai/bot/laning.ts` / `brain.ts` / `lasthit.ts`: `holdTimer`, `roll.skip`, `LAPSE_SHARE`, `tooLate:`, `6 * 30` stand hysteresis, lane last hits via `delay:` + tag `'lh'`.
- Root-cause questions: (A) does one scheduler fill every free attack period and keep only the one period the last hit needs (`now + windup <= freeUntil`, travel included)? (B) does the last-hit planner run every tick with the timing error rolled once at creation (biasTicks kept through validation, re-rolled only on prediction_drift)? Is the stand point recomputed every tick with spatial hysteresis only? Is move/stop during a wind-up gone except survive/dodge (log check: no `move` within [atkStart, hit] from reflex)?
- Reflex snapshot: built per tick with the same `buildSnapshot`; it must pass through `onPerceive` (or an equivalent hook) so the hidden-enemy test in tests/bots.test.ts covers the reflex path; snapshot cost reported separately from reflexCostMs (the 0.05 ms target is for reflex; 10 snapshots x 30 Hz is the real risk).
- Event buffering: reflex may read tick events, but think must still receive every event since its last decision.
- Numbers: §4.7 rows (jitter, horizon, window prep, hysteresis, orbwalk pct, harass rate, CS-window harass) in all ten profile JSONs, not in `reflexParams` defaults (defaults acceptable only until the JSON lands in the same merge).

### Phase 2 (A1): wave states + harass (§4.3, 4.5)
- Gate: test cases 5, 6; bot-sim Gold 8 games: harass autos >= 40 per laner by 14:00, kills/game >= 42, CS/min@15 >= 5.0; Phase 1 numbers not worse.
- Greps: `risk >= 0.4` -> `freeze`/`hold` rule in macro.ts gone (hold only for 0.4-0.7, freeze only with the §4.5 conditions); champion autos reachable outside `tradeWindow`.
- Root cause: wave state is a target picture (centre of mass + allowed fillers), not a prohibition; freeze still attacks (>= 1 auto per 2 s); state change at most every 10 s, logged with reason; harass budget per minute from profile + aggression axis; aggro check from Silver; harass pauses when a last-hit window is within windup + travel.
- Hard dependency (AGENTS-PLAN §3/§8): B1 ward stealth, B2 movesWhileCasting, B3 snapshot fields on main before Phase 2 is gated.

### Phase 3 (A2): utility model (§5, 4.6, 7)
- Gate: test cases 7, 8; bot-sim Gold: CS/min@15 >= 6.0, absence loss <= 15 % of lane minions by 15:00, first tower <= 15 min, idle <= 12 %.
- Greps: selector order for combat/objective/recall/idleAfterShove/role/vision in tree.json replaced by intent subtrees; every gold equivalent of §5 in `src/data/bots/values.json`; hysteresis and noise sigma per rank in profiles; style factors in playstyleAxes.json.
- Root cause: one currency (gold/s for the team); Farm nearly always a positive candidate; every idle tick > 45 has a log entry with all candidate scores <= 0 (test 7); recall only after crash from Silver; roam/recall/objective pay the wave value; jungler "catch lane" intent exists; flag `BOT_UTILITY=1` removed or defaulted on at merge (decide in DECISIONS).
- Explicit check: Diamond laner CS/min >= Gold in every role (8 mirrored games) - if not, the weighting is wrong (§8).

### Phase 4 (A2): combat (§6)
- Gate: Gold kills/game 45-55; deaths without enemy involvement (tower/minions) <= 5 %; `tests/botStyle.test.ts -t "trade length axis"` green (spec test 5); trade duration avg Gold ~4 s.
- Root cause: harass-to-trade without hysteresis penalty; kill window (killProb > 0.6) from the Farm intent; teamfight commit rule (re-evaluation only every 2 s); focus hysteresis 0.2 in data; skipped combo step becomes an auto, never idle; chase abort and dive aggro swap from Platinum as data.

### Phase 5 (A3): humanisation (§9)
- Gate: test case 10 (Iron 5 min: distracted share 30-40 %, no window > 3 s, no minion permanently ignored); error shares per rank within +-5 points of Table B (Iron 35, Gold 20, Diamond 9, Challenger 3 % as share of distracted time). `tests/errors.test.ts -t "observed rates"` must be reworked for the attention model - a green old test is not the gate.
- Greps: per-minion skip roll gone; every named error has duration + detection in errors.json; tilt acts via distraction windows and aggression shift, not direct parameter degradation.
- Logging: `attention: distracted(<reason>) <s>`, `injectedError: <id> (dur <s>)` present; overlay shows intent, top-3 candidates, plans with countdown, utilisation 30 s.

### Phase 6 (A3): rank tuning (§8)
- Gate: win rates (mirrored, 8 pairs per combination, `--vs --mirror`): Silver>Iron >= 65 %, Gold>Silver >= 65 %, Platinum>Gold >= 65 %, Diamond>Gold >= 80 %, Challenger>Diamond >= 70 %, Challenger>Gold >= 95 %; all §8 minimum gaps Gold->Diamond (CS/min +0.9, team gold/min +12 %, plates by 14:00 +2, objective conversion +30 pts, non-enemy deaths -3 pts, avoidable gank deaths -50 %, recalls with wave at own tower -60 %, first tower -2 min, idle -6 pts); test case 9; Table A +-10 % for all ten ranks (50 games per rank is the final acceptance; 8 per rank for the gate, 50 once before sign-off).
- Root cause: only profile parameters (Table B, §4.7) turned, no logic branches; every turn documented before/after; a line-up winning both sides of a mirrored pair is a balance issue (tools/balance.ts), reported not fixed.
- Final acceptance: docs/BRAIN-IST.md rewritten (not patched); F9 overlay verified in a real game.

## 3. AGENTS-PLAN §2 checklist (B, C, D merges)

Per merge, as a comment in the merge log (DECISIONS entry or status.md merge table):

1. Which ROADMAP / FEATURE-GAP line does the merge close? Line updated (FEATURE-GAP: status, agent, effort, training value 1-5)?
2. Tests green, determinism green (§1 #4), build green, bundle size not > +5 % without reason (`npm run build`, compare `dist/assets/*.js` sizes with the previous build log).
3. New values in data (JSON / i18n), not in code (§1 #7 method).
4. UI: de.json and en.json complete (key-equality test; if C has not added it yet, `node -e` key diff), keybind changeable (src/input), colour-blind mode checked.
5. Does it affect bots? Sim change touching `src/sim/snapshot.ts`, vision/**, cast flags (busy/`movesWhileCasting`), minion/tower targeting, damage events: note in shared-changes.md for A1-A3 BEFORE the merge, run §1 #5 fog tests and bot-sim Gold 4 games without degradation.
6. Screenshot before/after present (1280x720, fixed camera position, files under docs/ist/), taken from the built game, never accepted by description.
7. After every C or D merge: 5-minute game in the browser (built `vite preview`), console errors, HUD overlaps, load time < 5 s warm. No Playwright in the repo: S uses the Claude browser pane (`preview_start`, `resize_window 1280x720`, screenshots, `read_console_messages`) unless the lead adds Playwright as a devDependency (package.json is supervisor-owned).

B-specific:
- B1: the sim already hides enemy Schleierwards (`tests/summonersWards.test.ts -t "invisible to enemies"`). B must first reproduce what the user sees (render/minimap/spectator/buff expiry) and name the leaking path in the report; the fix must unify wards, Nyx seed, Grimald traps, Lysa wire under one stealth flag; tests: enemy ward outside reveal absent from team snapshot, present within 450 of a Siegelward, absent again 3 s after Spähfrucht.
- B2: docs/ability-cast-audit.md complete (26 x 4 + summoners), each ability `movesWhileCasting` + `castTime` in the champion JSON (data, not code), one test per ability ("walks 600, casts at 300, expected arrival"); `mem.busyUntil` in brain.ts then only blocks for abilities that really stop.
- B3: every new snapshot field is public information (atkPhase/target, minion target, tower target, plates, Kesselbrut stacks, active reveals); nothing from cooldowns, hidden HP or unseen wards; `tests/snapshot.test.ts` + fog tests green; A1-A3 informed via shared-changes.md before merge; `Snapshot` type change = shared-file approval by S.
- B8 before every B merge: determinism, `tests/sideMirror.test.ts`, `tests/phase1.test.ts` (107 minions, scripted >= 60 on main; AGENTS-PLAN says 73 - record which threshold applies in DECISIONS), bot-sim Gold 4 games.

C-specific:
- C1: docs/FEATURE-GAP.md exists with the full start list (not shortened), columns Function, LoL behaviour, Veilgrounds state, training value, effort, agent; S owns it afterwards.
- C2: Tab scoreboard and death timers checked by S in a real game (browser pane), not by screenshot alone.
- Every "da" line has a screenshot and a test.

D-specific (when D starts): IST-ZUSTAND.md updated with new screenshots and grades after every D merge; abilityVisuals tests extended; 60 FPS kept.

## 4. Merge order and blocking

B1-B3 before A1 Phase 2 gate; A1 Phase 2 on main before A2 switches `BOT_UTILITY` on; A2 Phase 4 on main before A3 tunes; A3 log format + calibration API before C builds style scales / post-game error list. At most three merges per cycle per track. A red gate stops only the track behind it; S decides within the cycle (fix or justified target change in DECISIONS).
