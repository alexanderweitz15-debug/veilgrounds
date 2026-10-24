# Bekannte Simulations- und Gameplay-Bugs (A2, Wave 0, 2026-10-24)

Stand: Branch `feat/a2-sim-bugs` (Basis `5b776d3`). Methode: Beweis zuerst – reproduzieren, Ursache belegen (Log, Zustand,
Test), Regressionstest schreiben (muss vor dem Fix rot sein), dann fixen. Werkzeug: `tools/bughunt/matchProbe.ts`
(`npx tsx tools/bughunt/matchProbe.ts --seed=11 [--rank=gold] [--minutes=45] [--brain=new] [--variance=0]`), spielt eine
komplette Bot-Partie und prüft je Tick Invarianten (NaN / außerhalb der Karte, HP <= 0 bei lebend, Todes-/Respawn-Zustand,
Gold/XP/Level, Stillstand mit Order, Idle, Ward-Obergrenze/-Ablauf); `console.warn/error` wird gesammelt. `tools/botSim.ts` ist
unverändert.

## Messläufe (alle Seeds `botGameConfig(seed, rank)`, Varianz normal)

10 komplette Partien (bis Nexus oder 45-min-Deckel) plus mehrere Teilläufe (3-36 min) zum Eingrenzen. Spalte Stand: vor = vor
den Fixes, nach = nach allen drei Fixes (Partieverlauf ändert sich durch die Fixes, derselbe Seed ergibt danach eine andere Partie).

| Seed | Rang | Gehirn | Stand | Ergebnis | Dauer |
|---|---|---|---|---|---|
| 11 | Gold | Standard | vor | Blau gewinnt (Nexus) | 34,3 min |
| 13 | Gold | Standard | vor | Blau gewinnt | 36,9 min |
| 12 | Gold | Standard | vor | Rot gewinnt | 36,8 min |
| 11 | Gold | Beta (`--brain=new`) | vor | Rot gewinnt | 44,7 min |
| 11 | Gold | Standard | nach | Blau gewinnt | 42,0 min |
| 13 | Gold | Standard | nach | Blau gewinnt | 38,4 min |
| 21 | Iron | Standard | nach | Rot gewinnt | 34,3 min |
| 11 | Gold | Beta | nach | Rot gewinnt | 41,9 min |
| 12 | Gold | Beta | nach (Fix 1+2) | Deckel 45 min, kein Sieger | 45,0 min |
| 22 | Challenger | Beta | nach | Deckel 45 min, kein Sieger | 45,0 min |

Ergebnis über alle Läufe: **keine Ausnahme, kein NaN/Infinity, keine HP <= 0 bei lebenden Einheiten, keine
`console.warn/error`-Ausgabe, keine falschen Todes-/Respawn-Zeiten** (Abweichungen von 1-2 Ticks sind Messrauschen der
Sonde). Gefunden wurden drei Stillstands-Bugs (unten), alle in `src/sim`.

Idle-Zeit je Bot (Sonde: kein Order, kein Angriff, nicht Recall, nicht im Brunnen, ab 1:45; nur Messung, Verhalten ist nicht
Teil dieser Aufgabe): typische längste Pause 4-5 s; Pausen > 10 s selten (4 Fälle in 10 Partien: Support Kiran 10,0 s, Top
Brom 12,6 s Modus `lane` bei 100 % HP, Support Hagen 13,0 s, Top Brom 17,9 s im Beta-Lauf vor den Fixes). Anteil der Spielzeit ohne Order (nach den Fixes):

| Partie | Top | Jungler | Mid | ADC | Support |
|---|---|---|---|---|---|
| Seed 13 Gold, Standard (38,4 min) Blau / Rot | 14 % / 14 % | 2 % / 2 % | 5 % / 10 % | 10 % / 10 % | 16 % / 11 % |
| Seed 11 Gold, Beta (41,9 min) Blau / Rot | 12 % / 15 % | 2 % / 2 % | 25 % / 20 % | 19 % / 15 % | 18 % / 15 % |
| Seed 22 Challenger, Beta (45 min) Blau / Rot | 42 % / 35 % | 5 % / 10 % | 33 % / 31 % | 23 % / 23 % | 12 % / 17 % |

Auffällig: Beta-Gehirn auf Challenger lässt Top/Mid ein Drittel der Partie ohne Order stehen (Verhalten des Gehirns, kein
Stuck/Crash – nicht angefasst, Hinweis für das Brain-Team).

---

## KRITISCH

### BUG-02 · Wegpunkt im Kollisionskreis eines Gebäudes wird nie erreicht (Belagerungs-Minion steht für immer am Turm)

- **Symptom:** Ein eigener Belagerungs-Minion stand ab 2:41 am Rand des eigenen Außenturms oben (1155, 11251) und ging nie
  weiter (bis er getötet wurde, mindestens 80 s). Bots schicken Champions per `move` auf Turmpositionen: die Order blieb
  für immer `Move.mode 1` (Aurel bei 15:36 am eigenen Mid-Turm, Thessaly bei 17:55 am eigenen Bot-Turm).
- **Reproduktion:** auf Basis `5b776d3`: `npx tsx tools/bughunt/matchProbe.ts --seed=13 --minutes=4` → Fund `stuck>10s kind4`
  (Teamfarbe 0, Bahn Top, Wegpunkt `[1200, 11267]`); Gold Seed 11 Standard, `--minutes=25` → `champion stuck >5s ... target
  (14700,4700)`. Der exakte Zustand (Position, Blickrichtung, Pfad) ist im Test nachgestellt.
- **Bewiesene Ursache:** `src/sim/systems/movement.ts:93` (`d <= step`) verbraucht einen Wegpunkt nur, wenn die Einheit auf
  weniger als einen Schritt (ms/30) herankommt. Liegt der Wegpunkt innerhalb des Kollisionskreises eines Gebäudes
  (Turm 88 + Einheitsradius), schiebt `collideStructures` (`movement.ts:311`) die Einheit nach jedem Schritt auf den Rand
  zurück: Hineingehen und Herausschieben heben sich auf – ein Fixpunkt (im Test: Position nach 300 Ticks bit-identisch). Der
  Lane-Knoten (1200, 11267) liegt 105 vom Turm (1300, 11300) entfernt, der Kreis hat 153.
- **Status:** gefixt in `11b44dd`. `collideStructures` verbraucht den Wegpunkt, wenn er im Kreis liegt und die Einheit am Rand
  steht (Pfad leer → `Move.mode 0`).
- **Regressionstests:** `tests/a2SimBugs.test.ts` › „BUG-02: a waypoint inside a structure never completes“ › „a siege minion
  at the rim of its own tower walks on …“ und „a move order onto the own tower ends at its rim …“. Vor dem Fix rot
  (`y = 11250.5` unverändert; `Move.mode` 1 statt 0) – verifiziert durch Lauf vor dem Fix.

### BUG-03 · Zwei eigene Minions blockieren sich gegenseitig an einem Lane-Knoten (Wellen stauen sich an Lane-Ecken)

- **Symptom:** Zwei Lane-Minions standen regungslos an der Bot-Lane-Ecke (14800, 1200); die Welle dahinter staut sich. In der
  Probe Seed 12/Beta stand das Paar bei 12:58 > 10 s still (exakter Zustand bewiesen). Weitere Stillstände von 20-22 s an
  Lane-Ecken (Seed 12/Beta: 2:34 bei (14370, 1337), 7:02 bei (14727, 2044), 12:06 Belagerer bei (3199, 14553)) sind
  möglicherweise derselbe Fehler (nicht einzeln bewiesen, die Sonde unterschied damals noch nicht von Wellen-Staus im Kampf).
- **Reproduktion:** auf Stand `11b44dd` (Fix 1+2, vor Fix 3): `npx tsx tools/bughunt/matchProbe.ts --seed=12 --minutes=14
  --brain=new` (Fund bei 12:58, Zustand wird als `STUCK exact:` ausgegeben).
- **Bewiesene Ursache:** `src/sim/systems/minions.ts:197` (`walkLane`) und `movement.ts:93`: der Knoten (14800, 1200) liegt
  zwischen zwei eigenen Körpern (52 bzw. 19 entfernt, Radien 48). Jeder geht darauf zu (10,8 je Tick), die Trennung
  (`separateUnits`, `movement.ts:206`) schiebt ihn um genau denselben Betrag zurück: Fixpunkt (Positionen nach 300 Ticks
  bit-identisch). Der Knoten wird nie auf Schrittweite erreicht, der Fortschrittsvergleich in `walkLane` greift nicht.
- **Status:** gefixt in `4ed06dd`: `walkLane` überspringt einen Knoten, wenn die Einheit innerhalb von zwei Körperradien liegt.
- **Regressionstest:** `tests/a2SimBugs.test.ts` › „BUG-03: two friendly minions block each other at a lane vertex“. Vor dem Fix rot
  (`y = 1216.19` nach 5 s, unverändert) – verifiziert.

## MITTEL

### BUG-01 · Minions jagen einen gegnerischen Minion im Busch und stehen dabei still

- **Symptom:** In der Probe (Seed 11, Beta, 33:53) standen 15 rote Minions (Nah-, Fern-, Belagerung) > 10 s im Jagdmodus
  (`Move.mode 2`) neben einem blauen Caster-Minion im Bot-Lane-Busch (15180, 3100), ohne anzugreifen.
- **Reproduktion:** auf Basis `5b776d3`: `matchProbe --seed=11 --minutes=35 --brain=new` → `stuck>10s kind3/kind4/kind2`
  (`target kind3 ... atkPhase 0`, Ziel bei (15033, 3190), Busch-Index 17).
- **Bewiesene Ursache:** `attack.ts:147` (`canTarget`) verlangt Sicht auf das Ziel, die Minion-Aggro
  (`minions.ts:285` `attackable`, `nearest`) akzeptierte jeden Minion ohne Sichtprüfung. Ein Minion im Busch ist für den
  Gegner unsichtbar (Buschregel in `vision.ts`), also wählte die Aggro ein Ziel, das der Angriff nie annahm.
- **Status:** gefixt in `0ff42bc` (`attackable` und die Minion-Zielliste verlangen Sicht auf Minions; Strukturen unverändert).
  Türme zielen weiter wie bisher (`targetLists` nicht angefasst).
- **Regressionstest:** `tests/a2SimBugs.test.ts` › „BUG-01: minions chasing a minion hidden in a bush“. Vor dem Fix rot (150 von
  150 Ticks mit dem Busch-Minion als Ziel) – verifiziert.
- Mittel statt kritisch: löst sich, sobald der Busch-Minion weiterzieht oder stirbt.

### HINWEIS-1 · Bots horten > 6000 Gold (kein Fehler, Verhalten)

Brom (Beta, Seed 11, ab 34:29), Lio (Beta, 28:23), Wren (Standard, 41:10): Inventar voll (6 Gegenstände, z. B. Brom:
Dornenklinge, Schwarze Kette, Stiefel-Rüstung, Blutdolch, Spitzhacke, Wetzdolch), keine Verkaufs-/Ersetzlogik. Kein Stuck/Crash,
Verhalten → Brain-Team (Build-Logik), nicht geändert.

## KOSMETISCH (nicht behoben, folgenlos)

- **COS-1 · Tote Champions behalten `Move.mode` / `Atk.phase`.** Sonde meldet das als `info` (zehntausendfach). Folgenlos:
  `movement.ts:43/49` und `attack.ts:171` überspringen Tote, `economy.ts` `respawn()` setzt `Move.mode 0` und
  `clearAttackOrders`. Test: `tests/a2Respawn.test.ts` (jeder Champion steht nach dem Tod-Timer im Brunnen, volle HP, ms > 0).
- **COS-2 · `Stats.ms` ist im Respawn-Tick 0** (Sonde: „respawn with CC / ms 0“, nie drei Ticks später ohne laufenden Cast).
  Die Stats werden vor dem Respawn berechnet; ein Tick (33 ms) ohne Bewegung. Ursache nicht weiter verfolgt.
- **COS-3 · Bots senden im Todes-Tick noch Befehle** (`move/cast/spell/recall` „while dead“, 1-2 je Partie). Die Befehle
  entstanden vor dem Tod desselben Ticks; die Sim ignoriert Befehle Toter (`castAbility`/`castSummoner` prüfen `alive`).
- **COS-4 · Tod im Aufzieh-/Cast-Moment erstattet Mana und Abklingzeit** (`abilities.ts:1088` `refund`): wer in der Aufzieh-
  phase stirbt, hat die Fähigkeit nach dem Respawn sofort bereit (LoL: Cast wird abgebrochen, ebenso). Beabsichtigt.

## Untersuchte Zonen ohne Fund (Tests belegen es)

- **Ward-Sichtbarkeit** (`tests/a2Wards.test.ts`, dazu die vorhandenen `tests/sim/wardStealth.test.ts`, `tests/summonersWards.test.ts`):
  ein Schleierward ist über die gesamte Lebenszeit weder in der Sicht noch im Snapshot des Gegners, auch nicht mit einem
  Gegner auf dem Ward; er ist es für das eigene Team bis zum Ablauf-Tick (genau 90 s) und gibt danach keine Sicht mehr; ein
  Siegelward deckt einen gegnerischen Ward in 450 auf und schaltet ihn ab; stirbt der Siegelward, ist der Ward wieder
  unsichtbar und sieht wieder. Die Sonde meldete keine Überschreitung der Obergrenze (3 je Spieler) und keinen Ward älter
  als 90 s (die ersten Sonden-Meldungen waren ein Sondenfehler: eid-Wiederverwendung).
- **Fähigkeits-Unterbrechungen** (`tests/a2Interrupts.test.ts`): alle Champions x alle Fähigkeiten, Tod 6 Ticks nach dem
  Cast und Betäubung nach 2 bzw. 14 Ticks: nach dem Tod/Respawn bzw. 3 s nach der Betäubung ist keine Einheit beschäftigt, kein
  Kanal/Dash/Recast-Fenster/Verstärkung bleibt offen, `ms > 0`, keine nicht-endliche Position. Teleport-Kanal bei Tod:
  `summoners.ts` löscht ihn (`!alive`).
- **Respawn / Todes-Timer** (`tests/a2Respawn.test.ts`, Sonde): Timer = `deathTimerTicks(Level beim Tod, Todes-Tick)` auf
  ±2 Ticks, Position = eigener Brunnen, HP voll, keine alten Angriffs-/Move-Orders, keine Buffs (Tote verlieren alle Buffs,
  `buffs.ts:337`).
- **Befehls-Fuzz** (`tests/a2Fuzz.test.ts`, einmalig 8 Seeds x 9000 Ticks, im Repo 3 x 4000): feindliche Befehle (NaN,
  Infinity, tote/fremde/ungültige eids, ungültige Slots) werfen nie und lassen Positionen/HP endlich.

## Auswirkung auf Determinismus

Die drei Fixes ändern das Simulationsverhalten dort, wo der jeweilige Fall auftritt (Minion-Aggro im Busch, Bewegung in
Gebäudekreise, Lane-Knoten zwischen Körpern): `stateHash` solcher Partien ist ein anderer als vor den Fixes. Replay- und
Determinismus-Tests (`tests/replay.test.ts`, `tests/bughunt.test.ts` M2, `tests/sideMirror.test.ts`) sind grün; es gibt keine
fest einprogrammierten Hash-Fixtures in `tests/`. Die in DECISIONS erwähnte Referenz `a5913c9c` (Flag aus = main) gilt für den
Stand vor diesem Branch. Keine Information über Nebel wurde zusätzlich an Bots gegeben (BUG-01 verschärft im Gegenteil die
Sichtprüfung der Minions).
