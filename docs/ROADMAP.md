# Roadmap (Stand 2026-10-15)

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
- Abnahme „107 CS in 10 min“: Skript-Last-Hitter erreicht aktuell 65 → Ursache wird analysiert (tests/phase1.test.ts).
- Fog: Projektile/Events werden gefiltert; Bots dürfen nur Snapshot-Daten lesen.
