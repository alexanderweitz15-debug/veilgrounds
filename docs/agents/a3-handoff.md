# A3 handoff (restart entry point)

Agent A3 "Menschlichkeit & Rang", branch `brain/a3-wiring` (main 56a197a merged). Spec: docs/BRAIN-REWORK.md §8, §9,
§10 test 10, §11 phases 5/6; docs/agents/orchestration.md; report docs/agents/a3.md (block 2 = current state).

## State (22 Oct)

- Wiring A3-4 .. A3-11 done, active only with the new brain (runner `reflex` or `utilityOn(ctx)`, not the lane-alone
  trainer). Gate = runner creates the attention state; all hooks are no-ops without it (`attentionOn(mem)`) and keep
  the Rng draws of the pre-rework brain.
- Bit-identical with the brain off vs main 56a197a: hash seed 1 / Gold / 4 min `c6c23309` (log 1462), bot-sim Gold
  2 x 15 min per-bot CSV byte-identical.
- Phase 5 gate measured green (a3.md table): every rank within +-1 point of its target; DECISIONS entry proposed in a3.md.
- Test 10 (all clauses) through the real runner; clause 3 with the "chance" window definition (a3.md).

## Next steps

1. Wait for S / lead: merge recommendation for brain/a3-wiring, answers to the two questions in a3.md (trainer without
   attention; clause 3 definition).
2. Before any new commit: `git fetch origin && git merge origin/main`; re-prove bit-identity (hash via
   `npx tsx tools/scratch/hash.ts 1 4`, bot-sim `npx tsx tools/botSim.ts --rank=gold --games=2 --minutes=15 --seed=1
   --out=X --game-out=Y` on main and branch; per-game CSV differs only in `thinkMsPerCall`). Run from exported trees
   (`git archive <rev> src tools tests package.json tsconfig.json vite.config.ts | tar -x -C <dir>` + node_modules
   junction) so edits do not leak into running processes; own scratchpad subdir (root is shared).
3. Phase 6 tuning only when the lead says Phase 4 is on main (§8 procedure, profile parameters of Table B / §4.7 only,
   every turn before/after in DECISIONS.md). Phase 5 re-check after tuning: `BOT_UTILITY=1 npx tsx
   tools/scratch/a3attn.ts <rank> 10 1,2 stable`.
4. Optional for A1/A2: clause 3 raw misses (fight mode, window collisions, horizon) - `npx tsx tools/scratch/a3clause3.ts 7 5`.
5. Last: rewrite docs/BRAIN-IST.md completely.

## Environment notes

- Worktree needs a node_modules junction (PowerShell `New-Item -ItemType Junction -Path <wt>\node_modules -Target
  C:\Users\Alex\Documents\Moba\node_modules`), remove with `(Get-Item <wt>\node_modules).Delete()`.
- Under load a 5-min game takes 1-6 min, a 10-min game up to 15 min: run with run_in_background. `python3` may hit the
  WindowsApps stub - use `python`. Commit with `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com
  commit`, push `brain/a3-wiring`.
