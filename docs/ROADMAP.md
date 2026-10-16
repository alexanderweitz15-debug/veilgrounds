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
- [x] Combo-Abnahme je Champion: alle Signature-Combos headless ausführbar (tests/combos.test.ts)
- [x] Telegraph-Audit: Anzeige = Sim-Hitbox für jede Fähigkeit (tests/telegraph.test.ts)
- [x] Fähigkeits-Icons zeigen, was die Fähigkeit ist (Feuer, Blitz, Haken, Netz …) + Typ-Abzeichen

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

Audit 2026-10-16 (Arbeitskopie inkl. noch nicht committeter Änderungen von Champion- und Balance-Agent). Methode:
Code-Lektüre, headless gemessen mit `tsx` (Sandbox-Duelle + 4-min-Bot-Match seed 7, 10 Bots Gold), Browser über
`vite preview` (1280×720, `?play=sandbox&bench`). Zeilen-Angaben mit Funktionsnamen, weil mehrere Dateien gerade
bearbeitet werden. LoL-Werte mit „ca.“ sind Richtwerte, nicht nachgemessen. `[~]` = ein anderer Agent arbeitet daran.
Screenshots: `~/.claude/projects/C--Users-Alex-Documents-Moba/aba13fc4-a91c-4600-bf36-e5fc8691a0d6/tool-results/`
(`mcp-Claude_Browser-blob-1792137888205-fa506z.jpg` Mira gegen Minion-Welle mit Einheits-Projektilen,
`mcp-Claude_Browser-blob-1792137855086-4rf6ev.jpg` Übersicht 720p). Mess-Skript: Scratchpad `measure.mts` (nicht im Repo).

### Auto-Attacks (Champions, Minions, Türme)
**Kritisch**
- [ ] **Lauf-Animation auf der Stelle beim Angreifen.** `buildSnapshot` (snapshot.ts ~Z. 229) setzt
  `moving: Move.mode !== 0`; wer ein Ziel in Reichweite hat, bleibt in Modus 2 (movement.ts `movementSystem`:
  „in range: attack system takes over“ → `continue`). Gemessen (4-min-Bot-Match): 24,1 % aller Champion-Snapshot-Ticks
  (8754/36373) und 24,4 % aller Minion-Ticks (57450/235427, davon 39751 in der Ausschwingphase) melden `moving` ohne
  Positionsänderung. Der neue Render-Code (championSprites.ts `push`:
  `!e.moving || now - a.atkHit < AFTER_MS`) bricht das Ausschwingen nach 95 ms ab und spielt dann den Lauf-Zyklus im
  Stand: Nahkampf-Minion ~0,47 s von 0,8 s Angriffszyklus, Caster ~0,95 s von 1,5 s, Fernkampf-Champion ~1,0 s von
  1,6 s. Im HEAD-Stand (den der Nutzer gespielt hat) hielt Phase 2 noch das letzte Angriffsbild, dort war das
  Minion-Problem die Schlagbild-/Lunge-Taktung (siehe `[~]` unten); mit dem neuen Render-Code wird das falsche
  `moving`-Flag zum Hauptproblem, weil das Ausschwingen nach 95 ms in den Laufzyklus kippt. LoL: zwischen zwei Autos Kampf-Idle, nie Laufen. Fix: `moving` aus
  echter Verschiebung (x≠px) oder „Modus 1 / Modus 2 außerhalb Reichweite“ ableiten (Sim/Snapshot, kein anderer
  Agent zuständig).
- [ ] **Wind-up zu lang.** Fernkampf `base.windup` 0,30, Nahkampf 0,30–0,35 der Angriffszeit (data/champions/*.json);
  gemessen 14 Ticks = 467 ms (Mira/Ilvane/Aurel/Corvin), 17 Ticks = 567 ms (Brom), 13 Ticks = 433 ms (Isolde);
  Klick→Schaden Fernkampf auf ~300 Distanz 18–20 Ticks (600–667 ms). LoL ca.: Schützen 15–22 % (≈ 0,25–0,3 s auf
  Stufe 1), Nahkämpfer meist 20–30 %. Folge: zähes Orbwalking, Last-Hits „kleben“. Fix: Fernkampf ~0,18–0,22,
  Nahkampf ~0,22–0,28 je Champion; danach botLastHit-Tests und Last-Hit-Trainer neu prüfen.
- [ ] **Keine Kollision Champion ↔ Minion/Champion.** movement.ts `separateMinions` schiebt nur Minions
  auseinander („Champions pass through units“). Gemessen: ~3200–3300 Champion-Ticks in 4 min (zwei Läufe), in denen ein Champion tief
  in einem Minion steht (Mittelpunkt-Abstand < halbe Radiensumme). LoL: Pathing-Kollision, Body-Block, Minions
  umstellen ihr Ziel, Geist-Effekt hebt das auf. Fix: weiche Champion↔Minion-Kollision (Minion weicht aus, Champion
  pfadet drum herum) + `ghosted`-Status; deterministisch halten.
- [~] **Angriffs-Animation ≠ Treffermoment.** HEAD (`git show HEAD:src/render/championSprites.ts`): Angriff mit fest
  12 fps über 5 Bilder (~417 ms, Schlagbild bei 167–250 ms) unabhängig vom 433–567-ms-Wind-up; Minions 4 Bilder,
  Schlagbild ~83 ms gegen Sim-Treffer 233 ms (Nahkampf) / 433 ms (Caster); Körper-Lunge Spitze 110 ms nach Start.
  → Champion-Agent (uncommitted: Schlagbild auf Phase 1→2, Lunge am Treffer, Wind-up geschätzt). Rest-Problem: der
  Snapshot kennt das Wind-up-Ende nicht, `windEstimate` nutzt nur Basis-AS + Wachstum (keine Item-/Buff-AS) → nach
  AS-Änderung ist die Ausholphase falsch getaktet. Fix: `atkEnd` (= `Atk.phaseEnd`) in `SnapEntity`.

**Wichtig**
- [ ] **Angriffs-Sound am Wind-up-Start.** audio/eventSounds.ts `soundForEvent` case `'attack'` spielt 433–567 ms vor
  Abschuss/Einschlag; Minion-Autos sind stumm, Einschläge auch. LoL: Schuss-Sound beim Abschuss, Einschlag-Sound am
  Ziel. Fix: Sim-Event beim Abschuss in attack.ts `fire()` (gibt es heute nicht) bzw. Phase 1→2 im Client, Einschlag
  an `damage` mit `auto: true`.
- [ ] **Kein Einschlag-Effekt.** Am Ziel nur 140 ms Aufhellung ×1,6 (units.ts `FLASH_MS`) + neu 9 Einheiten Zucken.
  LoL: Treffer-Funken/Partikel je Champion. Fix: kleiner Impact-Sprite am Projektil-Ende, nach Schadensart gefärbt.
- [ ] **Projektile alle gleich.** fx.ts `update`: jedes zielsuchende Projektil (Champion-Autos, Caster-Bolzen,
  Belagerer, Turm, gezielte Fähigkeiten) ist derselbe Ikosaeder-Klecks in Teamfarbe auf Höhe 110, gerade Linie, ohne
  Schweif, Start in der Körpermitte. LoL: eigene Missiles je Champion, Kanonenkugel im Bogen, Turm-Energiekugel.
  Fix: Missile-Stil je Einheit/Champion (Pfeil, Bolzen, Kugel, Bogen), Schweif, Start auf Waffenhöhe.
- [x] **Turm-Lesbarkeit.** (erledigt: Reichweitenkreis ab 350 vor der Grenze, rot + Ziel-Linie wenn er dich anvisiert; fx.ts) Kein Reichweitenkreis beim Annähern, keine Aggro-Linie zum Ziel; nur Rand-Vignette nach
  dem ersten Treffer (ui/cues.ts). LoL: Turmkreis taucht in der Nähe auf, rote Zielmarkierung vor dem Schuss. Fix:
  Kreis ab Abstand ≤ Reichweite + 300, Linie aus `atkTarget` (steht schon im Snapshot).
- [ ] **Kein Auto-Angriff im Stand.** attack.ts `acquire` läuft nur bei Angriffsbewegung; ein stehender Champion
  ignoriert Gegner in Reichweite. LoL-Standard „Automatisch angreifen“ an. Fix: Einstellung + Acquire bei Modus 0
  ohne Ziel (nicht nach Stopp-Befehl).

**Nice-to-have**
- [ ] Auto-Reset: nur 1 von 26 Champions (`dagny_q`, castTime 0,2 s → stehen bleiben); LoL-Resets sind sofort.
  Latent: ein `auto_reset` mit castTime 0 + Typ `self` setzt nur `nextReady` (abilities.ts `execute`), `castAbility`
  ruft dann kein `onMoveCommand` → die Ausschwingphase blockiert weiter. Fix: in `execute` auch `Atk.phase = 0`.
- [ ] Wind-up skaliert linear mit AS (attack.ts `windupTicks`) – prüfen, ob ein LoL-artiger Windup-Modifier bei
  hoher AS nötig ist.
- [ ] Angriffsbewegung nimmt den nächsten Gegner zum Champion (Reichweite + 200, `ACQUIRE_EXTRA`); LoL hat zusätzlich
  „Ziel am Cursor“ und die Taste „Nur Champions anvisieren“.
- [ ] Rechte Maustaste gedrückt über einem Gegner greift nicht an (controller.ts `rightClick` nur bei frischem
  Klick); in LoL schon.

### Bewegung
**Wichtig**
- [~] **Ruckeln zwischen 30-Hz-Snapshots.** Snapshot-Takt im Browser: p50 32,8 ms, p95 40,2 ms, Ausreißer 18,8 / 45,3
  ms; das alte Alpha („Zeit seit letzter Nachricht“) erzeugt Stopps und Sprünge. → in Arbeit (state.ts Ankunftsuhr +
  tests/interp.test.ts, uncommitted).
- [ ] **Dashes und Knock-ups sehen nach Rutschen aus.** Dashes laufen über `abilState.moves`, nicht `Move.mode` →
  aus dem Stand `moving = false` (aus dem Laufen bleibt Modus 1 → Laufzyklus); die Cast-Animation endet nach Wind-up + 280 ms (championSprites.ts `castLen`), lange Dashes
  dauern länger (Grimald R 542 ms, Vessa R 500, Dagny R 417, Oleth E 400) → Idle-Rutschen. Verdrängte/hochgeworfene
  Ziele (Buff `airborne`) gleiten am Boden, ohne Flugbogen. LoL: Dash-Animation über die ganze Strecke, Knock-up hebt
  an. Fix: Snapshot-Flags `dashing`/`airborne` + Hüpf-Bogen, Schweif.

**Nice-to-have**
- [ ] Blickrichtung springt in einem Tick um 180° (headless: `Face.x` +1 → −1), Sprite rastet auf 8 Richtungen.
  LoL dreht sichtbar (sehr schnell). Fix: Render-seitig Winkel über ~80 ms glätten vor `dirFromAngle`.
- [ ] Gedrückte rechte Maustaste pfadet nur alle 140 ms neu (controller.ts `HOLD_MOVE_MS`) → Lenken in ~7-Hz-Stufen.
- Geprüft, OK: Befehl → Bewegung im selben Tick (headless), im Browser 2–41 ms bis zum ersten bewegten Snapshot;
  Stopp exakt (7-Einheiten-Klick endet bei 7,00); Pfade mit String-Pulling, Wandgleiten.

### Fähigkeiten
**Kritisch**
- [ ] **Gezielte Fähigkeit außer Reichweite wird verschluckt.** abilities.ts `castAbility`: `if (tgt < 0) return; //
  ponytail: LoL walks into range first`. LoL: Champion läuft in Reichweite und wirkt dann. Fix: ausstehenden Cast
  merken, wie Modus 2 verfolgen, bei Reichweite auslösen (Abbruch durch Bewegungsbefehl).
- [ ] **Fehlgeschlagene Casts ohne Rückmeldung.** `castAbility` bricht bei Abklingzeit, Mana, Reichweite, CC oder
  „busy“ ohne Event ab; HUD kennt nur `cooling`/`unlearned` (hud.ts), kein „zu wenig Mana“. LoL: Symbol blau getönt,
  Fehlerton, „Nicht genug Mana“. Fix: Sim-Event `castFail` mit Grund (nur eigenes Team) → Ton + Text; HUD-Klasse
  `nomana` wenn Kosten > Mana.

**Wichtig**
- [x] **Nur Schnellzauber, keine Anzeige vor dem Wirken.** (erledigt: „Zauber mit Anzeige“ als Standard – Taste halten zeigt Reichweite + Form, loslassen wirkt, Esc bricht ab; Einstellung) controller.ts `cast()` sendet beim Tastendruck; kein
  Normal-Cast, kein „Schnellzauber mit Anzeige“ (Taste halten = Reichweite + Form, loslassen = wirken); C zeigt nur
  die AA-Reichweite. Fix: keydown → `castTelegraph()` am Cursor zeigen, keyup → senden; Modus je Taste einstellbar.
- [ ] **Kein Eingabe-Puffer.** `castAbility` verwirft Eingaben während Wind-up/Dash/Kanalisieren (`a.cast ||
  isBusy`), `castSummoner` blockt Sprung (Flash) während `isBusy`. LoL puffert den nächsten Zauber in Cast-Zeiten und
  Dashes und erlaubt Flash während vieler Wind-ups (R-Flash, Q-Flash). Fix: 1-Slot-Puffer (~0,25 s), ausgeführt wenn
  „busy“ endet; Flash im Wind-up erlauben.
- [ ] **Fähigkeiten sehen generisch aus.** Linien-Skillshots und gezielte Projektile sind derselbe Klecks wie Autos
  (fx.ts), unterscheidbar nur über Teamfarbe; Cast-Puls-Ring für alle gleich. LoL: eigener Missile-/Partikel-Look je
  Fähigkeit. Fix: `vfx`-Feld in den Champion-Daten (Farbe, Form, Schweif, Einschlag).
- [~] Cast-Animation war fest 320 ms (HEAD `CAST_MS`) bei castTime 0,2–0,5 s. → Champion-Agent (Dauer aus `ev.at`,
  uncommitted).

**Nice-to-have**
- [ ] Designfrage: gegnerische Linien-Skillshots zeigen den kompletten Bodenstreifen bis Max-Reichweite während
  Wind-up und Flug (fx.ts `addPreview` + Strips für beide Teams). LoL zeigt bei Gegnern nur das Projektil
  (Bodenanzeige nur bei verzögerten Flächen). Option „LoL-Telegraphe“ für Gegner.
- [x] Keine „bereit“-Rückmeldung, wenn eine Abklingzeit endet (erledigt: Symbol blitzt auf) (kurzes Aufleuchten des Symbols in LoL).

### Kampf-Lesbarkeit
**Kritisch**
- [ ] **CC und Buffs an Einheiten unsichtbar.** `SnapEntity` hat kein CC-/Buff-Feld; `ccLevel` steht nur in
  `PlayerHud.cc` und wird nur von Bots gelesen (keine Fundstelle in src/render, src/ui). Betäubung, Festhalten,
  Verlangsamung, Stille, Airborne sind weder bei Gegnern noch beim eigenen Champion zu sehen. LoL: CC-Partikel,
  Statustext über dem eigenen Champion, Buff-/Debuff-Leiste. Fix: `SnapEntity.cc` (stärkster CC + Rest-Ticks +
  Slow-%) → Symbol über der HP-Leiste, CC-Timer-Balken am eigenen Champion.

**Wichtig**
- [x] **Kein Schadens-„Chunk“.** (erledigt: Nachlauf-Balken in overlay.ts, 97bb63d) HP-Balken springt sofort (ui/overlay.ts `draw`); LoL zeigt den frischen Verlust als
  hellen Abschnitt, der nach ~0,5 s abläuft. Fix: nachlaufender HP-Wert je Einheit.
- [x] **Minion-HP-Balken bei vollem Leben ausgeblendet** (erledigt: immer sichtbar) (overlay.ts `draw`: `minion && hp >= maxHp && !hover →
  continue`, Kommentar „like LoL“). LoL zeigt alle Minion-Balken → Wellen-HP für Last-Hits vergleichbar. Fix: immer
  zeigen (Einstellung).

**Nice-to-have**
- [ ] Treffer-Aufhellung bei jedem Schadensereignis inkl. DoT-Ticks (×1,6, 140 ms) + neues 9-Einheiten-Zucken: im
  Teamfight flackert alles; LoL tönt dezent. Beobachten, ggf. für DoT/Minion-Ziele abschwächen.
- [x] 100-HP-Striche wechseln über 3000 Max-HP (erledigt: 100er bleiben, 1000er dicker) auf 1000er-Schritte (overlay.ts); LoL behält 100er + dickere 1000er.
- Geprüft, OK: 100-HP-Striche, Schild als weißer Abschnitt, Schadenszahlen nur eigene, Gold-Popup + Last-Hit-Ton.

### Kamera
- Gemessen: Neigung 56°, FOV 38°, Abstand 2750 (Mausrad 2000–3300 in 120er-Schritten); bei 1280×720 sichtbare
  Breite durch die Mitte 3367 Einheiten (2449 bei 2000, 4040 bei 3300), Champion ≈ 69 px = 9,5 % der Bildhöhe,
  38 px je 100 Einheiten; Rand-Scrollen 2600 E/s bei 10 px Rand; Leertaste zentriert solange gehalten, Y sperrt.
  Wirkt im Rahmen von LoL (ca. Champion 10–12 % Bildhöhe, nicht nachgemessen).
- [x] Nice-to-have: herauszoomen über den Standard (erledigt: Standard = Maximum 2750) (+20 % Sichtbreite bis 4040) gibt mehr Übersicht als LoL erlaubt
  (dort ist Standard = Maximum). Standard = Maximum setzen oder Maximum begrenzen.

### Zahlen
- Geprüft, OK: Lauftempo 335–345 (LoL 325–355), Minions 325, Nahkampf-Reichweite 125/150/175, Fernkampf 450–600,
  Minion-Werte (AS 1,25/0,667/1,0, Reichweite 110/550/300/170, Radius 48/48/65/65), Caster-Bolzen 650 (Abschuss →
  Schaden Median 34 Ticks ≈ 1,13 s), Turm 750 / 0,83 AS / Projektil 1200, Dash-Tempo 1200–1600.
- [ ] Nice-to-have: Fernkampf-Champions haben Radius 55, Nahkampf 65 (sim/systems/champions.ts Spawn-Default bzw.
  `base.radius`); in LoL haben fast alle 65 → Fernkämpfer sind 10 Einheiten je Seite schwerer zu treffen.
