# Prompt: Agenten-Plan und weitere Arbeitspakete (Veilgrounds)

16. Okt. 2026 · Alexander Weitz (Auftrag des Nutzers, wörtlich übernommen; Orchestrierungs-Abweichungen in docs/agents/orchestration.md)

## 1. Zweck

Dieser Prompt deckt alles ab, was nicht das Bot-Gehirn ist: Sim- und Sichtfehler, Mechanik-Feinschliff, Fähigkeiten-Anzeige, fehlende LoL-Funktionen und Menüs, Trainer-Reste, Post-Game, Darstellung. Das Gehirn-Rework hat seinen eigenen Prompt (docs/BRAIN-REWORK.md) mit drei Agenten A1–A3 und einem Aufsichts-Agenten; dieser Prompt läuft parallel dazu und darf das Gehirn-Team nicht blockieren.

Quellen für die Aufgaben: docs/ROADMAP.md (Abschnitte „Offen“, „Noch offen“ unter Mechanik-Feeling, „Fähigkeiten-Anzeige“), docs/IST-ZUSTAND.md (jede „Schwach“-Zeile), docs/DECISIONS.md (ponytail-Einträge), Nutzer-Meldungen vom 16.10.: Schleierwards sind für alle sichtbar; viele LoL-Funktionen und Menüs fehlen; manche Fähigkeiten halten den Champion fälschlich an; Scoreboard ohne Objectives und Todestimer; Teleport für Top nach 1.500 Minion-Gold.

Modell-Zuweisung: Höchstens drei Arbeits-Agenten mit Claude Opus 5.5 (B „Sim & Mechanik“, C „UI & Funktionen“, D „Darstellung & Trainer“) und ein Aufsichts-Agent mit Claude Fable 5.1. Zusammen mit dem Gehirn-Team sind das bis zu sechs Arbeits-Agenten; der Aufsichts-Agent ist für beide Prompts derselbe, damit es genau eine Instanz gibt, die main, ROADMAP.md und DECISIONS.md verantwortet. Reicht das Limit nicht für sechs, laufen zuerst A1 (Gehirn), B und C; D startet, wenn einer fertig ist.

Priorität (bei Zielkonflikten gewinnt die höhere Nummer nie gegen die niedrigere):

1. Blocker für das Gehirn: Ward-Sichtbarkeit, Fähigkeiten, die Bewegung fälschlich stoppen, Snapshot-Ergänzungen.
2. Alles, was den Trainingswert für den Spieler erhöht: Scoreboard, Todestimer, Beschwörerzauber-Timer, Trainingsplan, Post-Game.
3. LoL-Funktionslücken (Menüs, Keybinds, Pings, Chat).
4. Mechanik-Feinschliff und Darstellung.

## 2. Aufsichts-Agent (Fable 5.1)

Derselbe Agent wie im Gehirn-Prompt, Abschnitt 12. Zusätzlich für dieses Dokument:

- Führt docs/FEATURE-GAP.md (Abschnitt 5) als Quelle der Wahrheit für Funktionslücken; jede Zeile hat Status, Agent, Aufwand, Trainingsnutzen (1–5).
- Prüft bei jedem Merge von B, ob das Gehirn-Team betroffen ist (Snapshot-Typen, Sichtfilter, Cast-Flags) und informiert A1–A3 über docs/agents/shared-changes.md, bevor gemergt wird.
- Nimmt visuelle Änderungen nur mit Vorher/Nachher-Screenshot aus dem gebauten Spiel ab (1280×720, feste Kameraposition, Dateien unter docs/ist/), nie nach Beschreibung.
- Spielt nach jedem Merge von C oder D eine 5-Minuten-Partie im Browser (Playwright, headless mit Screenshots) und prüft Konsolenfehler, HUD-Überlappungen, Ladezeit.
- Verbote: keine eigenen Features, keine Umpriorisierung gegen Abschnitt 1 ohne Nutzer, kein Merge mit roten Tests oder ohne DECISIONS-Eintrag.

Review-Checkliste pro Merge (als Kommentar im Merge-Log):

1. Welche Zeile aus ROADMAP/FEATURE-GAP schließt der Merge? Zeile aktualisiert?
2. Tests grün, Determinismus-Test grün, Build grün, Bundle-Größe nicht > +5 % ohne Begründung?
3. Neue Werte in Daten (JSON), nicht im Code?
4. UI: Deutsch und Englisch vollständig (src/i18n/de.json, en.json), Keybind änderbar, Farbenblind-Modus geprüft?
5. Betrifft es Bots? Dann Hinweis an das Gehirn-Team und ein bot-sim-Lauf (4 Partien Gold) ohne Verschlechterung.
6. Screenshot vorher/nachher vorhanden?

Statusbericht täglich in docs/agents/status.md, gemeinsam für beide Prompts: pro Agent Stand, Kennzahlen, Blocker, Fragen an den Nutzer. Fragen an den Nutzer werden gesammelt und einmal täglich gestellt, nicht einzeln.

## 3. Agent A: Bot-Gehirn (Verweis)

Agenten A1–A3 arbeiten nach dem Gehirn-Prompt. Hier nur die Schnittstellen zu diesem Dokument:

- A1–A3 benötigen von Agent B bis spätestens Ende ihrer Phase 2: korrekten Ward-Sichtfilter (sonst sind Vision-Score, Gank-Risiko und Pfadwahl der Bots falsch), movesWhileCasting-Flag pro Fähigkeit (sonst sperrt busyUntil Bewegung bei Casts, die keine sind), Snapshot-Felder gegnerischer atkPhase, Minion-Ziel, Turm-Ziel, Plattenanzahl.
- A3 benötigt von Agent C: Scoreboard-Daten für die zehn Spielstil-Achsen und den Rang pro Bot (bereits teilweise vorhanden), Post-Game-Haken für Bot-Log-Ereignisse (injectedError, attention), damit die Fehleranalyse des Spielers dieselben Muster zeigen kann.
- Agent D benötigt von A3 die Kalibrierungs-API (stats/rankCalibration) für den Trainingsplan.
- Keine Datei aus dem Dateigebiet von A1–A3 wird von B, C oder D geändert; Bot-Verhalten, das B/C/D stört (z. B. Bots ignorieren Kesselbrut), wird als Issue an das Gehirn-Team gemeldet, nicht selbst gefixt.

## 4. Agent B: Sim, Sicht, Mechanik, Fähigkeiten (Opus 5.5)

Dateigebiet: src/sim/** (außer Champion-Hook-Dateien, die D für Visuals anfasst: Abstimmung über den Aufsichts-Agenten), src/data/champions/*.json, src/data/map.json, tests/sim/**. Branch sim/b-mechanics. Reihenfolge wie gelistet; B1–B3 sind Blocker für das Gehirn und kommen vor allem anderen.

**B1. Ward-Sichtbarkeit (Bug, Priorität 1).** Schleierwards (Trinket) sind heute für beide Teams sichtbar. Soll: unsichtbar für das gegnerische Team, außer (a) im Radius eines gegnerischen Siegelwards (450), (b) während eines Suchfeuers im Bereich, (c) 3 s nach Enthüllung durch Spähfrucht oder Nyx R, (d) der Ward greift gerade nichts an (Wards greifen nie an, also entfällt das). Siegelwards sind immer sichtbar (wie LoL-Kontrollwards). Umsetzung: Kind.Ward bekommt stealth: true; der Fog-Filter für Snapshots (Spieler und Bots) blendet gestealthte Einheiten des Gegners aus, sofern keine Enthüllung wirkt. Enthüllte gegnerische Wards sind angreifbar (1 HP pro Auto, wie bisher) und werden auf der Minimap mit eigenem Symbol gezeigt. Test: gegnerischer Schleierward außerhalb jeder Enthüllung fehlt im Team-Snapshot; mit Siegelward in 450 ist er drin; nach 3 s Spähfrucht wieder raus. Zusätzlich prüfen: Nyx-Saat, Grimald-Fallen und Lysa-Draht gehören in dieselbe Stealth-Logik (heute laut Roadmap „für Gegner weiter unsichtbar“, aber einheitlich über dasselbe Flag).

**B2. Fähigkeiten, die Bewegung fälschlich stoppen (Priorität 1).** Audit aller 26 Champions × 4 Fähigkeiten + Beschwörerzauber gegen docs/spec-champions.md: Jede Fähigkeit bekommt movesWhileCasting: boolean und eine explizite castTime (0 erlaubt). Regel: Selbst-Buffs, Nächster-Auto-Verstärkungen (*_next_auto: Brom W, Dagny Q, Gorvam W, Harrow W, Lio W, Tobin W, Vessa W, Wren Q, Isolde Q), Stance-Fähigkeiten (Mira Q, Lysa Q, Corvin E-Nachladen, Harrow E, Vessa E, Oleth W, Dagny E, Isolde Passiv), Pet-Befehle (Ottilie W) und Schilde (Thessaly W, Ferris W, Hagen W) unterbrechen die Bewegung nicht. Gezielte Casts und Skillshots haben ihren Wind-up (0,2–0,45 s) und stoppen für dessen Dauer; Kanalisierungen (Renn R, Teleport, Recall) stoppen voll. Dashes/Blinks bewegen. Ergebnis als Tabelle in docs/ability-cast-audit.md. Test: für jede Fähigkeit ein Fall „Bot läuft 600 Einheiten, castet bei 300“ mit erwarteter Ankunftszeit.

**B3. Snapshot-Ergänzungen für Bots** (öffentlich sichtbare Information, nichts anderes): gegnerischer atkPhase und Angriffsziel, Minion-Angriffsziel, Turm-Angriffsziel, Plattenanzahl pro Turm, Kesselbrut-Stacks pro Team, aktive Enthüllungen. Alles, was ein Spieler am Bildschirm sieht, darf hinein; Cooldowns, HP unsichtbarer Einheiten und Ward-Positionen ohne Sicht nicht. Abnahme durch den Aufsichts-Agenten mit dem Gehirn-Team.

**B4. Teleport für Top.** Nach 1.500 Gold aus Minion-Kills (Zähler pro Champion, nur Lane-Minions) wird Teleport als dritter Beschwörerzauber freigeschaltet, Slot F2 (Standard-Keybind T, änderbar), HUD-Slot erscheint mit Ansage. Nur für den Champion, der zu Spielbeginn der Toplane zugewiesen ist (Rolle aus Lobby). Cooldown wie Teleport (360 → 240 s). Bots: Top-Bots nutzen ihn für Lane-Rückkehr nach Recall und ab Gold für Bot-Lane-Fights (Gehirn-Team; B stellt nur die Sim-Seite und ein Event tpUnlocked).

**B5. Mechanik-Feeling, offene Punkte** (ROADMAP „Noch offen“):

- Dashes und Knock-ups mit Flugbogen: Snapshot-Flags dashing/airborne mit Fortschritt 0–1, Render (Agent D) zeichnet Bogen; Animation endet erst mit dem Dash.
- atkStart/atkEnd im Snapshot, damit der Render den Ausholvorgang exakt statt geschätzt zeigt.
- Blickrichtung glätten: Drehung begrenzt auf 180° in ~80 ms (Sim-Seite liefert facing interpoliert oder der Render glättet; Entscheidung dokumentieren).
- Auto-Reset sofort (Dagny Q Cast-Zeit 0,2 s → 0, Reset setzt Angriffstimer auf bereit).
- Fernkampf-Hitbox-Radius 55 → 65 prüfen (Spec sagt 55; LoL-näher wäre 65; Entscheidung mit Nutzer, Default bleibt 55).
- Angriffsbewegung „Ziel am Cursor“ als Option (Player Attack Move Click).
- Seraphyne Passiv: die vier Ability-MS-Buffs haben verschiedene IDs und stapeln (Q+W = +30 % statt 15 %); auf eine Buff-ID vereinheitlichen, Beschreibung korrigieren.
- Treffer-Aufhellung flackert im Teamfight: Sim liefert hitFlash nur für Champion-Treffer und DoT-Ticks gedrosselt (max. 4/s pro Einheit).

**B6. Kesselbrut als Objective:** Radius 70 → 130 oder eigenes Flag epic: true, damit Ansagen und Bot-Team-KI (A2) sie behandeln; Stacks ins Scoreboard (C).

**B7. Ladezeit:** Champion-Atlas braucht 10–12 s unter Last. Ziel < 5 s bei warmem Cache: Atlanten vorgerendert als PNG im Build statt zur Laufzeit „gemalt“ (Build-Schritt tools/bakeSprites.ts), Laufzeit-Malen nur noch als Fallback für Dev. Erster Frame des Hauptmenüs darf nicht dunkel sein (Platzhalter-Hintergrund bis Minions geladen).

**B8. Tests und Abnahme:** Jeder Punkt mit Vitest-Fall; Determinismus-Test und sideMirror.test.ts bleiben grün; Phase-1-Abnahme (107 Minions bis 10:00, Skript-Last-Hitter ≥ 73 CS) bleibt grün; vor jedem Merge npm run bot-sim -- --rank=gold --games=4 ohne Verschlechterung.

## 5. Agent C: UI und fehlende LoL-Funktionen (Opus 5.5)

Dateigebiet: src/ui/** (außer botDebug.ts, das gehört A3), src/game/**, src/i18n/**, src/input/**, docs/FEATURE-GAP.md. Branch ui/c-features.

**C1. Feature-Gap-Audit** (erster Arbeitstag): docs/FEATURE-GAP.md als Tabelle gegen LoL mit Spalten Funktion, LoL-Verhalten, Veilgrounds-Stand (fehlt/teilweise/da), Trainingsnutzen 1–5, Aufwand S/M/L, Agent. Startliste (ergänzen, nicht kürzen): Champion-Auswahl mit Bann-Phase und Rollentausch; Prägungen-Editor mit speicherbaren Seiten; Item-Sets und Empfehlungen pro Champion im Shop; Shop-Rückgängig und Gold-Effizienz-Anzeige; Tab-Scoreboard vollständig (C2); Chat-Befehle /mute, /surrender, /ff, Allchat-Umschalter; Ping-Rad komplett (Gefahr, Achtung, Auf dem Weg, Zurück, Vermisst, Vision erbeten, Objective-Ping mit Timer, Gegenstands-Ping aus dem Inventar, Ping auf Minimap-Türme/Objectives); Kamera (Sperre-Umschalter mit Taste, Geschwindigkeit, Minimap-Skalierung, Minimap links/rechts); Keybind-Editor mit Quick-Cast pro Taste, Quick-Cast-mit-Anzeige, Self-Cast, Level-up-Modifier; Zielrahmen über dem HUD (Portrait, HP, Buffs, Items des anvisierten Gegners); eigene Buff-/Debuff-Leiste mit Tooltips und Restzeit; Todes-Zusammenfassung (da) und Death-Recap-Vergleich mit Challenger-Schatten; Spielstatistik-Graphen im Post-Game; Replay-Browser mit Zeitleiste; Einstellungen HUD-Skalierung, Schadenszahlen an/aus, HP-Leisten-Stil, Gegner-Skillshot-Hervorhebung; Ladebildschirm-Tipps/Lore; Profil mit Verlauf; Lobby-Bot-Konfiguration für alle zehn Slots mit Archetyp-Preset und Achsen-Editor; Pause/Fortsetzen mit Ansage; Surrender-Abstimmung mit Bot-Stimmen; Spielende-Bildschirm mit Statistik und „Nochmal“.

**C2. Scoreboard (Tab):** oben Objective-Leiste beider Teams (Leviathan-Elemente als Icons, Seele, Kesselbrut-Stacks, Schleierwächter-Buff-Restzeit, Türme, Inhibitoren mit Respawn-Timer); pro Spieler Portrait, Level, K/D/A, CS, Gold, Items, Trinket, Beschwörerzauber mit Cooldown (Gegner: Klick startet manuellen Timer, wie LoL), Rang-Icon und zehn Spielstil-Mini-Skalen für Bots (Daten von A3); Vision-Score; Schaden an Champions. Todestimer: tote Spieler beider Teams mit Restzeit als Leiste über der Minimap und als Graustufen-Portrait im Scoreboard.

**C3. HUD-Ergänzungen:** Zielrahmen, Buff-Leiste, Kamera-Hinweis nach dem Tod („Kamera frei: Leertaste“) und Kamera auf letzte Position statt Nebel, Objective-Timer oben Mitte (Leviathan, Kesselbrut, Schleierwächter, Buffs), Minimap-Geist-Icons für letzte bekannte Gegnerposition, Fehlzauber-Meldungen (da) auch für Items.

**C4. Pings und Chat:** Ping-Rad vollständig, Minimap-Pings, Objective-Ping mit Timer-Text, Gegenstands-Ping; Chat-Befehle; Bot-Chat-Zeilen bleiben beim Gehirn-Team, C liefert nur die Darstellung.

**C5. Lobby:** Portrait-Ausschnitte korrigieren (Kopf sichtbar: Ilvane, Seraphyne, weitere prüfen), Bot-Konfiguration pro Slot (Rang, Archetyp, Achsen, Varianz), Bann-Phase optional, Prägungen-Editor, Rollentausch.

**C6. Post-Game:** Graphen Gold/XP/Schaden/Vision über Zeit, Zeitleiste mit Kill-/Objective-Markern (Klick öffnet Replay-Moment), Rang-Kalibrierung pro Kategorie (Daten von A3), Fehlerliste aus dem Bot-Log-Format (gleiche Erkennungs-Muster wie injectedError), „Was ein Challenger getan hätte“ (da) mit bis zu 10 Momenten.

**C7. Einstellungen:** alle Punkte aus C1; Export/Import der Einstellungen als JSON; Sprache DE/EN vollständig (jede neue Zeichenkette in beiden Dateien, Test prüft Schlüsselgleichheit).

Abnahme: Jede Zeile in FEATURE-GAP mit Status „da“ hat einen Screenshot und einen Test (UI-Test mit Playwright oder Unit-Test der Logik). Keine Konsolenfehler in einer 30-Minuten-Partie. Tab-Scoreboard und Todestimer werden vom Aufsichts-Agenten in einer echten Partie geprüft.

## 6. Agent D: Darstellung und Trainer (Opus 5.5)

Dateigebiet: src/render/**, src/stylelab/**, assets/**, src/sim/champions/*.ts nur für visuals-Hooks (Abstimmung mit B über den Aufsichts-Agenten), src/modes/** (Trainer), src/stats/** (Trainingsplan, gemeinsam mit A3s Kalibrierung), docs/style/**, docs/ist/**. Branch art/d-visuals. D startet, sobald ein Agent-Slot frei ist (Abschnitt 1); bis dahin liegen seine Punkte in FEATURE-GAP mit Agent „D“.

**D1. Fähigkeiten-Anzeige vervollständigen** (ROADMAP-Tabelle „Fähigkeiten-Anzeige“, offene Zeile): Einzel-Audit Q/W/E/R/Passiv für die 23 noch nicht geprüften Champions. Fehlende visuals: Oleth-Mauer und Banner, Dagny-Schildwall-Richtung, Hagen-Glocken-Stapel, Corvin-Fass-Ring und Trommel-Munition, Marken-Stapel (Brom-Blutung, Gorvam 4. Angriff, Lysa-Fadenlauf, Lio-Funken, Wren-Glut), Passiv-Stapel und -Abklingzeiten für alle, Tobin-Leine, Kiran-Faden, Aurel-Rückspul-Geist, Ottilie-Hark-Status. Jede Fähigkeit mit eigener Partikel-/Formsprache statt nur Farbe (Roadmap „Fähigkeiten-Effekte individueller“). Test abilityVisuals.test.ts erweitern: jede Fähigkeit mit Zustand hat ein visuals-Objekt.

**D2. Kampf-Lesbarkeit:** Projektile nach Herkunft weiter differenzieren (Turm-Energiestrahl dick und hell wie LoL, Kanonenkugel, Pfeile, Zauberbolzen), CC-Symbole über HP-Balken für alle CC-Typen, HP-Balken-Überlappung lösen (Stapel-Offset oder Minion-Balken dünner), Dash-/Knock-up-Flugbogen (Flags von B5), Treffer-Aufhellung gedrosselt, Blickrichtung geglättet.

**D3. Maßstab und Karte** (Fortsetzung des Scale-Agenten, Stand in DECISIONS „Maßstab“): Minion-Größe relativ zur Lane prüfen (heute „sehr klein“), Lane-Breite 1300–1400 visuell bestätigen, Klippenhöhe reduzieren bis Proportion zum Champion stimmt (Ziel: Klippe ≤ 1,5× Champion-Höhe), Champion-Sprite nicht über Klippenoberseite, Brunnenplatz kleiner oder gefüllt, Buff-Monster imposanter. Vorher/Nachher-Screenshots an festen Kamerapunkten (tools/scratch/shots.ts mit Liste).

**D4. Sprite-Revision** (laufender Agent, lokaler Stand pushen und fortsetzen): Vorher/Nachher-Bilder aller 26 Champions, Minions, Monster nach docs/style-variants.md Variante A mit Werthierarchie-Regel aus C; Silhouetten-Test bei 64 px für alle 26; Fähigkeits-Icons pro Champion unterscheidbar (heute gleiches Motiv in Farben, z. B. Aurel nur Zahnräder): vier verschiedene Motive pro Champion.

**D5. Trainer-Reste** (Phase 5 offen): Trainingsplan aus den Kalibrierungsdaten der letzten 10 Partien (drei Vorschläge mit Modus, Einstellungen, Dauer; Begründung aus der schwächsten Kategorie), Verlauf über mehrere Matches (IndexedDB, Diagramme pro Kennzahl, Streaks), Szenario-Trainer um die Momente aus dem Gehirn-Prompt ergänzen (Welle unter Turm fangen bei Gank-Gefahr, Baron-Call mit Vorsprung, Shove-and-Recall-Timing); Dodge-Trainer-Messwerte prüfen (Reaktionslatenz pro Projektil, Panik-Dodges, unnötige Dodges, Replay der letzten 10 Treffer mit Hitbox).

**D6. Tooltips und Texte:** Beschreibungen der Fähigkeiten von technisch („Linie 1.000, durchdringt“) zu LoL-artig (Satz + Zahlen), Voice-Lines als Text (6 pro Champion), Ladebildschirm-Tipps.

Abnahme: Jede „Schwach“-Zeile aus docs/IST-ZUSTAND.md, die D zugeordnet ist, hat einen Vorher/Nachher-Screenshot und ist im Ist-Zustand aktualisiert; Noten dort neu vergeben (Ziel: Karte ≥ 3,5, Camps ≥ 3,5, Kampf-Lesbarkeit ≥ 4); 60 FPS auf dem Referenz-Laptop bleiben.

## 7. Zuständigkeits-Matrix

| Pfad | Agent | Andere dürfen | Freigabe nötig |
|---|---|---|---|
| src/ai/runner.ts, src/ai/reflex/**, src/ai/plan.ts, src/ai/bot/laning.ts, lasthit.ts, kite.ts, src/ai/harness.ts, tools/botSim.ts | A1 | lesen | – |
| src/ai/utility/**, src/data/bots/values.json, src/ai/bot/macro.ts, trade.ts, exchange.ts, teamfight.ts, teamai.ts, combat.ts, src/ai/roams/**, src/ai/ganks/** | A2 | lesen | – |
| src/ai/humanize/**, src/ai/errors.ts, src/ai/params.ts, src/data/bots/profiles/*.json, errors.json, playstyleAxes.json, archetypes.json, src/ai/log.ts, src/ui/botDebug.ts, docs/BRAIN-IST.md | A3 | lesen | – |
| src/ai/bot/types.ts, src/ai/bot/brain.ts, src/data/bots/tree.json, src/ai/bt/** | gemeinsam A1–A3 | Vorschlag in shared-changes.md | Aufsicht |
| src/sim/** (ohne champions/*.ts-Visuals), src/data/champions/*.json, src/data/map.json, tests/sim/** | B | lesen | Snapshot-Typen: Aufsicht + Gehirn-Team |
| src/sim/champions/*.ts | B (Logik), D (nur visuals) | – | bei Überschneidung Aufsicht |
| src/ui/** (ohne botDebug.ts), src/game/**, src/i18n/**, src/input/**, docs/FEATURE-GAP.md | C | lesen; A3 liefert Daten-APIs | – |
| src/render/**, src/stylelab/**, assets/**, src/modes/**, docs/style/**, docs/ist/** | D | lesen | – |
| src/stats/** | D (Trainingsplan, Verlauf), A3 (Kalibrierung) | – | Schnittstelle rankCalibration von A3 definiert, D konsumiert |
| docs/ROADMAP.md, docs/DECISIONS.md, docs/IST-ZUSTAND.md, docs/agents/**, main | Aufsicht | Agenten liefern Einträge als Vorschlag im eigenen Bericht | – |
| package.json, vite.config.*, CI, Build-Skripte | Aufsicht | Vorschlag | Aufsicht |

Regel: Wer eine Datei außerhalb seines Gebiets braucht, schreibt den gewünschten Diff in docs/agents/shared-changes.md (Datei, Grund, Diff, betroffene Agenten). Der Aufsichts-Agent merged ihn oder lehnt ab, innerhalb eines Arbeitszyklus. Niemand wartet darauf: Bis zur Freigabe arbeitet der Agent hinter einem Feature-Flag oder mit einem lokalen Adapter weiter.

## 8. Ablauf und Abhängigkeiten

Zyklen sind Arbeitsabschnitte, keine Kalenderwochen; ein Zyklus endet, wenn seine Gates grün sind. Die vier Abhängigkeiten sind hart: A1 schaltet Phase 2 erst frei, wenn Bs Blocker (Ward-Sicht, Cast-Flags, Snapshot) auf main sind; A2 schaltet das Nutzenmodell erst scharf, wenn A1s Phase 2 gemergt ist; A3 beginnt das Rang-Tuning erst nach A2s Phase 4; C baut die Spielstil-Skalen und die Post-Game-Fehlerliste erst, wenn A3s Log-Format und Kalibrierungs-API stehen. Alles andere läuft parallel. D startet, sobald ein Agent-Slot frei wird (spätestens nach A1s Phase 2); bis dahin sammelt C die D-Punkte in docs/FEATURE-GAP.md.

Wenn ein Gate rot bleibt, stoppt nur die Spur dahinter; der Aufsichts-Agent entscheidet innerhalb eines Zyklus, ob der Agent nachbessert oder die Zielzahl begründet angepasst wird (Eintrag in DECISIONS.md, Nutzer wird im Statusbericht informiert).

## 9. Arbeitsregeln

- **Branches und Merges:** Ein Branch pro Agent (sim/b-mechanics, ui/c-features, art/d-visuals, brain/a1-reflex, brain/a2-utility, brain/a3-humanize). Agenten rebasen täglich auf main, mergen nie selbst. Merge-Anfrage = Bericht in docs/agents/<name>.md + grüne Tests + Screenshot bei UI/Render. Der Aufsichts-Agent merged in der Reihenfolge der Abhängigkeiten (Abschnitt 8), höchstens drei Merges pro Zyklus pro Spur, damit Regressionen zuordenbar bleiben.
- **Commits:** Kleine, benannte Commits (b1: ward stealth filter, c2: scoreboard objectives). Keine Sammel-Commits über mehrere Arbeitspakete. Jeder Commit baut und lässt npm test grün.
- **Tests:** Jede Änderung mit Test (Vitest für Sim/Logik, Playwright für UI, abilityVisuals.test.ts für Darstellung). Determinismus-Test, sideMirror.test.ts, Phase-1-Abnahme und bot-sim (4 Partien Gold) sind Pflicht vor jedem Merge, der Sim oder Bots berührt.
- **Daten statt Code:** Werte, Schwellen, Texte, Keybinds, Farben in JSON/i18n, nie im Code. UI-Texte in de.json und en.json gleichzeitig; ein Test prüft Schlüsselgleichheit.
- **DECISIONS und ROADMAP:** Jede Abweichung von Spec oder Prompt steht in docs/DECISIONS.md (Thema, Spec, Entscheidung, Grund) im Bericht des Agenten als Vorschlag; der Aufsichts-Agent übernimmt sie beim Merge. docs/ROADMAP.md wird nur vom Aufsichts-Agenten geändert, nach jedem Merge. docs/IST-ZUSTAND.md wird nach jedem D-Merge mit neuen Screenshots und Noten aktualisiert.
- **Definition of Done** für jedes Arbeitspaket: Zeile in ROADMAP/FEATURE-GAP auf „da“, Test grün, Screenshot (wo sichtbar), DE/EN vollständig, kein Konsolenfehler, Live-Build aktualisiert, Bericht geschrieben.
- **Konflikte:** Zwei Agenten wollen dieselbe Datei → shared-changes.md, Aufsichts-Agent entscheidet im selben Zyklus. Agent hält eine Vorgabe für falsch → im Bericht begründen, weiterarbeiten wie vorgegeben, bis der Aufsichts-Agent anders entscheidet. Agent findet einen Fehler außerhalb seines Gebiets → Issue in docs/agents/issues.md (Datei, Repro, Schwere), nicht selbst fixen.
- **Limits und Handoffs:** Stoppt ein Agent durch das Limit, schreibt der Aufsichts-Agent docs/agents/<name>-handoff.md (Branch, letzter Commit, offene Punkte, nächster Schritt, bekannte Fallen) und startet denselben Agenten mit dieser Datei neu. Lokale, nicht gepushte Stände (aktuell: Sprite-Revision Vorher/Nachher-Bilder und eine Doku-Änderung) werden vor jedem Agentenwechsel gepusht; nichts bleibt lokal.
- **Ehrlichkeit:** Kennzahlen werden gemessen, nicht geschätzt; was nicht erreicht ist, steht als nicht erreicht im Bericht. „Funktioniert“ ohne Test oder Screenshot gilt als nicht erledigt.
