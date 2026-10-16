# Masterplan (Stand 2026-10-16)

Checkliste aller Phasen. `[x]` = fertig und gepusht, `[ ]` = offen, `[~]` = teilweise / läuft.
Entscheidungen und Zahlen stehen in docs/DECISIONS.md, das Bot-Verhalten in docs/spec-bots.md.

## Phase 1 – Simulation + 1 Champion
- [x] Deterministische 30-Hz-Sim im Worker (xoshiro128**, Replays bit-identisch, stateHash)
- [x] Map, Grid-A*-Pathing, Wand-Abstand, Supercover-Sichtlinien
- [x] Minion-Wellen, Aggro-Prioritäten, Belagerer/Super-Minions
- [x] Türme, Platten, Inhibitoren, Nexus, Turm-Zielregeln
- [x] Gold, XP, Kopfgelder, Todestimer
- [x] Kamera, Steuerung (LoL-Belegung, Strg/Shift+QWER), HUD, Minimap
- [x] Abnahme: 107 Minions bis 10:00, Skript-Last-Hitter ≥ 60 CS, Turmschüsse exakt

## Phase 2 – Champions, Items, Prägungen, Zauber
- [x] 26 Champions mit Fähigkeits-Engine und Hooks
- [x] Shop: rekursive Rezepte, Basisstiefel, Legendäre einzigartig, 720p-tauglich
- [x] Item-Passiva/Aktive, Prägungs-Effekte, Prägungs-Presets je Champion
- [x] Alle 8 Beschwörerzauber (inkl. Sicht-Prüfung, nicht während Wind-up)
- [x] Wards, Trinkets, Kontrollwards
- [x] LoL-Tooltips für Fähigkeiten, Passive, Items, Zauber, Prägungen
- [ ] Combo-Abnahme je Champion (Signature-Combos aus den Daten ausführbar und getestet)
- [ ] Telegraph-Audit (jede Fähigkeit zeigt Reichweite/Form korrekt an)

## Phase 3 – Bots (Gold-Niveau)
- [x] Behavior Tree als JSON, Wahrnehmung ohne Allwissen (Fog), Entscheidungs-Log (gedrosselt), F9-Overlay
- [x] Team-KI, Ganks, Roams, Trades, Kiten, Teamfights
- [x] Vorhersagendes Last-Hitting, Jungle-Route nach Camp-Timern
- [x] Ward-Spots je Rolle, Kontrollwards, Suchfeuer
- [x] Drache, Kesselbrut, Baron mit Gruppenruf, Bannen-Timing
- [x] Wellen in Turm schieben, Gruppieren/Belagern ab 14:00
- [x] bot-sim mit CSV und `--vs=<rang>`
- [~] CS-Kalibrierung gegen Tabelle A (aktuell ~50 %) → Tempo/Balance-Agent
- [~] Spieldauer 28–35 min, 40–60 Kills, erster Turm 12–16 min (aktuell 40–45 min) → Tempo/Balance-Agent

## Phase 4 – Ränge + Humanisierung
- [x] Rangprofile Eisen–Challenger, 10 Spielstil-Achsen, Archetypen, Reaktionszeiten, Varianz
- [x] Pings (Rad, Alt-Klick), Bots reagieren auf Spieler-Pings
- [x] Rage-„?“-Pings, Flame-Chat gegen den Spieler, Toxizitäts-Schalter
- [x] Tilt, Persönlichkeit, alle Fehlerarten je Rang injiziert
- [x] Team-Chat (Enter), Bot-Chat in UI-Sprache
- [x] Eine Bot-Schwierigkeit für alle Bots, Einzelwerte unter „Erweitert“
- [ ] Siegquoten je Rang (Ziel: Gold vs Silber ≳ 65 %, Diamant vs Gold ≳ 80 %; aktuell 50 %)

## Phase 5 – Trainer
- [x] Last-Hit-Trainer (auch Turm), Ausweich-Trainer, Kiting-/Combo-Trainer
- [x] Lane-Duell 1v1, Jungle-Duell, Teamkampf-Arena
- [x] Post-Game-Analyse (CS/Gold-Kurven, Tode, Schaden)
- [x] Sandbox+ (Level, keine CDs, Godmode, Welle, Camps)
- [ ] Szenario-Trainer (Gank-Flucht, 2v1 am Turm, Drache stehlen, …) – begonnen, pausiert
- [ ] Trainingsplan, Verlauf über mehrere Matches

## Phase 6 – Politur
- [x] Menüs, Lobby (Splash-Art, Icons, Rollen-Icons), Enzyklopädie
- [x] Prozeduraler Sound, Vollbild + Tastensperre, PWA
- [x] Gemalte Champion-, Minion- und Monster-Sprites, Porträts
- [x] Karte im Gouache-Stil (Lanes, Klippen, Türme im Team-Stil, Jungle-Lichtungen, Nebel)
- [x] Jungle-Inhalt: 6 Lager, Kesselbrut, Pflanzen, LoL-Werte
- [x] Ansagen, Todes-Zusammenfassung, Level-up-Effekt, große Pings, Recall-/Ward-Effekte
- [x] Barrierefreiheit (Farbenblind, weniger Bewegung, Kontrast, Hinweise), Grafikqualität, Code-Splitting
- [x] Bughunt: 4 kritische, 12 mittlere, ~20 kleine Bugs behoben (41 Regressionstests)
- [~] Champion-Animationen und einzigartige Silhouetten → Champion-Agent
- [ ] „Was ein Challenger getan hätte“ (Schatten-Bot, Zeitleiste im Post-Game)
- [ ] Mechanik-Feeling auf LoL-Niveau (siehe nächster Abschnitt)

## Mechanik-Feeling vs. League of Legends
Nutzer-Feedback 2026-10-16: „fühlt sich noch zu scuffed an“, Minions schlagen komisch, Fähigkeits-Animationen
wirken seltsam. Befunde des Mechanik-Audits folgen hier als Checkliste.
