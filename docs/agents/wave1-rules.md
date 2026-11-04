# Welle 1 (+ Gehirn) – gemeinsame Regeln (A29 Integrator, 2026-10-25)

Gilt für A6, A7, A13, A14. Ergänzt docs/agents/swarm-rules.md (Konventionen) und den Master-Prompt; bei Widerspruch gilt diese Datei.

## Start
1. Dein Worktree startet evtl. auf einem alten Commit. Erster Befehl:
   `git checkout -b feat/a<nr>-<thema> claude/veilgrounds-next-level-f6na23` und prüfen, dass `git log -1` den Commit
   `docs: wave 1 rules` oder neuer zeigt.
2. `ln -s /home/user/veilgrounds/node_modules node_modules` (nie committen, kein `npm install`).
3. Lesen: docs/DECISIONS.md (oberster Eintrag = Pfad-Mapping), docs/WAVE-REPORT-0.md, docs/BUGS.md, deine Fach-Docs.

## Ressourcen (4 Kerne / 15 GB für 4 Agents)
- `bot-sim`/Benchmark: höchstens `--jobs=1` (A6: `--jobs=2`). Läufe > 2 min immer im Hintergrund.
- Während der Arbeit nur betroffene Testdateien. Volle Suite (`npx vitest run`, ~4–6 min) höchstens zweimal, am Ende.
- `npx tsc --noEmit` vor jedem Commit. `npx vite build` einmal am Ende.

## Dateien
- Nur in deinem Besitzbereich ändern (steht in deinem Auftrag). Alles andere → `docs/REQUESTS.md` (Format dort).
- `docs/CHANGELOG.md` **nicht** anfassen (Merge-Konflikte). Stattdessen `docs/agents/wave1-a<nr>.md`: was, warum, wie
  getestet, Messwerte vorher/nachher, offene Punkte. Der Integrator übernimmt es ins Changelog.
- Determinismus: Sim nur mit seeded RNG; Replay-/Determinismus-Tests bleiben grün.
- **Faire Bots:** Bots bekommen nie Informationen, die ein Mensch nicht hätte (Fog, Cooldowns ohne Sicht). Rang =
  Entscheidungsqualität + Ausführungsrauschen, nie Informationsvorteil. Fog-Guard-Tests müssen grün bleiben.

## Gehirn
- Ziel ist das **Beta-Gehirn** (`--brain=new`, Einstellung „Neues Bot-Gehirn": Reflex-Schicht + Nutzenmodell). Das
  Standard-Gehirn bleibt unverändert (bit-identisch), bis der Integrator den Schalter umlegt.
- Merge-Regel A13/A14: Verbesserung gegenüber der A6-Baseline (`docs/BENCHMARK-BASELINE.md`) in den eigenen Zielwerten,
  keine Verschlechterung > 5 % in anderen Kernwerten. Die Baseline entsteht parallel; vor deinem Abschlussbericht prüfen:
  `git show claude/veilgrounds-next-level-f6na23:docs/BENCHMARK-BASELINE.md`. Existiert sie, mit `tools/benchmark`
  (Stand des Sammelbranch, ggf. `git merge claude/veilgrounds-next-level-f6na23` in deinen Branch) gleiche Seeds messen.
  Existiert sie noch nicht: mit `bot-sim --brain=new --report` vorher/nachher auf festen Seeds messen und das im Bericht sagen.
- Kein champion-spezifischer Code im Gehirn. Champion-Wissen kommt aus Daten.

## Git
- Commits im Worktree mit `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com -c user.name=Alex commit`,
  Nachricht endet mit Leerzeile + `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Nicht pushen.**

## Abschlussbericht an den Integrator (≤ 25 Zeilen)
Branch + Head-Commit, was gebaut wurde, Messwerte vorher/nachher (mit Seeds/Befehl), Tests (Anzahl, volle Suite ja/nein),
tsc/build, eingereichte Requests, offene Risiken. Unfertiges oder Ungeprüftes ausdrücklich benennen.
