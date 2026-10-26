# Swarm queue (start in this order when a slot frees; max 20 concurrent subagents)

1. `elemental-drakes` - 5 Leviathan element types with German names, stacking team buff per kill, next type announced
   after the first kill, third type = soul type, soul at 4 kills with a strong per-element effect, then an Elder-like
   Uralt-Leviathan with an execute buff; snapshot fields, scoreboard/objective-bar icons, de/en announcements, team AI
   values by type (values.json), tests. (User 23 Oct: "mehr Dragons mit verschiedenen Souls und Boni bei Tötung".)
2. `plants` - better jungle fruits (user 23 Oct: "bessere Früchte"): painted, readable plant visuals with grow/ripe/pop
   animations and effects, honey fruit drops pieces on the ground to walk over (LoL), 2-3 new fruit types with clear
   effects (e.g. mana, speed, shield), bots use plants (additive brain hook, logged), tests. src/sim/systems/plants.ts.
3. `champ-adc` - new ADC champion #30 with a unique mechanic (prompt in the lead transcript; clockwork artificer).
4. `training-hud` - live training widget: CS/min vs chosen rank target, missed CS, gold/min, CS@10 projection,
   last-hit timing indicator.
5. `sounds` - procedural per-champion sounds, footsteps by body type, mixer categories.
6. `accessibility` - colorblind palettes, text size, reduced motion, high-contrast bars, contrast test.

## Mechanics agents (user 23 Oct: "weitere Sonnet-Agents, um Spielmechaniken zu verbessern")

First command of each: /caveman:caveman, /ponytail:ponytail, /caveman:cavecrew (use cavecrew-investigator / -builder /
-reviewer subagent presets where they fit). Each compares with LoL, measures before/after, adds tests.

7. `mech-tower` - tower aggro rules exactly like LoL (target priority, champion-hits-champion switch, aggro reset when
   leaving range, warming-up damage ramp, plates/fortification timings), tower shot readability.
8. `mech-minions` - wave behaviour like LoL: minion target priority, wave collision/spacing, cannon waves, wave
   bouncing/crashing, minion leash, catch-up speed when far from lane.
9. `mech-skillshots` - skillshot hit detection fairness: hitbox vs projectile width, edge hits, collision with
   minions, projectile speed/size vs LoL references, dodge feel; tests with edge cases.
10. `mech-movement` - pathing and collision smoothness: unit separation, stuck cases, click-spam handling, path around
    units, champion collision with minions (LoL: champions ghost through minions? no - check), terrain corners.
11. `mech-cc` - CC feel and rules: knock-up/airborne vs cleanse, tenacity, CC stacking, slow stacking (strongest only),
    stun animation states, CC duration display, interrupts of channels/dashes.
12. `mech-vision` - brush and vision rules like LoL: brush reveal on attack, ward vision, vision of attackers in fog
    (revealed when attacking), true sight, fog edge behaviour; tests vs omniscience.
