# auto/features - running log

Branch `auto/features` (from origin/main). Area: game features, UI/UX, QoL, polish.

## Idea list (why)
1. Finish WIP branches (tooltips, progression, training-hud, a11y, hook-visuals, mech-vision) - already coded, cheapest value.
2. Live-number tooltips (abilities/items) - LoL players read numbers with their own stats.
3. Rank ladder / missions / mastery UI - gives the training game a goal loop.
4. Practice tool options in sandbox (cooldowns off, dummy spawn, any champion) - core of a training game.
5. Spectator camera for bot-vs-bot - watch brains, free-cam follow.
6. Champion select polish (counters, recommended runes) - LoL-like.
7. Honor vote at game end, emotes/mastery badges, match history detail, keybind presets.

## Status / shipped
- [x] 1a: merged 6 WIP checkpoints (cherry-picked, conflicts in settingsPanel.ts/attack.ts resolved). Bush-attack expose limited to champions (a2SimBugs BUG-01 regression: minions in bushes must stay hidden). `npm test` green after fix.
- [x] a11y: canvas labels in overlay.ts use `txtPx` (text size setting).
- [x] 3: progression wired: profile card (rank/LP bar, level, daily+weekly missions, top mastery), post-game 'this game' card (LP/XP/missions/mastery, promo/demotion chips), recordMatch called from main.ts afterGame for classic games. src/ui/progressView.ts, i18n prog.*/mission.*.
- [x] 2: live-number tooltips: ability tips resolve '80 (+42)' with live AD/AP/HP (hud.ts -> setTipContext), haste-adjusted cooldown, learned rank highlighted, keyword colours, shop item tips (net recipe price, build tree with owned ticks, builds-into, gold efficiency, diff vs owned item). tests/tooltipMath.test.ts. Browser-verified (ability tip). NOTE: preview_start server serves the MAIN checkout; run vite from the worktree on another port.
- [x] 4: practice tool: dummy damage meter (src/ui/dummyMeter.ts), dummy armor/MR cycle (cheat dummyResist), save/load game state in sandbox (F2 / F4 or panel buttons; worker-side freezeSim/thawSim, replay cut to 0 ticks after a load). tests/dummyMeter.test.ts, tests/sandboxState.test.ts.
- [x] 5: main-menu rank/level chip (opens profile); mastery badges (M1..M10) on champion tiles in the classic and practice lobby (progression cache warmed before the lobby opens).
- [x] 6: classic lobby 'Mein Rang' shortcut (bots at own ladder rank). Browser-checked: menu chip + lobby button.
- [x] 7: profile match history: click a row for a detail line (CS@10, damage/min, deaths and kills per 30, rank per category).
- [x] training widget no longer hidden under the sandbox cheat panel.

## Not done (ideas, why)
- Honor vote after a game: needs players plumbed into postGame; low value vs bots.
- Spectator for live bot-vs-bot: needs an all-bot config + spectator snapshot (no human team); the replay viewer already covers watching finished games.
- Emote wheel, Clash-like bracket: larger; start from voiceBubbles.ts / progression ladder.
- Tooltips: summoner / rune tips still static text (plan in docs/agents/feat-tooltips.md steps 4-5).
- Verified in browser only partly (headless pane throttles); post-game progression card not seen live (logic covered by tests/progression.test.ts).

## Test status
- npm test: 151 files / 1880 tests green at the end.

## Round 2
- [x] A11 zoom min 1400, A12 soft edge zone (20 px full, 40 px half), A5 semi-lock camera option (setting cameraSemiLock; follows with lerp 0.2 once the champion is >35 % off centre).
- [x] Sandbox champion picker in the panel (restarts as the chosen champion, default runes; ExitOpts.champion).
- [x] A8 shoved minions/monsters shuffle (half-rate bob when moved >3 u per tick without walking). Champions excluded (dashes would look wrong).
- [x] Live bot-vs-bot spectator: classic lobby button 'Zuschauen'; all 10 slots bots, read-only worker link (send dropped), worker 'view' message, bar (pause, 1-8x, any player, follow/free cam) in src/ui/spectateBar.ts. Browser-verified incl. view switch.

## Round 3
- [x] Spectator bar: own i18n keys spec.*, placed below the HP panel (.spec-bar).
- [x] Emote strip: keybind action 'emote' (Z, rebindable), six phrases, shown as own speech bubble (always, even with voiceLines off). src/ui/emoteStrip.ts.
- [x] Honor vote after classic games (src/ui/honorVote.ts, giveHonor in progression: +20 XP, honor level on profile card).
- [x] Summoner tips show the value at the current level; minor rune tips show stat chips.
- npm test (read from file): 158 files / 1974 tests pass.
