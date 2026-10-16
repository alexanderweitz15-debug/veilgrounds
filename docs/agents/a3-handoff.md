# A3 handoff (restart entry point)

Agent A3 "Menschlichkeit & Rang", branch `brain/a3-humanize`. Spec: docs/BRAIN-REWORK.md §8, §9, §3 (overlay), §12;
docs/agents/orchestration.md; lead decisions in docs/agents/status.md. Report: docs/agents/a3.md.

## State

- Block 1 done and pushed: profile attention fields + `utilityNoisePct`, attention.json, errors.json durations /
  detection, src/ai/humanize/attention.ts, error episodes in src/ai/errors.ts, playstyle knobs for A2, withTilt
  'attention' mode, F9 overlay columns (optional data), tests/attention.test.ts, shared-changes A3-1 .. A3-10.
- Nothing calls the new code yet (no behaviour change). Wiring is A1's / A2's (shared-changes A3-4 .. A3-10).

## Next steps

1. When A1's reflex lands on main (`git fetch origin && git merge origin/main`): check A3-4/A3-5 were wired
   (observeAttention per decision, attentionProbe in reflexState, LAPSE_SHARE gone), turn the `it.todo` of test 10
   clause 3 into a real test, measure the distracted share per rank in bot-sim games (`npx tsx tools/scratch/a3attn.ts <rank> <min> <seeds>`;
   it drives BotRunner with a brain wrapper that calls observeAttention after think; after wiring use the real runner).
2. A2 logs intents under node `utility` (brain/a2-utility ecdd3f3); if that changes, adapt `INTENT_NODE` in src/ai/log.ts.
3. Phase 6 tuning only when the lead says Phase 4 is on main: `git merge origin/main`, then §8 procedure exactly
   (fixed line-ups, rank vs itself 8 games, then --mirror 8 pairs per combination, only profile parameters of
   Table B / §4.7, every turn documented before/after in DECISIONS.md).
4. Last: rewrite docs/BRAIN-IST.md completely (not patch).

## Environment notes

- Worktree needs a node_modules junction (PowerShell New-Item -ItemType Junction ...), remove with
  `(Get-Item <worktree>\node_modules).Delete()`.
- Real-game tests take 60-180 s under load: run with run_in_background.
