# feat/tooltips - WIP checkpoint

Status: stopped early by coordinator (agent limit). Nothing tested, nothing type-checked.

## Done (uncommitted-before-checkpoint, now in WIP commit)
- `src/ui/tooltipMath.ts`: pure helpers (no DOM). `fmtNum`, `hasteCooldown` (cd*100/(100+haste)), `hasteReductionPct`,
  `rankedSegs` (current rank highlighted), `byLevelValue`, `ratiosOf`, `scalingSegs` ("80 (+42)" resolved with live stats),
  `keywordSegs` (CC / damage type / heal / shield highlighting), `compareStats`, `compareTarget` (same slot type),
  `buildTree` (owned components ticked). Types `Seg`, `TipStats`.
- `src/ui/tooltipKeywords.json`: keyword regex per lang + css class.
- `src/sim/snapshot.ts` (additive, optional fields): `PlayerHud.stats` gains `bonusAd, maxHp, bonusHp, haste`; new import `baseMaxHp` from `./systems/stats`.

## Not done (exact next steps)
1. Rewrite `src/ui/tooltip.ts` to use `Seg[]` (Tip.meta/chips/body as segments; render spans with class). Add
   `setTipContext(me: PlayerHud | null)` (stats -> TipStats, level, items, gold, bootsMult) called from `hud.ts` each snapshot
   (near `const me = snap.me`), plus periodic re-render of the hovered tip (~0.5 s).
2. Ability tip: cooldown via `rankedSegs(cd, rank, lang, v => hasteCooldown(v, haste), 1)`, foot line with haste and
   reduction %, cost/range with rank highlight, damage chips via `scalingSegs` (type colour: phys orange, magic blue, true white;
   change `.dmg-magic` in `tooltip.css` from purple to blue), buff/mark chips, description through `keywordSegs`.
   Without context (lobby, encyclopedia, rank -1): ratios as plain "+70 % AP".
3. Item tip: stats chips with `compareStats` diff vs `compareTarget(item, ctx.items, itemById)` (only when spec ends `:shop`),
   gold efficiency chip from `goldEfficiency()` (ui/goldEfficiency.ts), net price via `recipePrice(inv, item)`
   (src/sim/items/inventory.ts, read-only) with full price struck through, `buildTree` lines, "builds into" list
   (`ITEMS.filter(i => i.from.includes(id))`), passive/active with cooldown. Add `:shop` suffix to `setTip` in `shop.ts`
   (cards ~l.455, tree rows ~l.426).
4. Rune tip: stats chips (RuneData.stats) + kind; summoner tip: move `SUMMONER_DESC` out of tooltip.ts into i18n keys
   (`tt.summoner.<id>`), show cooldown, range, level-scaled values (BARRIER_SHIELD exported from sim/summoners).
5. i18n: new keys with prefix `tt.` (NOT `tip.`: i18n test counts `tip.<n>`), de + en identical placeholders.
6. Tests (`tests/tooltipMath.test.ts`): fmtNum de/en, `scalingSegs` "80 (+42)" with ratios, `hasteCooldown` (100 haste -> half),
   `rankedSegs` highlight, `keywordSegs`, `compareTarget`, `buildTree`, net price via `recipePrice`; extend
   `tests/goldEfficiency.test.ts`. Run `npx vitest run tests/tooltipMath.test.ts tests/goldEfficiency.test.ts tests/i18n.test.ts`, then `npx tsc --noEmit` once.
7. Screenshots of 3 tooltips (ability, item in shop, rune), then close tab + vite server immediately.
8. Log shared edit in `docs/agents/shared-changes.md` under `feat-tooltips`: snapshot.ts stats fields, i18n `tt.*` keys, shop.ts `:shop` suffix.

## Notes
- Hot files untouched: game.ts, settingsIO.ts, settingsPanel.ts, src/render/*, src/audio/*, src/sim/items/*.
- Commit with `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com commit`.
