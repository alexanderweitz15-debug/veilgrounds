# swarm-pings (branch swarm/pings-2, continues swarm/pings)

## Built
- Ping wheel (src/ui/pingWheel.ts): 8 slots Gefahr / Hier hin (centre = Achtung) / Auf dem Weg / Zurueck / Vermisst / Vision / Hilfe, glyph per kind (`PING_ICON`, shared with world badges and minimap), `pickWheel` pure. Works on the minimap too (`Minimap.simAtClient`, controller `wheelOnMap`).
- Context pings (src/game/contextPing.ts, pingText.ts, campTimers.ts): Alt+click or wheel "Achtung" on epic pit / camp -> "Flussleviathan in 1:23" / "... ist da!"; Alt+click epic timer chip; enemy summoner spell on scoreboard "Blitz nicht bereit (2:10)"; enemy item in target frame "Wren hat Sturmklinge"; own ability/summoner in HUD "Q bereit in 4 s"; missing ping names the hovered enemy champion or the lane ("Mid vermisst").
- Label travels as `label` on the ping command/event (sanitised, 40 chars); shown as text plate in the world (src/render/pings.ts), in the kill feed.
- Per-kind animation (src/render/pingAnim.ts; back/onMyWay rings shrink inward) and minimap glyph + same ring style.
- Sounds: one procedural voice per kind (`pingCue` in src/audio/sfx.ts, used by eventSounds).
- Spam limit: sim authoritative 6 pings / 4 s (src/sim/pingRules.ts); client `PingLimiter` (5 / 4 s, 1.5 s lockout, 120 ms double-click gap) behind `PingSender`; refused ping plays the fizzle sound.
- Bots: see shared-changes.md P-1 (social.ts).

## Tests
- `npx vitest run tests/pingContext.test.ts tests/pings.test.ts tests/chatPings.test.ts tests/i18n.test.ts`: 23 passed.
- `tests/replay.test.ts`, `tests/botErrorsInjected.test.ts`: passed (determinism intact).
- `npx tsc --noEmit`: clean.
- Fixed two wrong test assumptions from the WIP commit (mid lane has 2 points, so its "middle" was the enemy base; corner (200,15800) is within 1600 of the top lane).
- `tests/bots.test.ts` crashed the vitest worker in my run (process exit, no assertion output) - not investigated, lead's full run decides.

## Open / not verified
- Not seen in a browser (rules: no browser). Wheel on minimap, label plate placement and sounds untested visually/audibly.
- No unit test for the bot "back" retreat; behaviour only checked through replay determinism.
- Own-ability / item / summoner context pings are placed over the own champion as `alert` with a label.
