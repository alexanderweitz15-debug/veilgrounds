# swarm-summoners

Check result: summoners already present in src/data/summoners.json and implemented in src/sim/summoners.ts: sprung (Flash), heilen, geist (Ghost: ms 24-48 % + collision ignore, movement.ts), entflammen (Ignite), erschoepfen (Exhaust: -40 % dmg, 30 % slow, 2.5 s), reinigen (Cleanse), teleport, bannen (Smite). Only Barrier was missing. Existing ids/names were not renamed (task wording Erschöpfung/Zündung/Zuschlagen vs. ids erschoepfen/entflammen/bannen: ~60 test files and other agents depend on the ids).

Built:
- `barriere` / Barriere / Barrier: 180 s, shield 115-455 by level (linear 1..18), 2 s, `addShield`. Castable like Heal (not while stunned/airborne).
- HUD icon (shield shape, src/ui/icons.ts SUMMONER), tooltip de/en, Exhaust tooltip now with numbers. Both lobbies list SUMMONERS without `todo`, so Barrier appears automatically.
- Bot rules (src/ai/bot/spells.ts, wired in brain.ts utilitySpells): `barrierStep` (HP line 16 % Iron .. 30 % Challenger via params.skill, enemy champion within 700 or tower aggro, reaction delay), `ghostStep` (skill >= 40; chase a fleeing <35 % HP enemy in fight mode, or retreat mode at <30 % HP with a foe within 800; escape.ts already had a Ghost-before-Flash path), `exhaustStep` prefers the diver.

Tests: tests/summonersBarrier.test.ts (10 pass), tests/summonersWards.test.ts (14 pass), tsc clean.

Open / lead decision:
- Bots never carry Barrier/Ghost: runner.ts SUMMONERS role table unchanged (would shift bot calibration). One-line switch if wanted (e.g. adc `['sprung','barriere']`).
- "Lethal damage" is approximated by an HP line (no HP history in View/BotMemory).
