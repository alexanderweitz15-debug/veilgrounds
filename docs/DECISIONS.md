# Entscheidungen und Abweichungen vom Prompt

Jede Abweichung vom Design-Prompt steht hier mit Grund. Neue Einträge oben.

## Maßstab (Scale-Agent, 2026-10-16)

Nutzer: „Camps viel zu klein und hässlich, Map-Größe passt nicht, alles wirkt abgecrackt“. Gemessen headless
(`tools/scratch/scaleMeasure.ts`: Abstände, freier Radius = Abstand Lagermitte → nächstes Wand-Polygon, Spurbreiten,
Engstellen) und im Browser (1280×720, Figurhöhe = `units.spriteHeight`, projiziert entlang der zur Kamera
geneigten Sprite-Achse). LoL-Werte sind Richtwerte („ca., nicht nachgemessen“).

| Größe | Veilgrounds vorher | jetzt | LoL (ca.) |
|---|---|---|---|
| Kartenkante | 16000 | 16000 (unverändert) | ≈ 14870 |
| Nexus → Nexus (Mid) | 17536 | unverändert | ≈ 16400 |
| Brunnen → Nexus | 1273 | unverändert | ≈ 1500 |
| Außenturm → gegn. Außenturm Mid / Seite | 4525 / 5798 | unverändert | ≈ 3800 / 4800 |
| Turmabstände Mid (außen→innen→Inhib) | 1980 / 2121 | unverändert | ≈ 1800 / 1800 |
| Turmabstände Seite | 3600 / 3100 | unverändert | ≈ 3700 / 2400 |
| Spurbreite (offen, Wand zu Wand) Mid / Seite | 1000–1300 / 1950–2200 (Kartenrand) | unverändert | ≈ 900–1200 / 1300–1600 |
| Wandstärke Viertel-Wände (max.) | 560–940 | 330–940 | ≈ 300–1000 |
| Dschungel-Engstellen (Wand zu Wand, vor Nav-Abstand 2×75) | 250–310 (Basis→Wölfe, Wölfe→Fluss, Blau→Baron) | ≥ 380–440 | ≈ 400–600 |
| Freier Radius Blau-/Rot-Buff | 363 | **628** | ≈ 550–700 (Nische) |
| Freier Radius Gromp/Raptoren-Lager (Sumpfunke/Hohlkäfer) | 415 | **582** | ≈ 500–650 |
| Freier Radius Wölfe/Krugs (Moosrudel/Schattenkrabbe) | 580 | **661** | ≈ 550–700 |
| Freier Radius Drachen-/Baron-Grube | 775 | unverändert | ≈ 750–850 |
| Gemalte Lichtung (Bodenscheibe) Buff / klein / Grube | 430 / 430 / 900 | **560 / 500** / 900 | – |
| Kamera-Abstand (Standard = Maximum) | 2750 | **2500** | – |
| Champion-Figurhöhe auf dem Schirm | 170 Einheiten = 9 % | ≈ 10 % | 10–12 % |
| Melee-/Caster-Vasall | 100 (0,6× Champion) | unverändert | ≈ 0,6× |
| Turm | ≈ 3× Champion, Radius 88 | unverändert | ≈ 3×, Radius 88 |
| Inhibitor / Nexus (Sim-Radius) | 140 / 220 | unverändert | ≈ 150 / 250 |

Monster-Figurhöhe relativ zum Champion (170), `MONSTER_DRAWERS.world` (Zellhöhe) angepasst:

| Monster (LoL-Pendant) | vorher | jetzt | LoL (ca.) |
|---|---|---|---|
| Dornenbock / Glutwächter (Blau/Rot) | 2,7× | 2,7× (640) | 2–2,5× |
| Sumpfunke (Gromp) | 1,3× | **1,7×** (330 → 430) | 1,5–1,8× |
| Mooswolf (großer Wolf) / Welpe | 1,1× / 0,7× | **1,4× / 0,84×** (340 → 430, Skala 0,6) | 1,3–1,5× / 0,8× |
| Hohlkäfer (Raptor-Anführer) / Käferling | 0,8× / 0,5× | **1,2× / 0,66×** (300 → 440, Skala 0,56) | 1,1× / 0,6× |
| Schattenkrabbe (Ur-Krug) / Krabbling | 1,1× / 0,65× | **1,6× / 0,92×** (330 → 480, Skala 0,58) | 1,6–1,8× / 1× |
| Nebelschleicher (Scuttle) | 1,1× | **1,2×** (340) | 1,2× |
| Flussleviathan (Drache) | 2,9× | **3,6×** (700 → 860) | 3,5–4× |
| Schleierwächter (Baron) | 3,9× | **4,9×** (820 → 1040) | ≥ 5× |
| Kesselbrut (Voidgrubs) | 0,7× | **0,9×** (290) | 0,8–1× |

| Thema | Entscheidung | Grund |
|---|---|---|
| Kartengröße | 16000 und alle Gebäude-/Spur-Koordinaten bleiben (≈ +8 % gegenüber LoL, Spuren zwischen Außentürmen ≈ +20 %) | Umskalieren würde Wellen-Spawnpunkte (1:28/1:38), die 107-CS-Abnahme, die Bot-Kalibrierung des Pacing-Agenten und zahlreiche Test-Koordinaten entwerten; der Eindruck „passt nicht“ kam von engen Lagern und zu kleinen Monstern, nicht von der Gesamtgröße. `waves.ts` unverändert |
| Lager-Geometrie | Viertel-Wände um die drei Lager geschrumpft (nur verkleinert, nie verschoben: Erreichbarkeit bleibt), Engstellen Basis→Wölfe, Wölfe→Fluss, Blau→Baron verbreitert; Lager-, Pflanzen- und Gebüsch-Positionen unverändert | Lager standen in 300er-Gassen, der Golem (Radius 110) hatte ≈ 180 Einheiten Platz bis zur sichtbaren Klippe |
| Lager-Optik | `terrain.ts campSite`: Lichtungsradius pro Typ, freie Richtung pro 15°, Wahrzeichen an der nächsten Wand (sonst gegenüber dem Hauptweg), zwei Eingänge bleiben frei. Boden: ausgetretene Erdscheibe mit ausgefranstem Rand, hellere Mitte, Buffs mit leuchtendem Doppel-Runenkreis + Glyphen, kleine Lager mit eingelassenem Plattenring, Kratzspuren (Wölfe/Käfer), Tümpel (Sumpfunke), Risse (Krabben). Rand: Menhire, Steine, Baumstämme, Knochen, leuchtende Pilze, Kristalle, Nest; Buffs: 7 Runensäulen mit leuchtender Spitze, Monolith 340 hoch, Bodenglühen ≈ 2,3× Lichtungsradius | Lager sollen auf einen Blick als Lager lesbar sein (LoL), Requisiten in Champion-Maßstab statt Kiesel |
| Große Monster-Atlas | Zelle 160 → 200 px, Master 256 → 320 (4096²) | Baron/Drache wurden größer gezeichnet und wären sonst unschärfer |
| Lebensbalken | Breite nach Monster-Radius (ui/overlay.ts, Lead) unverändert; der Anker folgt automatisch der größeren Figurhöhe (`barAnchor` → `spriteHeight`) | UI gehört dem Lead |
| Animation | Monster laufen über dieselbe Sprite-Pipeline wie Champions (Anlauf über die gemessene Wind-up-Zeit, Treffer-Frame bei atkPhase 1→2, Tod als Leiche) – unverändert | bereits synchron |

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

## Bot-Kalibrierung Phase 3/4 (Bot-Agent, 2026-10-15)

Messung: `npm run bot-sim -- --rank=<r> --games=6 --minutes=15` (Seeds 1–6) und `--games=2 --minutes=25`; Rang-gegen-Rang mit `--vs=<rang>` (Rot spielt den zweiten Rang). Stand auf dem Baum mit Dschungel-Überarbeitung (Commit d8ad6a0 + Bot-Änderungen).

| Kennzahl | Iron | Gold | Challenger | Tabelle A (I / G / C) |
|---|---|---|---|---|
| Laner-CS/min, 15 min, vorher (3 Seeds) | 2,02 | 2,40 | 2,06 | 5,0 / 6,8 / 8,6 |
| Laner-CS/min, 15 min, jetzt (6 Seeds) | 2,48 | 3,20 | 3,80 | |
| Laner-CS/min, 25 min, jetzt (2 Seeds) | 3,02 | 3,63 | 3,96 | |
| Mid-CS/min (25 min) | 2,9 | 3,2 | 2,3 | |
| Dschungel-CS/min (25 min) | 3,4 | 2,2 | 1,6 | – |
| Kills pro Spiel (gesamt, 25 min) | 6 | 9,5 | 8 | ~ 2 × 6–8 pro 32 min |
| Gold/min (alle Bots, 25 min) | 203 | 212 | 198 | 410 / 465 / 520 |
| Wards/min Support | 0,26 | 0,30 | 0,30 | 0,45 / 0,69 / 0,94 |
| Gold vs. Silber / Diamant vs. Gold (6 × 25 min, Sieg = Nexus oder mehr Teamgold) | | 3/6 | 3/6 (Dia vs. Gold) | ≳ 65 % / ≳ 80 % |

| Thema | Spec | Entscheidung | Grund |
|---|---|---|---|
| Last-Hit-Vorhersage | §7, Tabelle B lastHitJitterMs | `src/ai/bot/lasthit.ts`: Minion-HP-Verlauf aus den sichtbaren Angriffs-Events (Wind-up-Start eigener Minions/Türme, Projektilflug, gesehener Schaden), Kill-Fenster, eigener Auto mit Wind-up + Flug + Laufweg in das Fenster gelegt; Zauber-Last-Hit (gezielt/Linie) wenn der Auto zu spät käme | Vorhersage trifft den Todestick in > 75 % exakt (Test); kein Sim-Hook nötig |
| Rangfehler beim Farmen | lastHitJitterMs, errorInjectionPct | Zeitfehler N(0, Jitter) **einmal pro Minion** (nicht pro Takt), Aufmerksamkeits-Aussetzer = errorInjectionPct × 0,5 (`LAPSE_SHARE`) einmal pro Minion | Pro-Takt-Würfe mitteln sich weg bzw. kosten jedes knappe Fenster |
| Abstand von Tabelle A | ±10 % (Abnahme) | **nicht erreicht** (≈ 45–50 % der Zielwerte, Rang-Abstufung stimmt: Iron/Gold/Chall ≈ 0,65/0,84/1) | Struktur: erste Welle trifft erst bei 1:35–1:45, ≈ 11 Lane-Minions/min pro Lane; Turmschüsse (80 % Caster-HP) lassen kein Fenster; viele Trades → Recalls/Laufwege (≈ 35–40 % der Lane-Minions sterben, während der Bot weg ist). csAt10-Ziele (78–105) liegen über dem, was bis 10:00 überhaupt spawnt |
| Gruppieren/Belagern | §8 groupAfterFirstTowerPct | Ab 14:00 alle 3 min neu gewürfelt (Turm gefallen ×2), Gruppe = Jungler + Support + Mid (+ Side-Laner außer bei sideLaneFarmAfter15Pct), Ziel = nächster gegnerischer Turm der am weitesten gepushten Lane, Welle crashen; Turm-Schläge nur mit eigenen Minions am Turm | Vorher: ein Wurf, dann nie; danach alle fünf in einer Lane → CS aller Ränge ≈ 2,9 |
| Objectives | §8 | Drache: Jungler + Support + nächster Laner; Kesselbrut: Jungler + Support; Baron: Team, Start erst mit 4 am Pit; kein Neustart desselben Objectives für 180 s; Machbarkeit mit skalierten Monster-HP (Baron +180/min ab 20:00, sonst Ø-Level) | Laner verloren 14 % ihrer Zeit an Drachen-Versuche |
| Smite | §8 „Erfolg am Reaktionsjitter“ | HP-Abfall seit dem letzten Blick → HP beim nächsten Blick; Smite wenn ≤ Smite-Schaden; Zeitfehler lastHitJitterMs | Secure und Steal mit demselben Modell |
| Wards | §2 Vision-Achse | Ward-Spots pro Rolle/Seite in `data/bots/wardSpots.json` (blau, rot gespiegelt) + Büsche; Siegelward-Kauf pro Brunnenbesuch mit Wahrscheinlichkeit Tabelle-A-Kontrollwards/3 und Knob controlWardBuyGold; Platzierung auf Objective/Fluss-Spots im Vorbeigehen; Suchfeuer ab Stufe 9 (Support/Jungle, useSweeper, Gold+) | Daten statt Code |
| Fehler chase_third_kill / overcommit_after_kill / ignore_minion_aggro | §6 | Nach 2 Kills Ziel im Nebel verloren → Jagd trotz wenig HP; nach Kill All-in ohne Turm-/Rückzugsabbruch für 10 s; im gegnerischen Minion-Pulk Champion anklicken (alle 10 s gewürfelt) | Raten aus errors.json, im Log mit injectedError |
| Tilt | §4.2 | +1 pro Tod, −1 pro Kill oder 120 s, max 3; `withTilt` jetzt zur Laufzeit angewendet (war nie aufgerufen) und geloggt (`tilt`) | |
| Log-Drosselung | §1 | Identische Entscheidung (Knoten, chosen, reason, Fehler) desselben Bots innerhalb 150 Ticks wird verworfen (Herzschlag alle 5 s) | Vorher pro Takt ein Eintrag |
| Offene Punkte | | Spiele dauern 40–45 min, Kills 6–10 pro 25 min (Ziel ≈ 30 bis 25 min); höherer Rang gewinnt nicht messbar öfter (3/6); All-ins enden meist per Timeout oder unter dem Turm | Sim-Balance (Schaden/HP/Turm) + Kampf-Logik, nächster Schritt |

## Mechanik-Feeling (Mechanik-Agent, 2026-10-16)

Wind-up = Anteil der Angriffszeit (`base.windup`, Champion-JSON), Ticks = round(30 × windup / AS). LoL-Richtwerte
(ca., nicht nachgemessen): Schützen 15–22 % (Jinx 16,9, Caitlyn 17,7, Ashe 21,9), Magier 15–25 %, Nahkämpfer 20–30 %.

| Gruppe | Champions | windup vorher → jetzt | Wind-up Stufe 1 |
|---|---|---|---|
| Schützen (ADC, Ottilie) | mira, wren, tobin, ottilie 0,18; lysa 0,17; corvin 0,19 | 0,30 → 0,17–0,19 | 8 Ticks ≈ 270 ms (vorher 14 = 467 ms) |
| Fernkampf-Magier/Supports | aurel, ferris, ilvane, kiran, lio, nyx, oda, seraphyne, thessaly | 0,30 → 0,20 | 10 Ticks ≈ 320 ms |
| Kämpfer/Assassinen (Nahkampf) | isolde 0,22; kaelen, renn, vessa 0,23; harrow 0,24; dagny 0,25 | 0,30–0,35 → 0,22–0,25 | 10–12 Ticks |
| Tanks/Juggernauts | grimald 0,26; brom, gorvam, hagen, oleth 0,27 | 0,35 → 0,26–0,27 | 12–13 Ticks (Brom vorher 17) |

| Thema | Entscheidung | Grund |
|---|---|---|
| AS-Skalierung des Wind-ups | bleibt linear (Wind-up-Anteil konstant, `attack.ts windupTicks`) | entspricht LoLs Standard (Windup-Modifier 1); kein Champion braucht bisher einen abweichenden Modifier |
| Minion-Wind-up | unverändert 0,3 (`spawnUnit`-Default, Balance-Agent) | Last-Hit-Vorhersage der Bots (`MINION_WINDUP`) und Wellen-Balance hängen daran |
| `moving` im Snapshot | nur wenn die Einheit im letzten Tick gelaufen ist (Pfad-/Verfolgungsschritt); Dash, Flash, Kollisionsschub zählen nicht | Laufzyklus im Stand beim Angreifen (24 % der Champion-Ticks) |
| Einheiten-Kollision | Champions und Lane-Minions: Champion↔Minion/Champion halten 75 % der Radiensumme Abstand (weich, 50 % der Überlappung je Tick); Minion weicht 80 % aus, vor einem laufenden Champion seitlich; Minion↔Minion unverändert; Dash/Knockback (`abilState.moves`) und Geist ignorieren Kollision; Monster, Pets, Dummies ausgenommen | LoL-Pathing-Radien kleiner als Trefferradien; Lager/Tests bleiben stabil |
| Gezielte Zauber außer Reichweite | Champion läuft hin und wirkt in Reichweite (Ziel tot/unsichtbar → stehen bleiben); Abbruch durch Bewegen/Stopp/Angriff/Rückruf/neuen Zauber; auch Entflammen/Erschöpfen/Bannen | LoL |
| Eingabe-Puffer | 1 Platz, 8 Ticks (≈ 0,25 s) bzw. bis zum Ende des laufenden Wind-ups; ein Druck während eigenem Wind-up/Dash/Kanalisieren/Teleport wird danach ausgeführt | R-Flash/Q-Flash-Kombos |
| Flash im Wind-up | sofort während eines nicht gezielten Wind-ups (Zauber löst dann von der neuen Position aus); während eines gezielten Wind-ups, Dashes, Kanals: gepuffert | gezielte Wind-ups prüfen die Reichweite beim Auslösen nicht mehr (sonst Treffer aus 800+ Entfernung) |
| `castFail`-Event | Gründe cooldown/mana/range/cc/busy/target/unlearned; nur in der Ansicht des Wirkenden | Rückmeldung wie LoL („Nicht genug Mana“) |
| Automatisch angreifen | `PlayerSetup.autoAttack`: stehender Champion greift den nächsten Gegner in Reichweite an (keine Strukturen/Wards, keine Verfolgung, nicht nach Stopp bis zum nächsten Befehl, nicht beim Rückruf/unsichtbar); Sim-Default aus, Client setzt es für den Menschen (`game/modes.ts withClientSettings`, Default an) | Bots/Tests steuern Autos selbst |
