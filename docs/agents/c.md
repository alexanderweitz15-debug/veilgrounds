# Agent C "UI & Funktionen" - report

Branch `ui/c-features` (base `0bbc3d0`). Spec: docs/AGENTS-PLAN.md §5 (C1-C7). Newest block on top.

## Ready for merge

| Package | Commits | Merge note |
|---|---|---|
| C1 feature-gap audit | `7914764` | docs only |
| C2 scoreboard objectives + death timers | `feb41a2` (+ screenshots in `17f1a41`) | works without sim changes; shared-change proposal below makes enemy Kesselbrut / ally summoner CDs exact |
| C3 HUD additions | `4bdc78b` | – |
| C4 pings + chat | `28c5ab5` | – |
| C6 post-game (without A3 parts) | `17f1a41` | – |

Not merged-ready yet: B1 minimap symbol for revealed enemy wards (in the next commit, inert until B1's `stealth` field
is on main), C5, C7.

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
| docs/ist/c3-dead-after.jpg, docs/ist/c6-postgame-*.jpg | being captured (see handoff) |

Fixed camera: the human player stays in the fountain (camera on the own champion), so before/after frames match.

### Shared-change proposals (docs/agents/shared-changes.md)

1. `src/sim/snapshot.ts`: `ScoreRow.respawnIn`, `ScoreRow.summonerCds` (own team), `ScoreRow.visionScore`,
   `ScoreRow.champDamage`, `Snapshot.objectives { leviathan, kesselbrut, schleierLeft, inhibs }`. Nothing blocks;
   only enemy Kesselbrut (`?` today), ally summoner CDs, vision score and damage become available.
2. `src/settings.ts` is outside C's area but C7 needs new settings: allow additive fields or move the file.
3. B's request (B1): minimap symbol for revealed enemy Schleierwards - implemented on C's side, reads the optional
   `stealth` field, inert until B1 is merged.

### Open

- C5 lobby, C7 settings (C7 needs the settings.ts decision).
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
