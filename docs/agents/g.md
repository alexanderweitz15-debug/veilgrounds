# Agent G "Feel + Shop" - report

Branch `feel/g-shop` (from main 8275391). Scope: docs/IDEAS-FEEL-SHOP.md in its recommended order. Lead commits main.

## Package 1 - Teil A P1 feel fixes (render + client)

| Idea | Change | Evidence |
|---|---|---|
| A1 cast pose slides while walking | `spriteTiming.castPoseActive`: pose ends one AFTER_MS after the release once `moving` (standing: full playback as before) | tests/spriteTiming.test.ts |
| A3 no instant reaction to the click | `ChampionSprites.intentFace` (render only): own sprite turns toward the ordered point via the existing 80 ms turn; dropped when the sim facing changes or after 300 ms. Wired from controller right click / attack-move via `World.intentFace` | code |
| A2 run cycle fixed 14 fps | `spriteTiming.runRate`: rate x clamp(walked units per tick / (340/30), 0.75, 1.5), phase accumulator so a rate change never jumps a frame; pushed units keep the authored rate. No snapshot change: speed = `x - px` | tests/spriteTiming.test.ts |
| A6 first auto after an AS change mis-timed | wind-up length from the snapshot's `atkStart/atkEnd` (`windupMsOf`), measured/estimated only as fallback | tests/spriteTiming.test.ts |
| A7 hit feedback | `readability.json hitFlash.minGapMs` 250 -> 120; champion flinch 13 u (minions 9) | tests/readability.test.ts (reads the value) |
| A4 first-minute freezes | `state.ts EXTRAPOLATE_TICKS 0.5`: a late snapshot extrapolates with the last tick velocity instead of freezing (stopped units overshoot <= half a step); minion/monster atlas bakes start 2.5 s after the clock (`game.ts`) | tests/interp.test.ts (45 ms outlier: no frozen frame; stopped unit overshoot bound) |

Not changed: `BUFFER_TICKS` (measured steady-state p99 13.7 ms < 17 ms buffer, p90 8.7 ms would overflow at 0.25).
