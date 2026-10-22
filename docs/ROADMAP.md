# Masterplan (Stand 2026-10-16, Abend)

Checkliste aller Phasen. `[x]` = fertig und gepusht, `[~]` = teilweise / läuft, `[ ]` = offen.
Zahlen und Begründungen: [docs/DECISIONS.md](DECISIONS.md) · Bot-Spezifikation: [docs/spec-bots.md](spec-bots.md) ·
Ist-Zustand mit Screenshots: [docs/IST-ZUSTAND.md](IST-ZUSTAND.md) · Bot-Gehirn: [docs/BRAIN-IST.md](BRAIN-IST.md) · Live: https://alexanderweitz15-debug.github.io/veilgrounds/

## Jetzt in Arbeit
| Agent | Aufgabe |
|---|---|
| Balance | Seiten-Ungleichgewicht (Blau gewinnt 20/24), Siegquoten je Rang, Lanes auf LoL-Länge kürzen, mehr Terrain an Top-/Botlane, Minions jagen zu lange, Champions gleiten nicht um stehende Verbündete |
| Sprite-Revision | Analyse anderer Spiele (LoL, Hades, Darkest Dungeon, Dota-2-Art-Guide …) → Überarbeitung aller Champion-, Minion- und Monster-Sprites |
| Fähigkeiten-Audit | Jede Fähigkeit/Passive aller 26 Champions sichtbar und lesbar: Recast-Anzeige (Isolde Q/E …), Kreise für Renns Klingen, Isoldes Draht, Fallen/Banner/Glocken, Passiv-Symbol + Stapel im HUD |

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
- [~] Alle Champions mit sichtbarer, funktionierender Passive → Fähigkeiten-Audit
- [~] Kills ~34 statt 40–60, erster Turm ~18 min statt 12–16
- [~] CS der Bots ~40 % von Tabelle A in Partien (allein auf der Lane 5,6–7,8 CS/min; Verluste durch Abwesenheit)
- [ ] Trainingsplan + Verlauf über mehrere Matches (Phase 5)
- [~] Großes Bot-Gehirn-Rework (docs/BRAIN-REWORK.md; Stand 2026-10-22, main f343d7b). Alles liegt auf main; im Spiel nur über den Beta-Schalter „Neues Bot-Gehirn" (Einstellungen, Standard aus; DECISIONS „Beta-Schalter") – Reflex-Schicht + Nutzenmodell zusammen, Aufmerksamkeitsmodell weiterhin nicht verdrahtet:
  - [x] Phase 0 Messbasis (A1): bot-sim `--report`, csLossByCause, `--variance=0`, `--scenario=laneAlone`; Baseline aller vier Ränge in DECISIONS „Phase 0"
  - [~] Phase 1 Reflex-Schicht + Angriffs-Scheduler (A1): **Gate nicht grün** (DECISIONS „Phase 1 – Gate-Messung", S 22.10.): Lane-allein auf main (nach Hitbox 65) Iron 80,7 ✔ / Gold 88,0 (knapp) / Challenger 96,3 ✘ (Ziel 70/88/100; A1 hatte 75/89,7/100,7 vor Hitbox 65); 5v5 Gold 4 × 20 min Reflex an vs aus: CS/min@15 3,80 vs 3,52, Idle 4 % vs 10 %, Auslastung 0,39 vs 0,29 (Ziel 0,50); offen: Challenger ≥ 100 nach Hitbox 65 nachkalibrieren, Test 4 (Gold Stehpunkt `out_of_range`) und Test 5 (Harass) übersprungen, Reflex-Kosten 0,15 ms unter Last (Ziel 0,05), Platten sinken mit Reflex (Platten-Intent = Phase 3)
  - [~] Phase 2 Wellenzustände + Harass (A1): Harass-Filler im Reflex begonnen (4,2 Autos je Laner bis 14:00, Gate ≥ 40); Wellenzustände als Zielbild, Freeze-Bedingungen, Aggro-Prüfung, brain.ts `busyUntil` für `movesWhileCasting`-Casts (B-Hinweis) offen
  - [~] Phase 3 Nutzenmodell (A2): Gerüst + Baum-Einbindung (A2-1..A2-3) + Kesselbrut-Objective, Belagern ab 11:00, `convert:`-Log, Jungler-Platte nach Gank auf main (Flag); Kalibrierung Gold 4 × 20 min mit Flag: CS 3,20 ≈ aus 3,18, Idle 6 %, Tode ohne Gegner 1,6 %, aber Platten 1,25 vs 3,38 und Kills 14,5 vs 16,8 (a2.md); offen: Platten-Intent gegen Shove-and-Recall, Farm-Intent auf den Reflex-Scheduler setzen (jetzt möglich), Wertkalibrierung, Phase-3-Gate (CS@15 ≥ 6,0, Abwesenheit ≤ 15 %, erster Turm ≤ 15, Idle ≤ 12 %)
  - [~] Phase 4 Kampf (A2): Chase-Abbruch, Dive-Aggro-Wechsel, Fokus-Hysterese, Commit-Regel hinter dem Flag; Gate (Kills 45–55, Tode ohne Gegner ≤ 5 %) nicht gemessen
  - [~] Phase 5 Menschlichkeit (A3): Modell + Daten + F9-Spalten auf main, nicht verdrahtet (A3-4..A3-9: runner.ts, lasthit.ts, leaves.ts, Fehler-Aufrufstellen, Ping „Mein Fehler"); Test 10 Klausel 3 todo; A3 pausiert bis A1/A2 verdrahten
  - [ ] Phase 6 Rang-Tuning (A3): wartet auf Phase 4
  - [x] Fog-Guard-Erweiterung (reflex/plan/utility/humanize) auf main, Gate-Messung Phase 1 gemacht; weitere Gates je Phase durch S (docs/agents/review-checklist.md)
  - [ ] Beta-Schalter auf Standard „an" erst nach grünem Phase-2- und Phase-3-Gate (DECISIONS „Beta-Schalter")
  - [ ] docs/BRAIN-IST.md komplett neu schreiben (A3, nach Phase 6)
- [x] Scoreboard: Objective-Leiste, Todestimer über der Minimap, Beschwörerzauber-Timer (C2, docs/ist/c2-*); offen: Browserprüfung durch S, Spielstil-Skalen/Rang-Kalibrierung pro Bot (braucht A3-API), exakte gegnerische Kesselbrut-Stacks (C-Vorschlag an B in shared-changes.md)
- [x] Manche Fähigkeiten halten den Champion fälschlich an → B2: `movesWhileCasting` + `castTime` für alle 26×4 + Beschwörer (docs/ability-cast-audit.md); offen: brain.ts `busyUntil` soll diese Casts nicht mehr sperren (B-Hinweis, shared-changes.md)
- [x] Toplane: nach 1500 Gold aus Minions Teleport als 3. Beschwörerzauber (B4 Sim-Seite + C HUD-Slot/Taste T; im Spiel noch nicht gesehen – Bot-Tops tragen Teleport bereits, Freischaltung greift nur für einen menschlichen Top; FEATURE-GAP 1.18 „teilweise")
- [x] Fernkampf-Hitbox 55 → 65 (B5, Nutzerentscheidung 19.10., DECISIONS „Fernkampf-Hitbox")
- [~] Agent B: B1–B6 + Hitbox auf main; offen: B5-Reste laut b.md (Dash-Flag `dashing` für D), B7 Ladezeit (gebackene Atlanten) → an D übergeben (Lead 19.10.); S-Messung: Spielstart 10,4 s kalt / 7,0 s warm (Ziel < 5 s warm)
- [ ] Agent C offen: C5 Lobby (Prägungen-Editor, Bann-Phase, Rollentausch, Bot-Konfiguration prüfen), C7 Einstellungen (braucht Entscheidung zu src/settings.ts), Shop-Rückgängig (Sim-Befehl, B), „Nochmal" nach Classic (issues.md), Post-Game-Fehlerliste + Spielstil-Skalen (nach A3)
- [ ] Agent D offen: D1 Fähigkeiten-Anzeige-Audit der 23 Champions (nur Motiv-JSON begonnen, ungetestet), D2 Kampf-Lesbarkeit, D3 Maßstab/Karte, D4 Sprite-Revision (lokaler Stand docs/style/revision pushen), D5 Trainer-Reste (Trainingsplan, Verlauf), D6 Tooltips/Texte; Portrait-Ausschnitte (issues.md)
- [~] Agent E: Champion „Sev Aschenblick" auf main (Daten, Hooks Nachbild/Q-Finte/Schwarzglut/Trugbild/Augenbann, Fear-CC + `uncleansable`, Trugbild-Pet mit Champion-Look, Sprite-Kit, tests/sev.test.ts, Roster #27); offen: Balance des Glut-Sprungs (sevCasts.ts-Lauf), schwarze Flammen-Optik + Augenbann-Phantome (D), Fear-Symbol, Sounds, Bot-Regeln (issues.md: Finten, Trugbild, Glut im ExchangeEstimate, Fear im Escape-Knoten), Trainer-Pools
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
- [ ] Trainingsplan, Verlauf über mehrere Matches

## Phase 6 – Politur – weitgehend ✔
- [x] Menüs, Lobby (Splash-Art, Porträt-Kacheln, Rollen-Icons), Enzyklopädie, Ladebildschirm
- [x] Prozeduraler Sound, Vollbild + Tastensperre, PWA, Code-Splitting, Grafikqualität
- [x] Barrierefreiheit (Farbenblind, weniger Bewegung, Kontrast, Hinweise am Rand)
- [x] Gemalte Champion-/Minion-/Monster-Sprites, 12 Nicht-Menschen, Animationen synchron zum Treffer
- [x] Karte im Gouache-Stil; Camps mit großen Lichtungen, Runenkreisen und Deko; Monster in LoL-Proportionen
- [x] Jungle-Inhalt: 6 Lager je Seite, Kesselbrut, Pflanzen, LoL-Werte
- [x] Ansagen, Todes-Zusammenfassung, Level-up-Effekt, große Pings, Recall-/Ward-Effekte, Kesselbrut-Anzeige
- [x] Bughunt: 4 kritische, 12 mittlere, ~20 kleine Bugs behoben (41 Regressionstests)
- [~] Sprite-Revision nach Analyse anderer Spiele → Sprite-Agent
- [~] Fähigkeiten-/Passiv-Anzeige vollständig → Fähigkeiten-Audit

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
- [ ] Dashes und Knock-ups sehen nach Rutschen aus (kein Flugbogen, Animation endet vor dem Dash) → Snapshot-Flags `dashing`/`airborne`
- [ ] Render liest `atkStart`/`atkEnd` noch nicht (Ausholen nach Item-/Buff-Angriffstempo geschätzt)
- [ ] Fähigkeiten-Effekte individueller (eigene Partikel/Formen je Fähigkeit, nicht nur Farbe)
- [ ] Blickrichtung dreht in einem Tick um 180° (Glätten ~80 ms)
- [ ] Auto-Reset sofort (nur Dagny Q, Cast-Zeit 0,2 s)
- [ ] Treffer-Aufhellung flackert im Teamfight (für DoT/Minion-Ziele abschwächen)
- [ ] Optional: gegnerische Skillshots nur als Projektil statt ganzem Bodenstreifen (Einstellung „LoL-Telegraphe“)
- [ ] Optional: Fernkampf-Radius 55 → 65 wie in LoL; Angriffsbewegung mit „Ziel am Cursor“

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

