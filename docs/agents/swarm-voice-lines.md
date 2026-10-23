# swarm voice-lines (FEATURE-GAP 7.12)

Branch swarm/voice-lines. Status: done except open items.

## Built
- src/data/voiceLines.json: 27 champions x 8 keys (pick, move1, move2, attack, ability, kill, death, recall) x de/en.
  pick/kill/death/recall copied from the existing `voiceLines` in src/data/champions/*.json; move1/move2/attack/ability new.
  "ability/ult" is one key: R casts always speak, Q/W/E by chance.
- src/ui/voiceBubbles.ts (+ .css): `VoiceBubbles` (canvas speech bubbles, fog-safe: follow only visible units, fixed spot for death),
  `VoiceLimiter` (pure rate limiter), `voiceLine()`, `wrapLine()`, `renderPickLine()` (lobby quote under the showcase).
- Triggers: snapshot events cast / attack / death (victim = death line, champion killer = kill line); own champion from snapshot:
  recall start (`me.recallLeft` 0 -> >0), first move after 2.5 s standing still (move line), pick line 1 s after start.
- Rate limits (VOICE_RULES): gap per champion 6 s own / 11 s others (story lines 2 s); chance move .6, attack .1, ability .3;
  trigger cooldown 20/30/16 s; others max 3 live, 1.5 s apart.
- Setting `voiceLines` (default true), settings panel row, i18n `set.voiceLines` de+en.
- Tests: tests/voiceLines.test.ts (17: completeness, limiter, event mapping, wrap). Also ran i18n + settingsIO tests, tsc clean.

## Open
- Recall bubbles only for the own champion (snapshot has no recall state of other champions). Move line only own (no move event).
- No visual check in browser (no browser per swarm rules).
- Champion task (new champion + items) dropped by lead.
