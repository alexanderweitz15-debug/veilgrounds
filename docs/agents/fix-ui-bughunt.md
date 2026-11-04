# fix/ui-bughunt report

Click-through as a new player at 1024x768 (menu also at 800x600 / 640x480, DE + EN). One vite server on port 5391, one tab, both stopped/closed at the end. Console errors/warnings during the whole run: none.

## Findings

| # | Area | Finding | Status |
|---|------|---------|--------|
| 1 | Lobby (classic, practice, trainer) | Rune preset descriptions were mojibake (`Pr├ñgungen`) - `src/data/runePresets.json` was written in CP437. Re-decoded. Test `tests/uiBughunt.test.ts` guards all JSON under src/. | fixed |
| 2 | Encyclopedia | Raw enum ids shown: `SKILLSHOT_LINE`, `ZONE`, `BLINK`, `ground_target`, `pierce`, buff stat ids, cost type `mana` in DE. Localized maps in `encyclopedia.ts`. | fixed |
| 3 | Encyclopedia items | Stat lines `+10 ad`, `+3 lifestealPct`, `manaRegenPct`. Now uses the shop `statLines` (i18n `stat.*`). | fixed |
| 4 | Encyclopedia bot ranks | Intro line exposed a repo path (`src/data/bots/profiles/<rang>.json`). Reworded. Parameter names (`csPerMin`...) in the table stay (it is the "every bot parameter" view). | fixed (names open) |
| 5 | Main menu | At < 900 px width the nav (Profil, Enzyklopädie, Replays, Einstellungen) was `display: none`: unreachable. Now compact, fits down to 640 px. | fixed |
| 6 | Scoreboard (Tab) | Ally and enemy table had different column widths (auto layout), names clipped. Fixed layout + shared widths, panel min-width 900. Bot-info column keeps room. | fixed |
| 7 | Shop search | No hit showed "Keine Gegenstände in dieser Kategorie." Now `shop.noMatch`. | fixed |
| 8 | Post-game charts | Empty CS/XP/ward/damage charts had 0.25 / 0.5 ticks on integer axes. Min axis max 4. | fixed |
| 9 | Trainer / scenario result | "Pausiert" overlay was visible behind the result dialog (freeze used the pause flag). `Hud.resultFreeze`. | fixed |
| 10 | Tutorial, plan, profile (DE) | "Diener" vs "Vasallen" mixed; "des Vasallens"; "Wirke Q, W, E und R (Q, W, E, R)"; "1 Tage in Folge" (plural for n = 1). | fixed |
| 11 | Replay browser | Date format used `<html lang>` (only set after the first match), not the language setting. | fixed |
| 12 | Settings (all sections), profile with data, replay list, lobby (bans, roles, runes, summoners incl. Barriere/Geist tooltips), classic start, shop buy/sell/undo/quick-buy, scoreboard, chat, pause + resume countdown, ping wheel, Esc menu, sandbox buttons, tutorial (10 steps), trainers (last hit, dodge, kite, lane duel, jungle duel, arena, scenario turret2v1), lane practice, post-game | No further defect found. Raw-id and clipping audit script found nothing else. | ok |
| 13 | Pause | Three messages for one pause (top banner, centre overlay, chat line). Matches LoL, left as is. | open (by design) |
| 14 | Esc | First Esc right after chat Enter only blurs the input (menu needs a second press). | open (minor) |
| 15 | Scenarios | Only turret2v1 was started live; the other 9 scenarios and the replay viewer path with a saved replay were not clicked (no finished match available, RAM rules). Covered by existing tests only. | open |
| 16 | Profile | Result column shows "offen" for runs without a winner (trainer). Reads odd, not wrong. | open |

## Tests
- `tests/uiBughunt.test.ts` (new): no mojibake in any `src/**/*.json`.
- Run: uiBughunt, i18n, uiPolish, tutorial, drakesUi: 53 passed. `npx tsc --noEmit` clean.

## Files
`src/data/runePresets.json`, `src/ui/{encyclopedia,shop,scoreboard,postGame,hud,replayBrowser}.ts`, `src/ui/{menu,gamePanels}.css`, `src/game/game.ts` (+1 line), `src/i18n/{de,en}.json`, `src/modes/planStrings.json`, `tests/uiBughunt.test.ts`.
