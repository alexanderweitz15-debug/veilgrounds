# A2 handoff

- Branch: `brain/a2-utility`, pushed. Last code commit: c434680 (19 Oct; main 830aaa3 merged).
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
