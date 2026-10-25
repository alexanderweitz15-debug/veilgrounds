# Benchmark-Baseline (A6, Welle 1)

Stand: erste vollständige Baseline (n klein, siehe Stichprobe), 25. Okt. 2026. Branch `feat/a6-benchmark` (Basis `claude/veilgrounds-next-level-f6na23`); Messung gestartet auf Commit `ee6f8a7`, der Beobachter bekam währenddessen die Metriken `deathsAmbush` und `killerVis` dazu (Versionen 1-3, siehe "Stichprobe"); Werkzeug-Endfassung = Commit dieser Datei.
Spiele: new/F: 4, new/L: 16, old/F: 4, old/L: 16. Werkzeug: `tools/benchmark/**`. Rohdaten: `tools/benchmark/baseline/*.json`, voller Bericht mit allen Metriken, Rollen-Zeilen und Diagrammen: `tools/benchmark/baseline/report/report.html` (eigenständig, ohne CDN).

## Zweck und Merge-Regel

Diese Datei ist die Messlatte für A13 (Kampf/Micro) und A14 (Makro). Merge-Regel (docs/agents/wave1-rules.md): Verbesserung in den eigenen Zielwerten, keine Verschlechterung > 5 % in anderen Kernwerten. Der Vergleich läuft mit denselben Seeds und Befehlen, gepaart:

```
# 1. Kandidat messen (auf dem eigenen Branch; gleiche Seeds/Minuten/Paare wie die Baseline; --jobs=1 oder 2)
npx tsx tools/benchmark/cli.ts run --brain=new --set=L --minutes=15 --seeds=1..4 --jobs=2 --out=/tmp/mine-L.json
# 2. gegen die Baseline vergleichen (Differenz mit gepaartem 95-%-Intervall, Merge-Regel-Liste am Ende)
npx tsx tools/benchmark/cli.ts compare --base=tools/benchmark/baseline/new-L.json --new=/tmp/mine-L.json
```

Der Kandidat muss `--seeds`, `--minutes`, `--pairs` und den Rest der Baseline-Befehle wortgleich übernehmen (siehe unten). Weniger Spiele sind erlaubt (z. B. `--pairs=gold:gold,diamond:gold --seeds=1..2`); `compare` paart nur Spiele, die in beiden Dateien vorkommen.

## Aufbau der Messung

- **Leiter statt Spiegel:** Rang X spielt gegen eine feste Referenz (Gold). Paare: `iron:gold`, `gold:gold`, `diamond:gold`, `challenger:gold`. Nur so haben Siegquote, Trade-Bilanz, Objective-Anteile eine Richtung (gleicher Rang gegen gleichen Rang ergibt 50 % per Konstruktion). Die Werte einer Zeile gelten für das Team mit Rang X (bei `gold:gold` beide Teams).
- **Seeds:** 1..N, je Seed eine Partie je Paar. Bei Paaren mit Rang X ungleich Referenz spielt X auf Rot, wenn der Seed gerade ist (Seiten- und Aufstellungsfehler mitteln sich über die Seeds, nicht je Seed). Aufstellung und Persönlichkeiten kommen aus `botGameConfig(seed, X)`, sind also für beide Gehirne gleich.
- **Länge:** Menge L = 15-Minuten-Partien (Laning-Metriken: CS@10, Idle 2:00-14:00, Trades vor 14:00, Skillshots, Reaktionen, Recalls). Menge F = 35-Minuten-Limit, nur Seed 1 (Spiellänge, Objectives, erster Turm, Nexus-Siegquote); sie ist wegen der Rechenzeit sehr dünn, siehe "Stichprobe".
- **Varianz:** aus (`noVariance`, wie `bot-sim --variance=0`): jeder Bot spielt sein nominelles Rangprofil. Das Gehirn ist `--brain=old` (Standard) oder `--brain=new` (Beta: Reflex-Schicht + Nutzenmodell, wie `bot-sim --brain=new`).
- **Messung:** nur aus Sim-Zustand, Sim-Ereignissen und Bot-Befehlen (`tools/benchmark/observer.ts`, schreibt nichts in Sim oder KI; der stateHash ist mit und ohne Beobachter identisch, `tests/benchmarkDeterminism.test.ts`). Es gibt keinen Eingriff in `src/sim` oder `src/ai`.
- **Unsicherheit:** Standardfehler (±) und 95-%-Intervall (Tooltip im HTML) aus einem Bootstrap über ganze Partien (1000 Ziehungen, fester Seed). Die Partie ist die Einheit, weil die zehn Champions einer Partie nicht unabhängig sind. Bei so wenigen Partien (L: 4 je Rang und Gehirn, F: 1) sind die Intervalle grob und selbst unsicher; "±?" heißt: nur eine Partie, keine Streuung schätzbar. Rangunterschiede, die kleiner sind als ca. 2 Standardfehler, sind nicht belegt.
- **Determinismus:** gleiche Seeds, gleicher Commit, gleiche Befehle ergeben dieselben Zahlen (Test). Die Laufzeit hängt von der Last der Maschine ab (4 Kerne, mehrere Agents), nicht das Ergebnis.

## Befehle der Baseline

```
npx tsx tools/benchmark/cli.ts run --brain=new --set=L --minutes=15 --seeds=1..4 --jobs=1 --out=tools/benchmark/baseline/new-L.json
npx tsx tools/benchmark/cli.ts run --brain=old --set=L --minutes=15 --seeds=1..4 --jobs=1 --out=tools/benchmark/baseline/old-L.json
npx tsx tools/benchmark/cli.ts run --brain=new --set=F --minutes=35 --seeds=1 --jobs=1 --out=tools/benchmark/baseline/new-F.json
npx tsx tools/benchmark/cli.ts run --brain=old --set=F --minutes=35 --seeds=1 --jobs=1 --out=tools/benchmark/baseline/old-F.json
npx tsx tools/benchmark/cli.ts report --in=tools/benchmark/baseline/new-L.json,tools/benchmark/baseline/old-L.json,tools/benchmark/baseline/new-F.json,tools/benchmark/baseline/old-F.json --out=tools/benchmark/baseline/report
```

(Die L-Läufe wurden mit `--seeds=1..6` gestartet und nach Seed 4 gestoppt; wegen der Reihenfolge "Seeds außen, Paare innen" sind das dieselben Partien wie bei `--seeds=1..4`. Standard-Paare: `--pairs=iron:gold,gold:gold,diamond:gold,challenger:gold`. Die zwei Gehirne liefen als zwei Prozesse parallel (je `--jobs=1`). `run` setzt eine vorhandene `--out`-Datei fort und überspringt fertige Spiele, so lässt sich die Baseline mit `--seeds=1..8` erweitern.)

## Stichprobe (ehrlich gelesen)

- **Menge L:** 15-Minuten-Partien, Seeds 1..4, je Gehirn 16 Partien (4 je Rang X; `gold:gold` zählt beide Teams, ergibt also ebenfalls 8 Team-Stichproben, aber nur 4 Partien). Mit 4 Partien sind Unterschiede unter etwa 2 Standardfehlern nicht belegt, und die ±-Werte selbst sind bei n = 4 grob.
- **Menge F:** 35-Minuten-Limit, Seed 1, je Gehirn 4 Partien (eine je Rang). **Nur 1 von 8 Partien endete per Nexus** (alt, Iron gegen Gold, 32,4 min, Iron gewann); alle anderen liefen ins Zeitlimit. Spieldauer und Nexus-Siegquote sind damit **nicht baseline-fähig**; F-Werte sind n = 1 ("±?") und nur Richtwerte. Erster Turm, Objective-Anteile und Kills pro Partie stammen aus diesen Einzelpartien.
- **Rechenzeit:** Eine 15-Minuten-Partie kostete 3,5-6 min Wandzeit bei der herrschenden Maschinenlast (Lastmittel 20-30 auf 4 Kernen), eine 35-Minuten-Partie 6-11 min. Die komplette Baseline (40 Partien, zwei Prozesse) brauchte gut 2 h Wandzeit und liegt damit über dem 60-90-min-Ziel. Der Beobachter selbst kostet ca. 3 % Rechenzeit.
- **Versionen des Beobachters:** `deathsAmbush` (ab Beobachter-Version 2) und `killerVis` (ab Version 3) kamen während der Läufe dazu; ältere Partien tragen sie nicht. `killerVis` stammt daher je Gehirn nur aus 1 L-Partie je Rang (alt: nur Challenger) plus den F-Partien; die Zahl in Klammern im HTML-Tooltip zeigt die beitragenden Partien. Mit `--upgrade=1` lassen sich ältere Partien neu spielen.

## Befunde

1. **Der Rang ordnet die Metriken kaum.** Streng monoton über Iron < Gold < Diamond < Challenger sind nur: Skillshot-Treffer auf Champions gezielt (beide Gehirne: alt 30 / 52 / 60 / 67 %, neu 30 / 48 / 57 / 62 %), die Reaktionszeit des neuen Gehirns (567 / 500 / 433 / 400 ms) und Gold pro Recall des alten Gehirns. Alle anderen Kernmetriken haben mindestens einen Bruch; sie stehen in der Spalte "Monoton?" der Tabellen unten, jeweils eingeordnet als "signifikant" oder "im Rauschen".
2. **Laning-Tempo weit unter den Rangzielen.** CS@10 liegt bei 18-34 (alt) bzw. 23-29 (neu), also 1,8-3,4 CS/min; die Ziele aus docs/BRAIN-REWORK.md entsprechen bei 15:00 4,8-8,2 CS/min. Alt: Iron 17,8 / Gold 26,8 / Diamond 34,1 / Challenger 30,3 (Challenger im Rauschen, Std.-Fehler 4,1). Neu: 23,4 / 28,4 / 29,4 / 28,6, ab Gold nahezu flach. Das neue Gehirn farmt bei Iron besser (+5,6, signifikant), bei Diamond schlechter (-4,7, signifikant) als das alte.
3. **Idle-Anteil (Hirn-Spec, Laner 2:00-14:00):** alt 10,1 / 10,8 / 10,2 / 9,8 % (flach; Ziele 25 / 10 / 4 / 2 %), neu 4,9 / 6,1 / 7,0 / 8,5 % (**steigt mit dem Rang**, falsche Richtung, aber überall besser als alt). Der breite A2-Idle-Anteil (alle Rollen, ganzer Lauf) steigt in beiden Gehirnen mit dem Rang (alt 11,7 -> 17,2 %, neu 11,2 -> 19,1 %).
4. **Angriffsauslastung der Laner fällt mit dem Rang:** neu 48,3 / 38,2 / 31,3 / 27,8 % (jeder Schritt signifikant), alt 30,0 / 28,5 / 29,0 / 26,4 %. Ziele: 35 / 50 / 60 / 68 %. Das ist die auffälligste Abweichung.
5. **Tode ohne Sicht sind in diesem Setup kein Signal:** 0 % in allen Zellen, ebenso "Tode nach Überfall aus dem Nebel". Die Bots sehen ihren Killer fast immer (`killerVis`: 68-88 % der letzten 20 s vor dem Tod, wenige Partien). Die Nullquoten bleiben im Bericht, weil sie bei einem künftigen Gehirn mit riskanterem Spiel anschlagen können; für Merge-Entscheidungen taugt `killerVis` besser (stetig), hat aber derzeit wenige Partien.
6. **Reaktionszeit:** neu 567 -> 400 ms (monoton), alt 450 / 500 / 500 / 367 ms; Untergrenze durch den Tick-Takt 33 ms. 14-26 % der Reize (Skillshot, Gegner taucht auf, Überfall) bleiben 2 s ohne Auftragswechsel (`rtNone`), bei Iron am häufigsten.
7. **Ausweichen:** Ausweichquote 16-33 % ohne erkennbare Rangordnung (alt 18 / 17 / 24 / 16 %, neu 33 / 22 / 23 / 28 %); mit nur 10-40 Bedrohungen je Rang sehr unsicher.
8. **Recall-Qualität:** 62-78 % der Recalls enden im Brunnen (neu Challenger 62 %, signifikant weniger als Gold). Gold beim Recall-Start im Mittel 580-880, davon 250-340 nach dem Shoppen ungenutzt. Recall mit gecrashter Welle 5-26 % (neu Challenger 26 %), mit Gegnerwelle am eigenen Turm 3-12 %.
9. **Kämpfe:** Trade-Bilanz gegen Gold nur bei Iron schlechter (alt 40 %, neu 46 %), ab Diamond ausgeglichen (48-50 %). Kills pro 15 min (beide Teams) 8,5-16. Siegquote (L, Gold-Vorsprung als Maß): Iron alt 25 % / neu 0 %, Diamond und Challenger je 25 % bei n = 4, nicht von 50 % unterscheidbar; in F entschied nur das Zeitlimit.
10. **Erster Turm** fällt in 15 min nie; in F bei 18-22 min (alt; Challenger zuerst) und 25-28 min (neu). Ziel der Brain-Rework-Tabelle: 12-16 min.

## Hinweise für A13 und A14

- Naheliegende Zielmetriken für A13 (Kampf/Micro): Skillshot-Treffer (auf Champions gezielt), Ausweichquote, Reaktionszeit, Trade-Bilanz, gewonnene Lane-Trades, Tode pro 10 min. Für A14 (Makro): CS@10, Idle-Anteile, Angriffsauslastung, Recall-Metriken, Platten-Anteil, Objective-Kontrolle, Gold/min.
- Die Rang-Abstufung selbst ist ein Ziel (Monotonie-Tabelle): ein Kandidat, der alle Ränge gleich stark macht, besteht sie nicht.
- Auf denselben Seeds messen (Standard 1..4) und mit `compare` vergleichen (gepaarter Bootstrap, Merge-Regel-Liste). Für schnelle Läufe genügt `--pairs=gold:gold,challenger:gold --seeds=1..4` (8 Partien).


# Ergebnisse (generiert von `report`)

Stand: `ee6f8a7`. 

## Läufe

| Gehirn | Menge | Paar (Rang X vs Referenz) | Partien | Ø Dauer (min) |
|---|---|---|---|---|
| new | F | challenger:gold | 1 | 35.0 |
| new | F | diamond:gold | 1 | 35.0 |
| new | F | gold:gold | 1 | 35.0 |
| new | F | iron:gold | 1 | 35.0 |
| new | L | challenger:gold | 4 | 15.0 |
| new | L | diamond:gold | 4 | 15.0 |
| new | L | gold:gold | 4 | 15.0 |
| new | L | iron:gold | 4 | 15.0 |
| old | F | challenger:gold | 1 | 35.0 |
| old | F | diamond:gold | 1 | 35.0 |
| old | F | gold:gold | 1 | 35.0 |
| old | F | iron:gold | 1 | 32.4 |
| old | L | challenger:gold | 4 | 15.0 |
| old | L | diamond:gold | 4 | 15.0 |
| old | L | gold:gold | 4 | 15.0 |
| old | L | iron:gold | 4 | 15.0 |

Menge L = kurze Partien (Lane-Metriken), Menge F = Partien bis zum Nexus oder Zeitlimit (Spiellänge, Objectives, Siegquote). Werte: gepoolter Wert ± Standardfehler (Bootstrap über Partien, 1000 Ziehungen, fester Seed). Eine Partie ist eine Einheit; die zehn Champions einer Partie sind nicht unabhängig.

## Altes Gehirn (Standard): Kernmetriken je Rang

| Metrik | Erwartung | Iron | Gold | Diamond | Challenger | Monoton? |
|---|---|---|---|---|---|---|
| CS@10 [L] | steigt | 17.8 ±0.8 | 26.8 ±0.8 | 34.1 ±1.3 | 30.3 ±4.1 | **nein** (Diamond -> Challenger: im Rauschen) |
| Idle-Anteil Laner (Hirn-Spec) [L] | sinkt | 10.1 ±0.9 | 10.8 ±0.8 | 10.2 ±0.4 | 9.8 ±1.3 | **nein** (Iron -> Gold: im Rauschen) |
| Idle-Anteil breit (A2: kein Auftrag) [L] | sinkt | 11.7 ±0.9 | 12.8 ±0.5 | 14.9 ±0.6 | 17.2 ±1.5 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: signifikant; Diamond -> Challenger: im Rauschen) |
| Angriffsauslastung Laner [L] | steigt | 30.0 ±1.0 | 28.5 ±1.2 | 29.0 ±1.4 | 26.4 ±1.6 | **nein** (Iron -> Gold: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Trade-Bilanz in der Lane [L] | steigt | 39.8 ±7.1 | 50.0 ±0.0 | 48.3 ±4.7 | 48.9 ±6.1 | **nein** (Gold -> Diamond: im Rauschen) |
| Tode ohne Sicht [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | ohne Signal (alle Werte gleich) |
| Tode nach Überfall aus dem Nebel [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | ohne Signal (alle Werte gleich) |
| Skillshot-Trefferquote (auf Champions gezielt) [L] | steigt | 30.4 ±7.0 | 51.7 ±7.5 | 60.2 ±8.9 | 66.7 ±8.5 | ja |
| Ausweichquote [L] | steigt | 18.5 ±4.9 | 17.4 ±3.9 | 24.0 ±6.0 | 15.8 ±7.4 | **nein** (Iron -> Gold: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Reaktionszeit (Median) [L] | sinkt | 450 ±16 | 500 ±14 | 500 ±37 | 367 ±27 | **nein** (Iron -> Gold: signifikant; Gold -> Diamond: im Rauschen) |
| Recall abgeschlossen [L] | steigt | 75.5 ±1.6 | 78.3 ±1.1 | 69.0 ±2.2 | 71.1 ±5.2 | **nein** (Gold -> Diamond: signifikant) |
| Gold ausgegeben pro abgeschlossenem Recall [L] | steigt | 272 ±26 | 502 ±16 | 529 ±50 | 538 ±104 | ja |
| Recall mit gecrashter Welle [L] | steigt | 4.8 ±1.7 | 11.0 ±0.9 | 10.5 ±2.8 | 12.7 ±2.7 | **nein** (Gold -> Diamond: im Rauschen) |
| Recall mit Gegnerwelle am eigenen Turm [L] | sinkt | 8.0 ±1.9 | 7.6 ±2.6 | 11.8 ±5.6 | 11.4 ±2.2 | **nein** (Gold -> Diamond: im Rauschen) |
| Partiedauer (entschieden) [F] | sinkt | 32.4 ±? | - | - | - | ja |
| Erster Turm (min) [F] | sinkt | 22.3 ±? | 21.3 ±? | 18.7 ±? | 17.9 ±? | ja |
| Siegquote (Nexus) [F] | steigt | 100.0 ±? | - | - | - | ja |
| Siegquote (Nexus oder Gold-Vorsprung) [L] | steigt | 25.0 ±21.0 | 50.0 ±0.0 | 25.0 ±21.8 | 25.0 ±20.7 | **nein** (Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Objective-Kontrolle gesamt [F] | steigt | 64.7 ±? | 50.0 ±? | 25.0 ±? | 42.9 ±? | **nein** (Iron -> Gold: unbelegt (nur 1 Partie); Gold -> Diamond: unbelegt (nur 1 Partie)) |

## Neues Gehirn (Beta, --brain=new): Kernmetriken je Rang

| Metrik | Erwartung | Iron | Gold | Diamond | Challenger | Monoton? |
|---|---|---|---|---|---|---|
| CS@10 [L] | steigt | 23.4 ±1.2 | 28.4 ±2.0 | 29.4 ±1.3 | 28.6 ±3.4 | **nein** (Diamond -> Challenger: im Rauschen) |
| Idle-Anteil Laner (Hirn-Spec) [L] | sinkt | 4.9 ±1.2 | 6.1 ±0.2 | 7.0 ±0.7 | 8.5 ±1.0 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Idle-Anteil breit (A2: kein Auftrag) [L] | sinkt | 11.2 ±0.9 | 11.1 ±0.6 | 17.7 ±2.0 | 19.1 ±0.2 | **nein** (Gold -> Diamond: signifikant; Diamond -> Challenger: im Rauschen) |
| Angriffsauslastung Laner [L] | steigt | 48.3 ±2.0 | 38.2 ±1.1 | 31.3 ±0.8 | 27.8 ±0.5 | **nein** (Iron -> Gold: signifikant; Gold -> Diamond: signifikant; Diamond -> Challenger: signifikant) |
| Trade-Bilanz in der Lane [L] | steigt | 45.7 ±2.4 | 50.0 ±0.0 | 49.8 ±2.4 | 50.1 ±6.0 | **nein** (Gold -> Diamond: im Rauschen) |
| Tode ohne Sicht [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | ohne Signal (alle Werte gleich) |
| Tode nach Überfall aus dem Nebel [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | ohne Signal (alle Werte gleich) |
| Skillshot-Trefferquote (auf Champions gezielt) [L] | steigt | 29.6 ±5.9 | 47.7 ±6.3 | 56.7 ±7.4 | 62.2 ±7.9 | ja |
| Ausweichquote [L] | steigt | 33.3 ±11.7 | 22.0 ±4.6 | 22.9 ±4.9 | 27.6 ±6.7 | **nein** (Iron -> Gold: im Rauschen) |
| Reaktionszeit (Median) [L] | sinkt | 567 ±46 | 500 ±33 | 433 ±37 | 400 ±25 | ja |
| Recall abgeschlossen [L] | steigt | 76.3 ±3.8 | 77.2 ±4.0 | 73.2 ±3.1 | 62.4 ±3.2 | **nein** (Gold -> Diamond: im Rauschen; Diamond -> Challenger: signifikant) |
| Gold ausgegeben pro abgeschlossenem Recall [L] | steigt | 356 ±47 | 479 ±17 | 431 ±19 | 474 ±58 | **nein** (Gold -> Diamond: im Rauschen) |
| Recall mit gecrashter Welle [L] | steigt | 14.6 ±2.6 | 14.6 ±1.6 | 14.4 ±4.5 | 25.9 ±8.0 | **nein** (Gold -> Diamond: im Rauschen) |
| Recall mit Gegnerwelle am eigenen Turm [L] | sinkt | 4.2 ±2.3 | 5.5 ±0.7 | 9.3 ±2.9 | 2.8 ±1.9 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen) |
| Partiedauer (entschieden) [F] | sinkt | - | - | - | - | ja |
| Erster Turm (min) [F] | sinkt | 27.1 ±? | 25.5 ±? | 25.0 ±? | 28.2 ±? | **nein** (Diamond -> Challenger: unbelegt (nur 1 Partie)) |
| Siegquote (Nexus) [F] | steigt | - | - | - | - | ja |
| Siegquote (Nexus oder Gold-Vorsprung) [L] | steigt | 0.0 ±0.0 | 50.0 ±0.0 | 25.0 ±20.6 | 25.0 ±21.9 | **nein** (Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Objective-Kontrolle gesamt [F] | steigt | 0.0 ±? | 50.0 ±? | 66.7 ±? | 40.0 ±? | **nein** (Diamond -> Challenger: unbelegt (nur 1 Partie)) |

## Neu gegen Alt (gleiche Seeds)

Differenz Neu minus Alt je Rang; fett = außerhalb von 1,96 x Standardfehler der Differenz (Paarung der Seeds wird konservativ nicht ausgenutzt).

| Metrik | Iron | Gold | Diamond | Challenger |
|---|---|---|---|---|
| CS@10 | **+5.6** | +1.6 | **-4.7** | -1.7 |
| Idle-Anteil Laner (Hirn-Spec) % | **-5.2** | **-4.7** | **-3.2** | -1.3 |
| Idle-Anteil breit (A2: kein Auftrag) % | -0.5 | **-1.7** | +2.7 | +1.9 |
| Angriffsauslastung Laner % | **+18.3** | **+9.7** | +2.3 | +1.4 |
| Trade-Bilanz in der Lane % | +5.9 | +0.0 | +1.5 | +1.2 |
| Tode ohne Sicht % | +0.0 | +0.0 | +0.0 | +0.0 |
| Tode nach Überfall aus dem Nebel % | +0.0 | +0.0 | +0.0 | +0.0 |
| Skillshot-Trefferquote (auf Champions gezielt) % | -0.8 | -4.0 | -3.5 | -4.5 |
| Ausweichquote % | +14.8 | +4.6 | -1.1 | +11.8 |
| Reaktionszeit (Median) ms | **+117** | +0 | -67 | +33 |
| Recall abgeschlossen % | +0.8 | -1.0 | +4.2 | -8.7 |
| Gold ausgegeben pro abgeschlossenem Recall | +84 | -23 | -98 | -64 |
| Recall mit gecrashter Welle % | **+9.8** | +3.6 | +3.9 | +13.3 |
| Recall mit Gegnerwelle am eigenen Turm % | -3.8 | -2.1 | -2.6 | **-8.6** |
| Partiedauer (entschieden) min | - | - | - | - |
| Erster Turm (min) min | +4.8 | +4.2 | +6.3 | +10.3 |
| Siegquote (Nexus) % | - | - | - | - |
| Siegquote (Nexus oder Gold-Vorsprung) % | -25.0 | +0.0 | +0.0 | +0.0 |
| Objective-Kontrolle gesamt % | -64.7 | +0.0 | +41.7 | -2.9 |

## Definitionen

- **CS@10** (`cs10`, L): Champ.cs der Laner (Top, Mid, ADC) genau bei 10:00 (Tick 18000), Mittel über Laner und Partien. Rollen-Zeilen zählen auch Jungle/Support (deren cs).
- **CS/min Partieende** (`csEnd`, L): Laner: Champ.cs am Ende des Laufs geteilt durch die gespielten Minuten (Lauflänge der Menge, nicht Partielänge).
- **Idle-Anteil Laner (Hirn-Spec)** (`idle`, L): Zähler: Ticks, in denen der Laner (Top/Mid/ADC) lebt, nicht recallt, nicht castet (isBusy), keinen Angriff laufen hat (Atk.phase 0), nicht läuft (Move.mode 0) und seit mehr als 45 Ticks (1,5 s) keinen Order-Befehl (move, attack, attackMove, stop, cast, spell, item, recall, ward) ausgegeben hat. Nenner: Ticks 2:00-14:00, in denen ein gegnerischer Minion oder Champion in Reichweite+200 (Angriffsreichweite + eigener Radius + 200 + Radius des Ziels) ist. Entspricht der Definition in docs/BRAIN-REWORK.md; zählt anders als die Harness-Kennzahl nur Order-Befehle (kein buy/ping/chat).
- **Idle-Anteil breit (A2: kein Auftrag)** (`idleAll`, L): Zähler: Ticks, in denen ein lebender Bot keinen Bewegungsauftrag (Move.mode 0), keinen Angriff (Atk.phase 0, kein Atk.target), keinen Recall und keinen Cast/Kanal hat. Nenner: lebende Ticks ab 1:45 außerhalb des Brunnens und ohne Recall. Alle Rollen, ganzer Lauf (Idee: tools/bughunt/matchProbe.ts).
- **Angriffsauslastung Laner** (`util`, L): Anteil der Ticks 2:00-14:00 mit laufendem Angriff (Wind-up oder Backswing), während ein Gegner (Minion/Champion) in Reichweite+200 ist (gleicher Nenner wie Idle-Anteil).
- **Trade-Bilanz in der Lane** (`tradeBal`, L): Schaden des Teams an gegnerischen Champions geteilt durch (Schaden gemacht + Schaden erlitten), nur Champion-gegen-Champion-Schaden vor 14:00, bei dem im Umkreis von 1600 um das Opfer höchstens 4 lebende Champions stehen (Lane-Duelle, 2v2, kein Teamfight). 50 % = ausgeglichen. Nur gegen eine feste Referenz aussagekräftig (gleicher Rang: 50 % per Konstruktion).
- **Gewonnene Lane-Trades** (`exchWon`, L): Ein Trade ist eine Folge von Lane-Schaden (Definition oben) mit Lücken von höchstens 4 s im Umkreis von 1800 um den ersten Treffer, mit mindestens 200 Gesamtschaden. Gewonnen = das Team hat mehr Schaden gemacht als erlitten; Unentschieden zählen nicht. Anteil gewonnener von entschiedenen Trades.
- **Tode ohne Sicht** (`deathsNoVision`, L): Anteil der Champion-Tode durch einen gegnerischen Champion, bei denen das Team des Opfers den Killer in den 5 s (150 Ticks) bis 1 s vor dem Tod zu keinem Tick gesehen hat (Fog/Busch; die letzte Sekunde ist ausgenommen, weil der Angreifer sich beim Schlag zwangsläufig zeigt). Tode durch Türme/Minions/Monster zählen nicht (nicht im Nenner).
- **Sichtanteil auf den Killer (20 s vor dem Tod)** (`killerVis`, L): Für jeden Champion-Tod durch einen gegnerischen Champion: Anteil der 600 Ticks (20 s) vor dem Tod, in denen das Team des Opfers den Killer sehen konnte. Stetige Ergänzung zu den beiden Nullquoten-Metriken; niedrig = Tode aus dem Nebel. Mittel über alle solchen Tode (Ticks gepoolt).
- **Tode nach Überfall aus dem Nebel** (`deathsAmbush`, L): Anteil der Champion-Tode durch einen gegnerischen Champion, deren Kampf von einem Angreifer eröffnet wurde (erster Champion-Schaden auf das Opfer nach >= 5 s ohne Champion-Schaden, höchstens 20 s vor dem Tod), den das Team des Opfers in den 3 s (90 Ticks) vor diesem ersten Treffer nicht gesehen hat. Misst, ob der Bot aus dem Nebel angefallen wird (fehlende Sicht/Wards/Minimap-Disziplin). Ergänzt "Tode ohne Sicht", das fast immer 0 % ergibt, weil der Killer im Kampf selbst sichtbar wird.
- **Tode pro Champion und 10 min** (`deathsPer10`, L): Alle Champion-Tode des Teams geteilt durch (Champions x Lauflänge in Minuten / 10).
- **Skillshot-Trefferquote (alle)** (`ssHit`, L): Linienprojektile von Fähigkeiten (Kind.Projectile, kind 1, Ausgangsflug) der Champions des Teams: Anteil, der mindestens einen gegnerischen Champion getroffen hat (payload.hit). Enthält auch Schüsse auf Minions.
- **Skillshot-Trefferquote (auf Champions gezielt)** (`ssAimed`, L): Wie oben, aber nur Schüsse, deren Cursor beim Wirken höchstens 300 Einheiten von einem lebenden, für das Schützen-Team sichtbaren gegnerischen Champion entfernt war (der Bot hat auf einen Champion gezielt).
- **Ausweichquote** (`dodge`, L): Bedrohungen = gegnerische Linien-Skillshots, die einen Champion des Teams getroffen hätten, wenn er mit seiner Geschwindigkeit beim Abschuss geradeaus weitergelaufen wäre (geschlossene Form: kleinster Abstand von linear extrapolierter Champion- und Projektilbahn <= Champion-Radius + halbe Breite), mit Auftreffzeit >= 0,2 s und wenn das Schützen-Team-Champion für das Opfer-Team sichtbar war. Ausgewichen = Projektil hat den Champion nicht getroffen, obwohl es nicht vorher blockiert wurde (Minion, anderer Champion, Reichweite) und der Champion noch lebt. Quote = ausgewichen / Bedrohungen.
- **Ausweichquote ohne Fähigkeit** (`dodgeMove`, L): Wie Ausweichquote, aber ausgewichen gilt nur, wenn der Champion während des Fluges keinen cast/spell/item-Befehl ausgegeben hat (reine Bewegung). Nenner sind alle Bedrohungen.
- **Reaktionszeit (Median)** (`rtAll`, L): Zeit vom Reiz bis zum ersten Auftragswechsel-Befehl des Bots, über alle Reizarten gepoolt (siehe unten). Untergrenze 33 ms (1 Tick). Reize ohne Antwort in 2 s zählen als "keine Antwort" und gehen nicht in den Median ein.
- **Reaktionszeit Skillshot** (`rtDodge`, L): Reiz: gegnerischer sichtbarer Linien-Skillshot, der den Champion bedroht (Definition der Ausweichquote). Antwort: erster move/attackMove mit Richtungswechsel >= 40 Grad und >= 150 Einheiten Zielversatz zum letzten Auftrag, oder cast/spell/item/stop/recall.
- **Reaktionszeit Gegner taucht auf** (`rtVision`, L): Reiz: ein gegnerischer Champion wird für das Team sichtbar, nachdem er >= 3 s unsichtbar war, und steht <= 1500 Einheiten vom Bot. Antwort: erster Auftragswechsel (anderer Befehlstyp, Angriff auf anderes Ziel, Bewegung mit >= 40 Grad / >= 150 Einheiten Versatz, cast/spell/recall/stop/item/ward).
- **Reaktionszeit Überfall** (`rtAmbush`, L): Reiz: der Bot erleidet Schaden von einem gegnerischen Champion, nachdem er >= 5 s keinen Champion-Schaden erlitten hat. Antwort: erster Auftragswechsel (wie bei "Gegner taucht auf").
- **Reize ohne Antwort in 2 s** (`rtNone`, L): Anteil aller Reize (Skillshot, Gegner taucht auf, Überfall), auf die der Bot binnen 2 s keinen Auftragswechsel-Befehl gegeben hat.
- **Recalls pro Champion und 10 min** (`recallPer10`, L): Begonnene Recalls (Champ.recallAt wechselt von 0 auf > 0) pro Champion und 10 Minuten.
- **Recall abgeschlossen** (`recallDone`, L): Anteil der begonnenen Recalls, die im Brunnen enden (nicht durch Schaden/Bewegung/Tod abgebrochen).
- **Gold beim Recall-Start** (`recallGold`, L): Mittleres Champ.gold zu Beginn des Recalls.
- **Gold ausgegeben pro abgeschlossenem Recall** (`recallSpent`, L): Zuwachs von (totalGold - gold) vom Recall-Start bis der Champion den Brunnen verlässt (spätestens 20 s nach Ankunft): im Shop ausgegebenes Gold.
- **Ungenutztes Gold nach dem Shoppen** (`recallLeft`, L): Champ.gold beim Verlassen des Brunnens (abgeschlossene Recalls).
- **HP beim Recall-Start** (`recallHp`, L): Mittlerer Anteil Hp.cur / Hp.max zu Beginn des Recalls.
- **Recall mit gecrashter Welle** (`recallCrashed`, L): Anteil der Recalls von Laner/Support, bei denen >= 3 eigene Minions der Lane innerhalb von 1200 Einheiten um den vordersten lebenden gegnerischen Turm der Lane stehen (Welle crasht, kein Farm-Verlust für den Gegner-Push).
- **Recall mit Gegnerwelle am eigenen Turm** (`recallBad`, L): Anteil der Recalls von Laner/Support, bei denen >= 3 gegnerische Minions der Lane innerhalb von 1000 Einheiten um den vordersten lebenden eigenen Turm der Lane stehen (gleiche Definition wie recallsWaveAtTower im Harness).
- **Kills pro Partie (beide Teams)** (`killsGame`, F): Alle Champion-Kills beider Teams pro Lauf.
- **Partiedauer (entschieden)** (`gameLen`, F): Mittlere Dauer der Partien, die per Nexus entschieden wurden (nicht entschiedene Läufe hängen vom Zeitlimit ab und zählen nicht).
- **Entschiedene Partien** (`decided`, F): Anteil der Läufe, die vor dem Zeitlimit per Nexus endeten.
- **Erster Turm (min)** (`firstTowerMin`, F): Minute, in der der erste Turm (egal welches Team) fiel; Läufe ohne Turmfall zählen nicht.
- **Erster Turm für das Team** (`firstTower`, F): Anteil der Läufe mit Turmfall, in denen das Team den ersten Turm zerstört hat.
- **Siegquote (Nexus)** (`winNexus`, F): Siege per Nexus geteilt durch die entschiedenen Läufe.
- **Siegquote (Nexus oder Gold-Vorsprung)** (`winLead`, L): Wie botSim --vs: Sieg per Nexus, bei Zeitablauf der Lauf mit mehr verdientem Team-Gold. Zähler gewonnen / alle Läufe (Gleichstand nicht gewonnen).
- **Gold/min pro Champion** (`goldPerMin`, L): Verdientes Gold (Summe der positiven Gold-Zuwächse) pro Champion und Minute.
- **Turm-Anteil** (`objTower`, F): Vom Team zerstörte Türme / alle zerstörten Türme (nur Läufe mit mindestens einem Turmfall).
- **Leviathan-Anteil (Drache)** (`objDrake`, F): Vom Team getötete Leviathane / alle getöteten Leviathane.
- **Kesselbrut-Anteil (Herold)** (`objHerald`, F): Vom Team getötete Kesselbrut-Einheiten / alle getöteten Kesselbrut-Einheiten (3 Einheiten je Lager).
- **Schleierwächter-Anteil (Baron)** (`objBaron`, F): Vom Team getötete Schleierwächter / alle getöteten Schleierwächter.
- **Objective-Kontrolle gesamt** (`objAll`, F): Summe der Teil-Ereignisse des Teams (Türme + Inhibitoren + Leviathane + Kesselbrut-Lager (Einheiten / 3) + Schleierwächter) geteilt durch die Summe beider Teams.
- **Platten-Anteil (vor 14:00)** (`plates`, L): Vom Team abgebaute Turmplatten vor 14:00 / alle abgebauten Platten.

