# swarm-scenarios-macro (FEATURE-GAP 7.3), branch swarm/scenarios-macro-2

Three macro scenarios in the scenario trainer. Menu (`trainerMenu.ts`) lists `SCENARIO_IDS` automatically, so no menu edit was needed.

## Scenarios (src/sim/trainer/scenarios.ts)
- `waveCatch`: min 8, mid. Two enemy waves (12 minions) crash into the own outer tower, no own wave. Enemy jungler bot (dive style) revealed on the minimap. Win: >= 4 CS and alive when the wave is resolved / time up. Score = `waveCatchScore(cs, exposedSec)` (60 CS, 40 exposure). Exposed = outside tower range while jungler < 2500 away. Why: `passive`, `caught`, `caughtRisky`, `died`.
- `baronCall`: min 22, player jungle, 2 passive allies, enemy jungler dead (respawn shown), 4000 gold lead (team totalGold), 2 enemy bots far away; Schleierwaechter spawns at start, allies hit it with scripted true damage (never below 10% HP - last hit is real). When the enemy jungler respawns the enemy team is teleported to the pit (shown threat). Win: team kills the pit monster, player alive. Why: `baronClean`, `baronCost`, `baronStolen`, `died`, `time`. Score = `baronScore` (faster, fewer allies down).
- `shoveRecall`: min 8, mid, 1800 gold, both waves meet mid lane, no enemy champion. Win: recall completes at fountain with enemy wave <= 2 minions and own wave >= 3 at recall start, and <= 2 own minions lost during recall. Why: `shoved`, `early`, `lostMinions`, `noRecall`, `died`, `time`. Score = `shoveScore`.
- Shared: `ScenarioInfo.foeItems`, `ScenarioState.allies/foes`, tuning consts `WAVE_CATCH/BARON_CALL/SHOVE_RECALL`.

## Other files
- `src/game/scenarioConfig.ts` (foeItems), `src/ui/trainerHud.ts` + `trainer.css` (result screen shows "what a Challenger would do" tip when `scenario.<id>.tip` exists), `src/i18n/de.json` + `en.json` (name/desc/goal/tip/why/stat keys, de+en).

## Tests
- `tests/scenariosMacro.test.ts` (9 tests, ~2 s): setup + grading for all three. Also green: scenarios, i18n, trainer tests (39 total). `npx tsc --noEmit` clean.
- Manual sim runs (removed debug tests): waveCatch idle = passive, attack-move = caught (6 CS); baron with player attack = baronClean at 26 s; shove with recall = shoved.

## Notes / decisions
- Merged origin/main (5fc933b); one conflict (JG list) resolved keeping Vargrim.
- Fixed tsc error in WIP (fountain radius via `sim.map.sides[0].fountain`).
- Removed WIP debug tests zzdbg*.test.ts.
- Open: baron goldLead HUD number drifts above 4000 as gold is earned (display only). No browser check done.
