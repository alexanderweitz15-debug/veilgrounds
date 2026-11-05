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
