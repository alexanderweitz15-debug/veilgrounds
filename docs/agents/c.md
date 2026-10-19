# Agent C "UI & Funktionen" - report

Branch `ui/c-features` (base `0bbc3d0`). Spec: docs/AGENTS-PLAN.md §5 (C1-C7). Newest block on top.

## Ready for merge (block 3, on top of main `fcbf223`)

| Package | Commits | Merge note |
|---|---|---|
| C5 ban phase + role swap, C7 minimap fit | `39b01d1` | new src/game/bans.ts; `fitMinimap` in display.ts, called from Hud.applyScale |
| C4 '?' ping key + shop item ping | `f5887d3` | new keybind action `pingQuestion` (default H) |
| C7 HP-bar tick style + skillshot outline setting | `da0ec05` | src/settings.ts additive (logged); request to D in shared-changes.md |
| post-game axis labels, screenshots, docs | next commits | – |

## Block 4 (2026-10-20): supervisor browser-check fixes (`6348bef`)

| Finding (docs/ist/s-check-03-death.jpg) | Fix | Proof |
|---|---|---|
| "Unter Turmbeschuss!" drawn while dead, over the death title | cues.ts: no tower warning while the own champion is dead | docs/ist/c3-dead-fix-after.jpg |
| caption "[X ist gefallen]" across the recap's last row | no caption for the own death (overlay + recap show it); while dead other captions stack above the recap | c3-dead-fix-after.jpg |
| camera stays at the death spot after respawn | controller.ts: on dead -> alive the camera focuses the champion (LoL) | headless check: camera moved to (7500, 7500) while dead, after respawn the footprint centre is back at the fountain (900, 1155 for the champion at 900, 900, same offset as a locked camera); c3-respawn-camera-after.jpg |

## Block 3 (2026-10-20): open items from the lead's list

Test status (full suite on `12b96ce`): 69 files, 874 passed, 2 skipped, 1 todo, 1 failed - again only A1's
wall-clock gate tests/brainReflex.test.ts "reflex logic < 0.05 ms per bot and tick" (CPU shared by several agents;
src/ai not touched by C). `tsc --noEmit` exit 0, `vite build` exit 0, no console errors in any capture.

| Item | What | Proof |
|---|---|---|
| Ban phase (4.3) | "Banns (n/10)" in the lobby tools row opens a portrait grid; up to 10 bans, own champion not bannable, banned champions greyed/struck in the own champion grid; after `classicConfig` bots with a banned champion get the next free one of their role (default rune page for it); names, ranks, playstyles unchanged | tests/lobbyBans.test.ts, docs/ist/c5-bans-after.jpg |
| Role swap (4.4) | "⇄" on every allied bot row takes that bot's role (champion kept if it fits the role, summoners reset to the role default) | c5-bans-after.jpg (swapped to top) |
| `?` ping (2.1) | own rebindable action `pingQuestion`, default H (LoL has no default key): pings the unit under the cursor (with target) or the ground | c4-pings2-after.jpg (kill feed "Aurel Stundenwerk: ?") |
| Shop item ping (2.3) | Alt+click an item card: "Ich habe X." / "Ich kaufe X." / "Ich spare auf X (fehlen N Gold)." to team chat | c4-pings2-after.jpg |
| Minimap overlap (3.7) | `--mm` is capped so the minimap never reaches the centred bottom panel (both sides; 1280 px: max ~112 %); re-fitted on HUD mount, resize, settings change | lobbyBans.test.ts "minimap fit", c7-minimap-fit-after.jpg (150 % asked, 112 % used, 7 px gap) |
| HP-bar style (3.10) | `hpBarStyle`: ticks every 100 + 1000 HP (LoL), only 1000, or none (src/ui/overlay.ts is C's) | c7-settings2-after.jpg, c7-minimap-fit-after.jpg ("none") |
| Skillshot outline (3.11) | setting `enemySkillshotOutline` + row; drawing is D's (request in shared-changes.md); the row says so | c7-settings2-after.jpg |
| Post-game y axis | small axes now show 0, 0.25, 0.5, 0.75, 1 | c6-postgame-after-charts.jpg (refreshed) |

Also: 4.1 verified in the built game (docs/ist/c5-botconfig-after.jpg), post-game refreshed after the 2-decimal axis fix.
Still open for C: 4.5 portrait crops (D, issues.md), A3-/B-dependent
items as listed in block 2.

## Ready for merge (older blocks)

Block 1 (C1-C4, C6 part 1) is on main (`e0f40bb`). Block 2 commits since then, all merge-ready (branch is
fast-forward from main `e0f40bb`):

| Package | Commits | Merge note |
|---|---|---|
| C2 follow-up | `9fd59b1` | enemy Kesselbrut from B's `Snapshot.kesselbrutTeams`, "?" removed |
| C7 gold efficiency + loading tips | `d8bddf9`, `f127470` | new data file src/ui/goldValues.json |
| C5 own rune page | `e627710` | – |
| C7 minimap size/side, settings export/import | `003c3a8` | touches src/settings.ts (additive, lead-approved, logged in shared-changes.md) |
| C7 per-key cast modes | `fce34a6` | touches src/settings.ts (additive), src/input/controller.ts |
| screenshots/docs | `2c92dd9`, next docs commit | – |

## Block 2 (2026-10-19): merge of main, C2 follow-up, C5 rune page, C7 settings

### Done

| Pkg | Files | What |
|---|---|---|
| C2 | src/game/objectives.ts, src/ui/scoreboard.ts | Kesselbrut of both teams from `Snapshot.kesselbrutTeams` (B3, absent = 0 for both); the "?" fallback and its i18n key are gone. Enemy items (user decision 19 Oct): scoreboard and target frame already render any row's `items`, nothing to change until B sends them |
| C7 5.3 | src/ui/goldEfficiency.ts (new), src/ui/goldValues.json (new), src/ui/shop.ts, shop.css | Shop detail: "Gold-Effizienz der Werte: 97 % (Wert 2421 Gold)", gold per stat from the single-stat basic items (AD 35, AP 21.75, HP 2.67, armor 20, MR 16, AS% 25, mana 1.4, msFlat from boots), reference values for the rest in JSON |
| C7 4.6 | src/ui/classicLobby.ts, gamePanels.css, i18n | 12 training tips on the loading screen, rotating every 7 s |
| C5 4.2 | src/game/runePages.ts (new, storage + rules), src/ui/runePages.ts (new, editor), src/ui/classicLobby.ts, css, i18n | "Eigene Seite" next to the presets: keystone row + pick three minors, save = select; IndexedDB `runePages`; invalid/missing page falls back to the preset |
| C7 3.7 | src/settings.ts (+`minimapScale`, `minimapLeft`), src/ui/display.ts (`--mm`, `html.minimap-left`), style.css, settingsPanel.ts | minimap 80-150 % and left side (frame mirrored, death bar follows, chat lifted above it) |
| C7 3.13 | src/game/settingsIO.ts (new), src/input/keybinds.ts (`applyBinds`), settingsPanel.ts, settings.ts (`DEFAULT_SETTINGS`) | export settings + keybinds as JSON file, import validates keys, types, enum values, clamps slider ranges, reports skipped entries |
| C7 3.2 | src/input/castMode.ts (new), controller.ts, settings.ts (`castModes`), settingsPanel.ts | per Q/W/E/R: quick / with indicator (hold-release) / normal (indicator, left click casts, right click or Esc cancels). Verified in the built game: Q cooldown 0 after key release in normal mode, 5 s after the click |

### Tests (new in block 2)

tests/goldEfficiency.test.ts, tests/runePages.test.ts, tests/settingsIO.test.ts (round trip, validation, cast modes),
tests/i18n.test.ts (tip keys), tests/objectives.test.ts (kesselbrutTeams). Each green; `tsc --noEmit` clean.

Full suite on `9134f0b` (19 Oct, machine shared with other agents): 68 files, 871 passed, 2 skipped, 1 todo,
**1 failed: tests/brainReflex.test.ts "reflex logic < 0.05 ms per bot and tick" measured 0.152 ms** - a wall-clock
performance gate in A1's area (src/ai/reflex), not touched by C; it depends on CPU load (five agents running).
`tsc --noEmit` exit 0, `vite build` exit 0.

### Screenshots (block 2, 1280x720, built game, no console errors)

c7-shop-before/after (gold efficiency line), c7-loading-before/after (tip), c5-runes-before/after (own page + editor),
c7-settings-before/after and c7-settings-io-before/after (minimap rows, cast modes, export/import),
c7-minimap-left-before/after (left, 120 %), c7-castmode-settings-after, c7-castmode-indicator-after (indicator stays
after releasing Q in normal mode).

### Open after block 2 (exact next steps)

- 4.3 optional ban phase, 4.4 role swap with a bot slot (classicLobby.ts post-processing; low training value 2).
- 4.1: open "Erweitert" in the lobby, screenshot, set FEATURE-GAP 4.1 to `da` (code exists).
- 2.1 '?' ping in the wheel, 2.3 item ping from the shop ("missing parts").
- 3.7 caveat: on the left at > ~115 % the minimap touches the bottom HUD panel; either cap the left-side scale or
  shift `.hud-bottom` when `html.minimap-left` (needs a screenshot check).
- 3.10 HP-bar style / 3.11 enemy skillshot outline: settings keys can be added (src/settings.ts open for C), the
  drawing is D's (render).
- A3-dependent: playstyle mini-scales + rank calibration in the scoreboard, post-game error list.
- B-dependent: enemy items (decided, B), ally summoner CDs, vision score / damage, Teleport slot (B4), item cast-fail
  events.
- src/main.ts "Nochmal" after classic (issues.md).

---

Block 1 history below (C5/C7 "not started" there is superseded by block 2).

## Block 1 (2026-10-16): C1-C4, C6 part 1

### Done

| Pkg | Files | What |
|---|---|---|
| C1 | docs/FEATURE-GAP.md | 70 rows against LoL (7 sections incl. D's items, agent column, Nutzen 1-5, Aufwand S/M/L, evidence per row). `da` only with code evidence + screenshot/test; everything unverified is `teilweise` with the reason |
| C2 | src/game/objectives.ts (new), src/game/summonerTimers.ts (new), src/game/state.ts, src/ui/scoreboard.ts, src/ui/deathBar.ts (new), src/ui/hud.ts, src/game/game.ts, src/ui/icons.ts (`objectiveIcon`), css, i18n | Client adapter `ObjectiveTracker` (AGENTS-PLAN §7 "lokaler Adapter") derived only from public events: respawn timer of every champion (exact: same formula/tick as `Champ.respawnAt`, tested against the sim), Leviathan stacks per team (champion kills only, like the sim) + soul at 4, Schleierwächter buff time per team (ends when every holder died), inhibitor respawn timers, own Kesselbrut from `snap.kesselbrut`, enemy Kesselbrut `?` unless seen. Sim fields from the proposal win automatically (`row.respawnIn ?? derived`). Scoreboard: objective bar (both teams: towers, destroyed inhibitors + respawn timers, Leviathan pips / soul, Kesselbrut, Schleier buff timer), grey portrait + respawn seconds, summoner column (own champion: live CDs; allies: sim field when present; enemies: click starts a manual timer with the base CD, Teleport late CD after 10:00, second click clears). Death bar above the minimap (inside `.minimap-wrap`, scales with `--ui`): dead champions of both teams, grey portrait, seconds, team border, soonest first |
| C3 | src/ui/targetFrame.ts (new), src/ui/hud.ts, src/ui/minimap.ts, src/input/controller.ts (`select` host hook), src/game/state.ts (`seenAt`, `lastSeenEnemies`), css, i18n | Objective timers under the top bar (classic only): Leviathan / Kesselbrut / Schleierwächter countdown to first spawn / respawn, lit "da" while up, Kesselbrut drops out after 19:45 or when its last wave closed. Target frame (left click on a unit, ground clears; LoL top left): portrait, level, HP/shield/mana, K/D/A + CS, own-team items, CC + ability-buff chips; closes when the unit leaves vision. Own buff bar: CC with seconds, ability buffs, jungle/objective marks (replaces the text-only marks). Minimap: enemy champions seen in the last 45 s at their last position (dashed ring + "?", fading). Death overlay: "Kamera frei: Bildschirmrand oder Minimap · Space = zum Champion" (live key label) |
| C4 | src/ui/chatCommands.ts (new), src/ui/chat.ts, src/game/minimapPing.ts (new), src/game/game.ts, src/ui/hud.ts, src/ui/scoreboard.ts, src/game/state.ts (`muted`), i18n | /help, /mute and /unmute (bot or champion name, prefix, accents ignored, `all`; hides chat lines AND pings of that slot locally), /ff and /all answer honestly "noch nicht verfügbar" (need sim/bots). Click on an objective timer posts "Flussleviathan in 1:20 (6:40)" / "ist da!" to team chat; starting an enemy summoner timer posts "Wren Sprung bis 12:34" (LoL); Alt+click an inventory item posts "Ich habe X.". Alt+click on the minimap snaps: enemy structure -> focus (with target), own structure -> danger, objective pit -> objective |
| C6 | src/game/matchStats.ts, src/ui/postGame.ts, src/ui/trainer.css, i18n | Samples now also carry XP, team item-value lead (public both teams), active own-team wards (vision proxy until a sim vision score exists). New charts: XP, signed lead chart (gold above / red below zero), team wards; objective flags on every chart (hover = time + what + who); objective timeline below the charts |
| – | src/i18n/index.ts, tests/i18n.test.ts (new) | `t()` replaces every occurrence of a placeholder (was: first only). Test: de/en identical keys, same placeholders, no empty strings |

### Tests

- New: tests/objectives.test.ts (respawn timers vs sim incl. own HUD value, sim-field precedence, Leviathan/soul,
  Schleier holders, inhibitors, Kesselbrut, epic timers, last-seen ghosts, post-game samples/timeline, summoner
  timers), tests/chatPings.test.ts (commands, mute matching, minimap snapping), tests/i18n.test.ts.
- Each green in isolation; `tsc --noEmit` clean after every commit. Full suite: see "Test status" below.

### Screenshots (1280x720, built game, headless Edge via CDP, `?play=classic&bench`, no console errors/warnings)

| File | Shows |
|---|---|
| docs/ist/c2-scoreboard-before.jpg | old Tab scoreboard with a dead enemy (row only dimmed, no timer, no objectives, no spells) |
| docs/ist/c2-minimap-before.jpg | old HUD: nothing above the minimap while a champion is dead |
| docs/ist/c2-scoreboard-after.jpg | objective bar, dead ally grey with "7", summoner column, enemy Flash timer "4:58" after a click |
| docs/ist/c2-minimap-after.jpg | death bar above the minimap, target frame (ally Dagny), objective timers under the top bar |
| docs/ist/c2-scoreboard-objectives.jpg | 10:50: enemy team with one Leviathan stack, Kesselbrut "da", dead ally with timer |
| docs/ist/c3-hud-objectives.jpg | same moment without the scoreboard (timers 4:59 / da / 9:10, death bar, ghost on the minimap) |
| docs/ist/c3-dead-after.jpg | own death (walked into the enemy base): respawn overlay with the camera hint, death recap, death bar "7", objective timers (before: docs/ist/08-todesbildschirm.jpg) |
| docs/ist/c6-postgame-before.jpg, c6-postgame-before-charts.jpg | old post-game (CS, gold, damage only), 7-min classic game quit via the menu |
| docs/ist/c6-postgame-after.jpg, c6-postgame-after-charts.jpg, c6-postgame-after-timeline.jpg | new: XP, item-value lead (signed), team wards, objective flags; timeline below the charts (empty in that short game) |

Fixed camera: the human player stays in the fountain (camera on the own champion), so before/after frames match.

### Shared-change proposals (docs/agents/shared-changes.md)

1. `src/sim/snapshot.ts`: `ScoreRow.respawnIn`, `ScoreRow.summonerCds` (own team), `ScoreRow.visionScore`,
   `ScoreRow.champDamage`, `Snapshot.objectives { leviathan, kesselbrut, schleierLeft, inhibs }`. Nothing blocks;
   only enemy Kesselbrut (`?` today), ally summoner CDs, vision score and damage become available.
2. `src/settings.ts` is outside C's area but C7 needs new settings: allow additive fields or move the file.
3. B's request (B1): minimap symbol for revealed enemy Schleierwards - implemented on C's side, reads the optional
   `stealth` field, inert until B1 is merged.

### Open (exact next steps)

- **C5 lobby (not started):** (1) portrait crops are a render issue -> docs/agents/issues.md (D). (2) Bot config per
  slot already exists under "Erweitert" (rank, variance, archetype preset, 10-axis editor): verify in the browser,
  screenshot, then set FEATURE-GAP 4.1 to `da`. (3) Rune page editor (4.2): keystone + 3 minors from `RUNES`
  (src/sim/items/runes.ts), named pages stored via `kvSet('runePages', …)` (src/store/kv.ts), selectable next to the
  presets in classicLobby.ts/practiceLobby.ts; `runesFromPreset` fallback stays. (4) Optional ban phase (4.3): pick
  up to 5 champions in classicLobby.ts, then replace banned bot champions in the built config with another
  champion of the same role (post-process in the lobby, no change to src/ai/runner.ts). (5) Role swap (4.4) with a
  bot slot: swap `role` of the human and one bot before `classicConfig`.
- **C7 settings (not started, needs the src/settings.ts decision):** minimap scale + side (3.7: `.minimap` size and
  `.minimap-wrap` left/right from a setting; the death bar is inside the wrap and follows), enemy skillshot outline
  (3.11, with D), HP-bar style (3.10, with D), settings export/import as JSON (3.13: buttons in settingsPanel.ts,
  `JSON.stringify(settings)` + binds, import validates keys against DEFAULTS), loading-screen tips (4.6: 10-20 tip
  keys `tip.N` in de/en, random one in `renderLoading`), gold efficiency in the shop detail page (5.3: gold value per
  stat point from the basic items in items.json - AD 35, AP 21.75, HP 2.67, armor 20, MR 16, AS% 25, mana 1.4 -
  then `sum(stat * value) / cost`).
- **Shop undo (5.2):** needs a sim `undo` command (B).
- **"Nochmal" after classic (4.7):** one-line change in src/main.ts (issues.md).
- Waiting for A3: C2 playstyle mini-scales + rank calibration in the scoreboard, C6 error list + rank calibration
  (A3 has `injectedError`/`detected:` log lines on brain/a3-humanize, no `rankCalibration` API yet).
- Waiting for B: exact enemy Kesselbrut (proposal or B6 epic flag), ally summoner CDs, vision score, Teleport slot
  (B4 `tpUnlocked`), item cast-fail events (1.15: sim emits castFail only for abilities).
- Enemy items in target frame / scoreboard: LoL shows them; the snapshot deliberately hides them (`ScoreRow` "fog-safe:
  enemies show item value"). Question for S/user below.

### Deviations

- Death timers and objectives are computed client-side from public events instead of waiting for snapshot fields
  (§7 allows a local adapter); values are identical (test), sim fields take over when they land.
- /ff and /all are accepted but only answer "not available yet" (surrender vote needs bot votes from the brain team,
  all chat needs the sim to deliver chat to the enemy team).
- Vision chart uses "active own-team wards" as a proxy (no vision score in the snapshot yet).
- Post-game objective markers are not clickable into a replay (no replay viewer exists; FEATURE-GAP 6.2/6.6).

### DECISIONS proposals

- "Scoreboard-Daten client-seitig": respawn timers / Leviathan / Schleier / inhibitors derived from public death
  events + exported sim constants (`deathTimerTicks`, `SCHLEIER_BUFF_TICKS`, `INHIB_RESPAWN`), sim fields win.
- "Gegner-Beschwörerzauber": manual click timer with the base cooldown (no summoner haste exists), like LoL.
- "Minimap-Geister": enemy champions stay 45 s at their last seen position (LoL has no such default; asked for in
  AGENTS-PLAN C3).

### Questions (for S / user)

1. Should enemy items be visible in the Tab scoreboard and target frame like in LoL (last seen items)? Today the sim
   hides them on purpose.
2. src/settings.ts ownership for C7 (see shared-changes).

### Test status

(filled in below once the full run finished)
