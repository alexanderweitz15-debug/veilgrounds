# Masterplan (Stand 2026-10-16, Abend)

Checkliste aller Phasen. `[x]` = fertig und gepusht, `[~]` = teilweise / läuft, `[ ]` = offen.
Zahlen und Begründungen: [docs/DECISIONS.md](DECISIONS.md) · Bot-Spezifikation: [docs/spec-bots.md](spec-bots.md) ·
Ist-Zustand mit Screenshots: [docs/IST-ZUSTAND.md](IST-ZUSTAND.md) · Live: https://alexanderweitz15-debug.github.io/veilgrounds/

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

