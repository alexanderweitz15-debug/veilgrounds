# Wave-Report 0 – Stabilisieren (A29 Integrator, 2026-10-24)

Branch `claude/veilgrounds-next-level-f6na23`. Gemergt: A1 (`feat/a1-asset-pipeline`, Merge `5d9a2e1`),
A2 (`feat/a2-sim-bugs`, Merge `ba6dfd3`). Details: docs/CHANGELOG.md, docs/BUGS.md, docs/ART.md, docs/REQUESTS.md.

## Ergebnis in einem Satz

Die wahrscheinliche Hauptursache von „Grafiken laden nicht zuverlässig" ist gefunden und abgefangen: Champion **Fenna**
steht im Roster, hat aber kein Sprite-Kit. Jedes Match mit Fenna (~26 % der klassischen Seeds) ließ den gesamten
Champion-Atlas scheitern, alle zehn Champions waren Platzhalter-Kleckse.

## A1 – Asset- & Render-Pipeline

| Befund | Beleg | Status |
|---|---|---|
| Fenna ohne Kit → ganzer Champion-Atlas scheitert | reproduziert auf `5b776d3`, Seed 1008, Produktionsbuild | abgefangen: nur Fenna als pink/schwarzes Schachbrett. **Kit fehlt weiter (R3)** |
| Sim startete vor Minion-/Monster-Atlas | Zeitleiste: erster Tick 22 s, `minions: null` | gefixt: zentraler Preloader, Sim pausiert bis alles da ist |
| Worker-Pool ohne Timeout | Test mit stummem Worker hängt ohne Wächter | gefixt: 20-s-Wächter, `messageerror`, Fallback Hauptthread |
| Atlas 8192×4096 = 33,5 Mpx > Safari-Limit 16,7 Mpx | nur Layout-Mathe + Emulation in Chromium | gefixt per Laufzeit-Probe + Nachbacken; **nicht auf echtem Safari geprüft** |
| Lazy-Chunk 404 nach Deploy | Playwright mit 404-Chunk | gefixt: ein geschützter Reload, dann Banner |
| Google Fonts render-blockierend | Request hängt/fehlt offline | gefixt: Schriften selbst gehostet (OFL) |

Kosten: Der kalte Erststart dauert länger, weil jetzt alles vor dem Spiel gebacken wird (Sandbox: Spielstart nach ~45–75 s
statt 22 s; Sandbox hat nur Software-GPU, echte Hardware deutlich schneller). Der Menü-Leerlauf backt jetzt auch Monster vor.

## A2 – Simulation

12 komplette Headless-Partien (Standard- und Beta-Gehirn, Iron/Gold/Challenger) mit Invarianten-Sonde
(`tools/bughunt/matchProbe.ts`): keine Ausnahme, kein NaN, keine falschen Respawn-Zeiten. 0 kritisch, 3 mittel (alle
gefixt: Minion-Wellen blieben stehen – Busch-Ziel ohne Sicht, Turmkollision auf Lane-Knoten, zwei Minions blockieren sich
am Knoten), 5 kosmetisch (offen, BUGS.md). Ward-Sicht, Unterbrechungen (Tod/Stun je Champion × Fähigkeit) und Respawn
ohne Befund, als Tests abgesichert.

Messung nebenbei (nur gemessen, nicht geändert): Beta-Gehirn auf Challenger lässt Top/Mid 31–42 % der Spielzeit ohne
Order. Das ist Input für A6/A13/A14 und verletzt das DoD-Ziel „Leerlauf < 5 %" deutlich.

## Gate-Prüfung auf dem gemergten Stand

- `npx tsc --noEmit`: fehlerfrei
- Volle Testsuite: 92 Dateien, 1032 Tests, alle grün (vorher 81 / 987)
- `npx vite build`: fehlerfrei (nur die bekannte Chunk-Größen-Warnung)
- Browser (Produktionsbuild, headless Chromium, externe Hosts gesperrt): klassisches Match mit Fenna-Seed – alle drei
  Atlanten beim ersten Tick fertig, übrige Champions gemalt, keine Seitenfehler. Zweites Match (Zufalls-Seed) bis 1:16
  Spielzeit ohne Konsolenfehler. Ein „manuelles Match" im Sinne eines Menschen am Gerät ist in der Sandbox nicht möglich.

## Offen / Risiken

1. **Fenna braucht ein Kit** (R3). Bis dahin ist das DoD „alle Grafiken laden" nicht erfüllt. Empfehlung: Fenna aus
   Lobby und Bot-Auswahl nehmen, bis das Kit existiert (Nutzerentscheidung).
2. R1 (Terrain-Fertigsignal) und R2 (synchrones `toDataURL` in `icons.ts`/`portraits.ts`) offen → A19 (UI) / A10 (Welt).
3. Echte Safari/iOS-Prüfung fehlt (keine Hardware in der Sandbox).
4. Ursache des Nutzerproblems ist nicht durch Nutzer-Konsolenlog bestätigt (Platzhalter im Master-Prompt leer).

## Gate 0

**Technisch bestanden** (Build, Tests, Browser grün; alle kritischen Befunde behoben). Welle 1 startet nach Freigabe
durch den Nutzer – sie kostet deutlich mehr Laufzeit und Tokens als Welle 0, und Punkt 1 (Fenna) ist eine Produktentscheidung.
