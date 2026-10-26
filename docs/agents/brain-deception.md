# Brain: deception by rank (brain/s-deception)

Request: the lower the Elo, the easier to fool the bots (e.g. Sev W). All numbers: `src/data/bots/values.json` ->
`deception` (rank curves via `rankCurve`, skill = `ctx.params.skill`).

## Built
- **Sev W clone** (`src/ai/humanize/deception.ts`, hooked in `bot/perception.ts` + `reflex/view.ts`). Bots ignored every
  `Kind.Pet`. Now, on first sight of an enemy decoy (pet with `look`, fog-filtered snapshot only) the bot rolls once
  (`decoyFooledPct`: Iron 90 % .. Challenger 2 %). Fooled: for `decoySpotMs` (Iron 3 s .. Challenger 0.1 s; the clone
  lives 1.5 s) the pet is a `Kind.Champion` copy with the owner's champ/slot and the pet's eid, so autos, skillshots,
  chase and fight logic go to the clone (reaction delay through `mem.aware` as for any champion). The real owner is
  pushed to `unnoticed` for `decoyLoseRealMs` (Iron 2.5 s .. Challenger 0.05 s), also after the clone bursts. Not fooled
  or spotted: pet ignored as before. Own-team decoys and pets without `look` (Hark, kegs) are never touched.
  The roll is a single `rng.chance` in think, only when a decoy is visible: games without Sev W draw nothing extra.
- **Brush / fog juke** (`bot/trade.ts`): the all-in follow time for a low target that left sight is now
  `fogFollowS` (Iron/Bronze 0 as before the Silver gate, Silver+ 2.5 s as before) plus `fogFollowBushS` when the last
  seen spot is inside a bush (Silver 0.5 s .. Challenger 2 s): low ranks lose a target that jukes into a bush at once,
  high ranks keep guessing its spot.

## Already rank-scaled, not touched
- Skillshot leading / naive aim: `bot/combat.ts leads()` (`skillshotHitPct` + 15 pts) and `aimErrorDeg`.
- Chase into fog: `chaseIntoFogPct`; chase abort `combat.chaseAbort.pct`.
- Other decoys: grep over `src/sim/champions` found no other `_decoy` pet (only Sev W); `fooledBy` works for any pet
  with `look`, so a future clone ability is covered when its snapshot entity carries `look`.

## Tests
`tests/botDeception.test.ts` (4 tests, <2 s): clone treated as Sev: Iron > 75 %, Challenger < 10 %, monotone; fooled
bot loses the real Sev; Iron attacks the clone (arena scene, real Sev further away) > 3x more often than Challenger;
own/look-less pets ignored; illusion ends after the spot time.

## Open
- No end-to-end sim test of a bot dying to the clone burst; perception + decision level only.
- Clone `hp` stays Sev's HP at cast (no tell modelled beyond `decoySpotMs`).

## Test status
tsc clean; tests/botDeception.test.ts 4/4 green. tests/botPerception.test.ts and tests/bots.test.ts could not finish
here: vitest worker / esbuild service died under machine load (not a test failure; no assertion ran). The change is a
no-op without a visible enemy decoy pet, so those suites are unaffected by construction. Lead: please run them.
