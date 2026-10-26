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
| Wave states | src/ai/reflex/wave.ts | `chooseWaveState` (reflex path only; `reflexState(mem).waveOverride` forces a state for tests) |
| Tests | tests/brainReflex.test.ts | tests 1-6, 11, 12 (test 6 = freeze at the own tower) |

## Next steps (in order)

1. Reflex is a beta setting in the game ("Neues Bot-Gehirn", SimConfig.botReflex, off by default).
2. Phase 2 gate (Gold bot-sim): harass autos per laner to 14:00 >= 40 (now 6.6-9.2), kills >= 42, CS/min@15 >= 5.0
   (now ~3.6). Diagnosis in a1.md "Phase 2"; the harass part is distance (enemy laner rarely near), the rest needs
   Phase 3/4 (A2). Plates dropped with reflex on (supervisor: 4.0 -> 2.25): structures are a filler only in the
   push state now - check the push conditions after a crash.
3. Phase 3 (23 Oct): CS loss attribution fixed (a1.md "csLossByCause attribution fixes"); absence is 44 % of the
   lane minions at Gold, the reflex side 15 %. Coordination items for A2 in shared-changes.md "A1 -> A2 Phase 3"
   (recall count 8.4-8.8 per laner by 14:00, HP-term recalls dominate). Honouring A2's crash request in the reflex
   wave state was measured (8 games) and dropped - no gain.
4. Open items in a1.md.

## How to measure

- `npx tsx tools/botSim.ts --scenario=laneAlone --rank=<r> --games=3 --report=<file>` (lane alone).
- `npx tsx tools/botSim.ts --rank=gold --games=4 --minutes=14 --variance=0 --seed=1 --brain=new --out=x.csv
  --report=x.md` (new brain = reflex + utility; `--reflex=true` / `--utility=true` alone). Games run in parallel
  (`--jobs`, default cores - 2): 4 x 14 min in ~2 min wall. Compare per-cause shares (CSV `loss15_*`).
- Phase 2 levers in code: `harassTarget` / `stanceTarget` / `standPoint` (src/ai/reflex/reflex.ts), wave states
  (src/ai/reflex/wave.ts), trade opportunity (src/ai/utility/value.ts `tradeValue`, values.json weights).

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
