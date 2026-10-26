# swarm/mech-movement (queue item 10)

Wrapped up early on coordinator order. Result: no sim code change.

## Findings
`src/sim/systems/movement.ts` + `src/sim/map.ts` already cover: Jacobi (order-free) soft unit separation, champion vs
minion rule (minion yields sideways, BODY_OVERLAP 0.75), wall sliding with repath, structure rim push-out,
supercover `lineWalkable` (no corner cutting), A* with string pulling, `nearestWalkable` for wall clicks.

## Added
`tests/movementSmooth.test.ts` (seeded, 4 cases, ~11 s run): wall click ends within 2 cells of nearest walkable point;
click spam every 2 ticks has no jump > 1.5 steps and keeps progress; walking through an 8-minion wave arrives with
<= 2 direction reversals; no unit ends in a wall over a 600-tick mixed run. All pass on current main code.

## Not done / open
- No before/after jitter number: all cases pass already, nothing to improve measurably. Under-tower stuck case and
  champion-vs-champion crowding not covered by a test.
- Map data untouched (map-scale-2). No shared edits.
- tsc: run, see commit.
