# Entscheidungen und Abweichungen vom Prompt

Jede Abweichung vom Design-Prompt steht hier mit Grund. Neue Einträge oben.

## Phase 2: Zauber, Wards, Abnahme (Agent J, 2026-10-15)

| Thema | Prompt | Entscheidung | Grund |
|---|---|---|---|
| Erschöpfen | −40 % Schaden, −30 % MS 2,5 s, CD 240 | wie Spec; Reichweite 650, Ziel Champion/Dummy | – |
| Reinigen | CC außer Unterdrückung/Luft, 65 % Zähigkeit 3 s, CD 210 | entfernt Slow/Blind/Root/Silence/Stun + Entflammen/Erschöpfen; wirkbar während Stun, nicht in der Luft/unterdrückt/Stasis | LoL-Verhalten |
| Teleport | 4 s Kanal; vor 10:00 nur Türme, danach auch Vasallen/Wards/Champions; CD 360 → 240 | wie Spec. Bewegen bricht nicht ab (wie LoL), Neuwirken bricht ab; Stun/Luft/Unterdrückung/Stasis unterbrechen (Schaden, Root, Silence nicht). Abbruch → 30 s CD | Spec lässt Abbruch offen; 30 s als einfache Regel |
| Schleierward | Trinket, 2 Ladungen, 90 s, max 3 | Start mit 1 Ladung, Aufladung 240 → 120 s nach Level, Platzierung 600, Sicht 900, 3 Treffer | LoL-ähnlich |
| Siegelward | 75 Gold, permanent, sichtbar, enthüllt/blockt | Reichweite 900, 4 Treffer, max 1 (ältester fällt); über den Item-Befehl | – |
| Suchfeuer | Trinket-Tausch ab Level 9 | Tausch im Brunnen (HUD-Klick auf Trinket-Slot); Bodenziel 600, Radius 450, 6 s, CD 90 → 60 s; Rücktausch startet mit 0 Ladungen | Kein Gratis-Ward durch Tauschen |
| Ward-Schaden | „wenige Treffer“ | 1 HP pro Auto, Fähigkeiten/DoTs 0 | LoL |
| Kegel-Treffer | Hitbox = sichtbare Fläche | Kreis-gegen-Sektor exakt (Mitte im Winkel oder Hitbox berührt Seitenkante) | vorher zählte nur die Einheitenmitte am Winkel |
| Bot-Zauber | – | Top: Sprung + Teleport, Support: Sprung + Erschöpfen (vorher Entflammen/Heilen) | LoL-Standard; Bots nutzen sie (src/ai/bot/spells.ts) |

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

## Bot-Verhalten (docs/spec-bots.md, 2026-10-15)

| Thema | Spec | Entscheidung | Grund |
|---|---|---|---|
| Kiting-Richtung | Achse: −5 = Profi, +5 = keins; Archetyp-Tabelle nutzt aber + für gutes Kiting (Pro-Standard +4, Int-Bot −5), ebenso Champion-Bias „Lysa Kiting +2“ | Achsen-Definition bleibt (−5 = Profi, passt zu Testfall 6). Kiting-Werte der Archetypen und des Champion-Bias werden mit umgekehrtem Vorzeichen übernommen (Pro-Standard −4, Int-Bot +5, Lysa −2) | Sonst würde der „Pro-Standard“ nicht kiten und der „Int-Bot“ perfekt orbwalken |
| Challenger-Streuung | „Kiting nie schlechter als −3“ | Kiting ≤ +3 (nie stärker Richtung „keins“) | Mit −5 = Profi ist „schlechter“ die Plus-Richtung |
| Archetyp-Preset (K) | „Gewürfelte Werte werden verschoben, manuell gesetzte nicht“ | Archetyp-Wahl gilt als manuell: kein Champion-Bias; Achsen-Änderungen im Editor machen den ganzen Stil manuell | Preset ist eine bewusste Vorgabe |
| Stil-Wurf (K) | rangabhängige Verteilung | Reine Funktion von `personalitySeed` + nominellem Skill (nicht vom Varianz-Wurf); Config-Builder setzen den Seed | Lobby und Scoreboard zeigen exakt die Werte, mit denen der Worker spielt |
| Knob-Format (K) | base, perStep, clamp | Erweitert: mehrere Achsen pro Knob, asymmetrischer perStep `[unter 0, über 0]` (z. B. Kampfgewicht 0,6/1,0/1,6), `startAt` (Farm zählt beim Recall erst über +2), Bool-Knobs per Schwelle | Spec-Endpunkte sind um den Neutralwert asymmetrisch; 0 = Rang-Standard |
| Hysterese (K) | 10–25 %, Gold hoch, Challenger niedrig | Neues Profilfeld `hysteresis`: Iron 0,18 · Bronze 0,20 · Silber 0,22 · Gold 0,25 · Platin 0,22 · Smaragd 0,19 · Diamant 0,16 · Master 0,14 · GM 0,12 · Challenger 0,10; `inertia` des Prototyps bleibt | Prototyp nutzt `inertia` anders skaliert |
| Platin-Skill (K) | Profil 57, §10 nennt 58 | 58 | §10 |
| All-in-Schwellen (K) | Aggression ±0,1 pro Stufe | wörtlich: killProb 0,6 − 0,1 · Aggr. (0,1..0,98), deathProb 0,25 + 0,1 · Aggr. (0,02..0,75) | ±5 darf sichtbar unvernünftig sein |
| Fehlerraten ohne Zahl (K) | carry_too_far (Gold), late_recall (Iron), chase_third_kill (Gold), overcommit_after_kill (Iron) | 0,5 / 0,5 / 0,4 / 0,5 am genannten Rang, nach oben auslaufend (`data/bots/errors.json`) | Plausible Startwerte, Kalibrierung mit bot-sim |
| Spec-Beispiel-Konfig (K) | `"kiting": 4` beim Roamer | als −4 übernommen (`data/bots/configs.json`) | Gleiche Vorzeichen-Entscheidung wie bei den Archetypen |
| Skalen-Anzeige (K) | „--x-------“ (10 Zeichen) | 11 Zellen, eine pro Wert −5..+5 | Jeder Wert eindeutig ablesbar |

## Items + Prägungen (Phase 2, Agent I, 2026-10-15)

Werte, die §5 offen lässt. Code: `src/sim/items/itemHooks.ts`, `src/sim/items/runeHooks.ts` (Konstanten oben in den Dateien).

| Thema | Spec | Entscheidung | Grund |
|---|---|---|---|
| Sturmbogen | Krits verlangsamen 1 s | 30 % | Spürbar, aber unter Frostkern-Dauer-Slow-Niveau |
| Blutkrone | Überschuss-Lebensraub → Schild | Schild max. 50 + 15 × Level, 25 s Laufzeit (Refresh pro Treffer) | Wie Bloodthirster-Größenordnung |
| Scharfrichterbeil / Gnadenstoß | +15 % / +8 % unter 40 % HP | Auf alles außer Gebäude / nur Champions; vor Rüstung multipliziert, auch DoTs | Desc: „Ziele“ vs. „Champions“ |
| Schwarze Kette | 5 × 6 % Rüstungsreduktion | Autos + Fähigkeitstreffer, 6 s, nicht auf Gebäude | – |
| Frostkern | Fähigkeitstreffer 25 % Slow | 1 s | – |
| Brandglas | Brennen 3 s | 30 + 12 % AP Magieschaden, 3 Ticks à 1 s, Refresh pro Treffer | – |
| Funkenkelch | alle 1,5 s Bonus-Blitz | 50 + 20 % AP Magieschaden auf den ersten Fähigkeitstreffer nach Ablauf | – |
| Wallherz | Aura −10 % AS | Radius 550, alle Gegner außer Gebäuden; zwei Wallherzen stapeln | ponytail |
| Sturmgewand | Magieschild, lädt alle 40 s | 180 + 12 × Level; lädt 40 s nach dem ersten Absorbieren voll auf. Umsetzung: HP-Anteil von Magieschaden wird sofort zurückgegeben (kein typisierter Schild im Buff-System, kein Schildbalken) | ponytail bis typisierte Schilde |
| Lebenswurzel | 1,5 % Max-HP / 5 s im Kampf | „Im Kampf“ = Schaden ausgeteilt/erhalten in den letzten 5 s, kontinuierlich pro Tick | – |
| Hüterstab / Hüterlampe | +12 % / +8 % Heil- und Schildkraft | Multiplikativ auf Fähigkeits-Heilungen/-Schilde (Daten-Effekte) und Kettenrelais; Hook-eigene Heilungen in Champion-Dateien ausgenommen | `healShieldPowerPct` war bisher wirkungslos |
| Zauberring | Last-Hits +6 Mana | Minion- und Monster-Kills | – |
| Dornenklinge | Nahkampftreffer heilen 3 | Nur Nahkampf-Champions, nur gegen Champions | – |
| Jägerzahn | +30 % vs. Monster, 50 % Minion-Gold bis 14:00 | Seit der Dschungel-Überarbeitung +80 % + Begleiter-True-Damage/Heilung (siehe unten); sonst wie Spec; Bannen bleibt ohne Item nutzbar (Beschwörer-Logik bei Agent J) | Tests nutzen Bannen ohne Item |
| Spenderlampe | Ladungen, Gold-Teilen, Quest | 3 Ladungen, +1 je 10 s, 1 s Abstand; 15 Gold für dich + nächsten Verbündeten (≤ 1000); Quest = 500 selbst verdientes Gold → `givingLampQuestDone` (Ward-Ladung bei Agent J). „Keine Minion-Gold-Strafe“: gibt es nicht, also nichts zu tun | – |
| Zeitglas / Kettenrelais | Stasis 2,5 s / Schild in 500 | Nicht nutzbar unter Stun/Airborne/Unterdrückung; Relais-Schild 80 + 10 × Level, 2,5 s, inkl. Träger. Cooldowns pro Item-ID (nicht pro Slot) | – |
| Trank | 120 HP über 15 s | Ein Trank pro Slot (kein Stapeln); weitere Tränke reihen sich hinten an (gleiche Rate); endet beim Tod | ponytail: Stapeln braucht Slot-Zähler |
| Adaptiv | +9 AD oder +15 AP | Nach Item-AD vs. Item-AP; Gleichstand nach Archetyp (Magier/Enchanter/Heiler → AP) | Nicht von den eigenen Runen-Werten abhängig |
| Dauerhafter Schaden | 3 Angriffe/Fähigkeiten in 3 s | „Getrennt“ = verschiedene Ticks; Schadenstyp adaptiv | ponytail |
| Präzision | +8 % AS, max 6, 6 s | Stacks erneuern die Dauer gemeinsam | – |
| Zähigkeit | nach 4 s im Kampf | Kampf endet nach 3 s ohne Schaden; nach einem Proc wieder 4 s; Bonus = Magieschaden | – |
| Inspiration | Gratis-Stiefel 12:00, −10 % davor | Uhrmacherstiefel, falls noch keine Stiefel und ein Slot frei (sonst jede Sekunde neu versucht). Rabatt nur in der Sim (`quote`), Shop-Anzeige zeigt Vollpreis | ponytail |
| Mana-Flow | +25 Max-Mana, max 250 | Höchstens alle 6 s, nur Mana-Champions | Ohne interne Abklingzeit nach 10 Treffern voll |
| Zweiter Wind | 6 % fehlende HP über 10 s | Jeder Champion-Treffer startet neu (fehlende HP zu dem Zeitpunkt) | – |
| Wachsamkeit | Wards +10 % | `wardDurationMult` für Agent J | – |
| Fehlende Runen | – | `PlayerSetup.runes` fehlt → Standard-Preset des Champions; unbekannte Runen-IDs werden ignoriert (Tests nutzen eine leere Seite) | – |

## Dschungel-Überarbeitung (2026-10-15)

Monsterwerte LoL-nah, Skalierung nach Durchschnitts-Champion-Level (abgerundet) beim Spawn: HP +6 %, AD +5 % pro Level über 1 (LoL skaliert ähnlich stark; +10 %/+6 % ließ Bot-Jungler ab Minute 8 einbrechen). Schleierwächter nach Zeit: 12000 HP / 150 AD um 20:00, +180 HP / +8 AD pro volle Minute danach. Monster-AD bewusst niedriger als in LoL (kein Begleiter-Schild/-Heilung wie LoL-Jungle-Pets).

| Lager (je Seite) | Mitglieder | HP | AD | Gold | XP |
|---|---|---|---|---|---|
| Dornenbock (Blau-Buff) | 1 | 2300 | 22 | 90 | 240 |
| Glutwächter (Rot-Buff) | 1 | 2300 | 22 | 90 | 240 |
| Sumpfunke (neu, Gromp) | 1 | 1800 | 24 | 80 | 200 |
| Moosrudel (Wölfe) | Mooswolf + 2 Mooswelpen | 1600 / 420 | 16 / 6 | 55 + 2×20 | 120 + 2×50 |
| Hohlkäfer (Raptoren) | Hohlkäfer + 3 Käferlinge | 1200 / 350 | 15 / 5 | 40 + 3×15 | 100 + 3×40 |
| Schattenkrabbe (Krugs) | Schattenkrabbe + 2 Krabblinge | 1450 / 540 | 18 / 7 | 75 + 2×25 | 130 + 2×45 |
| Nebelschleicher (Fluss) | 1 | 1050 | 0 | 70→120 | 200 |
| Flussleviathan | 1 | 3500 | 70 | 25 | 150 |
| Kesselbrut (neu) | 3 Larven | je 1800 | 30 | je 25 | je 110 |
| Schleierwächter | 1 | 12000 | 150 | 300 Team | 300 |

- **6. Lager**: Sumpfunke auf der oberen Viertelseite (2900, 8800 blau), Schattenkrabbe nach (6200, 3500) verschoben → jedes Viertel hat 3 Lager, symmetrisch zum x/y-Tausch. Bot-Route: Reihenfolge in map.json (Dornenbock → Sumpfunke → Moosrudel → Schattenkrabbe → Glutwächter → Hohlkäfer).
- **Kesselbrut** (Voidgrubs): 3 Larven in der Schleier-Grube ab 6:00, Respawn 4:00, keine neue Welle nach 13:45, verbleibende Larven verschwinden um 19:45. Jede Larve = 1 Team-Stack (max 6), je +4 % Champion-Schaden gegen Gebäude. Radius 70 (< 130): keine Epic-Ansage, Bots behandeln sie nicht als Objective (ponytail).
- **Jägerzahn** stärker, damit der LoL-HP-Dschungel klappt: +80 % Schaden an Monstern (statt +30 %), Autos auf Monster +30 (+3/Level) True Damage und Heilung 6 (+1/Level). Gemessen (tools/scratch/jungleClear.ts, nur Autos + Bannen): Full-Clear 6 Lager ≈ 2:15 ab 1:30 (alt 5 Lager 1:20), Level 3 nach Buff + 2 Lagern ≈ 2:47. Ohne Jägerzahn ist ein Level-1-Clear nicht machbar (wie LoL).
- **Bot-Check** (4 Spiele × 15 min, Gold, gleiche KI): Jungler-Gold/min 195 → 197, Jungler-CS 31.6 → 24.1 (mehr Gold pro Monster, längere Clears).
- **Pflanzen** (Kind.Plant, 1 HP, nur Champion-Autos lösen aus, Bots ignorieren sie), je Seite 6 (3 pro Viertel), Wachstum 1:30, Nachwachsen 5:00: Sprungfrucht = Champions im Radius 380 springen 650 von der Pflanze weg, über Wände (Landepunkt bis +500 weiter, sonst kürzer); Honigfrucht = Heilung 60 + 6 % Max-HP und 25 % Slow 1,5 s im Radius 320; Spähfrucht = 3 Sichtpunkte (450/900/1350, Radius 380–560) 10 s in Richtung weg vom Angreifer. Datentyp `spaehbluete` → `spaehfrucht` umbenannt.
- **Wände**: map.json-Polygone organischer (mehr Ecken, Diagonalen, Halbmond-Gruben um Leviathan/Schleierwächter); die Kollision bleibt das Polygon, gerendert wird eine gerundete, gewellte Kontur (render/organic.ts, −35…+60 um das Polygon; UNIT_CLEARANCE 75 verhindert sichtbares Clipping). Kampf-Testgelände (6000, 8750) unverändert. Test: alle Lager/Pflanzen/Objectives von beiden Brunnen erreichbar.
