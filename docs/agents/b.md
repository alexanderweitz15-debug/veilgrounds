# Agent B "Sim & Mechanik" - report

**B1-B3 READY FOR MERGE** (merged to main once in e0f40bb; follow-ups since then on `sim/b-mechanics`).
**B4, B5 (sim side), B6 done; B7 proposal only (other agents' files); B8 see "Tests".**

Branch `sim/b-mechanics`, merged with origin/main (last merge 3d48b5a). All commits pushed.

## B1 Ward visibility - done

Repro of the user report ("Schleierwards visible for everyone"): **not reproducible** on main.
- Headless 10-bot game, both team snapshots checked every second: 8 min = 1506 enemy-veil samples, 0 in a snapshot;
  20 min = 4595 samples, 2 in a snapshot, both legit Siegelward reveals (old reveal radius 900).
- Checked: invisible buff for the whole lifetime (VEIL.ticks+1, no gap), computeVision, buildSnapshot, teamEvents
  (no ward-placement event, ward deaths need a visible kill), render/wards.ts + ui/minimap.ts draw only snapshot
  entities, fog overlay only own units, bots read only snapshots, Pages deploy current. Likely cause: the old 900
  Siegelward radius or own/allied wards.
- Implemented one stealth rule (wards.ts): Schleierwards (buff id `stealth`), Nyx seeds + Grimald traps
  (`GroundObject.stealth`), ability flag `stealth` for zones (unused). Revealed by enemy Siegelward within 450,
  Suchfeuer, 3 s linger after Spaehfrucht / Nyx R. Revealed wards attackable. `SnapEntity.stealth`,
  `SnapObject.stealth`. Ward numbers in src/data/wards.json.
- User 19.10.: **Lysa E wire visible** again (flag removed from lysa.json; test checks visible + flag mechanism).
- Minimap symbol (C) / render look (D): diffs in shared-changes.md.
- Tests: tests/sim/wardStealth.test.ts (7, incl. 2.5-min 10-bot regression), tests/snapshot.test.ts updated.

## B2 movesWhileCasting - done
All 104 abilities + summoners carry `movesWhileCasting` + explicit `castTime` (validator). Sim `movementLocked()`.
docs/ability-cast-audit.md (measured table). tests/sim/castMovement.test.ts (25/26 champions fail with the old rule).
brain.ts busyUntil diff for A1 in shared-changes.md (lead: goes to A1 Phase 2).

## B3 Snapshot additions - done
`SnapEntity.plates / revealed / exposed / dash / air / epic`, `Snapshot.reveals`, `Snapshot.objectives`
(C2 names: leviathan, kesselbrut, schleierLeft, inhibs) + `kesselbrutTeams` (kept, C reads it), `ScoreRow.respawnIn`,
`summonerCds` (own), `visionScore` (both), `champDamage` (own), **enemy `items` as last seen + `itemsSeen`** (user
19.10.; system src/sim/seenItems.ts after vision). `atkTarget` masked to -1 for targets outside the view.
`snapshotEntities(sim, team)` exported for the bot runner (A1 request). Tests: tests/sim/snapshotBots.test.ts.

## B4 Teleport for top - done (sim side)
src/sim/topTeleport.ts: lobby role `top` counts lane-minion gold; at 1500 (`summoners.json teleport.topUnlockGold`)
Teleport becomes summoner slot 2 (`spell` slot 2, `abilities[6]`), cooldown as Teleport; team-only event
`tpUnlocked`. A top laner who took Teleport gets nothing extra. HUD slot F2/T + announcement: C (shared-changes).
Bot use: issue in issues.md. Test tests/sim/topTeleport.test.ts.

## B5 Mechanic feel - sim side done
- Dash/knock-up arcs: `SnapEntity.dash` / `air` 0..1 (render: D).
- atkStart/atkEnd were already in the snapshot (render: D).
- Facing: decision = render smooths (sim facing stays exact for casts/bots); D2.
- Auto reset: Dagny Q castTime 0, `auto_reset` also ends the backswing (next auto same tick).
- Ranged hitbox 55 -> 65: unchanged (default 55; needs the user's decision).
- Attack-move "target at cursor": command `attackMove.cursor`; setting/input: C.
- Seraphyne passive: verified done in 188f75f.
- Hit flash: damage events `flash` (champion hits always, others max 4/s per target); render: D.
- Tests: tests/sim/mechanicsFeel.test.ts. Also: item actives emit `castFail` with `item: true` (C's issue).

## B6 Kesselbrut objective - done
`CampDef.epic` (Leviathan, Kesselbrut, Schleierwaechter), death events `epic` reach both teams, `SnapEntity.epic`.
Radius unchanged. Test tests/sim/epicObjectives.test.ts. Note for C (announce.ts) and A2 in shared-changes.

## B7 Load time - not implemented
All files are D's (src/render) or the lead's (build). Proposal (Cache Storage per champion cell, version hash,
optional Playwright bake step, menu placeholder background) in shared-changes.md.

## Tests (B8)
- tsc green after every commit. Targeted tests green for every package.
- Full suite before B6/attack-move/vision score: 867 passed, 1 failed = tests/brainReflex.test.ts reflex cost
  timing (A1, wall clock, 0.147 ms vs 0.05 under load from 5 agents; not touched by B).
- Determinism / sideMirror / phase1: green after the seenItems system (19.10.).
- Final full suite (HEAD e26437a, 19.10.): 881 passed, 2 skipped, 1 todo, 1 failed = the same brainReflex cost
  timing (0.05 ms limit, wall clock under load). Everything B touched is green.
- Final bot-sim on the branch (B1-B6 + main): numbers identical to merged main e0f40bb below (CS/min 3.37, deaths
  2.30, gold/min 223.7, towers/game 0.5): B4-B6 are bot-neutral, no regression.
- Bot-sim gold 4x20 min: base 0bbc3d0: CS/min 3.13, deaths 2.02, gold/min 219.1, towers/game 1.3, wards/min 0.23.
  Merged main e0f40bb (all agents incl. B1-B3): CS/min 3.37, deaths 2.30, gold/min 223.7, towers/game 0.5,
  wards/min 0.21. Not attributable to B alone (A1-A3/C/D/E changes merged at the same time).

## DECISIONS proposals
- Siegelward reveal radius 900 -> 450 (AGENTS-PLAN B1 (a)).
- Lysa E wire visible (user 19.10.); stealth only for Schleierwards, Nyx seeds, Grimald traps.
- Ally-targeted buffs (Ferris E, Kiran E, Oda E) and buffs Grimald W, Hagen R, Nyx W/R, Ottilie R, Renn W keep walking;
  Oleth Q, Isolde R count as dashes; self AoEs with damage/CC stand for the wind-up.
- Dagny Q castTime 0.2 -> 0 (instant auto reset).
- Kesselbrut kills public (epic flag), radius stays 70.
- Vision score formula (approximation): ward-minutes + enemy wards killed + 0.5 x revealed.
- Facing smoothing in the render, not the sim.

## Questions for the user
- Ranged hitbox radius 55 (spec) or 65 (LoL)?
