# Spec: Bot-KI-Verhalten (Ganks, Roams, Spielstile)

Vom Nutzer am 15.10.2026 vorgegeben (Alexander Weitz). Gilt zusätzlich zu Hauptprompt §7/§8 (Rangprofile Tabelle A/B, Behavior Trees, Influence Map, Worker). Hier steht, was in den Knoten passiert.

## 1. Rolle und Grundregeln
Zwei getrennte Dimensionen pro Bot:
1. **Rang** (Iron–Challenger, Skill 0–100): wie gut entschieden und ausgeführt wird (Reaktionszeit, Fehlerquote, Tracking-Tiefe, Vorhersage).
2. **Spielstil** (zehn Achsen, je −5 bis +5): welche Entscheidungen bevorzugt werden, wenn mehrere gut sind. Aggressiver und passiver Challenger sind beide stark, aber erkennbar anders; aggressiver und passiver Iron sind beide schwach, sterben aber an unterschiedlichen Fehlern.

Grundregeln:
- **Keine Allwissenheit.** Bot handelt nur auf Basis seines Wahrnehmungsmodells (§3). Ungesehenes = Schätzung mit Unsicherheit. Testbar: Entscheidungslog enthält nie eine Gegnerposition, die sein Team nicht gesehen hat.
- **Erst korrekt, dann menschlich.** Jede Regel zuerst als „richtige“ Entscheidung; Rang und Stil verschlechtern/verschieben danach (Verzögerung, Auslassen, Schwellen). Nie umgekehrt.
- **Jede Entscheidung ist begründet.** Log-Eintrag pro Entscheidung (tick, bot, node, inputs, score, chosen, reason), sichtbar im Debug-Overlay (F9) und im Replay. Pflicht.
- **Hysterese.** Laufendes Verhalten bekommt 10–25 % Bonus (rangabhängig, Gold hoch, Challenger niedrig).
- **Kein Rubber-Banding, keine Boni.**
- **Reaktionszeit vor jeder Aktion** (log-normal aus Rang). Vorhersagen (§3) sind der einzige Weg, schneller zu sein.

## 2. Spielstil-Profile: zehn Achsen (ganzzahlig −5..+5)
Anzeige in Lobby und Scoreboard als Skala mit Marker:
```
Trades        kurz   --x-------  lang
Kiting        Profi  ---------x  keins
Aggression    passiv ------x---  all-in
```
Achsen sind Präferenzen, keine Skills; Rang bestimmt die Ausführung. „Kiting: Profi“ bei Silber = versucht jeden Auto zu orbwalken, 140 ms Jitter macht es mittelmäßig. „Kiting: keins“ bei Challenger = steht beim Angreifen, obwohl er könnte.

| # | Achse | −5 (links) | +5 (rechts) | Wirkung im Code |
|---|---|---|---|---|
| 1 | Trade-Länge | kurz: eine Rotation, dann raus | lang: bleibt bis CDs zweimal durch | Trade-Abbruch (§6): links nach erstem Combo-Ende oder 2 s, rechts erst bei HP-Verhältnis < 0,8 oder 7 s. Links tradet häufiger (Trade-Fenster-Schwelle −20 %). |
| 2 | Kiting | Profi: Orbwalk bei jedem Auto, Attack-Move, Abstand | keins: steht beim Angreifen, läuft erst bei Gefahr | Orbwalk-Wahrscheinlichkeit 100 % → 0 %; Spacing-Zielabstand Reichweite − 50 → − 250; Kite-Back gegen Nahkämpfer ja/nein |
| 3 | Aggression | passiv: farmt, nur sichere Kills | all-in: sucht Kills, dived, forciert | Gewicht Kampf-Subtree × 0,6 → × 1,6; Dive-Toleranz ±15 Pp; Tower-Dive-Erlaubnis; Chase-Wahrscheinlichkeit ±25 Pp |
| 4 | Roam-Neigung | bleibt in Lane | roamt nach jedem Shove, folgt Jungler | Roam-Desire-Grundwert 0,1 → 0,7; Side-Lane-Verlassen-Schwelle; Support-Lanebindung an ADC 90 % → 40 % |
| 5 | Risiko bei Objectives | wartet auf Prio, Vision, Zahlenvorteil | startet ohne Vorbereitung, stiehlt | Objective-Start-Sicherheits-Score 0,8 → 0,3; Steal ja/nein; Baron bei Gleichstand |
| 6 | Farm-Priorität | Kills/Fights vor CS | CS vor allem, lässt Fights aus | Gewicht Laning/Clear vs Skirmish-Hilfe; Reaktionsschwelle auf „Auf dem Weg“-Pings; bei +5 kommt Bot erst nach Wellen-Clear |
| 7 | Vision-Fleiß | wardet nur erzwungen | wardet früh, oft, räumt | Ward-Intervall × 2 → × 0,5; Siegelward-Kaufschwelle; Sweeper-Nutzung |
| 8 | Mobilität/Ressourcen | spart Flash/Dashes/Ults | setzt sie offensiv ein | Flash-Offensiv-Erlaubnis; Dash-als-Engage-Gewicht; Ult-Schwelle (Killwert) 0,9 → 0,4 |
| 9 | Teamorientierung | solo: eigenes Spiel, Splitpush | team: gruppiert, folgt Calls/Pings | Gewicht group_mid/split_push; Ping-Gehorsam 30 % → 95 %; Teamfight-Beitritt-Latenz |
| 10 | Tempo | langsam: wartet, recallt oft | schnell: shove-and-roam, Timings | Recall-Schwelle; Makro-Neubewertung × 1,5 → × 0,7; Welle für Objective opfern |

Kombinationsregeln:
- 0 = neutrales Rang-Standardverhalten. Achsen skalieren Parameter linear; ±5 darf sichtbar unvernünftig sein (gewollt).
- Achsen beeinflussen sich (Aggression +4 & Trade +4 = all-in bis einer stirbt; Aggression −4 & Roam +4 = Support, der roamt, aber nicht engaged: wardet, setzt Vision, geht zurück). Alle Kombinationen spielbar, kein Deadlock.
- Rang begrenzt die Ausführung, nie die Präferenz (Iron mit Tempo +5 versucht Shove-and-Roam und verpasst Last-Hits).
- Zufällige Vergabe ohne Spielervorgabe: rangabhängige Verteilung. Iron σ = 2,5 (viele ±4/±5), Challenger σ = 1,2, Kiting nie schlechter als −3 ... (Achtung: Kiting −5 = Profi, also „nie schlechter“ heißt nie Richtung „keins“ über +3), Vision nie schlechter als 0.
- Champion-Bias in den Champion-Daten (Renn: Aggression +2, Roam +2; Lysa: Farm +2, Kiting +2 Richtung Profi; Old Harrow: Team −3, Tempo +1). Gewürfelte Werte werden verschoben, manuell gesetzte nicht.

Archetypen (Lobby-Presets, danach einzeln verstellbar):

| Archetyp | Trade | Kiting | Aggr | Roam | ObjRisiko | Farm | Vision | Ressourcen | Team | Tempo |
|---|---|---|---|---|---|---|---|---|---|---|
| Der Farmer | −2 | +2 | −3 | −4 | −2 | +5 | 0 | −2 | −1 | −1 |
| Der Duellant | +4 | +3 | +4 | −3 | 0 | −1 | −2 | +3 | −4 | 0 |
| Der Roamer | −3 | 0 | +2 | +5 | +2 | −3 | +2 | +2 | +3 | +4 |
| Der Vorsichtige | −4 | +1 | −4 | −1 | −5 | +1 | +3 | −4 | +2 | −3 |
| Der Int-Bot (Iron-Klassiker) | +5 | −5 | +5 | +1 | +4 | −4 | −5 | +5 | −3 | +2 |
| Der Shotcaller | −1 | 0 | 0 | +2 | +1 | 0 | +4 | 0 | +5 | +3 |
| Der Splitpusher | 0 | +1 | −1 | −5 | −3 | +3 | +1 | −1 | −5 | +2 |
| Der Pro-Standard | 0 | +4 | +1 | +1 | 0 | +1 | +2 | +1 | +2 | +3 |

(Hinweis Lead: Die Tabelle nutzt die Achsenrichtung wie oben definiert; bei Kiting ist −5 = Profi. Beim Int-Bot −5 = Profi-Kiting wirkt widersprüchlich zur Beschreibung „Iron-Klassiker“; wir behandeln die Archetyp-Werte wie angegeben und dokumentieren die Auffälligkeit in docs/DECISIONS.md.)

Lernende Anpassung (optional, nach Phase 4): Bots ab Platin verschieben Achsen im Spiel um bis zu ±2, wenn der Stil nicht funktioniert (drei verlorene Trades in Folge → Trade −1, Aggression −1). Challenger passen sich an den Spieler an (zweimal zuerst angegriffen → „Spieler aggressiv“ → Bot baitet). Jede Anpassung geloggt und im Post-Game angezeigt.

Anzeige: Scoreboard (Tab) zeigt neben jedem Bot Rang und zehn Mini-Skalen. Post-Game schätzt die Achsen des Spielers (Trade-Dauer, Orbwalk-Quote, Roam-Häufigkeit ...).

## 3. Wahrnehmungsmodell
PerceptionState pro Bot und Entscheidungstakt aus dem Team-Sichtzustand; einzige Eingabe des Behavior Trees.
- **Nahbereich** 1.400 um den Champion: alles Team-Sichtbare sofort (nach Reaktionszeit).
- **Minimap**: Sichtbares außerhalb nur beim „Minimap-Blick“ (Intervall aus Rangprofil, Iron 25 s, Challenger 2 s) plus erzwungene Blicke: eigener Ping, Verbündeten-Ping (ab Silber), Kill-Feed, Objective-Spawn (ab Gold), Recall (immer).
- **Audio-Cues**: Cast-Sounds in 1.800 Einheiten als Ereignis „Gegner castet X Richtung Y“, auch ohne Sicht. Ab Platin zur Vorhersage genutzt.

**EnemyTrack** pro Gegner: letzte Position, Zeitstempel, Richtung, Level, HP-Schätzung, Items (ab Gold beim Scoreboard-Blick), bekannte Cooldowns (Flash, Ult, Hauptfähigkeit; nur wenn gesehen/gehört und Rang Tracking erlaubt). Nach Sichtverlust **Wahrscheinlichkeitswolke**: Zentrum entlang letzter Richtung zu plausiblen Zielen (Camp, Lane, Recall-Pfad), Radius wächst mit Tempo × Zeit, Gewicht sinkt. Iron nutzt keine Wolke; Gold 30 s; Diamant 90 s; Challenger bis zum nächsten Kontakt, korrigiert mit Camp-Timern und Minion-Zählung.

**Jungler-Modell**: Challenger startet bei 1:30 (Leash-Seite → Startbuff → Clear-Pfad → Gank-Lane bei 3:15, meist Gegenseite des Startbuffs). Jede Sichtung setzt neu. Ausgabe pro Lane: Gank-Wahrscheinlichkeit nächste 20 s aus Wolken-Nähe, Lane-Zustand (Welle gegnerseitig erhöht), HP eigener Laner, Flash-Status, Pfad-Timing, Muster (nach Full-Clear und Objectives). Rang-Eingaben: Iron/Bronze keins; Silber Sichtungen; Gold + Wellenzustand; Platin + Timer; Diamant + Pfadvorhersage; Challenger + Leash und CS-Zählung (12 CS ≈ 3 Camps).

**ThreatMap** (Influence-Map-Layer): sichtbare Gegner (Reichweite + Fähigkeitsreichweite + Flash-Reichweite wenn bereit), Wolken gewichtet, gegnerische Türme, Fog-Unsicherheit (unbewardete Büsche mit Grundbedrohung, ab Silber wachsend). Iron hat fast leere Karte → läuft in Büsche.

**Vorhersage** (ab Platin, Wahrscheinlichkeit „Vorhersage-Dodge“): Cast-Animation, Blickrichtung, Abstand → Fluglinie vor dem Projektil. Hook-Champions (Gorvam, Tobin): Muster der letzten 3 Casts (aktuelle Position vs Bewegungsrichtung). Challenger wechselt sein Dodge-Muster.

## 4. Gank-Handling
### 4.1 Als Gegankter: Gefahr erkennen
GankRisk (0–1) der Lane jeden Takt. Schwellen rang-/stilabhängig (Aggression +5 hebt jede Schwelle um 0,15, Vorsichtig senkt).

| Risiko | Verhalten (Gold, Stil 0) |
|---|---|
| < 0,2 | normales Laning, Welle darf gepusht werden |
| 0,2–0,4 | keine neuen langen Trades; Zielposition 200 zur eigenen Seite; Ward setzen wenn Ladung und Spot unbewardet (Vision-Achse verschiebt) |
| 0,4–0,7 | nicht mehr pushen (Freeze/Hold), Trade nur bei Killsicherheit > 0,9, in Flash-Reichweite zum Turm, Vermisst-Ping wenn Jungler-Wolke nah |
| > 0,7 | Rückzug unter Turm, Last-Hits nur unter Turm, Recall wenn Welle gegnerseitig |

Rang: Iron/Bronze kein GankRisk (reagieren erst bei Jungler im Nahbereich). Silber reagiert auf Sichtungen 8–15 s verspätet. Gold richtig, außer Welle ist „gut“ (Belagerer in Reichweite → bleibt mit 60 %). Platin+ korrekt; Diamant+ crasht vorher die Welle (Shove-and-Back bei 15 s Vorwarnung).

### 4.2 Als Gegankter: Gank läuft
Auslöser: Jungler/roamender Laner im Nahbereich oder Busch-Audio-Cast. Nach Reaktionszeit Escape-Knoten:
1. Lage bewerten (1 Takt): Gegnerzahl, deren CC (bekannte CDs), eigene HP, Turmabstand, eigene Flucht, Flash, eigener Jungler (Wolke), Welle.
2. Kann ich gewinnen? ExchangeEstimate 2v1/2v2 (eigener Jungler in 8 s). > 0,6 → Fight; Aggression: −5 → 0,85, +5 → 0,4. Iron–Silber würfeln 50 % Fight.
3. Fluchtroute: Pfad zum Turm mit minimalem ThreatMap-Integral; sonst Richtung eigener Jungle. Richtungswechsel alle 0,4–0,8 s gegen Skillshot-Verfolger (ab Gold; Challenger juked nach Cast-Animation).
4. Ressourcen: Bewegungs-Buffs (Geist, E-Dashes) vor Flash; Flash nur wenn (a) CC-Cast beginnt, der sonst trifft, oder (b) sicherer Punkt ohne Flash nicht erreichbar (Pfadlänge/Tempo > Zeit bis Tod). Ressourcen-Achse −5: nur (a); +5: schon bei 0,5 Gefahr. Iron flasht zu spät oder in Terrain (Fehlerinjektion „Flash-Fehlrichtung“ 15 %), Diamant+ flasht über Wände wenn Wand näher als Turm.
5. Heilen/Schild/Zeitglas bei HP < 35 % und Burst (Zeitglas nur wenn Verbündeter in 6 s oder Gegner-CDs ablaufen; ab Platin).
6. Turm als Waffe: unter Turm umdrehen, wenn Gegner Turm-Aggro hat; Dive neu bewerten (Turmschaden zählt).
7. Ping „Gefahr“ beim ersten Kontakt, „Hilfe“ bei Fight. Iron 10 %, Diamant 90 %.
Nach dem Gank: überlebt → Recall neu bewerten; gestorben → Tilt +1, EnemyTrack Jungler aktualisieren (nächstes Ziel), ab Gold „Vermisst“-Ping Richtung Jungler.

### 4.3 Als Jungler: Gank-Entscheidung
Alle 5 s (Tempo skaliert) Gank-Score pro Lane (0–1):
- Welle gegnerseitig oder Gegner über Lane-Mitte +0,3; unter eigenem Turm −0,3.
- Ziel-HP < 60 % +0,2; < 35 % +0,35.
- Flash verbraucht (bekannt) +0,25; Fluchtfähigkeit auf CD +0,15.
- Eigenes CC +0,15; Laner hat CC +0,15; Laner-HP > 50 % +0,1.
- Weg > 12 s −0,3; Pfad durch bekannte Wards −0,25.
- Gegner-Jungler-Wolke selbe Seite −0,2; Gegner-Jungler andere Seite gesehen +0,15.
- Objective-Timing (Prio für Objective in 60 s) +0,2 (ab Gold).
- Laner hat zuletzt auf Pings reagiert +0,1 (Spieler gleich).
Gank bei Score > 0,55; Aggression ±0,15; Iron > 0,3 (und zufällig), Challenger ab 0,6 mit vollen Eingaben. Ausführung: Anlauf durch Busch/Fluss (min. Sichtbarkeit, ab Silber), Engage laut Champion-Combo, Ziel = höchste Killwahrscheinlichkeit. Abbruch bei Flash des Ziels und Killwahrscheinlichkeit < 0,3 (Iron chased trotzdem). Teilerfolg (Flash erzwungen, Welle gewonnen) wird geloggt.

### 4.4 Counter-Gank und Gegen-Hilfe
- Jungler/Mid halten Hilfsradius (Jungler 20 s Weg, Mid 12 s); hin, wenn ExchangeEstimate 2v2/3v3 > 0,5 (Team-/Farm-Achse). Gold mit 5 s Latenz, Diamant sofort.
- Challenger-Jungler „Shadowing“: präventiv auf der Seite der gegnerischen Jungler-Wolke, wenn eigener Laner dort gepusht hat.
- Keine Hilfe, die bei Ankunft entschieden ist (Ankunft > Lebenszeit Verbündeter + 1 s → Trade woanders). Silber und darunter laufen trotzdem (bewusst).

## 5. Roam-Handling
### 5.1 Eigener Roam (Mid, Support, ab 20:00 auch Top)
Nach jedem Wellen-Clear Roam-Score pro Ziel (Lane, Objective, Invade):
- Voraussetzung (außer Roam ≥ +4): eigene Welle in gegnerischen Turm gecrasht oder auf eigener Seite gefroren. Iron–Silber roamen von pushender Welle weg (Fehlerinjektion „Roam vom Push“ 30 %).
- Ziel-Lane: Gegner über Mitte +0,3; Gegner-HP < 50 % +0,25; Verbündeter hat CC +0,15; Gegner-Flash weg +0,2; eigener Jungler unterwegs +0,25.
- Weg > 15 s −0,3; durch bekannte Wards −0,25 (Diamant+ Pfad hinter Wards).
- Kosten: gegnerischer Mid folgt wahrscheinlich −0,15; eigener Turm unter Platten-Druck −0,2; Objective in 90 s auf anderer Seite −0,3.
- Support: nur wenn ADC nicht in Gefahr (GankRisk Bot < 0,3) und kein Belagerer in 20 s; Ziele: Vision (Fluss-, Pit-Ward) und Mid-Gank; Roam −5 bindet Support zu 90 % an ADC.
Roam bei Score > 0,5 (Roam ±0,2; Tempo ±0,1). „Auf dem Weg“-Ping (ab Silber), Pfad min. Sichtbarkeit, Engage über 4.3. Abbruch, wenn Ziel-Laner sich zurückzieht bevor 1.200 erreicht (dann Ward setzen, zurück). Rückkehr: Welle am eigenen Turm → zurück; Welle beim gegnerischen Turm → Recall bei Gold-Schwelle, sonst über Jungle mit Ward-Stopp zurück.

### 5.2 Reaktion auf gegnerischen Roam
Auslöser: gegnerischer Laner verschwindet aus dem Nahbereich oder Verbündeter pingt „Vermisst“.
1. Eigener Vermisst-Ping: Iron nie; Silber nach 10 s; Gold nach 5 s; Diamant+ sofort beim Sichtverlust mit Richtungs-Ping (außer Welle läuft in eigenen Turm → Recall-Wolke).
2. Wolke: Ziele Mid-Roam, Side-Roam, Recall, Invade, gewichtet nach Position, Welle (gecrasht → Roam wahrscheinlich; Welle bei ihm → Recall) und geschätztem Stil (5.3).
3. Reaktion nach Rolle:
   - Mid, gegnerischer Mid roamt: Folgen (Weg < 8 s, HP > 60 %), Bestrafen (Welle crashen, Platten/Turm; Standard ab Gold bei Weg > 8 s oder Seite unklar), nur Ping (Iron/Bronze). Team → Folgen, Farm → Bestrafen. Challenger folgt nur mit sicherer Richtung, sonst Bestrafen + Vermisst-Ping.
   - Side-Laner: GankRisk steigt, Reaktion wie 4.1. Gold ignoriert Vermisst-Pings zu 40 %, Platin+ zuverlässig.
   - Jungler: Roam Richtung eigener Lane → Counter-Gank (4.4); weg → Invade auf freie Camps (Objective-Risiko) oder Objective-Start.
   - Support, gegnerischer Support roamt: 2v1 in Lane → Welle crashen, Platten (ab Gold), Vision in den Fluss.

### 5.3 Stil-Schätzung des Gegners (ab Platin)
Jeder Bot schätzt die zehn Achsen jedes Gegners (auch des Spielers) aus Trade-Dauer, Orbwalk-Quote, Roam-Häufigkeit, Wards, Flash-Nutzung. Fließt in Roam- und Gank-Score. Challenger ab Minute 4, Platin ab 10 und ungenauer. Anzeige im Post-Game („Die Bots haben dich als Aggression +3, Roam −2 eingeschätzt.“).

## 6. Trade- und All-in-Logik
**ExchangeEstimate** für Horizont T (kurz 3 s, lang 8 s, All-in bis Tod), beide Seiten: verfügbare Fähigkeiten (bekannte CDs; unbekannte rangabhängig als bereit: Iron alles bereit, Challenger schätzt), Autos × AS × T × Orbwalk-Faktor, Minion-Schaden (Aggro-Regeln), Turm, Items, Level-Differenz, Heilung/Schilde → winProb (HP-Verhältnis nach T), killProb, deathProb. Rang-Rauschen: Iron ±40 %, Gold ±20 %, Challenger ±7 %.

**Trade-Fenster** (alle erfüllt; Aggression lockert je eine Bedingung pro Stufe über +2):
- Gegner in Combo-Reichweite oder in 0,5 s drin.
- GankRisk < 0,5.
- Minion-Aggro-Bilanz: Bot steht nicht in gegnerischer Welle oder Gegner in seiner (ab Silber; Iron/Bronze ignorieren → „kämpft in der gegnerischen Welle“).
- Auslöser (einer): Gegner geht für Last-Hit vor (CS-Fenster, ab Diamant), Gegner hat Hauptfähigkeit verbraucht (Punish 6–8 s, ab Gold), eigener Power-Spike (Level 2/3/6 zuerst), Gegner-HP < 50 % mit Killchance, Zufall (Bronze „tradet, sobald CDs bereit“ = Auslöser 70 %).
- winProb > Schwelle: 0,55; Aggression ±0,15; kurze Trades (−5) senken auf 0,45.

**Ausführung**: Combo aus Champion-Daten (Poke/Trade/All-in), Rang entscheidet situativ vs Standard.
- Abbruch (Trade-Achse): −5 nach Combo-Ende oder 2 s, dann Disengage mit Orbwalk; Mitte bei winProb < 0,5 oder HP < 40 %; +5 erst bei HP-Verhältnis < 0,8 oder 7 s, bevorzugt All-in bei killProb > 0,5.
- All-in: killProb > 0,6 und deathProb < 0,25 (Aggression ±0,1 pro Stufe). Flash offensiv (Ressourcen ≥ 0, Rang ≥ Gold) nur wenn Flash killProb um > 0,3 hebt. Entflammen bei All-in ab killProb > 0,7 (Iron beim ersten Trade).
- Disengage: Orbwalk rückwärts hinter eigene Welle Richtung Turm; Kiting-Achse bestimmt Qualität.
- Gegen Dive: Turmschaden zählt; 2 Gegner → Turm-Tanken, Flash raus oder zurücktraden (ab Platin korrekt; Gold Fehlerinjektion „Flash in Dive statt Turm-Dance“ 40 %).

**Benannte Fehlerinjektionen** (im Log markiert, für Post-Game): `trade_on_cooldown` (Bronze), `fight_in_enemy_wave` (Iron–Silber), `ignore_minion_aggro` (Iron–Silber), `no_flash_tracking` (bis Smaragd 50 %), `chase_third_kill` (Gold), `flash_into_wall` (Iron–Bronze 10 %), `overcommit_after_kill` (Iron: Dive mit 20 % HP). Dazu aus anderen Abschnitten: `flash_wrong_direction` (Iron 15 %), `roam_from_push` (Iron–Silber 30 %), `flash_in_dive` (Gold 40 %), `carry_too_far` (Gold), `late_recall` (Iron), `idle_after_shove` (Gold 40 %).

## 7. Kiting, Orbwalking, Positionierung
**Orbwalk-Zyklus**: Bot kennt Wind-up und Treffpunkt bei aktueller AS. Nach Treffpunkt Bewegungsbefehl zur Kite-Position, neuer Angriff sobald bereit. Timing-Jitter (Iron 220 ms, Challenger 35 ms) auf den Bewegungsbefehl; negativer Jitter bricht den Angriff ab (Auto verloren), positiver verschwendet Backswing. Kiting-Achse = Orbwalk-Wahrscheinlichkeit pro Auto (100 % bei −5, 0 % bei +5).
**Spacing**: Zielabstand = eigene Reichweite − Puffer (−5: 50, +5: 250). Gegen Nahkämpfer mit Gap-Closer: Abstand = Dash-Reichweite + 100 solange Dash bereit (nur mit CD-Tracking, sonst konstante Angst/Sorglosigkeit je Aggression). Kite-Richtung entlang ThreatMap-Gradient, nie in Büsche ohne Vision, nie über die gegnerische Welle hinaus.
**Skillshots beim Kiten**: Dodge vor Orbwalk; Auto abbrechen, wenn Projektil Position in < 0,4 s trifft. Vorhersage verschiebt Kite-Richtung beim Wind-up.
**Teamfight-Positionierung**:
- Carry (ADC, Mage): Zielzelle maximiert erreichbare Ziele minus Bedrohung; hinter mindestens einem Frontliner; bekannte gegnerische Ults > 900 Reichweite zählen. Gold steht 150 zu weit vorn (`carry_too_far`), Diamant korrekt, Challenger antizipiert Flanken.
- Frontline: zwischen Carries und Gegnern; Engage über ExchangeEstimate 5v5, 6 s.
- Assassine: wartet auf Flank (Busch/Terrain) bis gegnerische CCs verbraucht oder Fight 2 s läuft; Aggression −5 wartet zu lange, +5 springt sofort.
- Support: Peel auf Carry mit höchstem Schadensanteil; Engage nur mit Follow-up (Team in 500).
- Fokus-Ziel: Killwahrscheinlichkeit × Bedrohung × Erreichbarkeit; Spieler-Fokus-Ping +0,3 (Team-Achse).
**Last-Hitting unter Druck**: bei GankRisk oder Gegner in Trade-Reichweite nur wenn Minion-HP ins Auto-Fenster passt und Gegner keine bereite Poke-Fähigkeit hat (ab Diamant). Gold nimmt immer („verwundbar beim Last-Hitten“). Farm +5 nimmt selbst bei hoher Gefahr.

## 8. Recall, Wellen, Objectives, Teamfights
**Recall-Score** (alle 5 s): Gold ≥ nächstes Item +0,4 (Schwelle aus Profil, Tempo senkt); HP < 35 % +0,4; Mana < 15 % +0,2; Welle gecrasht +0,3; Welle läuft auf eigenen Turm −0,4; GankRisk > 0,5 +0,2; Objective in 60–90 s +0,2 (wenn rechtzeitig zurück), < 45 s −0,3; Tempo ±0,1; Farm −0,1 pro Stufe über +2. Recall ab 0,6. Iron nur bei HP < 25 % oder zufällig (`late_recall`), Gold shovet und steht im Fluss (`idle_after_shove` 40 %), Diamant+ Shove-and-Recall und Cheater-Recall Welle 2–3.
**Wellen-Zustand** (ab Silber, Qualität „Wave-Zustand bewusst gewählt“): Freeze wenn Gegner hinten und eigener Jungler nicht nah; Slow-Push vor Recall/Roam/Objective; Crash vor Recall oder bei Gegner-Abwesenheit; Hold bei Gank-Gefahr. Tempo langsam → Freeze, Roam hoch → Slow-Push/Crash.
**Objective-Start** (Jungler, Team-KI-Desires): Sicherheit = Prio × Vision × Zahlenvorteil × Smite-Vorteil. Schwellen: Gold Drache 0,4 ohne Prio, meidet Baron unter 0,9; Diamant 0,6/0,7; Challenger 0,65/0,65 und Vorbereitung 60 s vorher. Objective-Risiko ±0,25. Steal: Objective-Risiko ≥ +3 und Rang ≥ Platin: Pit-Rand mit Flash, Smite bei HP ≤ Smite-Schaden (Erfolg am Reaktionsjitter).
**Objective-Konversion** nach gewonnenem Skirmish (≥ 2 Gegner tot/zurückgedrängt): Team-KI bewertet Turm/Platten, Drache, Kesselbrut, Baron, Invade. Konversion aus Profil (Iron 15 %, Challenger 95 %); sonst rangtypisch: Iron chased, Silber recallt, Gold steht herum (Idle 8 s), Smaragd forciert Baron ohne Sicht.
**Teamfight-Beitritt**: Ankunft < geschätzte Fight-Dauer und ExchangeEstimate > 0,45 (Team ±0,15). Gold 5 s Latenz, Challenger in 2 s und trennt sich von aussichtslosen Fights (Trade auf der anderen Seite).
**Splitpush**: Team ≤ −3 oder Old Harrow: Side-Lane pushen bei Teleport bereit oder Zwang zu 1v1/2v1-Antwort; Rückzug bei 2+ Gegnern in der Wolke auf dem Weg (ab Platin). Challenger-Splitpusher zieht zwei und pingt das 4v3.

## 9. Interaktion mit dem Spieler
Mitspieler sollen sich wie Teammates anfühlen, nicht wie Begleiter.

| Ping | Reaktion |
|---|---|
| Auf dem Weg (Lane/Gegner) | Jungler/Roamer plant Gank mit (+0,25, Ankunft synchronisieren, wartet im Busch, ab Gold); Laner hält Welle (Hold), tradet nicht vorher |
| Gefahr / Zurück | verlässt Zone, wenn Grund nicht selbst sichtbar; Gehorsam per Team-Achse 30–95 %; Challenger prüft Sinn, sonst Gegen-Ping „Alles OK“ |
| Vermisst | EnemyTrack „unbekannt, Richtung aus Ping“; GankRisk aller Lanes neu; Iron ignoriert 60 % |
| Hilfe | Hilfsradius (4.4) mit +0,15 |
| Objective | Objective-Desire +0,3, Laner bauen Prio (Shove), Jungler wardet (Vision-Achse) |
| Fokus auf Gegner | Zielscore +0,3 |
| Gruppieren | group_mid +0,3, Splitpusher brechen ab wenn Team > −2 |

Follow-up ohne Ping: Engaged der Spieler (CC, Dash in Gegner), bewerten Bots in 800 den Fight neu (Reaktionszeit, ExchangeEstimate mit Spieler-Beitrag); Follow-up bei > 0,45 (Team-Achse). Iron folgt 50 % zufällig; Challenger folgt jedem guten Engage und keinem schlechten, pingt „Zurück“ vor schlechtem Engage, wenn er den Dash-Cast sieht.
Spielerfehler: Stirbt der Spieler, passen Mitspieler die Lane-Zuweisung an; Gegner ab Gold nutzen die Abwesenheit (Welle crashen, Platten, Objective). Challenger-Gegner bestrafen jeden Fehler messbar.
Kommunikation: ~120 deutsche Chatzeilen nach Rang (src/data/bots/chat.json); Diamant+ callt, Silber flamt (abschaltbar). Jede Chatzeile verweist auf das Log-Ereignis. Keine Reaktion auf Spieler-Chat, nur Pings.

## 10. Datenformat, Interpolation, Tests
Bot-Konfiguration (data/bots/):
```json
{
  "id": "enemy_jungle", "champion": "vessa", "rank": "diamond", "skill": 80, "variance": "normal",
  "playstyle": { "tradeLength": -2, "kiting": 4, "aggression": 1, "roam": 3, "objectiveRisk": 0,
                 "farmPriority": -1, "vision": 2, "resourceUse": 1, "teamplay": 2, "tempo": 3 },
  "personalitySeed": 918273, "archetype": "roamer"
}
```
- skill aus rank (Iron 5, Bronze 15, Silber 30, Gold 45, Platin 58, Smaragd 68, Diamant 80, Master 88, GM 94, Challenger 100), für Divisionen direkt setzbar; Tabelle-B-Parameter linear zwischen den zwei nächsten Profilen interpoliert.
- Jede Achse mappt auf Parameter mit base, perStep, clamp in `data/bots/playstyleAxes.json`; nichts hartkodiert.
- Reihenfolge: Rangprofil → Varianz-Offset → Champion-Bias (nur gewürfelt) → Spielstil-Achsen → Tilt (Laufzeit). Ergebnis: flacher BotParams-Record pro Takt.
- Entscheidungslog: `logs/bots/<game>.ndjson` (im Browser: IndexedDB/Replay), eine Zeile pro Entscheidung: tick, botId, node, inputs (gekürzt), scores, chosen, reason, injectedError?, perceptionAgeMs. Replay zeigt ihn im Debug-Overlay. Max 50 MB pro Spiel, Rotation.

Testfälle (Vitest, Seed fix, grün bevor ein Verhalten fertig ist):
1. Gank-Erkennung: Jungler sichtbar 3:05 im Fluss → Diamant-Laner GankRisk > 0,4 in 1 s; Gold in 8 s; Iron nie > 0,2.
2. Escape: 2v1 unter 50 % HP, Flash bereit, Turm 900 entfernt → Platin flasht bei beginnendem CC-Cast, nicht vorher; Iron flasht in 15 % der Läufe nach dem CC.
3. Gank-Score: Welle gegnerseitig, Ziel 40 % HP ohne Flash → Jungler-Score > 0,7 für Rang ≥ Gold.
4. Roam-Voraussetzung: pushende Welle eigene Seite → Diamant roamt nicht; Iron in 30 %.
5. Trade-Länge: Achse −5 vs +5 → mittlere Trade-Dauer < 2,5 s vs > 6 s über 100 Trades.
6. Kiting: Challenger −5 → Orbwalk-Quote > 95 %; +5 → < 5 %; Silber −5 → 60–80 %.
7. Keine Allwissenheit: 1.000 zufällige Spielstände → kein Log-Eintrag mit Gegnerposition außerhalb Team-Sicht/Wolke.
8. Hysterese: Score pendelt um Schwelle → Moduswechsel höchstens einmal pro 2 s.
9. Objective-Konversion: gewonnenes 5v3 bei 14:00, Drache frei → Challenger nimmt Drache > 90 %, Silber < 35 %.
10. Stil-Kombinationen: 8 Archetypen × 10 Ränge × 5 Rollen 2 Minuten headless ohne Deadlock oder Idle > 10 s.

Abnahme: bot-sim 50 Spiele pro Rang (neutraler Stil) trifft Tabelle A ±10 %; 20 Spiele pro Archetyp auf Gold mit signifikant verschiedenen Stil-Kennzahlen (Trade-Dauer, Orbwalk-Quote, Roams/min, Wards/min, Recalls/min; Effektstärke d > 0,8 Farmer vs Roamer bei Roams). Blindtest: 10 Replays, Archetyp-Trefferquote > 60 % (Nutzer-Aufgabe).
