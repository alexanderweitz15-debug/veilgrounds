# swarm dodge-metrics (FEATURE-GAP 7.4)

## Built
Dodge trainer measures the player and shows it live, in the result dialog and in the post-run analysis.

- `src/sim/trainer/dodgeMetrics.ts` (+ `dodgeMetrics.json` thresholds): pure bookkeeping, plain-data state in `DodgeState.metrics`
  (hashed by `stateHash`, deterministic: + - * / sqrt, no new rng draws, so dodge replays/spawn sequence are unchanged).
- `src/sim/trainer/dodge.ts`: feeds the tracker (shots with ids, player position and this tick's move order / blink, hits with the impact
  point). HUD stats `reaction`, `panic`, `unnecessary`, `hitRate` + `TrainerHud.dodge` (review list only after the run).
- `src/ui/dodgeReview.ts`: buckets table, last-10-hits review (one 180 px canvas each: projectile band + path, player path gold, hitbox
  circle at impact, cause line), trend text across runs. Used by `trainerHud.ts` (trend in result dialog) and `postGame.ts` (all).
- `src/stats/history.ts`: trainer records now carry `metrics` (reactionMs, panic, unnecessary, hitRate); `trainerTrend` / `withoutRun`.

## Definitions
- Threat: shot would hit the player if he stood still from now on (segment test of the rest of its path).
- Reaction latency: ticks from spawn to the first move order / blink after which walking straight to the target no longer gets him hit
  (tick-by-tick sweep, like the projectile system). HUD shows the median in ms; best and count in the analysis.
- Panic dodge: move order with nothing relevant in the air (no threatening or near-passing shot, no zone on/near him); orders < 12 ticks apart = one episode.
- Unnecessary dodge: move order while a never-threatening shot passes within 2.2 x its hit radius; once per shot.
- Hit rate: hits / threatening shots (a shot counts when it threatened at some tick or hit). Buckets: speed < 1100 / 1100-1400 / >= 1400, width < 100 / 100-140 / >= 140 (thresholds in `dodgeMetrics.json`).
- Hit cause: idle (no order since the shot appeared), wrongWay (orders, none left the path), changed (left, then walked back); zone hits: zone.

## Tests
- `tests/dodgeMetrics.test.ts` (11): synthetic sequences for latency (hit/miss/too late/wrong way first), panic episodes, zone relevance,
  unnecessary vs far shot, bucket hit rate incl. expired shots, review ring (10) + causes, history trend/withoutRun/trainerMetrics,
  real trainer wiring (standing player, sideways mover). All pass.
- Also green: `tests/trainer.test.ts` (incl. dodge replay hash), `i18n.test.ts`, `scenarios.test.ts`, `trainingPlan.test.ts`. `npx tsc --noEmit` clean.

## Open / decisions
- Shot width is constant (120) in the trainer, so the width table has one row; code and UI handle more buckets if widths vary later.
- Zones are threats for the panic logic and hit counts but have no reaction latency.
- Canvas drawing and the layout were not looked at in a browser (swarm rule: no browser).
- Trend in the result dialog uses saved history (IndexedDB); the current run is saved by main.ts when leaving the dialog, so the postGame trend drops it again via `withoutRun`.
