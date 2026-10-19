# A1 handoff (Reflex & Laning)

Branch `brain/a1-reflex`, merged with main e0f40bb (lead integration). Read first: docs/BRAIN-REWORK.md §3/§4/§10/§11,
docs/agents/plan-api.md (contract + "Changes"), docs/agents/a1.md (numbers, deviations, open items).

## Where things are

| Piece | File | State |
|---|---|---|
| Phase 0 metrics, report, lane-alone scenario | src/ai/harness.ts, tools/botSim.ts, tools/botSimTargets.json | done; baseline in DECISIONS.md (top entry) |
| Reflex layer | src/ai/reflex/reflex.ts, view.ts, state.ts; src/ai/plan.ts | works; **opt-in**: `RunnerOptions.reflex` (bot-sim `--reflex=true`; laneAlone defaults on) |
| Runner wiring | src/ai/runner.ts | reflex pass after decisions; per-team reflex snapshot (`buildTeamEntities`) through onPerceive; cost split |
| laneLeaf | src/ai/bot/brain.ts | `laneLeaf` = intent for reflex if `reflexState(mem).enabled`, else `laneLeafLegacy` (old code, unchanged) |
| Last-hit prediction | src/ai/bot/lasthit.ts | `predictWindows` (reflex horizon 120 ticks), legacy `planLastHit` unchanged (horizon 75) |
| Tests | tests/brainReflex.test.ts | tests 1, 3, 11, 12 green (reflex on); tests 2 and 4 are `describe.skip` until the gate is met |

## Half done / next steps (in order)

1. **Top priority (lead): reflex farms worse than legacy in full 5v5 games** (Gold seed 1, 12 min: laner CS/min 2.68
   on vs 3.08 off) although it is better alone in lane. Findings so far (seed 1): with reflex on, laner recalls
   are broken by damage far more often (18 cancelled vs 6, mostly ~1 s after the recall command, HP low), and
   `in_range_no_attack` rises (12.7 % -> 20.4 % of lane minions), `tower_took` (6.2 -> 9.4 %), `absent_recall`
   (16.0 -> 19.7 %); `timing_miss` drops (14.2 -> 9.2 %). See a1.md "Real-game regression" for the multi-seed
   comparison and the diagnosis state. Scratch scripts to reproduce: see a1.md.
2. Lane-alone gate: Iron 69 (>= 70), Gold 85-89 (>= 88), Challenger ~93-98 (>= 100). Ideas in a1.md open items.
3. Reflex cost: lead measured 0.025 ms/bot/tick (test 11 green); under load locally 0.1-0.2.
4. Phase 2 only after the lead says B1-B3 are on main.

## Traps

- Background bot-sim processes survive `TaskStop` on Windows (npm -> tsx -> node children): kill by PID tree (see
  a1.md) or avoid TaskStop.
- The scratchpad dir is shared with other agents (`scratchpad/base` is not mine): use `scratchpad/a1`.
- A file named `nul` appears in the worktree when a Windows tool redirects to `nul`; delete with the `\\?\` path.
- `observeAttacks` must see each event exactly once: the reflex layer feeds it one tick of events; the legacy
  path (`planLastHit`) observes the decision buffer. Never run both for the same bot.
- Reflex snapshots share one entity list per team and tick (`entityIndex` / `groups` caches are keyed by the list):
  never mutate `v.enemyMinions` etc.
