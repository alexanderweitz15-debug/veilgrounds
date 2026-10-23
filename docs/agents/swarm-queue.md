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
