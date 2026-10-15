# Roadmap (Stand 2026-10-15)

## Status pro Phase (2026-10-16)
| Phase | Stand | Erledigt | Offen |
|---|---|---|---|
| 1 Simulation + 1 Champion | abgeschlossen | Map, Grid-Pathing, Wellen/Aggro, Türme/Platten, Gold/XP, Kamera/Steuerung/HUD, Mira, Puppe; Abnahme: 107 Minions bis 10:00, Turmschüsse exakt, Replay bit-identisch | – |
| 2 Champions, Items, Prägungen, Zauber | ~95 % | 26 Champions inkl. Hooks, Engine, Shop (rekursive Rezepte, Basisstiefel, Legendäre einzigartig), Item-Passiva/Aktive, Prägungs-Effekte + Presets, alle 8 Beschwörerzauber, Wards/Trinkets, LoL-Tooltips | Combo-Abnahme, Telegraph-Audit |
| 3 Bots Gold | ~85 % | Behavior Tree als JSON, Wahrnehmung ohne Allwissen, Team-KI, Ganks/Roams/Trades/Kiten, F9-Overlay, gedrosseltes Entscheidungs-Log, bot-sim (--vs), vorhersagendes Last-Hitting, Ward-Spots/Kontrollwards/Suchfeuer, Drache/Kesselbrut/Baron + Bannen, Belagern ab 14:00 | CS ~50 % von Tabelle A, Spieldauer 40–45 min → **läuft (Agent Tempo/Balance)** |
| 4 Ränge + Humanisierung | ~70 % | Rangprofile, 10 Spielstil-Achsen, Reaktionszeiten, Varianz, Pings, Rage-„?“-Pings, Flame-Chat gegen Spieler, Toxizitäts-Schalter, Tilt, alle Fehlerarten injiziert, Bot-Chat in UI-Sprache, eine Schwierigkeit für alle Bots | Siegquoten je Rang (noch 50 %) → **läuft (Agent Tempo/Balance)** |
| 5 Trainer | ~90 % | Last-Hit- (auch Turm), Ausweich-, Kiting-/Combo-Trainer, Lane-Duell 1v1, Jungle-Duell, Teamkampf-Arena (Bots kämpfen untereinander), Post-Game-Analyse, Sandbox+ | Trainingsplan, Verlauf über mehrere Matches |
| 6 Politur | ~75 % | Menüs, Enzyklopädie (Splash, Icons), prozeduraler Sound, Vollbild, PWA, gemalte Minions/Monster, Porträts + Splash-Art, Karte komplett überarbeitet (Gouache), Ansagen, Todes-Zusammenfassung, Team-Chat, Barrierefreiheit, Grafikqualität, Code-Splitting, Icons überall, Kesselbrut-Anzeige | Champion-Animationen/Einzigartigkeit → **läuft (Agent Champions)**, Szenario-Trainer, Challenger-Geist |

Nutzer-Entscheidung 2026-10-15: zuerst **Phase 2 abschließen**.

## Umpriorisierung durch den Nutzer (2026-10-15)
Der Nutzer will zuerst einen **funktionierenden Prototypen: 5v5 gegen Bots**. Deshalb werden die Bots vorgezogen –
zunächst nur mit **grober Logik**. Die volle Rang-Simulation aus Spec §7/§8 folgt danach.

### Bot-Prototyp („grobe Logik“) – jetzt
- Läuft im Sim-Worker (gleicher Thread), liest nur den fog-gefilterten Snapshot des eigenen Teams, erzeugt normale Commands.
- Laner: Lane folgen, hinter eigener Welle stehen, grob last-hitten, Gegner-Champion angreifen wenn günstig, Fähigkeiten
  generisch aus den Champion-Daten nutzen (Reichweite/Typ), bei wenig HP zurückziehen, recallen, nach Tod zurück in die Lane.
- Jungler: Camps clearen in fester Route, gelegentlich gank (Lane mit wenig HP-Gegner in Reichweite).
- Support: folgt dem ADC, nutzt Heal/Schild-Fähigkeiten auf Verbündete.
- Rang: nur wenige Parameter aus `src/data/bots/profiles/*.json` (Reaktionszeit, Entscheidungstakt, Last-Hit-Jitter,
  Ziel-Fehler, Fehlerinjektion). Keine Cheats, gleicher Fog.
- Shop: Bots kaufen nach `src/data/builds/<champ>.json` im Brunnen (Item-Stats wirken, Item-Passiva noch nicht).
- Jungle-Camps + einfache Objectives (Monster mit HP/Angriff/Leash/Respawn, Gold/XP), damit Jungler etwas zu tun haben.
- Klassik-Modus in der Lobby: Rolle + Champion wählen, Bot-Rang-Schieberegler, Gegner/Mitspieler rollenkonform besetzt.

### Danach (volle Ausbaustufen)
1. Phase 2 fertig: alle Champion-Hooks (läuft: Agents E/F), Item-Passiva/Aktive, Prägungs-Effekte, Shop-UI.
2. Phase 3 voll: Team-KI (Desires, Win-Condition), Behavior Trees als JSON, Influence Map, Vision/Wards, Debug-Overlay F9,
   Bot-Sim-Harness `npm run bot-sim` mit CSV gegen Tabelle A.
3. Phase 4: alle Rangprofile kalibriert (±10 % Tabelle A), Humanisierung (Tilt, Persönlichkeit, Pings/Chat), Rang-Siege-Quoten.
4. Phase 5: Trainer (Dodge, Last-Hit, Kiting/Combo, Sandbox komplett, Lane-/Jungle-Duell, Teamfight-Arena), Post-Game-Analyse.
5. Phase 6: Art-Pass, Sound (prozedural), Barrierefreiheit, PWA, Performance, Szenario-Trainer, „Was ein Challenger getan hätte“.

## Offene Punkte aus Phase 1
- Abnahme „107 CS in 10 min“: erledigt – 107 Minions kommen an, Skript-Last-Hitter ≥ 60 (tests/phase1.test.ts).
- Fog: Projektile/Events werden gefiltert; Bots dürfen nur Snapshot-Daten lesen.
