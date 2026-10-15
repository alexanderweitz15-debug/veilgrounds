# Entscheidungen und Abweichungen vom Prompt

Jede Abweichung vom Design-Prompt steht hier mit Grund. Neue Einträge oben.

## Vom Nutzer entschieden (Phase 1, 2026-10-15)

| Thema | Prompt | Entscheidung | Grund |
|---|---|---|---|
| Pause/Shop | §6.1 Pause = P, §9 Shop = P | Shop = P, Pause = F10/Pause | Wie LoL; §9 gewinnt |
| Trinket | „4 (Standard) oder 7“ | Trinket = 4, Items 1 2 3 5 6 7 | LoL-Muskelgedächtnis |
| Determinismus | Fixed-Point 16.16 | JS-Doubles, nur `+ - * / sqrt` in der Sim; sin/cos per Taylor-Reihe (`vec.ts`) | 16.16 läuft bei Distanz² auf 16.000er-Map über; IEEE-754 ist für diese Operationen plattformübergreifend exakt |
| CS-Ziel | 112 CS bei 10:00 | 107 CS | Mit den Wellenwerten aus §2 sind max. 17 Wellen × 6 + 5 Belagerer erreichbar |

## Vom Lead entschieden

| Thema | Prompt | Entscheidung | Grund |
|---|---|---|---|
| Render-Lib | Dateibaum sagt „Pixi“ | Three.js | Stack-Abschnitt §10 fordert Three.js; „Pixi“ ist Tippfehler |
| State-Transfer | SharedArrayBuffer, Fallback Transferable | `postMessage`-Snapshots (Structured Clone) | SAB braucht COOP/COEP; GitHub Pages sendet die nicht. Umstieg, wenn Profiling es verlangt |
| ECS | bitecs | bitecs 0.4.0, Komponenten pro Sim-Instanz | 0.3.x hat globale Komponenten-Arrays und Entity-IDs; mehrere Sims parallel (Replay-Check, „Was ein Challenger getan hätte“, bot-sim) wären unmöglich |
| Pathfinding | recast-navigation-js (WASM) | Grid-A* (50er Zellen) + String-Pulling, Minions folgen Lane-Wegpunkten | Synchron, deterministisch, kein WASM im Worker. Upgrade auf recast, wenn Crowd-Steering gebraucht wird |
| Persistenz | Dexie | Phase 1: kleiner IndexedDB-Wrapper | Dexie, sobald Schemas (Replays, Trainingsverläufe) kommen |
| Grafik | Handgemalte Sprites/Texturen | Prozedurale Platzhalter bis Phase 6 (vom Nutzer bestätigt) | Kein Art-Team |
| Blindtest | 5 Spieler schätzen Rang (Phase 4) | Als Aufgabe für den Nutzer dokumentiert | Nicht automatisierbar |
| Item-Anzahl | 12 Basis + 16 Komponenten + 12 legendär = 40, aber Tabelle nennt 12 legendäre + 2 Aktiv-Items | 12 Basis (inkl. 5 Startitems) + 14 Komponenten + 14 legendär (12 + Zeitglas + Kettenrelais) = 40; Stiefel und Verbrauchsgüter zusätzlich | Gesamtzahl 40 und alle genannten Items bleiben erhalten |
| Hüterstab-Preis | Legendär 2.600–3.400, Hüterstab 2.500 | 2.500 beibehalten | Konkreter Tabellenwert schlägt Spannweite |
| „Ketenrelais“ | Tippfehler | Kettenrelais | – |
| Minion-Laufzeit | 1:35 Mid / 1:45 Side | Minion-Tempo bzw. Spawnpunkt so getunt, dass beide Zeiten ±3 s treffen | Map-Geometrie (Nexus-Abstand ca. 17.500) und eine einheitliche Geschwindigkeit passen nicht exakt zu beiden Zeiten |
