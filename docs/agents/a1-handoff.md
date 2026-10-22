# A1 handoff (Reflex & Laning)

Branch `brain/a1-reflex`, merged with main (eb72edb + A2 utility). Read first: docs/BRAIN-REWORK.md §3/§4/§10/§11,
docs/agents/plan-api.md (contract + "Changes" 1-12), docs/agents/a1.md (numbers, gate table, deviations, open items).

## Where things are

| Piece | File | State |
|---|---|---|
| Phase 0 metrics, report, lane-alone scenario | src/ai/harness.ts, tools/botSim.ts, tools/botSimTargets.json | done; baseline in DECISIONS.md ("Gehirn-Rework Phase 0") |
| Reflex layer | src/ai/reflex/reflex.ts, view.ts, state.ts; src/ai/plan.ts | works; **opt-in**: `RunnerOptions.reflex` (bot-sim `--reflex=true`; laneAlone defaults on); sim worker keeps it off until the lead switches it on |
| Runner wiring | src/ai/runner.ts | reflex pass after decisions; per-team reflex view (`buildTeamEntities`, same fog rule + B3 atkTarget masking) through onPerceive; cost split view/reflex |
| laneLeaf | src/ai/bot/brain.ts | `laneLeaf` = intent for reflex if `reflexState(mem).enabled`, else `laneLeafLegacy`; `think()` no busyUntil for movesWhileCasting casts (B2) |
| Last-hit prediction | src/ai/bot/lasthit.ts | `predictWindows` (reflex horizon 120 ticks), legacy `planLastHit` unchanged (horizon 75) |
| Tests | tests/brainReflex.test.ts | tests 1-4, 11, 12 green (b24ea8e); test 5 describe.skip (harass gate) |

## Next steps (in order)

1. Lead decision pending: switch reflex on in src/sim/worker.ts (criterion met: 4 Gold games seeds 1-4, laner
   CS/min 3.27 on vs 2.90 off; lane-alone means meet the gate).
2. Phase 2: harass filler is in (reflex only) but far below the gate (a1.md open item 5 has the diagnosis and the
   next steps); wave states not started. Test 5 is describe.skip until harass meets its gate.
3. Open items 1-3 and 6 in a1.md.

## How to measure (scratch scripts, not committed; recreate if needed)

- `npx tsx tools/botSim.ts --scenario=laneAlone --rank=<r> --games=3 --report=<file>` (lane alone).
- `npx tsx tools/botSim.ts --rank=gold --games=4 --minutes=12 --variance=0 --seed=1 [--reflex=true] --out=x.csv
  --report=x.md` twice (on/off) and compare the per-cause shares (the report and the CSV columns `loss15_*`).

## Traps

- Background bot-sim processes survive `TaskStop` on Windows (npm -> tsx -> node children): kill by PID tree or
  avoid TaskStop.
- The scratchpad dir is shared with other agents (`scratchpad/base` is not only mine): use `scratchpad/a1`.
- A file named `nul` appears in the worktree when a Windows tool redirects to `nul`; delete it via the `\\?\` path
  (node `fs.unlinkSync('\\\\?\\C:\\...\\nul')`).
- `observeAttacks` must see each event exactly once: the reflex layer feeds it one tick of events; the legacy path
  (`planLastHit`) observes the decision buffer. Never run both for the same bot.
- Reflex views share one entity list per team and tick (`entityIndex` / `groups` caches are keyed by the list):
  never mutate `v.enemyMinions` etc.
- tsx loads source files at process start, but a run started seconds before an edit may still pick the edit up
  (slow startup under load): wait for the first "game" line before editing when comparing builds.
