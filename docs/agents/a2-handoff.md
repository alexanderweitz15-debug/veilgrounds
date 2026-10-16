# A2 handoff

- Branch: `brain/a2-utility`, pushed. Last code commit: cfac9d0 (+ this docs commit).
- Worktree had a node_modules junction (deleted at stop). Untracked scratch tools in tools/scratch/ (hash.ts,
  prof.ts, cmds.ts, trace.ts, idle.ts, recalls.ts) were not committed; recreate as needed.
- Flag: `BOT_UTILITY=1 npm run bot-sim ...` works today through the interim hook in `tradeRun` (trade.ts).

## State

- Utility model complete as scaffold (12 candidates, selection, commitments, logging, intent subtrees). All behind
  the flag; flag off = bit-identical (seed 1, 4 min hash 8643ddf8).
- §6 combat items done behind the flag (see a2.md). §7 macro items partly (see "Not done" in a2.md).

## Not run at stop

- Full `npx vitest run`; tests/utilityGame.test.ts after cfac9d0 (last green before it); bot-sim with the flag.

## Next steps (in order)

1. Re-run `npx vitest run tests/utility.test.ts tests/utilityGame.test.ts` and the full suite in the background.
2. When the lead applies A2-1 (tree node `utilitySelect` + registry): delete the first line of `tradeRun`
   (`if (utilityOn(n.ctx)) return utilitySelect(n);`) and the trade.ts import of select.ts.
3. After A1 Phase 2 is on main (`git merge origin/main`): the farm/push/recall/group intents call `laneLeaf`, which
   then sets A1's lane intent - check `getIntent` is set for them; add the disengage intent (A2-4) in `endTrade`.
   Flip `it.fails` in tests/utilityGame.test.ts (strict test 7) to `it` once it passes.
4. Apply A2-3 (retreat goHome) and write the harness form of test 8 (laner recalls from the utility recall intent:
   enemy minions within 1500 at the recall <= 2 on average; tools/scratch/recalls.ts measured it).
5. Missing §7 items: Kesselbrut candidate (team AI `OBJECTIVES` excludes it), jungler plate dive after a gank,
   siege from 11:00 when a lane is won, `convert:` log line, team-AI interval by rank, idle_after_shove under the
   utility model.
6. Calibrate values.json with bot-sim Gold 4 x 20 min (CS/min@15, absence loss, first tower, idle) before Phase 3 gate.

## Traps

- With the flag off nothing in src/ai/utility may draw rng, write memory or log before the flag check.
- Python/sed edits on Windows: write with newline='\n' (CRLF warnings otherwise).
- `utilityOn` caches per BotStatic at the first call: set `ctx.utility` before the first decision (harness does).
- Setting `process.env.BOT_UTILITY` inside a vitest file leaks into other files of the same worker: use the harness.
- The full test with a 5-min game takes > 3 min under shared CPU: run in background.
