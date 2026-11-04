# Welle 1, A6: Bot-Messsystem (Benchmark)

Branch `feat/a6-benchmark` (Basis `claude/veilgrounds-next-level-f6na23`). Besitz: `tools/benchmark/**`, `tests/benchmark*.test.ts`, `docs/BENCHMARK-BASELINE.md`, diese Datei. Kein Eingriff in `src/sim`, `src/ai`, `tools/botSim.ts`, kein CHANGELOG-Eintrag.

## Was gebaut wurde

- **`tools/benchmark/cli.ts`** (`npx tsx tools/benchmark/cli.ts run | report | compare`): headless Bot-gegen-Bot-Läufe mit festen Seeds, `--brain=old|new` (new = `botUtility` + Reflex-Schicht, wie `bot-sim --brain=new`), Rang X gegen Referenzrang (`--pairs=iron:gold,...`), Menge L (kurz) und F (bis Nexus/Limit), `--jobs=N` Kindprozesse pro Partie, fortsetzbare JSON-Ausgabe (`--out`), `--mirror=1`, `--variance=1`, `--upgrade=1`. `report` erzeugt Markdown + eigenständiges HTML (inline CSS/SVG, kein CDN) mit Diagrammen, Monotonie-Tabelle, Alt/Neu-Vergleich und Definitionen. `compare` vergleicht einen Kandidaten gepaart mit der Baseline und listet Kernmetriken, die > 5 % schlechter sind (Merge-Regel).
- **`observer.ts`** (rein lesend, an `runBotGame`s `onTick` gehängt): Skillshots über die Projektil-Payloads, Ausweich-Bedrohungen in geschlossener Form (`geometry.ts`), Reaktionszeiten aus Reiz und Bot-Befehl, Idle (Hirn-Spec und breit nach A2), Trades, Tode/Sicht, Recall-Episoden mit Wellenzustand, Objectives. **`metrics.ts`** enthält jede Metrik mit ihrer ausgeschriebenen Definition (landet im Bericht). **`stats.ts`**: Bootstrap über ganze Partien (deterministisch, fester Seed), Median/Quantile.
- **Tests (19 neue):** `tests/benchmarkStats.test.ts` (13: Bootstrap, Monotonie, Bericht, Geometrie), `tests/benchmarkCompare.test.ts` (3), `tests/benchmarkDeterminism.test.ts` (3: gleiche Spezifikation gibt identische Zahlen; der stateHash mit Beobachter ist gleich dem ohne, für beide Gehirne; anderer Seed anderes Spiel).
- **Baseline:** `docs/BENCHMARK-BASELINE.md`, Rohdaten und HTML-Bericht in `tools/benchmark/baseline/`.

## Entscheidungen

- **Leiter statt Spiegel.** Rang X gegen feste Referenz Gold; gleicher Rang gegen gleichen Rang ergibt für Siegquote, Trade- und Objective-Anteile 50 % per Konstruktion. Dafür je Seed nur eine Partie je Paar (X auf Rot bei geradem Seed); `--mirror=1` spielt jeden Seed zweimal, kostet aber das Doppelte.
- **Varianz aus** (`noVariance`), damit Rangunterschiede nicht von Würfen überlagert werden; `--variance=1` schaltet sie ein.
- **15-Minuten-Partien** statt 20: CS@10, Idle (bis 14:00), Trades (bis 14:00), Skillshots, Reaktionen, Recalls brauchen nicht mehr; der Rechenaufwand war der Engpass (Last 20-30 auf 4 Kernen).
- **"Tode ohne Sicht"** wie gefordert definiert (Killer 5 s bis 1 s vor dem Tod nie im Team-Sichtfeld), ergibt aber überall 0 %. Deshalb zusätzlich "Überfall aus dem Nebel" (Eröffnungsangreifer 3 s vor dem ersten Treffer unsichtbar; ebenfalls 0 %) und das stetige `killerVis` (Sichtanteil auf den Killer in den 20 s vor dem Tod, 68-88 %).
- **Ausweichquote** nur für Skillshots, deren Schütze für das Opferteam sichtbar war und die erst nach >= 0,2 s träfen; blockierte, ausgelaufene oder wegen Tod verfehlte Schüsse zählen nicht. Kein Eingriff in Sim-Verhalten; Zonen-Skillshots (`zone`-Ereignis) sind nicht enthalten.
- **Reaktionszeit** aus drei Reizen (sichtbarer Skillshot, Gegner taucht auf, Überfall) und dem ersten Befehl, der den Auftrag wechselt (Typ, Ziel, >= 40 Grad Richtung); Mediane, weil die Verteilung schief ist.

## Messwerte und Tests

Zahlen und Tabellen: `docs/BENCHMARK-BASELINE.md`. Kurzfassung (neues Gehirn, 4 Partien je Rang, 15 min): CS@10 Gold 28,4 / Challenger 28,6; Idle (Hirn-Spec) 6,1 / 8,5 %; Angriffsauslastung 38,2 / 27,8 %; Skillshot-Treffer (gezielt) 47,7 / 62,2 %; Reaktionszeit 500 / 400 ms.

- Tests: 3 Dateien, 19 Tests grün (`npx vitest run tests/benchmarkStats.test.ts tests/benchmarkCompare.test.ts tests/benchmarkDeterminism.test.ts`, letzte ca. 100 s bei hoher Last). `npx tsc --noEmit` sauber. **Volle Suite und `vite build` nicht gelaufen** (nur Tools und Tests geändert; die Tools gehören nicht zum Build).
- Beobachter-Overhead 3 %, stateHash identisch (Test). Die Läufe laufen seed-deterministisch, die Wandzeit nicht.

## Offene Punkte und Risiken

- **Stichprobe klein:** L = 4 Partien je Rang und Gehirn, F = 1. In F endete nur 1 von 8 Partien per Nexus (Limit 35 min), Spieldauer und Nexus-Siegquote sind nicht baseline-fähig. Empfehlung: Baseline mit `--seeds=5..8` erweitern (`run` setzt `--out` fort), sobald die Maschine frei ist; dafür `--seeds=1..8` mit derselben `--out`-Datei starten.
- `deathsAmbush` und `killerVis` kamen während der Läufe dazu und liegen nur für einen Teil der Partien vor (Zähler im Tooltip). `run --upgrade=1` spielt ältere Partien neu.
- Die Monotonie-Tabellen sind mit 4 Partien meist nicht entscheidbar ("im Rauschen"); ein Bruch ist erst bei mehr Partien belegt oder widerlegt.
- Die Nullquoten "Tode ohne Sicht" und "Überfall" sind in dieser Bot-Population kein Signal (siehe Entscheidungen).
- Wunsch an die Besitzer von `src/sim`/`src/ai`: keiner. Die Beobachtung kommt ohne Haken aus; eine Anfrage in `docs/REQUESTS.md` war nicht nötig.
