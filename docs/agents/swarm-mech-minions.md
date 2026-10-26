# swarm: mech-minions (queue item 8)

## Audit vs LoL (src/sim/systems/minions.ts, waves.ts, movement.ts)

| Topic | Veilgrounds before | LoL | Status |
|---|---|---|---|
| Target priority | 1 champ->champ call, 2 minion->champ, 3 minion->minion, 4 nearest minion, 5 structure, 6 nearest champion (tests/minions.test.ts) | same order (turret-attacks-minion tier omitted) | ok, no change |
| Call for help | `recordCombat` ledger, CALL_RANGE 1000, CALL_WINDOW 30 ticks, champ->champ interrupts anything | same | ok |
| Leash | LEASH_RANGE 1000, CHASE_LEASH 650 from lane anchor, idle champion only near attack range | gives up soon after leaving lane | ok |
| Spacing | `separateUnits` (movement.ts): minions separate fully, champions push minions aside, rows 130 / cols 100 at spawn | no stacking | ok, test added |
| Cannon timing | siege every 3rd wave, every 2nd from 15:00, every wave from 25:00; waves 30/25/20 s | same | ok, test added |
| Wave meeting | ~1:28 mid / ~1:38 side (tests/waves.test.ts) | same | ok |
| Bounce / crash | emergent: minions target structures (prio 5), towers target minions | same | ok, no change |
| Catch-up speed | none (every minion 325 MS) | stragglers far from the wave hurry | NEW |

## Change

- `src/data/minionWave.json`: catchupGapStart 700, catchupGapRamp 600, catchupMaxBonus 0.25, offLaneBonus 0.2.
- minions.ts: `waveFronts` (furthest lane progress per team+lane, refreshed each tick), `minionSpeed(sim)` multiplier written in `walkLane`: +0..25 % when more than 700 behind the own wave front (linear to 1300), +20 % when more than OFF_LANE (300) off the lane. Reset to 1 every tick before aggro. Spawn formation (rows 130 apart, max 520 gap) stays under the 700 start, so wave meeting times are unchanged.
- movement.ts: `step *= minionSpeed` for minions in lane-walk mode (mode 1) only. Stats.ms untouched (stats system would adopt a rewritten ms as new base).
- tests/minionWave.test.ts: catch-up, spacing, cannon cadence.

## Tests

- `npx vitest run tests/minions.test.ts tests/waves.test.ts tests/minionWave.test.ts`: green (waves.test 8/8 incl. meeting times; minions 7/7).
- tsc: see final message. phase1 CS gate / determinism not re-run by me (lead runs full suite).

## Open

- LoL tier "turret attacking allied minion" and "champion attacking allied minion" not modelled.
- Super-minion count (2 per lane when all inhibitors down) still 1 (existing ponytail note in waves.ts).
- Real LoL catch-up numbers are not public precisely; values are tuned guesses, all in minionWave.json.
