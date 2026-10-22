# A3 handoff (restart entry point)

Agent A3 "Menschlichkeit & Rang", branch `brain/a3-wiring` (from main e360650). Spec: docs/BRAIN-REWORK.md §8, §9,
§10 test 10, §11 phases 5/6; docs/agents/orchestration.md; report docs/agents/a3.md (block 2 = current state).

## State (22 Oct, stopped by the lead: 3-agent limit)

- Wiring A3-4 .. A3-10 done on brain/a3-wiring, active only with the new brain (runner `reflex` or `utilityOn(ctx)`).
  Gate = runner creates the attention state; all hooks are no-ops without it (`attentionOn(mem)`).
- Bit-identical with the brain off: hash seed 1 / Gold / 4 min `1e2f12d9` (log 1462) = main; bot-sim CSV see a3.md.
- Test 10 runs through the real runner; clause 3 is a real test (tests/attention.test.ts `playIron`).

## Next steps (in this order)

1. `git fetch origin && git merge origin/main` (A1 edits reflex.ts stand point / macro.ts chooseWave, A2 recall /
   plates: conflicts possible on the reflex.ts `chooseFiller(..., mem)` call and the macro.ts idle_after_shove lines).
   Re-run tsc + tests/attention.test.ts tests/bots.test.ts tests/botPerception.test.ts tests/brainReflex.test.ts
   tests/bughunt.test.ts tests/utility.test.ts.
2. Re-prove bit-identity after the merge: `npx tsx tools/scratch/hash.ts 1 4` on main and branch, and
   `npx tsx tools/botSim.ts --rank=gold --games=2 --minutes=15 --seed=1 --out=X.csv --game-out=Y.csv` on both;
   per-bot CSV must be byte-identical, per-game CSV identical except `thinkMsPerCall` (wall clock). Run the two from
   an exported tree or wait until tsx has loaded before editing src (an edit during a run is picked up by the next
   process). Use your own scratchpad subdir (the scratchpad root is shared with other agents).
3. Phase 5 gate (not started): rewrite tools/scratch/a3attn.ts to the real wiring: `runBotGame(botGameConfig(seed,
   rank, 'stable'), min*1800, undefined, { reflex: true })` with `BOT_UTILITY=1`, per bot `attentionStats(mem, tick)`
   share vs `params.behavior.errorInjectionPct`, `byReason`, `errorEpisodes(mem)` per id, and log counts (node
   `attention` without '+' == windows; node `error` injected/detected == episodes). Ranks Iron/Gold/Diamond/Challenger,
   >= 2 seeds x >= 10 min each, background runs (~30 s per sim-minute under load). Gate: mean share per rank within
   +-5 points of Table B. Record before (block 1 wrapper numbers in a3.md) / after with seeds; propose the DECISIONS
   entry ("Phase 5 Menschlichkeit: attention wired, shares per rank, error episodes, test 10 green").
   bot-sim `loss_distracted` (harness.ts csLossByCause) now reflects the real windows with `--reflex=true`.
4. Remaining hooks (small): reaction penalty in perception/perceive.ts (notice) and bot/spells.ts cleanseStep (pass
   a penalty in; no mem there), episodes for escape.ts flash_wrong_direction / flash_into_wall (durS 0) and
   perceive.ts no_flash_tracking. Log each in shared-changes.
5. Full `npx vitest run` before the merge recommendation.
6. Phase 6 tuning only when the lead says Phase 4 is on main (§8 procedure, profile parameters only).
7. Last: rewrite docs/BRAIN-IST.md completely.

## Environment notes

- Worktree needs a node_modules junction (PowerShell `New-Item -ItemType Junction -Path <wt>\node_modules -Target
  C:\Users\Alex\Documents\Moba\node_modules`), remove with `(Get-Item <wt>\node_modules).Delete()`.
- Real-game tests take 60-300 s under load: run with run_in_background. Commit with
  `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com commit`, push `brain/a3-wiring`.
