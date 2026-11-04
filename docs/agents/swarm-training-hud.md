# swarm/training-hud - live training widget (WIP checkpoint)

## State
Code complete, unit-tested, `tsc --noEmit` clean. NOT done: screenshot check of layout, git push of final polish.

## Built
- `src/ui/liveTrainingCalc.ts` - pure math: CS@10 projection (rate since first wave, `farmStartSec`), per-minute rates, missed-CS detection (`isMissedCs`: enemy minion death within `missRangeU` of me, killer != me), minion HP history + `dropRate`, `killWindow`, `lastHitMark` (kill / soon / wait / late + bar fill), rank goals from PROFILES Table A (`rankGoal`), `widgetVisible`.
- `src/ui/liveTraining.ts` - `LiveTraining` widget (CS/min, CS missed + %, gold/min, CS@10 vs chosen rank; rank button cycles `settings.trainingRank`), `lastHitMarks` map, `attackedMinion`, `drawLastHitMark`.
- `src/ui/liveTraining.json` (constants), `liveTraining.css`.
- Hooks: `hud.ts` (import, field, ctor mount, `onEvent`, `update`: 5 lines), `overlay.ts` (timing bar under attacked/hovered minion HP bar: 4 lines), `settings.ts` (`trainingHud: auto|on|off`, `trainingRank`), `settingsPanel.ts` (1 select row), i18n de/en (`lt.*`, `set.trainingHud*`). game.ts untouched.
- Tests: `tests/liveTraining.test.ts` (17 pass), `tests/i18n.test.ts` pass, `tests/settingsIO.test.ts` pass.

## Decisions
- Default `auto`: on for modes in `liveTraining.json autoModes` (sandbox, lastHit, laneOnly, laneDuel, jungleDuel, scenario, mock), off for classic, dodge, kite, arena.
- Timing bar uses own AD vs MINION_STATS armor (no crit/on-hit), HP drop rate over 0.7 s of snapshots, wind-up 0.2 s + projectile flight for range >= 300.
- Gold/min = (totalGold - first seen total) / minutes.

## Next steps
1. Start dev server, open a lastHit trainer, check widget position (right, top 150px) does not collide with F3 overlay / deathBar; adjust `liveTraining.css`. One screenshot, then close tab + server.
2. Check the timing bar visually on an attacked minion; tune `projectileSpeed`, `windupSec` if it reads early/late.
3. Add heading `training-hud` to `docs/agents/shared-changes.md` listing: settings.ts (2 keys), settingsPanel.ts (1 row), i18n de/en (10 keys each), hud.ts, overlay.ts.
4. Run `npx tsc --noEmit` and the three test files, push.
