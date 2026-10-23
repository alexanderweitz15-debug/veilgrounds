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

## Package 2 - V1 item stat schema (commit 59c4bbc)

`ItemStat` + `magicPen`, `magicPenPct`, `armorPenPct`, `tenacity`; `Stats.magicPenPct` (ecs.ts); stats.ts folds them
every tick (hooks adjust in `onComputeStats`); damage.ts magic: % pen then flat (LoL order); shop labels de/en,
`goldValues.json` reference prices (magicPen 30, magicPenPct 45, armorPenPct 42, tenacity 25). tests/itemStatsV1.test.ts.

## Package 3 - shop undo (B1, commit 56abc05)

inventory.ts ledger (last 10 transactions: inventory before + gold moved), `undoLast` / `undoDepth` / `clearUndo`;
command `{t:'undo'}` (also while dead), snapshot `me.undo`; cleared when the champion is alive outside the fountain
(itemHooks.tickItemsAndRunes) or uses an item/consumable; undoing a sell needs the sale gold. Shop: button
"Rückgängig" in the header + Ctrl+Z. `sellValue()` fixes `floor(350 * 0.7) = 244` (was shown and paid as 244).
tests/inventory.test.ts (3 cases).

## Package 4 - recommended view + small shop items (B2, B4-B9)

- `src/ui/shopRecommend.ts` (pure, tests/shopRecommend.test.ts): rows Start / Stiefel (+ vsAD/vsAP alternatives) /
  Kernitems in order (first unowned = "next") / Situativ (vsAD/vsAP cores not in the standard build); `nextPurchase`
  = the whole target at its recipe price if affordable, else depth-first the first missing affordable component.
- Shop: "Empfohlen" is the default view (champions without a bot build fall back to "Alle"); next core item glows,
  the quick-buy piece glows green, button "Nächsten Schritt kaufen: X (price)"; component tree of the next item.
- B4: opening the shop focuses the search, Enter buys the first affordable listed item, Esc in the search closes,
  double click buys. B5: search by name (de/en), stat label, passive/active name, tag (`shopSearch.itemMatches`,
  tests/shopSearch.test.ts). B6: hovering a card lights the inventory slots a purchase would consume. B7: detail
  pane shows "Es fehlen N Gold (≈ m:ss bei deiner Gold-Rate)" from `totalGold / time`. B8: buy/sell sounds
  (`sfx.ts` cues `buy`/`sell`, triggered by the HUD item-slot change while in the shop). B9: Inspiration boots
  discount shown (`me.bootsMult`). B10: sell value in the item tooltip and the detail pane.
- Screenshots (800x600, the browser pane cannot show 1280 wide): docs/ist/g-shop-before.jpg (= c7-shop-after, main),
  docs/ist/g-shop-recommended-after.jpg (Empfohlen view, next step Langschwert, numbered core items, vsAD/vsAP tags),
  docs/ist/g-shop-detail-after.jpg (Sturmbogen: sell value, "Es fehlen 2300 Gold", stat chips).
