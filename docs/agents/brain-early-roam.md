# brain/early-roam log

Base: origin/main 2f90b20 (map 13000). New brain (reflex + utility), Gold, `--minutes=12`, 2 games. Raw outputs in
tools/scratch/out (base-*, new-*, v2-*). Two games are noisy: read the direction, not the decimals.

## What changed
1. Level 1
   - `laning.ts` laneFronts: with no enemy minion in the lane the stand point is max(own wave front, own tower + 700).
     Laners wait at the tower and no longer run back to the freshly spawned wave (dist to tower at 1:20: mid 368 -> 288,
     adc 1484 -> 596, top 1282 -> 536).
   - `TeamAI.earlyPlan()` (src/ai/bot/teamai.ts) rolls once per team: invade (jungler + mid + support to the enemy buff
     camp), guard (mid + support at the own buff camp) or normal. Chances by rank, invade also by mean aggression of the
     comp (values.json `early`). `earlyPlan` leaf (src/ai/bot/early.ts) is the first child of the `farm` intent and ends
     at 1:20; fights, recalls and lane logic take over as before. Test: tests/earlyPlan.test.ts (seeded challenger game
     that rolls invade: jungler within 400 of the point, mid/support within 2600, lane CS > 0 at 3:00).
2. Roams (src/ai/roams/roam.ts, values.json `roam`): target sighting may be older with rank (Iron 2 s .. Challenger 18 s,
   score penalty per extra second), shove-then-roam prerequisite (wave pushing past 0.5 with +2 minions, rank chance),
   abort-when-unseen limit grows with the age limit.
3. Lane presence: biggest losses are recall + heal trips (about 30 % of lane minions) and in_range_no_attack. Tried
   `recallStayDeathThreshold` 0.3 -> 0.4: heal losses did not drop (14 -> 15 %), reverted.

## Before / after (Gold, 2 x 12 min)
| metric | base (main) | branch |
|---|---|---|
| laner lane-CS/min (bot-sim) | 2.10 | 2.70 |
| lane CS share | 19 % | 25 % |
| deaths/game/champion, kills/game | 1.50 / 1.00 | 1.25 / 0.95 |
| roam starts per game-min (roams.ts, mid+support) | 0.75 | 0.88 |
| roamer kills / all kills | 1 / 17 | 0 / 12 |
| lane CS lost to roams | 0.8 % | 3.2 % |
| CS at 3:00 top/mid/adc (early.ts) | 9.5 / 6.0 / 5.0 | 5.5 / 5.8 / 6.3 |
| deaths before 3:00 per game | 1.0 | 1.5 |

## Experiments that did not help (reverted)
- Roam retreat limit 0.06 -> 0.15 of lane length: roams last longer ("took too long" 6x), CS lost to roams 6.6 %, kills not up.
- Recall threshold 0.4 (above).

## Open
- Roam success is the real gap: 9-15 of ~20 roams end with "target retreated before 1200", roam kills about 0. Needs a
  roam that arrives with CC/flash and waits in a bush near the lane, not a chase of a stale position.
- Gold laner CS/min target 4 not reached (2.7). Next: heal/recall trips (30 %), mid in_range_no_attack (15-25 % at mid).
- Invade effect on first-wave CS is not measured over many seeds (only the one-seed test).
