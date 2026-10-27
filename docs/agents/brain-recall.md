# brain-recall (branch brain/s-recall)

Bug: tests/utilityRecall.test.ts "shove-and-recall, Diamond" - item recall at tick 17738, slot 5 had 13 enemy minions
within 1500 (threshold had been loosened 2 -> 2.5 in 22625d4).

## Root cause (probe, seeded game)

Sim truth at the recall command: 10 enemy minions at 1248-1476 from the bot. The bot saw none of them: its own wave was
dead, it stood near the enemy tower, the wave walked on just beyond vision at the bot's speed. `uRecall` backs off only
for minions it SEES within `recall.minionAvoidRange` (1400); 3 s earlier it had seen 3 and backed off, then the sighting
was lost and `recall()` found a "safe" lane (its own check uses 700 reach) and channelled. The wave arrived mid-channel.
Low-HP recalls take another path (`retreat` in brain.ts) and are unchanged.

## Fix (one place)

`src/ai/utility/intents.ts` `uRecall`: remember the last tick the bot saw >= `waveMinMinions` (3) enemy minions within
`waveSeenRange` (2200) with fewer than `ownWaveMinMinions` (3) own minions there (nothing to shove / fight it). For
`waveMemoryS` (5 s) afterwards it keeps taking the existing back-off branch (walk toward the fountain, log `back_off`)
instead of channelling. Memory expires on its own, so no endless loop. Values in `src/data/bots/values.json` `recall`.
Utility brain only (uRecall); the default brain stays bit-identical.
ponytail: no off-lane / into-fog step and no tower-aware stop; walking the lane toward the fountain only buys time.

## Tests

- tests/utilityRecall.test.ts: limit back to <= 2 (stopgap comment removed). Passes (161 s on a loaded machine).
- tests/bots.test.ts (incl. determinism, fog) 9/9 pass; tsc clean; botReact 4/4 pass (new brain 4 / 4 ticks).
- botReact default brain: 47 ticks full HP, 40 half HP (limit 60, target 45). The delay is the rank's `reaction` node (Gold ~36
  ticks, log `trade trigger retaliate` at 36) plus ~11 ticks until the first hit lands; a faster answer means a shorter
  reaction time in the profile, not a trade-path fix. Left at 60.

## Bot-sim (`--brain=new --rank=gold --games=2 --minutes=8 --jobs=2`, seeds 1-2; --brain=new added because the default brain has no utility recall)

| | recalls/min | CS/min | deaths/game | kills/game |
|---|---|---|---|---|
| before (waveMemoryS 0) | 0.44 | 2.45 | 0.70 | 0.55 |
| after | 0.47 | 2.61 | 0.55 | 0.40 |

Two games, 8 min: differences are noise; no regression.
