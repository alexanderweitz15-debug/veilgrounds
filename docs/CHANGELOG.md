# Changelog

Neue Einträge oben. Format: Was / Warum / Wie getestet.

## 2026-10-24 · A2 · Simulations-Bugs (Wave 0), Branch feat/a2-sim-bugs

**Was:** Drei Minion-Stillstandsfehler in `src/sim` behoben (Details und Beweise in [docs/BUGS.md](BUGS.md)):
(1) Minions jagen keine gegnerischen Minions mehr, die im Busch stehen (`minions.ts` `attackable`/`nearest`);
(2)+(3) Lane-Minions überspringen einen Lane-Knoten, wenn sie ihm auf zwei Körperradien nahekommen (`minions.ts` `walkLane`) –
ein Belagerungs-Minion stand sonst für immer am eigenen Turm (Knoten im Turmkreis), zwei Minions blockierten sich an einem
Knoten zwischen ihnen (Wellen blieben an Lane-Ecken stehen, bewiesen > 10 s); Neu: `tools/bughunt/matchProbe.ts` (Invarianten-Prüfung je Tick für komplette Bot-Partien).

**Warum:** Befunde aus 10 kompletten Probe-Partien und mehreren Teilläufen (Seeds 11-13, 21, 22; Standard- und Beta-Gehirn; Iron/Gold/Challenger).
Kein Ausnahmefehler, kein NaN, keine Konsolenmeldung gefunden; die drei Fehler waren Stillstände im Kern (Wellen).

**Wie getestet:** Je Fehler ein Regressionstest in `tests/a2SimBugs.test.ts` (vor dem Fix rot, nach dem Fix grün); dazu
Sweeps in `tests/a2Wards.test.ts`, `tests/a2Interrupts.test.ts` (Tod und Betäubung je Champion x Fähigkeit),
`tests/a2Respawn.test.ts`, `tests/a2Fuzz.test.ts` (feindliche Befehle). Replay-/Determinismus-Tests grün. **Spielergebnisse
ändern sich** (stateHash jeder Partie, in der einer der Fälle vorkommt); es gibt keine festen Hash-Fixtures in `tests/`.
