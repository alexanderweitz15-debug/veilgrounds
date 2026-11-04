# Entscheidungen und Abweichungen vom Prompt

Jede Abweichung vom Design-Prompt steht hier mit Grund. Neue Einträge oben.

## Master-Prompt „Nächstes Level" (29 Agents): Pfad-Mapping und Abweichungen (A29 Integrator, 2026-10-24)

Der Master-Prompt beschreibt Pfade eines Neuprojekts. Das Repo hat diese Struktur nicht; Besitzbereiche gelten
deshalb für die **realen** Pfade unten. Bestehende Systeme werden erweitert, nicht neu gebaut.

| Prompt | Reales Repo |
|---|---|
| `src/render/loader*` | `src/render/sheets.ts`, `atlasStore.ts`, `spriteWorker.ts`, Bake-Teil von `src/render/champions/atlas.ts`; neu `src/render/loader/**` |
| `public/`, `assets/` | `public/` enthält nur Icon/Manifest/Service-Worker. **Es gibt keine Bilddateien**: alle Sprites, Icons und das Terrain werden prozedural im Code gemalt (Canvas 2D, im Worker gebacken, IndexedDB-Cache) |
| `src/core/contracts.ts` | existiert noch nicht. Heutige Verträge: `src/sim/protocol.ts` (Sim↔Client), `src/sim/snapshot.ts`, `src/sim/types.ts`, `src/ai/contract.ts` (Bot). Der Integrator legt `src/core/contracts.ts` an, sobald Welle 1 neue gemeinsame Typen braucht |
| `data/items/**` | `src/data/items.json`, Schema `src/sim/items/schema.ts`, Effekte `src/sim/items/itemHooks.ts` |
| `data/champions/<name>/kit.json` | `src/data/champions/<id>.json` (Werte/Texte) + `src/sim/champions/<id>.ts` (Hooks = Code) + Optik in `src/render/champions/kits.ts` + `src/data/builds/<id>.json` |
| `src/ai/combat`, `macro`, `profiles` | `src/ai/bot/*`, `src/ai/reflex/*`, `src/ai/utility/*`, Profile `src/data/bots/profiles/*.json` + `src/ai/profiles/*` |
| `assets/units/**` | `src/render/champions/**` (prozedurale Paper-Doll-Rigs) |
| `src/render/anim/**` | `src/render/champions/anim.ts`, `src/render/championSprites.ts`, `src/render/spriteTiming.ts` |
| `src/render/vfx/**` | `src/render/fx.ts`, `particles.ts`, `telegraph.ts`, `sevFx.ts` |
| `src/audio/**` | `src/audio/sfx.ts`, `eventSounds.ts` (prozedural, keine Dateien) |
| `src/render/camera/**` | `src/render/camera.ts` |
| `src/ui/shop/**` | `src/ui/shop.ts`, `shopLayout.ts`, `shop.css` |
| `tools/benchmark/**` | `tools/botSim.ts` existiert (Report, `--jobs`, `--brain=new`); Erweiterung statt Neubau |

Abweichungen, mit Grund:
- **Branches:** Agents arbeiten auf lokalen Branches `feat/a<nr>-<thema>` in eigenen Worktrees; gepusht wird nur der
  Sammelbranch dieser Sitzung (`claude/veilgrounds-next-level-f6na23`), weil die Sitzung nur dorthin pushen darf.
- **Parallelität:** Die Maschine hat 4 Kerne / 15 GB. Die volle Testsuite braucht allein ~4 min auf allen Kernen.
  Statt ~6 laufen höchstens 2–3 Arbeits-Agents gleichzeitig.
- **Schaden auf dem Hit-Frame (A3):** Die Sim läuft deterministisch mit 30 Hz im Worker, auch headless für Bots und
  Replays. Render-Animationen dürfen den Schadenszeitpunkt deshalb nicht bestimmen. Umgekehrt ist es richtig und
  schon so gebaut: die Sim legt den Wind-up fest, die Animation trifft genau darauf (`spriteTiming.ts`).
- **„Klick → Bewegung im selben Frame" (A9):** Ohne Client-Vorhersage unmöglich (Sim im Worker, 33 ms Takt). Ziel
  wird: Klick-Marker und Blickrichtung im selben Frame, Bewegung im nächsten Sim-Tick.
- **Winrate 47–53 % aus 1.000 Matches (A28):** Statistisch nicht prüfbar. Bei ~47 Champions spielt jeder ~210 Partien;
  der Standardfehler ist dann ±3,4 Punkte, das 95-%-Intervall ±6,7. Für ±3 Punkte braucht es ~1.100 Partien je
  Champion, also ~5.000 Matches. A28 muss das Ziel als Konfidenzintervall formulieren.

## Gehirn-Rework Phase 1: Reflex-Schicht + Angriffs-Scheduler – Gate-Messung (S, 2026-10-22, main f343d7b)

Gemessen vom Aufsichts-Agenten in einem sauberen Worktree auf f343d7b (A1 4ce5cc5 gemergt, Hitbox 65 aktiv):
`npm run bot-sim -- --rank=gold --games=4 --minutes=20 --seed=101 --variance=0 [--reflex=true] --report`
(Seeds 101–104, dieselben Aufstellungen beide Läufe; Reflex-Schicht ist im Spiel nur über den Beta-Schalter aktiv).

| Kennzahl (Gold, 4 × 20 min) | Reflex aus (bisheriges laneLeaf) | Reflex an | Ziel §1/§11 |
|---|---|---|---|
| Laner-CS/min bei 15:00 | 3,52 | **3,80** | 6,5 |
| Laner-CS/min Partieende (20 min) | 3,80 | **4,33** | 6,8 |
| Angriffsauslastung Laner 2:00–14:00 | 0,29 | **0,39** | > 0,50 (Gate Phase 1) |
| Idle-Anteil Laner (Ziele in Reichweite) | 0,101 | **0,042** | ≤ 0,10 |
| Kills/Partie (beide Teams) | 16,0 | 14,5 | 50 |
| Erster Turm (min, 2/4 Partien) | 17,1 | 16,6 | 14 |
| Platten je Team bis 14:00 | 4,0 | 2,25 | 4 |
| Tode ohne gegnerischen Champion | 2,5 % | 4,0 % | ≤ 4 % |
| Harass-Autos je Laner bis 14:00 | 1,3 | 4,2 | ≥ 40 (Gate Phase 2) |
| Abwesenheitsverlust bis 15:00 | 27,2 % | 30,3 % | ≤ 12 % |
| CS-Verlust `timing_miss` / `in_range_no_attack` | 15,1 % / 13,1 % | 10,9 % / 14,4 % | – |
| Reflex-Kosten ms/Bot/Tick | – | 0,150 (unter Last; A1 allein 0,04) | 0,05 |

S-Prüfung des Lane-allein-Gates auf f343d7b (`--scenario=laneAlone --rank=<r> --games=3 --seed=1 --minutes=10 --variance=0 --reflex=true`, Mira mid, Autos only):

| Rang | S (Seeds 1/2/3) | Ø / min | A1 (a1.md, vor Hitbox 65) | Gate |
|---|---|---|---|---|
| Iron | 85 / 73 / 84 | 80,7 / 73 | 79 / 76 / 70 (Ø 75,0) | ≥ 70 **erfüllt** |
| Gold | 91 / 93 / 80 | 88,0 / 80 | 94 / 86 / 89 (Ø 89,7) | ≥ 88 **gerade erfüllt** (Seed 3 = 80) |
| Challenger | 100 / 92 / 97 | 96,3 / 92 | 102 / 101 / 99 (Ø 100,7) | ≥ 100 **nicht erfüllt** |

Vorher (altes laneLeaf): Iron 51, Gold 65, Challenger 93. Die A1-Zahlen stammen von Branch 289c506 vor dem Merge der Fernkampf-Hitbox 55 → 65 (b358b80); auf main liegt Challenger 4 Punkte darunter – die größere Hitbox verschiebt Reichweite/Stehpunkt der Fernkämpfer (Mira), die Fenster-Kollisionen (`window_collision` 0,9 → 1,9 %) nehmen zu. A1 muss Lane-allein nach Hitbox 65 neu kalibrieren (Stehpunkt-Puffer, Vorbereitung der Fenster).

Gate-Stand Phase 1 (§11): **nicht grün.** Erfüllt: Iron- und (knapp) Gold-Lane-allein, Tests 1, 2, 3, 11, 12 grün, Reflex an in 5v5 nicht schlechter als aus (CS +0,3 / +0,5, Idle 10 % → 4 %, Auslastung +10 Punkte), Determinismus grün. Nicht erfüllt: Challenger Lane-allein 96,3 < 100 (nach Hitbox 65), Angriffsauslastung Gold 5v5 0,39 < 0,50 (A1: braucht Phase 2 – Harass-Filler mit Budget, Wellenzustände als Zielbild), Test 4 übersprungen (Gold Stehpunkt: 1 `out_of_range`-Abbruch), Test 5 übersprungen (Harass 11 Autos/3 min statt ≥ 12, 4 Minions verloren), Reflex-Kosten 0,15 ms unter Last (Test 11 nur Regressionsschranke 0,5). Platten je Team sinken mit Reflex (4,0 → 2,25) – Laner stehen nach dem Crash nicht mehr am Turm; gehört zu Phase 3 (Platten-Intent). Entscheidung: Phase 2 darf parallel beginnen, weil die 5v5-Auslastung ohnehin Phase-2-Arbeit ist; Challenger-Lane-allein ≥ 100 und Test 4 bleiben Phase-1-Pflicht und werden beim Phase-2-Gate mitgemessen. Der Beta-Schalter bleibt Standard aus.

## Beta-Schalter „Neues Bot-Gehirn" (Lead, 2026-10-20; Eintrag S)

| Thema | Spec / Prompt | Entscheidung | Grund |
|---|---|---|---|
| Aktivierung des Gehirn-Reworks im Spiel | BRAIN-REWORK §11/§12: Reflex-Schicht und Nutzenmodell gehen erst nach grünem Gate auf main bzw. „Umschalten erst, wenn A1s Phase 2 auf main ist" | Beide liegen auf main, aber hinter **einem** Einstellungs-Schalter „Neues Bot-Gehirn (Beta: Reflex-Schicht + Nutzenmodell)" (`settings.newBrain`, Standard **aus**; `withClientSettings` setzt `SimConfig.botReflex` + `botUtility`, der Worker gibt `reflex` an den `BotRunner`, der Runner `utility` an `BotStatic`). Headless: `bot-sim --reflex=true` bzw. `BOT_UTILITY=1` getrennt | Der Nutzer will das neue Gehirn im Spiel ausprobieren können, bevor die Gates grün sind; mit Standard „aus" bleibt die Live-Partie bit-identisch zum bisherigen Verhalten (A2: Hash `a5913c9c` Flag aus = main; A1: Reflex nur mit Option). Ein Schalter statt zwei, weil das Nutzenmodell ohne den Scheduler im Farm-Intent (A1) nicht sinnvoll messbar ist und beide zusammen die „Beta" sind |
| Umschalten auf Standard „an" | – | erst, wenn Phase 2 (A1) und Phase 3 (A2) nach review-checklist.md gemessen grün sind und ein 4-Partien-Gold-Lauf mit Schalter an in keiner Kennzahl aus Tabelle A schlechter ist als mit Schalter aus | §11 Gate-Regel bleibt für den Standard; die Beta ist eine Vorschau |

## Fernkampf-Hitbox 55 → 65 (Agent B5, Nutzerentscheidung 19.10., Commit b358b80; Eintrag S)

| Thema | Spec | Entscheidung | Grund |
|---|---|---|---|
| Hitbox-Radius Fernkämpfer | spec-champions: 55 (Nahkampf 65); AGENTS-PLAN B5: „prüfen, Default bleibt 55, Entscheidung mit Nutzer" | **65** für die 15 Fernkämpfer (`base.radius` in aurel, corvin, ferris, ilvane, kiran, lio, lysa, mira, nyx, oda, ottilie, seraphyne, thessaly, tobin, wren); Nahkampf unverändert 65 | LoL-näher (alle Champions dort ~65 Gameplay-Radius); vom Nutzer so entschieden |
| Folgen für Tests | – | `tests/phase1.test.ts`: der Skript-Last-Hitter hält seinen Abstand jetzt relativ zur Champion-Kante (395 + Radius = früher 450 bei 55); mit festem 450 fiel das gierige Skript auf 49 CS, jetzt 99 CS bei 65. `tests/combat.test.ts` angepasst; `tests/hooksE/hooksF` (Corvin-Fass, Vessa R) prüfen die CC jetzt im Treffmoment (f343d7b, Lead) | größere Hitbox = frühere Treffer von Skillshots, die Tests prüften einen Tick zu spät |
| Nicht gemessen | – | Wirkung auf Bot-Kennzahlen (Trades, Skillshot-Trefferquote, CS) nicht separat gemessen; die Phase-1-Messung unten läuft bereits mit 65 | Bot-Messungen vor/nach 65 wären ein eigener Lauf; Balance-Folgen (tools/balance.ts) beim nächsten Balance-Durchgang prüfen |

## Integration aller Agenten-Branches ohne Gate-Review (Lead auf Nutzeranweisung, 2026-10-19; Eintrag vom Aufsichts-Agenten S)

Abweichung von BRAIN-REWORK §11/§12 („kein Merge vor grünem Gate, Gates misst der Aufsichts-Agent") und AGENTS-PLAN §2 („kein Merge mit roten Tests oder ohne DECISIONS-Eintrag"): Der Nutzer hat am 16.10. alle Agenten gestoppt und die Zusammenführung aller Branches auf main angeordnet, damit nichts verloren geht und die Agenten vom gleichen Stand weiterarbeiten. Merge e576592 (A3 → B → A1 → A2 → C → D → E), Folge-Commits 45d0622 (rote Tests übersprungen, `bot-sim --reflex=true`) und e0f40bb (Wren-Passiv-HUD, Reflex-Gate-Tests schalten die Reflex-Schicht jetzt wirklich ein). Kein Gate ist gemessen; die Gate-Messung je Phase bleibt offen (status.md).

| Was liegt auf main | aktiv? | Grund / Bedingung |
|---|---|---|
| A1 Phase 0: bot-sim-Kennzahlen (csLossByCause, Auslastung, Idle, Harass, Platten, Konversion, Kosten), `--report`, `--variance=0`, `--scenario=laneAlone` | ja (Werkzeug) | Messbasis vorhanden; Gold/Diamant/Challenger-Baseline im Bericht a1.md noch Platzhalter (`SEE_BASELINE_TABLE`, `LA_*`, `GATE_TEXT`) |
| A1 Phase 1: Reflex-Schicht (src/ai/reflex/**, plan.ts), laneLeaf nutzt den Scheduler | **nein** im Spiel: `src/sim/worker.ts` baut `new BotRunner(config)` ohne `reflex`; an nur in `runLaneAlone()` und `bot-sim --reflex=true` | Gate rot: Lane-allein Iron 69 (< 70), Gold out_of_range-Abbrüche; Lead-Messung Gold Seed 1, 12 min, `--variance=0`: Laner-CS/min Reflex aus 3,08, an **2,68** (schlechter) |
| A2 Phase 3/4-Gerüst: Nutzenmodell (src/ai/utility/**, values.json), §6-Kampfänderungen | **nein**: `BOT_UTILITY=1` (Env, im Browser nie gesetzt); Flag aus = bit-identisch (Hash 8643ddf8, A2-Bericht) | Lead-Messung mit Flag: Laner-CS/min 3,33, aber Recalls 1,36/min, Roams 0 → Wertkalibrierung offen; Umschalten erst nach A1 Phase 2 (§12) |
| A3 Phase 5-Vorbereitung: Aufmerksamkeitsmodell, Fehler-Episoden, Profil-/Achsen-/errors-Daten, F9-Spalten | **nein**: nichts ruft `observeAttention`/`startErrorEpisode` (Verdrahtung A3-4..A3-9 bei A1/A2) | vom Aufsichts-Agenten geprüft (unten) |
| B1 Ward-Stealth-Regel, B2 movesWhileCasting (26×4 + Beschwörer), B3 Snapshot-Felder | ja (Sim) | B-Bericht: volle Suite nach B2 806/807 (telegraph-Timeout unter Last), nach B3 nicht erneut; Branch-bot-sim nicht beendet |
| C1 FEATURE-GAP, C2 Scoreboard/Todestimer, C3 HUD, C4 Pings/Chat, C6 Post-Game | ja (UI) | Screenshots in docs/ist/c2-*, c3-*, c6-*; 5-Minuten-Browserprüfung durch S (AGENTS-PLAN §2) **offen** |
| D: abilityMotifs.json + abilityTheme (WIP, „NOT tested") | ja (Render) | Lead-Fix „motif JSON cast"; D1-Audit nicht begonnen |
| E: docs/champions/sev.md (Spec) | – | kein Sev-Code |

Übersprungene/aufgeschobene Tests (Eigentümer, Bedingung zum Wiedereinschalten):
- `tests/brainReflex.test.ts` `describe.skip` Tests 2 + 4 (Iron 2 Hz allein ≥ 70 CS; Gold Stehpunkt folgt, kein `out_of_range`) – A1; wieder an, sobald Iron ≥ 70 (a1.md Punkt 2: `margin()`-Kappe für breite Fenster) und Gold-Stehpunkt ohne out_of_range-Abbrüche. Tests 1, 3, 11, 12 laufen (3 von 5 grün laut Lead; Test 11 prüft nur eine Regressionsschranke, gemessen 0,10 ms statt 0,05).
- `tests/attention.test.ts` Test 10 Klausel 3 `it.todo` („kein Minion dauerhaft ignoriert") – A3; wieder an, sobald A1 `LAPSE_SHARE`/`roll.skip` entfernt (A3-5).
- D: Wren-Passiv-Badge-Test war übersprungen, in e0f40bb wieder grün.

Prüfung des A3-Standes durch S (Worktree auf e08e396, vor dem Merge): volle Suite 55 Dateien, 784 bestanden, 1 todo; `npm run bot-sim -- --rank=gold --games=2 --minutes=15 --seed=1` auf main 68bc2f2 und auf e08e396 **CSV-identisch** (Laner-CS/min 2,89, Kills 17/13) → keine Verhaltensänderung, wie behauptet; Status-Hash-Vergleich (main: Seed 1 `90671ce2`, Seed 2 `24dc6d8`) auf dem Kandidaten nicht beendet (Lauf beim Stopp abgebrochen). Statische Prüfung: attention.ts importiert nur `sim/rng`, `sim/types`, Snapshot-Typ; keine Uhren; alle Raten in Profilen/attention.json/errors.json, Konstanten in Code nur Ticks/s und Rundung.

Abweichungen aus den Agentenberichten, hiermit übernommen (ohne Gate-Messung):
- A3: §9-Ablenkungsraten (Iron ~8 s … Challenger ~120 s) ergeben mit 0,5–3-s-Fenstern maximal 15 % (Gold) statt 20 %; da §9 „Kalibriere Rate × Dauer, dass der Anteil stimmt" sagt, gilt der Anteil (Tabelle B): Start-zu-Start ~5,7 s Iron, ~9,4 s Gold, ~18 s Diamant, ~34 s Challenger. Geplante Minimap-Blicke (`minimapGlancePlannedPct` Iron 0 … Challenger 100) kosten nichts. „Mein Fehler" als Team-Chat, bis ein Ping-Typ existiert (A3-8).
- A1: Delay-Queue bleibt für Nicht-Lane-Knoten (§3 sagt „ersetzt"); Lane-Befehle nutzen kein `delay`/`'lh'` mehr. Reflex-Sicht ist nicht `buildSnapshot` (0,76 ms/Aufruf), sondern eine Team-Sicht mit derselben Fog-Regel über `onPerceive`. Kein Reaktionsanteil im Zeitfehler (kommt aus A3). csLossByCause mit 11. Ursache `ally_took`. Lane-allein-Szenario ohne Recall/Wards, Vision-Achse −5.
- A2: §6-Kampfänderungen ebenfalls hinter dem Flag (Bit-Identität bei Flag aus); Interims-Haken in `tradeRun` statt Baumknoten (A2-1).
- B: Siegelward-Enthüllungsradius 900 → 450; Lysa-E-Draht gestealtht; verbündeten-gezielte Buffs (Ferris E, Kiran E, Oda E) und Buffs (Grimald W, Hagen R, Nyx W/R, Ottilie R, Renn W) laufen weiter, Oleth Q/Isolde R zählen als Dash; Cast-Zeiten unverändert.
- Vom Aufsichts-Agenten freigegeben: A3-1 (schema.ts), A3-2 (contract.ts Knob-Union), A3-3 (i18n/css, C-Gebiet, additiv), A1-Profilfelder.

Regel ab jetzt: Agenten mergen `origin/main` zuerst; weitere Merges nur nach Messung durch S (review-checklist.md), es sei denn der Nutzer ordnet es an; jeder übersprungene Test hat hier Eigentümer und Bedingung.

## Gehirn-Rework Phase 0: Messbasis vor dem Rework (A1, 2026-10-16)

Stand vor dem Rework: Commit 456298f (Gehirn = cc3eecc, nur Messcode neu). `npm run bot-sim -- --rank=<r> --games=8
--minutes=40 --variance=0 --seed=101 --report` (Seeds 101–108, gleiche Aufstellung je Seed für alle Ränge,
Rang-Varianz aus). Laner = Top/Mid/ADC. Ziele aus docs/BRAIN-REWORK.md §1/§4.6/§6.4/§7.1.

| Kennzahl | Iron | Gold | Diamant | Challenger | Ziel (I/G/D/C) |
|---|---|---|---|---|---|
| Laner-CS/min bei 15:00 | 2,68 | 3,42 | 3,61 | 4,14 | 4,8 / 6,5 / 7,4 / 8,2 |
| Laner-CS/min Partieende | 3,92 | 4,14 | 4,15 | 4,33 | 5,0 / 6,8 / 7,7 / 8,6 |
| Kills/Partie | 27,1 | 25,8 | 25,0 | 21,0 | 55 / 50 / 44 / 40 |
| Erster Turm (min) | 17,0 | 21,1 | 22,1 | 22,9 | 16 / 14 / 13 / 12 |
| Partiedauer (entschiedene, min) | 33,5 (7/8) | 33,2 (8/8) | 35,2 (8/8) | 36,8 (6/8) | 33 / 31 / 29 / 26 |
| Angriffsauslastung Laner 2–14 min | 0,30 | 0,27 | 0,32 | 0,28 | 0,35 / 0,50 / 0,60 / 0,68 |
| Idle-Anteil Laner | 0,11 | 0,10 | 0,08 | 0,09 | 0,25 / 0,10 / 0,04 / 0,02 |
| Harass-Autos/min Laner | 0,22 | 0,07 | 0,04 | 0,04 | 2 / 6 / 10 / 12 |
| Platten pro Team bis 14:00 | 4,4 | 3,3 | 2,4 | 1,0 | – / 4 / 6 / 8 |
| Abwesenheitsverlust bis 15:00 (Anteil Lane-Minions) | 31,4 % | 26,9 % | 21,9 % | 20,8 % | Gold ≤ 12 % |
| Tode ohne Gegner-Champion | 5,2 % | 9,9 % | 4,1 % | 10,2 % | 8 / 4 / 1 / < 1 % |
| Objective-Konversion nach gewonnenem Fight | 23 % | 23 % | 22 % | 20 % | Iron 15 … Challenger 95 % |

CS-Verlust nach Ursache bis 15:00 (Anteil aller Lane-Minionen; Summe = tatsächliche Verluste, vom Report geprüft):

| Ursache | Iron | Gold | Diamant | Challenger |
|---|---|---|---|---|
| vom Laner gelasthittet | 23,8 % | 30,3 % | 32,2 % | 37,0 % |
| absent_recall | 13,6 | 6,2 | 6,0 | 5,4 |
| absent_heal | 10,2 | 11,8 | 9,9 | 10,2 |
| absent_roam | 0,5 | 1,3 | 1,7 | 2,6 |
| absent_dead | 7,1 | 7,6 | 4,4 | 2,7 |
| in_range_no_attack | 13,3 | 14,0 | 20,4 | 19,8 |
| timing_miss | 14,4 | 15,3 | 14,0 | 11,9 |
| window_collision | 0,8 | 1,2 | 1,0 | 1,6 |
| tower_took | 6,9 | 6,0 | 5,9 | 6,2 |
| enemy_took (abgedrängt) | 0,8 | 1,1 | 1,8 | 1,4 |
| ally_took | 0,3 | 0,5 | 0,5 | 0,5 |
| distracted (alter Aussetzer pro Minion) | 8,3 | 4,7 | 2,2 | 0,7 |

Last-Hit-Trainer (Lane allein, Mid, mira, nur Autos, kein Recall/Ward, 10 min, 107 Minions; `--scenario=laneAlone`):
Iron 51/52, Gold 65, Challenger 92/94 (Seeds 1/2).

Abweichungen der Messung vom Prompt (Begründung in docs/agents/a1.md): elfte Ursache `ally_took`; `enemy_took` =
vom Gegner-Champion aus der Reichweite gehalten; Auslastung/Idle beziehen sich auf Ticks mit Ziel in Reichweite + 200;
Idle zählt nur ohne laufenden Angriff und ohne Laufen.

## Seiten-Fairness, Lane-Länge, Minion-Leine, Kollision (Balance-Agent, 2026-10-16)

**Seiten-Ungleichgewicht – Ursachen.** Zwei Bot-Fehler benachteiligten Rot strukturell, dazu mehrere Tick-Reihenfolge-Effekte der Sim (niedrige Entity-IDs = Blau, weil Blau zuerst spawnt, handelten zuerst):

| Ursache | Vorher | Jetzt |
|---|---|---|
| Ward-Spots (Bots) | Rot bekam die Blau-Spots **punktgespiegelt** (16000−x, 16000−y): Rots Top-Laner wardete den Bot-Fluss, Rots Leviathan-Wards landeten an der Schleierwächter-Grube und umgekehrt | Spiegelung an der Fluss-Diagonale (16000−y, 16000−x): Lane- und Objective-Identität bleiben (`macro.ts wardSpots`, Test in botVision) |
| Jungle-Start | erster Buff der Liste (`dornenbock`) für beide Teams; der liegt für Blau oben, für Rot unten → Blaus Jungler beendete den ersten Clear immer am Leviathan/Botlane, Rots nie | beide starten am Buff auf der Schleierwächter-Seite und enden botseitig (LoL-Standard, umkämpfter Leviathan) (`laning.ts jungle`) |
| Spawn-Versatz im Brunnen | rot punktgespiegelt (Jungler stand näher am anderen Buff als Blaus) | an der Fluss-Diagonale gespiegelt (`champions.ts spawnChampion`) |
| Nahkampf-Treffer im Angriffs-Loop | sofort aufgelöst, in eid-Reihenfolge: Blau tötete bei gleichzeitigen Treffern zuerst, Rots Treffer/Wind-up ging verloren → gespiegelte Wellen kippten zu Blau | alle Nahkampf-Treffer eines Ticks landen nach dem Loop gemeinsam (`attack.ts pendingHits`); Zielwechsel im Wind-up bricht ab (vorher traf der Wind-up das neue Ziel) |
| Verfolgen | Verfolger las die Live-Position, die niedrigere eids im selben Tick schon bewegt hatten; Repath-Takt nach eid | Zielposition vom Tick-Anfang; Repath, wenn das Ziel > 100 vom Pfadende ist (`movement.ts`) |
| Einheiten-Kollision | Paare nacheinander aufgelöst (Gauss-Seidel, eid-Reihenfolge) | alle Schübe aus den Startpositionen summiert, dann angewendet (Jacobi) |
| Gleichstände bei Zielwahl | erste eid gewinnt (eids werden recycelt → zufällig zwischen den Seiten verschieden) | Abstand gleich (rel. 1e−9) → ältere Einheit (Spawn-Serial) (`vec.ts nearer`: Minions, Türme, Attack-Move) |
| Angriffs-Takt | Bruchteil-Übertrag des Angriffstimers blieb an recycelten eids hängen | wird bei neuer Einheit zurückgesetzt |

Test `tests/sideMirror.test.ts`: Spiel ohne Champions bleibt 6 min exakt punktgespiegelt (vorher erste Abweichung nach 88 s, nach 8 min 30:26 Minions), zwei gleiche Champions im Auto-Duell sterben im selben Tick. Ab ≈ 12 min wachsen Rundungsunterschiede (16000 − x) chaotisch, ohne Richtung.

Messung (Gold, `npm run bot-sim -- --sides`: jeder Seed zweimal, zweites Mal tauschen die Aufstellungen die Seite). Die „20/24 Blau“ ließen sich in Gold-gegen-Gold nicht nachstellen (vorher Seeds 21–26: Blau 2/6; Seitentausch auf altem Stand 31–38: Blau 6/12) – die Bot-Fehler oben wirken vor allem bei Wards/Objectives und damit stärker bei höheren Rängen.

| | vorher (HEAD 6f071df) | nachher |
|---|---|---|
| Blau gewinnt (Seitentausch) | 6/12 | 12/24 |
| gleiche Aufstellung gewinnt beide Seiten | – | 9 von 11 entschiedenen Paaren (Aufstellung A 14/24) |
| Spiellänge / erster Turm / Kills (Gold, vor dem Turm-Umbau) | – | 33,3 min / 19,8 min / 26 |

Offen: Die Champion-Zusammenstellung entscheidet mehr als die Seite (und als der Rang, s. u.).

**Lane-Länge.** Statt die ganze Karte zu skalieren (bricht Trainer-Arenen, Testgelände, Render; Außen↔Außen bliebe bei +11 %) stehen die Außen- und Innentürme näher am Fluss (map.json `blue.towers`, Rot gespiegelt). Wellen-Treffpunkt (Lane-Mitte) und Spawn unverändert → Treffen weiter 1:27 / 1:38, 107 Minions bis 10:00 unverändert.

| | vorher | jetzt | LoL (ca.) |
|---|---|---|---|
| Außen ↔ gegn. Außen Mid / Seite | 4525 / 5798 | **3818 / 4808** | 3800 / 4800 |
| Mid außen→innen→Inhib | 1980 / 2121 | 1803 / 2652 | 1800 / 1800 |
| Seite außen→innen→Inhib | 3600 / 3100 | 3700 / 3700 | 3700 / 2400 |
| Turmpositionen (blau) Mid / Top / Bot | (6400,6400) (5000,5000) / (1300,10600) (1250,7000) / gespiegelt | (6650,6650) (5375,5375) / (1300,11300) (1250,7600) / gespiegelt | – |
| Laufweg Brunnen → Außenturm Mid / Seite (345 MS) | 21,9 s / 27,7 s | 23,0 s / 29,7 s | 23–30 s |
| Nexus ↔ Nexus | 17536 | 17536 (Karte 16000 vs. LoL ≈ 14870) | 16400 |

Seiten-Inhib-Türme bleiben, die Seitenlanes sind von Natur aus länger (Inhib→Außen 7400 vs. LoL ≈ 6200). Render: nur die Turmpositionen ändern sich (aus den Sim-Entities), Sprites unberührt. Last-Hit-Trainer setzt den Spieler jetzt relativ zum Mid-Außenturm aus den Kartendaten. Phase-1-Abnahme: weiter 107 ankommende Minions; der Skript-Last-Hitter lief mit den näheren Türmen in die gegnerische Turmreichweite (52 CS < 60) und hält jetzt 1000 Abstand zum gegnerischen Außenturm (73 CS, vorher 66).

**Toplane-Terrain.** Neue Viertel-Wand: Klippe am Kartenrand entlang der Toplane (x ≤ 380–560, y 3700 bis zur Ecke) – über Tausch/Spiegelung auch Botlane und Rots Hälften, Ecke rund – plus 2 Lane-Büsche auf der Außenseite (780, 9700) / (820, 12900). Lane jetzt 1300–1400 breit zwischen den Wänden (vorher bis Kartenrand ≈ 1950–2200, LoL 1300–1600); Isoldes E findet auf beiden Seiten Wände. Alle Lane-Linien (±150 seitlich) bleiben frei, Lager/Objectives erreichbar (map-/jungle-Tests).

**Minion-Leine.** `CHASE_LEASH = 650`: gemessen ab der letzten Position des Minions auf seiner Lane, solange er keinen Champion als Ziel hatte. Darüber lässt er den Champion fallen und nimmt keine Champion-Ziele (auch keine Hilferufe), bis er zurück ist; Minions/Gebäude weiter. Vorher folgte er einem kitenden Champion, bis der 1000 Abstand hatte – bei etwas schnellerem Champion Tausende Einheiten. Test in `minions.test.ts`.

**Kollision.** Ein laufender Champion, der auf einen stehenden (oder entgegenkommenden) Champion trifft, wird tangential um ihn herumgeschoben (Senkrechte zur Laufrichtung, zur freien Seite; exakt frontal: feste Seite relativ zur Laufrichtung, spiegelsymmetrisch) und übernimmt 80 % der Korrektur. Vorher frontal blockiert, ohne Ende. Test in `mechanics.test.ts` (900 Weg, Umweg ≤ 10 Ticks).

**Rang-Siegquote** (nach allen Änderungen, `--mirror`, Seeds 51–54): Gold vs. Silber **4/8**, Diamant vs. Gold **4/8** (Ziel ≳ 65 % / ≳ 80 %: **nicht erreicht**, Profile nicht getunt). In den gespiegelten Paaren gewinnt meist dieselbe Aufstellung beide Spiele – die Champion-Zusammenstellung überwiegt den Rang. Diamant farmt weiter weniger als Gold (alle Rollen 2,58 vs. 3,03 CS/min; Top 4,17 vs. 4,52, ADC 4,17 vs. 5,00, Mid 2,25 vs. 2,89) bei gleicher Recall-Rate (0,30 vs. 0,31/min) und kaum Roams (0,02/min) – Ursache also nicht Roams/Recalls, sondern vermutlich mehr Trades/Bestrafen in der Lane (Trade-Auslöser Diamant+) und Shove-first; nächster Schritt: CS-Verlust pro Ursache messen (tools/scratch csloss-Ansatz) und Champion-Stärke zwischen den Aufstellungen angleichen. Pacing nach dem Turm-Umbau (diese 16 Spiele, vor Leine/Randklippe): Länge ≈ 33 min, erster Turm Ø 19,7 min (vorher 19,8), Kills ≈ 20 pro Spiel – Ziele 12–16 min / 40–60 Kills weiter offen.

Werkzeug: `npm run bot-sim -- --sides` (neu) trennt Seiten- von Aufstellungs-Effekten.

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

## Spieltempo + Bot-Pathing (Pacing-Agent, 2026-10-16)

Ziel: Bot-Spiele ≈ 28–35 min mit Sieger, ≈ 40–60 Kills, erster Turm ≈ 12–16 min, Laner-CS/min nahe Tabelle A, höherer Rang gewinnt klar. Messung mit `npm run bot-sim` (neue Kennzahlen: erster Turm, Tode bis 15/25 min, Türme, CS bei 15:00, Pathing; `--mirror` spielt jeden Seed zweimal mit getauschten Rängen, damit Champion-Picks und Kartenseite sich aufheben). Vorher-/Nachher-Tabelle unten.

| Thema | Vorher | Jetzt | Grund |
|---|---|---|---|
| Minion-Tempo | 300, Spawn −250 Mid / 750 Seite (Treffen 1:35 / 1:45) | **325** (LoL), Spawn 1275 Mid (zwischen Nexus und Inhibitor) / 2025 Seite (vor dem Inhibitor); Treffen 1:27 Mid / 1:38 Seite (Test: 1:28 ± 3 s / 1:38 ± 3 s) | LoL-Werte; ersetzt die Zeile „Minion-Laufzeit 1:35 / 1:45“ unter „Vom Lead entschieden“ |
| Turmschuss vs. Minions | Nahkampf 50 %, Caster 80 % | **45 % / 70 %** (Belagerer 15 %, Super 7 % unverändert) | LoL: Caster stirbt an 2 Schüssen (Auto–Schuss–Auto), Nahkampf an 3 (Schuss–Schuss–Auto). Mit 50 % tötete der 2. Schuss den Nahkampf-Minion exakt, ohne Last-Hit-Fenster |
| Fähigkeitsschaden gegen Champions | ×1 | **×1,4** (`CHAMP_ABILITY_DMG_MULT` in `sim/types.ts`, nur Daten-Fähigkeiten, nur Champion-Ziele; das Exchange-Modell rechnet mit) | Die Kits haben 1–3 Schadenseffekte statt LoL-üblich 3–4 plus Runen-/Passiv-Procs: Level-6-1v1 dauerte laut Exchange-Modell ≈ 15–20 s (LoL ≈ 5–8 s). Minions, Monster, Gebäude unverändert |
| All-in-Entscheidung | Kill-Schätzung über 3 s (Trade-Horizont), daher fast nie All-in; All-in endete fest nach 12 s | Kill-Schätzung über 6 s (`ALLIN_HORIZON_S`); All-in endet, wenn das Ziel 5 s lang keine 5 Punkte HP verliert oder nach 20 s; verlorenes Ziel (Busch/Nebel) wird 2,5 s in Laufrichtung verfolgt (Silber+) | Gewinnende Kämpfe liefen in den Timeout |
| Rückzug im All-in | Rückzugsknoten (vor dem Kampf im Baum) brach jedes All-in bei < 25 % HP oder Turm-Aggro ab | Bleibt, solange Kill wahrscheinlich (> 0,6), eigener Tod unwahrscheinlich (< 0,5) und das Ziel nicht gesünder ist | Tauchen war strukturell unmöglich |
| Turm-Dive | nur mit Aggressions-Knob (≥ +2) und Ziel-HP unter Toleranz | zusätzlich **tödlicher Dive** ab Silber: Kill > 0,75 im 6-s-Horizont, Ziel < 35 % HP, eigene HP > 35 % | LoL-Dives auf sichere Kills |
| Trade-Auslöser | Vergeltung, Bestrafen (Gold+), CS-Fenster (Diamant+), Power-Spike, wenig HP | + **„Vorteil“**: Exchange-Gewinnchance > 0,62 bei nicht schlechteren HP (jeder Rang; Fehlurteil über das Rang-Rauschen) | Gold-Bots tradeten fast nur als Reaktion |
| Gebäude schlagen | nur mit ≥ 4 eigenen Minions am ersten Turm bzw. als Gruppe | `structureToHit`: nächstes offenes Gebäude der Schutzkette (Turm → Inhibitor → Nexustürme → Nexus, öffentliches Wissen) in 1300, Türme nur mit ≥ 2 tankenden Minions (oder 1 + 2 Verbündete) und nicht auf den Bot zielend, nie gegen mehr Gegner als Verbündete | Champions machten bis 15:00 fast keinen Turmschaden (0,9k von 12k) |
| Spiel beenden | Belagerungsziel nur Lane-Türme (danach der tote Inhibitorturm), Gruppen 90 s je 180-s-Wurf | Belagerungsziel = nächstes stehendes Gebäude der Lane-Kette; **„Vorteil ausspielen“**: ≥ 2 mehr Lebende (bei ≥ 3), Ace oder eigener Schleierwächter-Buff → alle freien Bots pushen die tiefste Lane (Wurf pro Episode mit 50 % + 50 % × objectiveConversionPct: Iron 58 % … Challenger 98 %); Gruppen ab 20:00 bis zum nächsten Wurf | Spiele endeten fast nie (1/4 Nexus bis 45 min) |
| Gank-Abbruch | Ziel 4 s unsichtbar → Abbruch | 7 s; danach anderes sichtbares Lane-Ziel (bis 12 s Gank-Dauer) | Die meisten Ganks endeten als „target lost“ vor der Ankunft |
| Turm-Farmen | – | **Pre-Hit**: Auto vor dem Turmschuss, wenn danach der nächste Auto tötet (Chance pro Minion nach Skill: Iron 0 … Gold ≈ 0,5 … Challenger 1) | LoL-Turm-Last-Hits; ≈ 1,5 verlorene Minions/min pro Laner am eigenen Turm |
| Rückzug → Heimweg | nach Rückzug unter 60 % HP heim, Gegnernähe unter 60 % gemieden | 40 % / 45 % | Jeder Turm-Aggro-Rückzug bei 55 % kostete einen ganzen Recall-Weg |
| Rang-Mechanik | `skillshotHitPct` ungenutzt; Fokus-Ziel im Teamfight für alle Ränge gleich | Vorhalten bei Skillshots mit skillshotHitPct + 15 Punkte (Iron 45 % … Challenger 97 %), sonst Wurf auf die aktuelle Position; Fokus-Score mit Rang-Fehler (Iron ±60 %, Gold ±30 %, Challenger ±10 %, pro Kampf und Gegner gewürfelt); **Ausführung** pro Kampf-Entscheidung 55 % + 45 % × Skill/100 (Iron 57 %, Gold 75 %, Diamant 91 %, Challenger 100 %), sonst nur Autos (verspäteter Combo-Schritt); Rückzugslinie nach Skill 17 % + 13 % × Skill/100 (Iron 18 % … Challenger 30 %, vorher 25 % für alle) | Mechanik soll Kämpfe entscheiden |
| Diamant+-Last-Hit unter Druck | Gank-Risiko ≥ 0,4 allein ließ Diamant+ jeden Vor-Lauf-Last-Hit auslassen | nur ein echter Gegner in Poke-Reichweite mit bereitem Poke zählt | Diamant farmte weniger als Gold (Laner-CS 3,64 vs. 3,92 in Diamant-gegen-Gold-Spielen) |
| Pathing | Lane-Standpunkt folgte dem Wellenkontakt in 80er-Schritten (Stop-and-go), Gank/Roam/Flucht-Wege alle 0,5 s neu, Ziele im Turm-Fußabdruck (Einheit drückt gegen den Turm), Support stand genau hinter dem ADC (läuft in ihn), Unstuck erst nach 10 s, Leerlauf-Zappeln ±150 alle 3 s | Standpunkt-Hysterese (250, 6 s), Mindestschritt 120, gleiche Wegziele 3 s behalten, Ziele aus Gebäude-Fußabdrücken geschoben (`clearOfStructures`), Support 170 seitlich versetzt, Seitschritt nach 1,5 s ohne Fortschritt, Leerlauf ±100 alle 4–7 s | Nutzer: „die Bots pathen schlecht“; Kennzahlen in bot-sim (Moves/min, Richtungswechsel/min, Steck-s/min, Pfad-Effizienz) |

**Messung** (bot-sim, Gold Seeds 1–4, Iron/Challenger Seed 1; vorher 45 min, nachher 40 min Limit; Rang-gegen-Rang nachher mit `--mirror`, Seeds 11–14 = 8 Spiele je Paarung). „Tode“ = alle Champion-Tode (auch durch Türme/Minions).

| Kennzahl | vorher | nachher | Ziel |
|---|---|---|---|
| Spiele mit Sieger / Länge (Gold) | 1/4 (35,7 min), Rest offen bei 45 min | **4/4**, 29,6–34,7 min (Ø 31,5) | 28–35 min |
| Erster Turm (Gold) | Ø 22,1 min (20,4–28,9) | Ø 18,1 min (15,4–22,8) | 12–16 min |
| Tode bis 25:00 (Gold) | Ø 18 | Ø 28 | – |
| Tode pro Spiel (Gold) | ≈ 28 in 45 min | ≈ 34 in ≈ 31 min | 40–60 Kills |
| Laner-CS/min bei 15:00 Iron / Gold / Challenger | 2,40 / 2,80 / 3,45 | 2,07 / 2,83 / 3,73 | 5,0 / 6,8 / 8,6 |
| Gold vs. Silber (Siege) | 3/6 bzw. 0/3 | 5/8 (gespiegelt) | ≳ 65 % |
| Diamant vs. Gold (Siege) | 2/6 | 3/8 (gespiegelt) | ≳ 80 % |
| K/D höherer Rang vs. niedrigerer (gespiegelt) | – | Gold 2,8/3,4 vs. Silber 2,0/4,2; Diamant 3,1/3,0 vs. Gold 2,2/4,5 | – |
| Pathing (Gold Seed 1, 10 min, Mittel über 10 Bots): Moves/min, Richtungswechsel/min, Steck-s/min, Pfad-Effizienz | 34,6 / 3,31 / 1,04 / 0,915 | 25,5 / 2,15 / 0,18 / 0,933 (Mid: 6,6 → 2,5 Wechsel/min, 2,1 → 0,25 Steck-s/min) | – |

Offen: (1) Rang-Siegquote: höhere Ränge gewinnen die Kämpfe jetzt deutlich (K/D), aber nicht die Spiele — die Team-Zusammenstellung/Kartenseite entscheidet (in 20 von 24 Spielen gewann Blau; dieselbe Aufstellung gewinnt meist beide Spiele eines gespiegelten Paares), und Diamant farmt in Spielen weniger als Gold (öfter abwesend: Shove-and-Recall, Roams). Blau-Vorteil prüfen (Sim/Karte, nicht die Bots: Bot-Code ist bis auf die Kartenspiegelung seitenneutral). (2) CS bei 15:00 bleibt bei ≈ 40 % von Tabelle A; allein in der Lane schaffen die Bots 5,6 (Iron) … 7,8 (Challenger) pro Minute über 10 min — der Verlust liegt in Abwesenheit (Recall-/Heilwege ≈ 30 % der Minions) und knappen Fenstern im Lane-Kampf. (3) Kills ≈ 34 statt 40–60 pro Spiel. (4) Erster Turm ≈ 18 statt 12–16 min.

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
| Minion-Laufzeit | 1:35 Mid / 1:45 Side | ~~Tempo 300, Treffen 1:35 / 1:45~~ → seit 2026-10-16 LoL-Tempo 325, Treffen 1:28 Mid / 1:38 Side (±3 s), Spawnpunkte entlang der Lane verschoben (siehe „Spieltempo + Bot-Pathing“) | Map-Geometrie (Nexus-Abstand ca. 17.500) und eine einheitliche Geschwindigkeit passen nicht exakt zu beiden Zeiten |

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
