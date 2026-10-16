# Ist-Zustand Bot-Gehirn (2026-10-16)

Stand: `main` (Commit `f0cdede` + Folge-Commits). Code in `src/ai/**` (~9300 Zeilen), Daten in `src/data/bots/**`.
Spezifikation: [spec-bots.md](spec-bots.md). Zahlen/Entscheidungen: [DECISIONS.md](DECISIONS.md).

## 1. Überblick in einem Satz
Jeder Bot bekommt in seinem Entscheidungstakt (2–8 Hz je Rang) einen **fog-gefilterten Snapshot seines Teams**,
baut daraus eine **Wahrnehmung**, läuft einmal durch einen **Behavior Tree aus JSON** und gibt **normale Spieler-Befehle**
(move/attack/cast/…) zurück, teils mit **Verzögerung** (Reaktionszeit, Last-Hit-Timing). Er sieht nie den Sim-Zustand.

## 2. Ablauf pro Tick (`src/ai/runner.ts`, `BotRunner.tick`)
1. Sim-Events des letzten Ticks werden **pro Team fog-gefiltert** (`teamEvents`) und pro Bot gepuffert
   (Events leben nur einen Tick; ein Bot sieht alle Events seit seiner letzten Entscheidung).
2. Nur Bots, deren Takt fällig ist, entscheiden. Takt = `30 / microHz` Ticks, **±20 % Zufall** (kein Gleichtakt mit Angriffstimern).
3. `buildSnapshot(sim, team, slot)` → `think(snap, ctx, mem, rng)` (`src/ai/bot/brain.ts`).
4. `think`: während eigener Cast-Zeit/Kanalisierung nur Level-ups (sonst würde ein Bewegungsbefehl den Cast abbrechen);
   sonst `runTree` (Behavior Tree). Gecastete Fähigkeiten setzen `mem.busyUntil`.
5. Befehle mit `delay` kommen in eine Warteschlange (Reaktionszeit, geplanter Last-Hit); `cancelTags` verwirft
   überholte Pläne (z. B. alter Last-Hit, `tag: 'lh'`). Während `busy` werden verzögerte move/attack verworfen.
6. Moduswechsel und Knoten-Entscheidungen gehen ins **Entscheidungs-Log** (gedrosselt: gleiche Entscheidung max. alle 5 s).

## 3. Statische Bot-Daten (`BotStatic`, `src/ai/bot/types.ts`)
Slot, Team, Rolle, Lane, Champion-Daten, Build (`src/data/builds`), **Rangprofil**, Karte, Spielerliste,
Toxizität, Sprache, **BotParams** (Skill 0–100, Verhalten, 10 Spielstil-Achsen, Archetyp, Knobs), Log, Team-KI.

## 4. Rang und Persönlichkeit
### Rangprofile (`src/data/bots/profiles/*.json`)
| Rang | Skill | Entscheidungen/s | Last-Hit-Streuung | Fehlerrate | CS-Ziel/min (Tabelle A) |
|---|---|---|---|---|---|
| Eisen | 5 | 2 | ±220 ms | 35 % | 5,0 |
| Bronze | 15 | 2,5 | ±180 ms | 30 % | 5,8 |
| Silber | 30 | 3 | ±140 ms | 25 % | 6,4 |
| Gold | 45 | 3,5 | ±110 ms | 20 % | 6,8 |
| Platin | 58 | 4 | ±90 ms | 16 % | 7,1 |
| Smaragd | 68 | 4,5 | ±75 ms | 13 % | 7,4 |
| Diamant | 80 | 5 | ±60 ms | 9 % | 7,7 |
| Meister | 88 | 6 | ±50 ms | 6 % | 8,0 |
| Großmeister | 94 | 7 | ±40 ms | 4 % | 8,3 |
| Challenger | 100 | 8 | ±35 ms | 3 % | 8,6 |

Weitere Profilwerte: Reaktionszeit-Verteilung (`sampleReactionMs`), Wellenzustand-Häufigkeit, Skillshot-Treffer,
Rückzugsgrenze, Objective-Umsetzung, Hysterese, optimale Prägungen, Fehlerarten-Tabelle (`errors.json`).

### Spielstil (`src/ai/params.ts`, `playstyleAxes.json`, `archetypes.json`)
10 Achsen −5..+5 (u. a. Aggression, Farm-Priorität, Roam, Tempo, Trade-Länge, Vision, Team-Bindung …), gewürfelt pro
Spiel (rangtypisch + Champion-Bias) oder per Archetyp/manuell in der Lobby. Daraus `knobs` (z. B. Ping-Gehorsam,
Recall-Schwelle, Support-ADC-Bindung). **Tilt**: +1 pro Tod, −1 pro Kill / nach 120 s → verschlechtert Werte.

### Fehler-Injektion (`src/ai/errors.ts`)
Je Rang feste Raten, geloggt mit `injectedError`, u. a.: `chase_third_kill`, `overcommit_after_kill`,
`ignore_minion_aggro`, Last-Hit-Aussetzer, falsche Zielwahl, verpasste Skillshots, schlechte Rückzüge.

## 5. Wahrnehmung (`src/ai/bot/perception.ts` = `View`, `src/ai/perception/**` = `BotPerception`)
- Nur Snapshot-Daten: sichtbare Gegner, eigene Einheiten, Türme, Objectives-Timer (aus Events), Audio-Cues.
- **Wolken** (`clouds.ts`): wo ein unsichtbarer Gegner sein könnte (wächst mit der Zeit seit letzter Sicht).
- **Jungler-Modell + Gank-Risiko** pro Lane (`gankRisk.ts`), **Bedrohungskarte** (`threat.ts`), Wellen-Analyse (`waves.ts`),
  Gegner-Spielstil-Schätzung (`enemyStyle.ts`), Rang-Modell des Gegners (`rankModel.ts`).
- Reaktion: Infos wirken erst nach der Reaktionszeit (verzögerte Befehle).

## 6. Behavior Tree (`src/data/bots/tree.json`, Runtime `src/ai/bt/**`)
Oberster Knoten `sequence root`:
1. **housekeeping (parallel):** `levelUp`, `bookkeeping`, `teamAI`, `pingsIn`, `utilitySpells` (Teleport, Reinigen, Erschöpfen …)
2. **main (selector, erster Erfolg gewinnt):**
   - `dead` → `recallChannel` → `fountain` (Shop, Heilen)
   - **survive:** `escape` → `pingRetreat` → `diveDefence` → `retreat`
   - `dodge` (Linien-Skillshots) → `peel` (Support) → `arena` (Trainer)
   - **combat:** `tradeRun` → `disengage` → [`teamfightNear` → `teamfight`] → `followUp` → [`tradeWindow` → `tradeStart`] → `joinFight`
   - [`hasObjectiveDesire` → `objective`] (Drache/Kesselbrut/Baron/Türme)
   - [`recallScore` (alle 5 s) → `recall`]
   - `idleAfterShove`
   - **role:** `gankRiskReaction` → `gank` → `counterGank` → `roam` → `enemyRoamReaction` → `splitPush` → `jungle` → **`lane`**
   - `vision` (Wards, Kontrollwards, Suchfeuer) → `idle` (kleine Schritte, Unstick)

Blätter: `src/ai/bt/leaves.ts` verdrahtet sie mit den Modulen unten. Zustand pro Bot: `BotMemory` (`src/ai/bt/state.ts`).

## 7. Module
| Modul | Datei | Was es tut |
|---|---|---|
| Lane | `bot/brain.ts` `laneLeaf`, `bot/laning.ts` | Stehpunkt hinter der Welle, Last-Hits, Pushen, Gebäude schlagen |
| Last-Hit | `bot/lasthit.ts` | sagt Minion-HP aus sichtbaren Angriffen eigener Minions/Türme voraus, Kill-Fenster, Timing inkl. Wind-up/Flugzeit, Vor-Treffer unter Turm, Zauber-Last-Hit |
| Trades | `bot/trade.ts`, `exchange.ts` | Austausch-Schätzung (3 s Trade / 6 s Kill), Trade starten/beenden, All-in, Turm-Dive bei sicherem Kill |
| Kiten | `bot/kite.ts` | Orbwalking (Angriff → Bewegung im Ausschwung), Abstand halten |
| Kampf | `bot/combat.ts`, `spells.ts` | Fähigkeiten offensiv/defensiv/heilend, Beschwörerzauber |
| Teamfight | `bot/teamfight.ts` | Zielwahl (mit Rang-Fehler), Positionierung, Fokus |
| Macro | `bot/macro.ts` | Wellenzustand (freeze/hold/slowPush/crash), Recall-Score, Wards, Sweeper |
| Team-KI | `bot/teamai.ts` | Wünsche je Team: Objective, Gruppieren, Belagern, Push zum Ende, Split |
| Jungle | `bot/laning.ts` `jungle`, `ganks/**` | Route nach Camp-Timern, Ganks (Ziel-Lane nach Kill-Chance), Gank-Abwehr, Flucht |
| Roams | `roams/**` | eigene Roams, Reaktion auf gegnerische Roams |
| Shop | `bot/shop.ts`, `builds.ts` | kauft nach `src/data/builds/<champ>.json` im Brunnen |
| Sozial | `bot/social.ts` | Pings, Chat, Flame, Rage-„?“, Reaktion auf Spieler-Pings |
| Log/Debug | `log.ts`, `ui/botDebug.ts` | Entscheidungs-Log, F9-Overlay |
| Mess-Harness | `harness.ts`, `tools/botSim.ts` | Bot-gegen-Bot-Partien, CSV, Metriken |
| Schatten-Bot | `ghost.ts` | Challenger-Brain auf der Sicht des Spielers (nur Auswertung) |

## 8. Gemessener Stand (bot-sim, Gold, wenige Seeds)
| Messwert | Wert | Ziel |
|---|---|---|
| Partiedauer | 29,6–34,7 min, alle mit Nexus-Sieg | 28–35 min ✔ |
| Kills/Tode pro Partie | ~34 | 40–60 |
| Erster Turm | ~18 min | 12–16 min |
| CS/min Laner bei 15:00 (Eisen/Gold/Challenger) | 2,1 / 2,8 / 3,7 | 5,0 / 6,8 / 8,6 |
| CS/min allein auf der Lane (10 min) | 5,6 (Eisen) – 7,8 (Challenger) | – |
| Siegquote Gold vs Silber / Diamant vs Gold | 5/8 / 3/8 | ≳ 65 % / ≳ 80 % |
| Seiten | Blau gewann 20 von 24 | 50 % |
| Wegfindung (Richtungswechsel/min, Hängen s/min) | 2,2 / 0,18 | – |

## 9. Warum die Bots so schlecht farmen („stehen die Hälfte der Zeit vor den Minions“)
Im Code nachvollzogen (`laneLeaf` + `planLastHit`):
1. **Zwischen den Last-Hits tut der Bot fast nichts.** Er greift nur an, wenn (a) ein Last-Hit innerhalb seines
   Entscheidungstakts fällig ist oder (b) gepusht werden darf. Pushen wird von `holdTimer` blockiert, sobald das nächste
   Kill-Fenster innerhalb von ~1 Angriffsperiode liegt – das ist in einer Welle fast immer der Fall. Ergebnis: Stehen.
2. **Wellenzustände bremsen zusätzlich:** `freeze`/`hold` (Gank-Risiko ≥ 0,4, Gegner im Rückstand, Tempo-Achse ≤ −2)
   verbieten Pushen ganz; `slowPush` nur bei ≥ 2 Minions Vorsprung.
3. **Aktives Ziel wird abgebrochen:** hat der Bot noch ein Angriffsziel und ist nichts fällig, schickt er `move`/`stop`
   („Timer frei halten“) → bricht eigene Auto-Angriffe ab, statt Minions anzuschlagen.
4. **Last-Hit nur im Takt:** Ein Plan wird nur ausgeführt, wenn die Verzögerung ≤ Entscheidungsintervall ist
   (Eisen 15 Ticks, Gold ~9). Fenster dazwischen werden beim nächsten Takt neu geplant; enge Fenster gehen verloren
   (`tooLate:timer/walk/windup`).
5. **Aussetzer werden pro Minion gecacht:** `roll.skip` wird einmal pro Minion gewürfelt und gilt für dessen ganzes Leben →
   ein „vergessener“ Minion bleibt vergessen.
6. **Stehpunkt hält zu lange:** Hysterese (250 Einheiten / 6 s) hält den alten Punkt, auch wenn die Welle weitergezogen ist;
   dazu +350 Abstand bei ≥ 2 Minions auf dem Bot, + Gank-Risiko-Verschiebung, „in Flash-Reichweite des Turms bleiben“
   → Bot steht außerhalb der Reichweite und muss erst laufen (`approach` nur bei Fenster < 45 Ticks).
7. **Kein Harass im Leerlauf:** Gegner-Champion wird nur über den Trade-Knoten (Gate `tradeWindow`) angegriffen,
   nicht nebenbei zwischen Last-Hits.
8. **Abwesenheit:** ~30 % der Lane-Minions sterben, während der Bot weg ist (Recalls, Heilen, Roams, Shove-and-Recall
   bei hohen Rängen) – das größte Einzel-Leck bei den CS.
9. **Rang-Unterschied falsch gewichtet:** höhere Ränge roamen/recallen mehr und farmen dadurch teils weniger als Gold.

## 10. Weitere bekannte Schwächen
- Seiten-Ungleichgewicht (Blau gewinnt 20/24) – Ursache noch offen (Agent arbeitete daran, unterbrochen).
- Ränge entscheiden Partien nicht klar genug (Kampf ja, Partie nein).
- Kill-Zahl und erster Turm unter Ziel.
- Champion-Kollision: Bots bleiben an stehenden Verbündeten hängen (Seitenschritt nach 1,5 s als Notlösung).
- Viele Logik-Teile sind „Regel + Schwelle“ verteilt über Knoten; kein gemeinsames Nutzen-/Score-Modell für
  „was ist jetzt am wertvollsten“ (Farm vs. Trade vs. Push vs. Roam).

## 11. Was gut funktioniert
- Kein Allwissen (nur Fog-Snapshot), deterministisch, Replays identisch, alles geloggt (F9).
- Vorhersage der Minion-HP ist genau (Todeszeitpunkt in > 75 % exakt), Timing mit Wind-up/Flugzeit korrekt.
- Objectives, Belagern, Spiel beenden, Wards, Bannen, Teamfights, Ganks laufen.
- Wegfindung deutlich ruhiger als zuvor.
