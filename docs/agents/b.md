# Agent B "Sim & Mechanik" - report

**B1-B3 READY FOR MERGE** (code + targeted tests green; full suite and branch bot-sim see "Not run / open" below).

Branch `sim/b-mechanics` (base 0bbc3d0). Commits: `b1: ward stealth filter ...` (7022391), `b2: movesWhileCasting
audit ...` (fc9118b), `b2: castMovement test passes tsc` (7052a4f), `b3: snapshot additions for bots ...` (09e8860),
docs commit after that.

## B1 Ward visibility - done

Repro of the user report ("Schleierwards visible for everyone"): **not reproducible on current main.**
- Headless 10-bot game, every second both team snapshots checked: 8 min = 1506 enemy-veil samples, 0 in a snapshot;
  20 min = 4595 samples, 2 in a snapshot, both legit Siegelward reveals (bots buy seal wards later; old radius 900).
- Sim path checked: `invisible` buff for the full lifetime (VEIL.ticks+1 outlives the expiry tick, no gap),
  `computeVision`, `buildSnapshot`, `teamEvents` (ward deaths need a visible kill, no ward-placement event), client
  `render/wards.ts` + `ui/minimap.ts` only draw snapshot entities, fog overlay only own units, bots read only
  snapshots. GitHub Pages deploys are current (last green deploy 0bbc3d0), so it is not a stale build.
- Most likely explanations: the old 900 Siegelward reveal radius (large), or own/allied wards. The repro had no
  Spaehfrucht/Nyx reveals, so it proves "no leak", the new tests prove the reveal rules.

Implemented (AGENTS-PLAN §4 B1): one stealth rule in `src/sim/wards.ts` for everything hidden from the enemy:
Schleierwards (stealth buff id `stealth`, `wards.json veil.stealth`), Nyx seeds + Grimald traps
(`GroundObject.stealth`), Lysa E wire (ability flag `stealth` -> zone event `stealth`). Revealed by (a) enemy
Siegelward within 450 (was 900), (b) Suchfeuer area, (c) 3 s linger after Spaehfrucht pop / Nyx R
(`revealStealthArea`). Siegelwards never stealthed. Revealed wards are attackable (test). Snapshot: `stealth` flags on
entities/objects (additive). Ward numbers moved to new `src/data/wards.json`.
Minimap symbol (C) and render look (D): exact diffs in docs/agents/shared-changes.md, not done by B.
Tests: `tests/sim/wardStealth.test.ts` (7 cases incl. 2.5-min 10-bot regression; mutation-checked: radius 900,
no wire flag, no Spaehfrucht reveal each fail), `tests/snapshot.test.ts` updated (trap now needs `stealth: true`).

## B2 movesWhileCasting - done

Every ability (26x4) + summoner has `movesWhileCasting` and explicit `castTime` in data (validator requires it).
Sim: `movementLocked()` replaces `isBusy()` for walking speed; autos still blocked in wind-ups; channels stand.
Table with measured wind-up/walked/arrival: docs/ability-cast-audit.md. Test `tests/sim/castMovement.test.ts`
(walk 600, cast at 300, arrival per ability; with the old rule 25/26 champions fail).

## B3 Snapshot additions - done

`SnapEntity.plates` (outer towers), `revealed` (enemy under own reveal), `exposed` (own unit revealed to enemy),
`Snapshot.kesselbrutTeams`, `Snapshot.reveals` (own seal/sweep areas). atkPhase/atkTarget/atkStart/atkEnd were already
there; **atkTarget is now masked to -1 if the target is not in the same view** (eid leak fix). Test
`tests/sim/snapshotBots.test.ts`.

## What the brain team must know
- `ab.movesWhileCasting` in champion data: `brain.ts think()` should not set busyUntil for those casts (diff in
  shared-changes.md; brain.ts is a shared file, not edited by B).
- New optional snapshot fields above; `atkTarget` can now be -1 where it used to be a hidden eid.
- Siegelward reveal radius 450 changes vision outcomes in bot games (fewer reveals).

## Tests run
- Green: tests/sim/wardStealth, castMovement, snapshotBots, snapshot, summonersWards, jungle, abilityVisualsC,
  championData; `npx tsc --noEmit` green after 7052a4f + B3.
- Full `npx vitest run` after B2: 806/807, only tests/telegraph.test.ts timed out (5000 ms, load; green alone).
- Full suite after B3 and the branch bot-sim were started but stopped at the lead's wind-down order: **not verified
  after B3** (B3 only adds snapshot fields + masking; replay/determinism/phase1/sideMirror were green after B2).
- Bot-sim gold 4x20 min on base 0bbc3d0 (baseline): laner CS/min 3.13, deaths/game 2.02, kills/game 1.77,
  gold/min 219.1, wards/min 0.23, towers/game 1.3, first tower 16.2 min (2/4). **Branch run not finished: open.**

## Open (not started): B4 Teleport for top, B5 mechanic feel, B6 Kesselbrut objective, B7 load time, B8
- B5 Seraphyne passive: verified done in 188f75f (one refreshing buff `PASSIVE_MS`, test abilityVisuals.test.ts:97).

## DECISIONS proposals
- Siegelward reveal radius 900 -> 450 (AGENTS-PLAN B1 (a)).
- Lysa E wire is stealthed (plan groups it with seeds/traps; spec-champions does not say "invisible"). Remove the
  `stealth` flag in lysa.json if the user wants a visible wire.
- Ally-targeted buffs Ferris E, Kiran E, Oda E and buffs Grimald W, Hagen R, Nyx W/R, Ottilie R, Renn W keep walking
  (treated like shields/self-buffs); Oleth Q, Isolde R count as dashes. Self AoEs with damage/CC stand for the wind-up.
- Casts keep castTime; only movement during the wind-up changed (no balance change).
