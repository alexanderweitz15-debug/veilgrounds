# Masterplan (Stand 2026-10-23)

Checkliste aller Phasen. `[x]` = fertig und gepusht, `[~]` = teilweise / läuft, `[ ]` = offen.
Zahlen und Begründungen: [docs/DECISIONS.md](DECISIONS.md) · Bot-Spezifikation: [docs/spec-bots.md](spec-bots.md) ·
Ist-Zustand mit Screenshots: [docs/IST-ZUSTAND.md](IST-ZUSTAND.md) · Bot-Gehirn: [docs/BRAIN-IST.md](BRAIN-IST.md) · Live: https://alexanderweitz15-debug.github.io/veilgrounds/

## Jetzt in Arbeit (max. 3 Agents, Nutzerentscheidung 22.10.)
| Agent | Aufgabe |
|---|---|
| A1 (Opus) | Bot-Gehirn Phase 2: Lane-Verhalten (Harass, Poke, Begegnungen auf Reichweite), Shove vor Recall, dann gemeinsamer CS-Durchgang mit Phase 3 |
| F (Fable) | Champion-Identität: eigene Lauf-/Idle-/Angriffsanimationen, Cast-Posen und Effekte je Fähigkeit, mehr Dynamik; epische Monster und Camps passend zur Welt |
| G (Fable) | Spielgefühl + Shop nach docs/IDEAS-FEEL-SHOP.md: Feel-Fixes P1, Item-Schema, Rückgängig, Empfohlen-Ansicht, neue Icons, 40 neue Items, Prägungen Stufe 1 |
| Lead | Masterplan, Merges, Sprite-Licht/-Größe (erledigt 23.10.), Abnahmen |

## Offen (Nutzer-Feedback und Messungen)
- [x] Seiten-Ungleichgewicht: Sim jetzt spiegelsymmetrisch (Test), Bot-Seitenfehler behoben (Ward-Spots, Jungle-Start, Spawn); Seitentausch-Messung Blau 12/24 (DECISIONS „Seiten-Fairness“)
- [ ] Höherer Rang gewinnt nicht klar (Gold vs Silber 5/8, Diamant vs Gold 3/8; Ziel ≳ 65 % / ≳ 80 %) → nach Seiten-Fix weiter offen: Team-Zusammenstellung entscheidet (gleiche Aufstellung gewinnt meist beide Seiten); Profil-Tuning noch nicht gemacht
- [x] Lanes zu lang: Außen-/Innentürme Richtung Fluss, jetzt 3818 / 4808 (DECISIONS „Seiten-Fairness“)
- [x] Toplane (und Botlane, gespiegelt) mit Klippe am Kartenrand + 2 Lane-Büschen, Lane 1300–1400 breit
- [x] Minions jagen Champions höchstens 650 von der Lane weg (CHASE_LEASH), dann zurück
- [x] Champions gleiten an stehenden Einheiten vorbei (tangentiale Kollision)
- [x] Recast nicht sichtbar (Isolde Q hat einen, man sieht ihn nicht), Recast-Reichweite als Kreis → Fähigkeiten-Audit
- [x] Renn: Kreis an jeder Klinge „E kann hierhin dashen“ → Fähigkeiten-Audit
- [x] Isolde E: sichtbarer Draht beim Ranziehen → Fähigkeiten-Audit
- [x] Alle Champions mit sichtbarer, funktionierender Passive: Passiv-Badge im HUD für alle 27 (Test `abilityMotifs` „passive badge"), Wren nachgezogen 16.10.
- [~] Kills ~34 statt 40–60, erster Turm ~18 min statt 12–16
- [~] CS der Bots ~40 % von Tabelle A in Partien (allein auf der Lane 5,6–7,8 CS/min; Verluste durch Abwesenheit)
- [x] Trainingsplan + Verlauf über mehrere Matches (Phase 5): Plan im Trainer-Menü, jede Partie ab 1 min im Verlauf (IndexedDB); Kalibrierung noch lokaler Adapter bis A3-API
- [~] Großes Bot-Gehirn-Rework (docs/BRAIN-REWORK.md; Stand 2026-10-23, main 983e289). Alles auf main; im Spiel nur über den Beta-Schalter „Neues Bot-Gehirn" (Einstellungen, Standard aus): Reflex-Schicht + Nutzenmodell + Aufmerksamkeitsmodell zusammen; Standard-Spiel bit-identisch zum alten Gehirn:
  - [x] Phase 0 Messbasis (A1): bot-sim `--report`, csLossByCause, `--variance=0`, `--scenario=laneAlone`, `--jobs=N` (parallel, ~3-4x schneller), `--brain=new`
  - [x] Phase 1 Reflex-Schicht + Angriffs-Scheduler (A1): nach Nachkalibrierung für Hitbox 65 alle Seeds über dem Gate (Lane allein Iron 79,7 / Gold 95,7 / Challenger 101,3; Ziel 70/88/100), Tests 1-4/11/12 grün; offen: Reflex-Kosten unter Last 0,15 ms (allein 0,04; Ziel 0,05), Test 3 nur vereinfacht
  - [~] Phase 2 Wellenzustände + Harass (A1): Wellenzustände (push/neutral/slowPush/freeze/hold) als Zielbild, Platten bei >= 3 tankenden Minions, Harass-Budget, Trade-Gelegenheit bei gegnerischem Last-Hit/Cast, Tests 5/6 grün; **Gate weit offen**: Harass 14 Autos je Laner bis 14:00 (>= 40), Kills 11 (>= 42), CS/min 3,27 (>= 5,0); Ursache: Laner treffen sich zu selten auf Reichweite; Fix in Arbeit: Reflex-Wellenzustand ignorierte A2s crashWave (Shove vor Recall)
  - [~] Phase 3 Nutzenmodell (A2): Gerüst, Kesselbrut-Objective, Belagern ab 11:00, `convert`-Log, Jungler-Platte nach Gank, sicherer Platten-Push (>= 2 tankende Minions), kein Recall neben gegnerischen Minions, kein Trade in den Turm; offen (A2 misst gerade neu): CS und Kills mit Nutzenmodell schlechter als ohne, Abwesenheitsverlust 27-30 % (Ziel <= 15 %), 8-9 Recalls je Laner in 14 min, Objective-Konversion nach gewonnenem Fight ~0, erster Turm ~17 min (<= 15)
  - [~] Phase 4 Kampf (A2): Chase-Abbruch, Dive-Aggro-Wechsel, Fokus-Hysterese, Commit-Regel, kein Trade in den Turm hinter dem Flag; Gate (Kills 45-55, Tode ohne Gegner <= 5 %) nicht erreicht (Kills 13-16, Tode ohne Gegner 3,2 %)
  - [x] Phase 5 Menschlichkeit (A3): Aufmerksamkeitsmodell + Fehler-Episoden mit Dauer/Erkennung + Ping „Mein Fehler" verdrahtet (nur neues Gehirn); abgelenkter Anteil je Rang +-1 Punkt am Ziel (Iron 33 %, Gold 21 %, Diamant 10 %, Challenger 3 %); Lane-allein-Trainer ohne Ablenkung (Abweichung, DECISIONS-Vorschlag in a3.md)
  - [ ] Phase 6 Rang-Tuning (A3): wartet auf Phase 4; Siegquoten + Mindestlücken Gold -> Diamant
  - [ ] Abschluss: BRAIN-IST.md neu schreiben; Beta-Schalter erst standardmäßig an, wenn Phase 2 + 3 grün
  - [ ] Sev-Bots: Fähigkeiten auf Trugbilder (unter Gold 40 %), Amaterasu-Brand in der Kampfabschätzung
  - [x] Fog-Guard-Erweiterung (reflex/plan/utility/humanize) auf main, Gate-Messung Phase 1 gemacht; weitere Gates je Phase durch S (docs/agents/review-checklist.md)
  - [ ] Beta-Schalter auf Standard „an" erst nach grünem Phase-2- und Phase-3-Gate (DECISIONS „Beta-Schalter")
  - [ ] docs/BRAIN-IST.md komplett neu schreiben (A3, nach Phase 6)
- [x] Scoreboard: Objective-Leiste, Todestimer über der Minimap, Beschwörerzauber-Timer (C2, docs/ist/c2-*); offen: Browserprüfung durch S, Spielstil-Skalen/Rang-Kalibrierung pro Bot (braucht A3-API), exakte gegnerische Kesselbrut-Stacks (C-Vorschlag an B in shared-changes.md)
- [x] Manche Fähigkeiten halten den Champion fälschlich an → B2: `movesWhileCasting` + `castTime` für alle 26×4 + Beschwörer (docs/ability-cast-audit.md); offen: brain.ts `busyUntil` soll diese Casts nicht mehr sperren (B-Hinweis, shared-changes.md)
- [x] Toplane: nach 1500 Gold aus Minions Teleport als 3. Beschwörerzauber (B4 Sim-Seite + C HUD-Slot/Taste T; im Spiel noch nicht gesehen – Bot-Tops tragen Teleport bereits, Freischaltung greift nur für einen menschlichen Top; FEATURE-GAP 1.18 „teilweise")
- [x] Fernkampf-Hitbox 55 → 65 (B5, Nutzerentscheidung 19.10., DECISIONS „Fernkampf-Hitbox")
- [x] Agent B: B1–B6, Hitbox 65, Item-Fehlermeldungen fertig (b.md); B7 Ladezeit von D gebaut (IndexedDB-Atlas-Cache, warm 4–4,5 s bei 128-px-Frames; nach Umstellung auf 152 px neu zu messen)
- [x] Agent C: Lobby (Bann-Phase, Rollentausch, Prägungsseite je Champion, Bot-Konfiguration), Einstellungen (Minimap, Cast-Modi, Export/Import, HP-Balken-Striche), Klick-Auswahl neu (picking.ts), A+Klick am Cursor, Trainingsplan im Trainer-Menü; offen nur, was auf A3 wartet: Spielstil-Skalen + Rang-Kalibrierung im Scoreboard, Post-Game-Fehlerliste; Shop-Rückgängig → Agent G
- [x] Agent D: Motive je Fähigkeit (4 verschiedene pro Champion), Partikel je Fähigkeit, Turm-Lanze, Dash-/Knock-up-Bögen, Blickrichtung geglättet, Treffer-Aufhellung gedrosselt, Trainingsplan-Logik, Atlas-Cache, Sev-Effekte; offen → Agent F: D3 Maßstab/Karte/Camps, D4 Silhouetten-Test, D6 Fähigkeitstexte LoL-artig + Voice-Lines
- [x] Agent E: Sev Fassung 3 (Itachi-Look, Feuerball/Krähensturm-AoE, Bannblick, R-Wahl Amaterasu/Susanoo/Tsukuyomi) auf main; Bot-Regeln von A2 umgesetzt (Ult-Wahl, Q-Finte ab Platin, Wegschauen); offen: Bots werfen Fähigkeiten auf Trugbilder (unter Gold), Amaterasu-Brand im ExchangeEstimate, Susanoo als volle Geistfigur (F). Vorgeschichte: Champion „Sev Aschenblick" auf main (Daten, Hooks Nachbild/Q-Finte/Schwarzglut/Trugbild/Augenbann, Fear-CC + `uncleansable`, Trugbild-Pet mit Champion-Look, Sprite-Kit, tests/sev.test.ts, Roster #27); offen: Balance des Glut-Sprungs (sevCasts.ts-Lauf), schwarze Flammen-Optik + Augenbann-Phantome (D), Fear-Symbol, Sounds, Bot-Regeln (issues.md: Finten, Trugbild, Glut im ExchangeEstimate, Fear im Escape-Knoten), Trainer-Pools
- [x] 5-Minuten-Browserprüfung nach den C-Merges (S, review-2026-10-19.md: 0 Konsolenfehler, 3 kleine Befunde – von C in 6348bef behoben); Beta-Schalter-Prüfung 22.10. (F9 zeigt Intent/Pläne/Auslastung, 0 Konsolenfehler); offen: Screenshot-Abnahme der D-Änderungen durch S im gebauten Spiel

---

## Phase 1 – Simulation + 1 Champion ✔
- [x] Deterministische 30-Hz-Sim im Worker (xoshiro128**, Replays bit-identisch, stateHash)
- [x] Karte, Grid-A*-Pathing, Wand-Abstand, Sichtlinien
- [x] Minion-Wellen, Aggro-Prioritäten mit Hilferufen, Belagerer/Super-Minions
- [x] Türme, Platten, Inhibitoren, Nexus, Turm-Zielregeln
- [x] Gold, XP, Kopfgelder, Todestimer
- [x] Kamera, Steuerung (LoL-Belegung, Strg/Shift+QWER), HUD, Minimap
- [x] Abnahme: 107 Minions bis 10:00, Skript-Last-Hitter ≥ 60 CS, Turmschüsse exakt

## Phase 2 – Champions, Items, Prägungen, Zauber ✔
- [x] 26 Champions mit Fähigkeits-Engine und Hooks; 12 davon Nicht-Menschen (Tier-, Stein-, Baum-, Geistvolk …)
- [x] Shop im LoL-Stil: Kategorien, Suche, Bau-Baum mit abgehakten Teilen, reduzierte Preise, Basisstiefel, Legendäre einzigartig
- [x] Item-Passiva/Aktive, Prägungs-Effekte, Prägungs-Presets je Champion
- [x] Alle 8 Beschwörerzauber (Sicht-Prüfung, Flash während Wind-ups)
- [x] Wards, Trinkets, Kontrollwards
- [x] LoL-Tooltips für Fähigkeiten, Passive, Items, Zauber, Prägungen
- [x] Icons: Fähigkeiten nach Motiv (Feuer, Blitz, Haken …) + Typ-Abzeichen; Items mit Stufenrahmen und Element-Akzent
- [x] Combo-Abnahme (tests/combos.test.ts), Telegraph = Hitbox (tests/telegraph.test.ts)

## Phase 3 – Bots (Gold-Niveau) – weitgehend ✔
- [x] Behavior Tree als JSON, Wahrnehmung ohne Allwissen (Fog), gedrosseltes Entscheidungs-Log, F9-Overlay
- [x] Team-KI, Ganks, Roams, Trades, Kiten, Teamfights, Kills durchziehen, Turm-Dive bei sicherem Kill
- [x] Vorhersagendes Last-Hitting (auch unter dem Turm), Jungle-Route nach Camp-Timern
- [x] Ward-Spots je Rolle, Kontrollwards, Suchfeuer
- [x] Drache, Kesselbrut, Baron mit Gruppenruf, Bannen-Timing
- [x] Belagern der ganzen Gebäudekette, Spiel beenden bei Vorsprung/Ass/Baron
- [x] Spieldauer: Gold-Partien enden 29,6–34,7 min mit Nexus
- [x] Wegfindung: Richtungswechsel −35 %, Hängen −83 %
- [x] bot-sim mit CSV, `--vs=<rang>`, `--mirror`, Pathing-Metriken
- [~] Kills, erster Turm, CS (siehe „Offen“)

## Phase 4 – Ränge + Humanisierung – weitgehend ✔
- [x] Rangprofile Eisen–Challenger, 10 Spielstil-Achsen, Archetypen, Reaktionszeiten, Varianz
- [x] Rang-Mechanik: Skillshot-Vorhalten, Zielwahl-Fehler, Cast-Ausführungsrate, Rückzugsgrenze
- [x] Pings (Rad, Alt-Klick), Bots reagieren auf Spieler-Pings
- [x] Rage-„?“-Pings, Flame-Chat gegen den Spieler, Toxizitäts-Schalter, Tilt, alle Fehlerarten je Rang
- [x] Team-Chat (Enter), Bot-Chat in UI-Sprache
- [x] Eine Bot-Schwierigkeit für alle Bots, Einzelwerte unter „Erweitert“
- [ ] Siegquoten je Rang (siehe „Offen“)

## Phase 5 – Trainer – weitgehend ✔
- [x] Last-Hit- (auch Turm), Ausweich-, Kiting-/Combo-Trainer
- [x] Lane-Duell 1v1, Jungle-Duell, Teamkampf-Arena
- [x] Szenario-Trainer: 2v1 am Turm, Gank-Flucht, Turm-Dive, Drache stehlen, Welle einfrieren, Carry schützen, Flash-Ausweichen
- [x] Post-Game-Analyse (CS-/Gold-Kurven, Tode, Schaden)
- [x] „Was ein Challenger getan hätte“: Schatten-Bot auf deiner Sicht, Zeitleiste mit bis zu 10 Momenten
- [x] Sandbox+ (Level, keine Abklingzeiten, Godmode, Welle, Camps)
- [x] Trainingsplan, Verlauf über mehrere Matches (Trainer-Menü, IndexedDB)

## Phase 6 – Politur – weitgehend ✔
- [x] Menüs, Lobby (Splash-Art, Porträt-Kacheln, Rollen-Icons), Enzyklopädie, Ladebildschirm
- [x] Prozeduraler Sound, Vollbild + Tastensperre, PWA, Code-Splitting, Grafikqualität
- [x] Barrierefreiheit (Farbenblind, weniger Bewegung, Kontrast, Hinweise am Rand)
- [x] Gemalte Champion-/Minion-/Monster-Sprites, 12 Nicht-Menschen, Animationen synchron zum Treffer
- [x] Karte im Gouache-Stil; Camps mit großen Lichtungen, Runenkreisen und Deko; Monster in LoL-Proportionen
- [x] Jungle-Inhalt: 6 Lager je Seite, Kesselbrut, Pflanzen, LoL-Werte
- [x] Ansagen, Todes-Zusammenfassung, Level-up-Effekt, große Pings, Recall-/Ward-Effekte, Kesselbrut-Anzeige
- [x] Bughunt: 4 kritische, 12 mittlere, ~20 kleine Bugs behoben (41 Regressionstests)
- [~] Sprite-Revision nach Analyse anderer Spiele: Licht wie die Welt + Größe 1,3× + 152-px-Frames + kein Clipping (Lead 23.10.); eigene Animationen je Champion → Agent F
- [x] Fähigkeiten-/Passiv-Anzeige vollständig (Recast-Ringe, Klingen-Kreise, Draht, Passiv-Badges, Motive, Partikel)

## Mechanik-Feeling vs. LoL
Audit 2026-10-16 („fühlt sich scuffed an“). Erledigt und gepusht:
- [x] Wind-ups wie LoL (Schützen ~270 ms auf Stufe 1 statt 470), Sound beim Abschuss, Treffer-Funken, Einschlag-Ton
- [x] Keine Lauf-Animation mehr beim Angreifen; Schlag-Bild genau auf dem Schadens-Tick
- [x] Weiche Kollision Champion ↔ Minion/Champion
- [x] Gezielte Zauber laufen in Reichweite; Eingabe-Puffer (R-Flash, Q-Flash); Auto-Angriff im Stand
- [x] Zauber mit Anzeige (Taste halten → Reichweite + Form, loslassen → wirken)
- [x] Fehlgeschlagene Zauber: „Nicht genug Mana“, „Außer Reichweite“ … mit Ton
- [x] CC über dem HP-Balken (Betäubt, Verlangsamt 30 % …), CC-Timer am eigenen Champion
- [x] Projektile nach Herkunft (Turm-Energiekugel, Kanonenkugel, Caster-Bolzen, Pfeil, Elementfarbe)
- [x] Turm-Reichweitenkreis beim Annähern, rot + Ziellinie wenn er dich anvisiert
- [x] HP-Nachlauf-Balken, Minion-Balken immer sichtbar, 100er-/1000er-Striche, Abklingzeit-Aufblitzen
- [x] Flüssigere Bewegung (Ankunftsuhr + halber Tick Puffer), rechte Maustaste lenkt alle 50 ms und greift überstrichene Gegner an
- [x] Kamera: Standard = Maximum, schnelleres Rand-Scrollen (4200 E/s, 20 px Rand)
- [x] Minions 325 Tempo, Wellen treffen sich 1:27 / 1:38, Turm tötet Caster mit 2 / Melee mit 3 Schüssen

Noch offen:
- [x] Dashes und Knock-ups mit Flugbogen (Snapshot `dash`/`air`, B + D)
- [~] Render liest `atkStart`/`atkEnd` noch nicht → Agent G (Feel-Fix A6, Wind-up-Frames aus dem Snapshot)
- [~] Fähigkeiten-Effekte individueller: Partikel/Motiv je Fähigkeit (D) erledigt; echte Effekte + Cast-Posen je Fähigkeit → Agent F
- [x] Blickrichtung geglättet (180° in ~80 ms, D)
- [x] Auto-Reset sofort (Dagny Q Cast-Zeit 0, B)
- [x] Treffer-Aufhellung gedrosselt (B-Flag + 4/s Render-Grenze, D); Feinschliff (Gate 120 ms, Flinch) → Agent G
- [ ] Optional: gegnerische Skillshots nur als Projektil statt ganzem Bodenstreifen (Einstellung „LoL-Telegraphe“)
- [x] Fernkampf-Radius 55 → 65 (Nutzer 19.10.) und Angriffsbewegung „Ziel am Cursor" (Standard an seit 22.10.)

## Fähigkeiten-Anzeige (Audit)
Neue Grundlage (gilt für alle Champions): `ChampionHooks.visuals` (nur Snapshot, read-only) liefert Objekte auf der Karte
(Form, Linie/Folge-Einheit, Timer, Anzahl), Hinweis-Kreise für den eigenen Champion (`PlayerHud.hints`), Marken mit Stapeln
auf Einheiten und den Passiv-Zustand (`PlayerHud.passive`). Generisch aus dem Sim: offene Recast-Fenster je Slot
(`AbilityHud.recast`: „öffnet in“ / Restzeit), verstärkter nächster Angriff (`AbilityHud.armed`, `SnapEntity.emp`),
Fähigkeits-Selbstbuffs/Schilde als Aura (`SnapEntity.auras`), `mark`-Buffs als Marken. Darstellung: HUD-Slot mit
türkisem Leuchtrand + ablaufendem Ring + „Erneut x,x“ (bzw. gedimmt „öffnet in“), goldener Rand bei verstärktem Angriff,
Passiv-Symbol unten links am Porträt (Tooltip `passive:<champ>`, Abklingzeit-Sweep, Stapelzahl, Bereit-Leuchten);
Welt: `src/render/groundObjects.ts` (Formen in Teamfarbe + Fähigkeitsfarbe, Timer-Bogen, Hinweis-Kreise, Aura-Ring,
goldener Ring bei verstärktem Angriff), Overlay: Marken-Pips rechts am Lebensbalken, goldener Funke bei `emp`.
Test: `tests/abilityVisuals.test.ts` (Passiven aller 26 vorhanden + Hooks exportiert, Isolde-Q/E-Recast, Renn-Klingen-Kreise).

| Champion | Fähigkeit | Was fehlte | Behoben? |
|---|---|---|---|
| alle | Recast (openRecast) | HUD zeigte keinen Recast | ja – generisch (Slot-Leuchten, Ring, Restzeit) |
| alle | Nächster Angriff verstärkt (`*_next_auto`: Brom W, Dagny Q, Gorvam W, Harrow W, Lio W, Tobin W, Vessa W, Wren Q, Isolde Q) | keine Anzeige | ja – generisch (goldener Slot-Rand, Ring + Funke am Champion, auch für Gegner sichtbar) |
| alle | Selbstbuffs/Schilde aus Fähigkeiten | keine Aura | ja – generisch (Aura-Ring in Fähigkeitsfarbe) |
| alle | Passive | kein eigenes HUD-Element | ja – Passiv-Symbol am Porträt mit Tooltip; Stapel/Abklingzeit nur wo `visuals` sie liefert (s. u.) |
| Isolde | Q Schnitt/Bruch | Recast (1,5–3,5 s) unsichtbar | ja – „öffnet in“, dann Leuchtrand + ablaufender Ring „Erneut x,x“ (Browser + Test geprüft) |
| Isolde | E Draht | Draht beim Ranziehen unsichtbar, Recast-Reichweite fehlte | ja – Drahtlinie Wand↔Isolde während des Zugs, Ankerpunkt mit Timer, 400er-Kreis um sie im Recast-Fenster (Code + Test; Test findet nur eine Wand, wenn eine nahe am Testpunkt liegt) |
| Isolde | R Glaskuppel | Kuppel (blockiertes Terrain) nicht gezeichnet | ja – Kuppelring r 450 mit Timer (nur Code) |
| Isolde | Passiv Temperglas | kein Zustand sichtbar | ja – Abklingzeit-Sweep, Bereit-Leuchten (Browser geprüft); Schild als Aura (nur Code) |
| Renn | E auf Klinge | kein Kreis an den Klingen | ja – Kreis (Klick-Toleranz 200) an jeder eigenen Klinge mit Linie, gedimmt wenn E auf Abklingzeit/außer Reichweite (725) (Test geprüft) |
| Renn | Klingen (Q/W/R) | nur graue Box | ja – schwebende Klinge + Teamring + Timer-Bogen (4 s) |
| Renn | Passiv | – | ja – Klingenzahl am Passiv-Symbol |
| Seraphyne | Passiv Elektrisiert | keine Passive-Hook-ID (nur Daten-Buffs) | teils – `seraphyne_electrified`, Passiv-Symbol leuchtet mit Restzeit (nur Code). Offen: die 4 Ability-MS-Buffs haben verschiedene IDs und stapeln (Q+W = +30 % statt 15 %), Beschreibung erwähnt noch „als Buff-Effekt hinterlegt“ |
| Grimald | Fallen | Ring ohne Form | ja – X-Form + Teamring (für Gegner weiter unsichtbar) |
| Nyx | Samen | – | ja – Scheibe + Teamring |
| Gorvam | Q Recast | nur Abbruch in der Ausholzeit (kein Fenster) | nichts nötig – keine Anzeige korrekt |
| Aurel, Brom, Corvin, Dagny, Ferris, Gorvam, Grimald, Hagen, Harrow, Ilvane, Kaelen, Kiran, Lio, Lysa, Mira, Nyx, Oda, Oleth, Ottilie, Thessaly, Tobin, Vessa, Wren | Einzel-Audit Q/W/E/R/Passiv | nicht einzeln geprüft (Zeit) | offen – fehlende `visuals` für Hook-Zustände: Oleth-Mauern/Banner, Dagny-Wand, Hagen-Glocken, Corvin-Fass-Ring, Marken-Stapel (z. B. Brom-Blutung, Gorvam 4. Angriff), Passiv-Stapel/Abklingzeiten |

