# swarm: scoreboard-bots (FEATURE-GAP 1.7)

## Built
- Rank badge (procedural heater shield, 10 ranks; chevrons 1-3, crest gem from Gold, wings from Diamond, crown for
  Challenger) in front of every bot name on the Tab scoreboard (`rankIcon` in src/ui/icons.ts). Native title: "Rang: Gold".
- "Bot-Info" column (off by default; toggle button in the scoreboard title, persisted as setting `scoreBotInfo`):
  ten compact bars (2 x 5) per bot, one per PLAYSTYLE_AXES entry, marker = resolved axis value -5..+5
  (`resolvePlaystyle(setup).playstyle`). Tooltip per bar: "Aggression: spielt sehr aggressiv (+5)".
- Tendency text: src/ui/botTendency.ts (pure, DOM-free): value -> 5 tiers (-5/-4, -3/-2, -1..1, 2/3, 4/5); sentences in
  i18n `tend.<axis>.<tier>` (de + en, 10 axes x 5 tiers).
- Files: src/ui/scoreboard.ts, src/ui/gamePanels.css, src/ui/icons.ts, src/ui/botTendency.ts, src/settings.ts,
  src/i18n/de.json + en.json, tests/botTendency.test.ts.

## Tests
- `npx vitest run tests/botTendency.test.ts tests/i18n.test.ts tests/settingsIO.test.ts`: 13 passed. `npx tsc --noEmit`: clean.
- Not run in a browser (swarm resource rules); rank icon / bar layout are visually unverified.

## Open items / decisions
- Tilt: not shown. It is runtime brain state (withTilt) and not part of the snapshot / ScoreRow, so it is not public.
  Showing it needs a new public ScoreRow field filled by the sim/worker (shared snapshot type) - left to the lead.
- Bot-Info default off so the table stays compact; the rank badge is always on.
- The displayed playstyle uses `resolvePlaystyle(setup)` with configSeed 0 (as the existing name tooltip did): correct
  when the setup carries a personalitySeed (runner sets it on its own copy, src/ai/runner.ts:475); otherwise rolled
  styles may differ from the worker's.
- Follow-up champion task (Eulalia, owl seer) dropped by lead: nothing built, no files touched.
