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
