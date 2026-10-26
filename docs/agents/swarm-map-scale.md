# swarm map-scale (continued on swarm/map-scale-2)

## What
Map edge 16000 -> 14900 (LoL size) via ONE factor: `src/data/map.json` has `size: 14900` and `designSize: 16000`;
`src/sim/map.ts` exports `MAP_SIZE`, `MAP_SCALE` (0.93125), `scalePt`, `MAP_OBJECTIVES`. Every map.json coordinate
and radius (walls, bushes, fountain, lanes, towers, inhibitors, nexus, camps, plants, objectives) is multiplied and
rounded once BEFORE the quarter swap / point mirror, so `size - x` stays exact (sideMirror green). Unit sizes,
ranges, speeds, clearances unchanged. Setting `size` back to 16000 restores the old map exactly (scale 1).

Scaled consumers: ward spots (`macro.ts`, `scalePt`), `SANDBOX_DUMMY`, trainer `ARENA` / `ARENA_CENTRE`, objectives
and announce (via `MAP_OBJECTIVES`), camera start/clamp, render `MAP_SIZE` (coords, fog shader uniform, minimap),
ping clamp (`sim.map.size`).

## Tests (single files)
- tsc: clean.
- map, sideMirror, jungle, phase1 (107 minions, 62 CS at 10:00), minions, towers, waves, economy*, botVision,
  botPerception, pings, snapshot, telegraph, aimPreview, botLog, picking, objectives, bughunt, wardStealth,
  trainer, botArena, botGank: green.
- Fixed hard-coded coordinates by deriving from map data: minions, towers, botGank (escape scenario), plus the
  WIP edits in map/jungle/bughunt/sideMirror/objectives/phase1/wardStealth.
- NOT run (lead's full suite): replay, ghost, brainReflex, summonersWards, rest. botGank spec-3/4 scenarios still use
  literal design-space top-lane coordinates (pass, not geometrically exact on the new map).
- phase1: last-hitter stand-off had to go 395 -> 340 (greedy script, chaotic): with 395 CS fell to 42 because the
  wave reaches the tower sooner. Test script retune only, sim unchanged.

## bot-sim gold 2 games 8 min (before = size 16000, after = 14900)
| | before | after |
|---|---|---|
| laner CS/min | 2.27 | 2.92 |
| total kills/game | 2.0 | 6.0 |
| deaths/game | 0.25 | 0.80 |
| wards/min | 0.19 | 0.23 |
| path eff / stuck s/min | 0.92 / 0.22 | 0.90 / 0.25 |
| max idle | 4.7 s | 4.6 s |
Only 2 games: kills up (shorter distances, more contact), CS up (shorter walks). No stuck or idle regression.

## Open
- Render art constants not scaled (base ring radii 2700/3900, terrain particle counts, camera far 12000): purely
  decorative, a quick screenshot pass is advised (nothing viewed in a browser here).
- Bot distance thresholds (1100/1500/2500 ...) stay: bots now see more of the map per range, expected.
- Pacing calibration (wave arrival 1:28/1:38 test passes) not re-tuned beyond tests.

## DECISIONS proposal (replaces row "Kartengröße", docs/DECISIONS.md line ~224)
| Kartengröße | 14900 (LoL-Größe), ein Faktor `size/designSize` = 0,93125 beim Laden von map.json; Einheitengrößen, Reichweiten, Geschwindigkeiten unverändert | Alle Karten-Koordinaten bleiben im 16000-Designraum editierbar; Wellen kommen früher an den Türmen an (phase1-Skript angepasst), Bot-Kalibrierung ggf. neu messen |
