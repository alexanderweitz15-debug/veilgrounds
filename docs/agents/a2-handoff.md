# A2 handoff

- Branch: `brain/a2-utility`, pushed. Last code commit 455e29c (23 Oct; main b3150ef merged).
- Worktree had a node_modules junction (deleted at stop). Untracked scratch tools in tools/scratch/ (hash.ts,
  prof.ts, cmds.ts, trace.ts, idle.ts, recalls.ts) were not committed; recreate as needed.
- Flag: `BOT_UTILITY=1 npm run bot-sim ...` or `SimConfig.botUtility = true`; tree node `utilitySelect` (after `arena`).

## State

- Utility model complete as scaffold (12 candidates, selection, commitments, logging, intent subtrees). All behind
  the flag; flag off = bit-identical (seed 1, 4 min hash 8643ddf8).
- §6 combat items done behind the flag (see a2.md). §7 macro items partly (see "Not done" in a2.md).

## Not run at stop

- Full `npx vitest run`; tests/utilityGame.test.ts after cfac9d0 (last green before it); bot-sim with the flag.

## Next steps (in order)

1. Run the full suite in the background (not run since the hooks were applied).
2. (done) A2-1..A2-3 applied, interim hook removed.
3. After A1 Phase 2 is on main (`git merge origin/main`): the farm/push/recall/group intents call `laneLeaf`, which
   then sets A1's lane intent - check `getIntent` is set for them; add the disengage intent (A2-4) in `endTrade`.
   Flip `it.fails` in tests/utilityGame.test.ts (strict test 7) to `it` once it passes.
4. Write the harness form of test 8 (laner recalls from the utility recall intent:
   enemy minions within 1500 at the recall <= 2 on average; tools/scratch/recalls.ts measured it).
5. (done) §7 items; calibration pass 1 done (a2.md table).
6. Plates (1.25 vs main 3.38): diagnose push vs recall after a crash - log `intent` entries around crashes
   (tools/scratch/trace.ts) and give the push candidate the plates the bot gives up when it recalls (opportunity term in
   recallValue: plates within reach x plate gold), or shove-first should end with the plate (`uRecall` hits the
   structure while >= 2 minions tank). Re-measure with the same 4 x 20 min setup.
7. Kills 14.5 vs main 16.8: trade duration 2.7 s is short; check the trade candidate's missed-farm and aggro costs
   (weights.tradeMissedFarm / tradeAggroPerMinion) once A1's harass filler exists (kills come mostly from harass).
8. Objective conversion 0 % in both flag states: the team AI's conversion never fires (wonSkirmish needs 2 enemy
   deaths in 12 s); check with the `convert` log node in a longer run.

## Traps

- With the flag off nothing in src/ai/utility may draw rng, write memory or log before the flag check.
- Python/sed edits on Windows: write with newline='\n' (CRLF warnings otherwise).
- `utilityOn` caches per BotStatic at the first call: set `ctx.utility` before the first decision (harness does).
- Setting `process.env.BOT_UTILITY` inside a vitest file leaks into other files of the same worker: use the harness.
- The full test with a 5-min game takes > 3 min under shared CPU: run in background.

## 19 Oct notes

- Recall loop trap: after a channel the bot stands in the fountain with mode 'recall'; any lock on mode alone
  re-issues recall there. Lock / candidate / leaf all stop inside `values.recall.homeRange`.
- Roam/gank value: `roamPrize` in value.ts; tune `weights.roamKillConversion` with bot-sim roams/10 min (targets
  §7.3: mid Gold 0.8 / Diamond 1.5 / Challenger 2.0 per 10 min).
- Recall rate check: `tools/scratch/recall2.ts` (not committed scratch except recall2.ts) prints recall commands per
  slot and the logged recall terms.

## 19 Oct part 2 notes

- Calibration command: `BOT_UTILITY=1 npm run bot-sim -- --rank=gold --games=4 --minutes=20 --variance=0 --seed=1
  --report=<file>` (about 8-10 min wall time under shared CPU; run in the background).
- Death analysis: `tools/scratch/deaths.ts <min> <seed>` (committed) prints the last log entries before every death
  without a champion killer.
- Kesselbrut feasibility: the team AI's rough DPS model needed a 75 s window (2 champions); it is in values.json.

## 22 Oct: state at stop (lead: max 3 agents, A2 stops)

Done: recall minion clearance, Sev build, top-lane Teleport (lane return + Gold+ fight join), test 8 full game,
conversion weight + diagnosis, plates 1.25 -> 2.75 (shove to the plate when the opponent is away).

Next steps, in order:
1. Deaths without an enemy champion rose to 4.7 % with the shove change (target <= 4 %, 1.4 % before). Check
   tower deaths during `push` with tools/scratch/deaths.ts; likely the shove walks into tower range before the wave
   tanks - require `tank >= 2` for the structure part when the bot is within tower range, or raise
   `weights.exposurePush` (0.8) only near the tower.
2. Plates 2.75 vs main 3.38: remaining gap probably the push candidate losing to farm while the wave is still in
   mid lane; consider the plate tempo term for `wave.pushing` too (values.json `weights.platePriority`).
3. Conversion 0 %: decide with the supervisor whether the 30-s window of the harness metric is right (LoL-like
   tower conversion after a lane 2v2 takes longer) or the team AI should convert to plates / dragon only when the
   group can finish in 30 s (feasibility check like the objective DPS model).
4. Kills 13.8 vs 16.8 and trade duration 2.8 s: trade costs (`tradeMissedFarm`, `tradeAggroPerMinion`) after A1's
   harass filler lands.
5. A1 now owns `chooseWave` in macro.ts (Phase 2 wave states): coordinate via shared-changes.md before touching it.
6. tests/utilityRecall.test.ts runs a 12-min Diamond game (~6 min wall time under shared CPU): if the suite gets too
   slow, move it behind an env switch or shorten to 10 min after checking an item recall still occurs.
7. Phase 3 gate only after A1's scheduler drives the farm intent (lead decision); §6 combat stays flag-gated until
   the Phase 4 gate.

## 23 Oct: state

Done: safer plate push (plates 3.13 vs main 3.50, deaths without a champion 3.2 %), Sev Fassung 3 rules 1/2/3/6,
conversion feasibility metric, CI fixes for tests 7/8 (harness flag via SimConfig, attention windows, shove cap,
recall back-off from minions), trade dive rule.

Next steps:
1. Re-measure on main b3150ef+ (A1 reflex + wave states now on together with the flag): CS dropped to 3.09 (off
   3.31) and kills 13 vs 16.5 in the pre-merge run - check whether the farm intent still loses to poke/recall.
2. Sev items not done: 4 (decoys - bots never target pets, so only the "below Gold 40 %" waste is missing), 5
   (Amaterasu burn in ExchangeEstimate: needs the dot remaining damage in the snapshot), 7 (combos: champion json,
   E's file). Q fake needs reflex-precise timing at low decision rates (it is rank-gated Platinum+ anyway).
3. Conversion: TeamAI.convert sends a push_lane to the next structure; for lane fights consider a plate / tower
   desire only when the harness-style feasibility holds, and log `convert:` with the feasibility inputs.
4. Test 8 runs 15 min (~1 min wall); test 7 strict form still it.fails until A1's scheduler fills the farm intent.

## 23 Oct (later): Phase 3 gate measured - not reached (a2.md); main bfa15f2 merged

Next steps:
1. Absence: about 40 % of laner recalls come from the retreat leaf below the retreat line (tools/scratch/recallsrc.ts).
   Under the flag the retreat could walk to the own tower and farm there while stay-death <= 0.3 (§4.6 heal path),
   recalling only from there; shove-before-recall only when the wave can crash within 20 s.
2. First tower / plates: both reflex variants take ~2 plates vs classic 3.5 - check with A1 whether the reflex wave
   state 'push' hits the structure (hitStructures intent flag) when >= 2 minions tank.
3. Conversion: local conversion is in (TeamAI.convert); 1/8 feasible fights converted - next: keep the convert desire
   until the structure / epic is taken or 30 s pass, and let the group candidate weight it higher.
4. Sev items 4/5 not started.
