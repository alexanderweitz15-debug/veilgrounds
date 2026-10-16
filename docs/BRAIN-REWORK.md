# Prompt: Bot-Gehirn-Rework (Veilgrounds)

16. Okt. 2026 · Alexander Weitz (Auftrag des Nutzers, wörtlich übernommen; Orchestrierungs-Abweichungen in docs/agents/orchestration.md)

## 1. Auftrag

Du übernimmst das Bot-Gehirn von Veilgrounds (src/ai/**, ~9.300 Zeilen, Daten in src/data/bots/**) und baust es so um, dass die Bots durchgehend handeln statt zu stehen, dass der Rang die Partie entscheidet und dass die Kennzahlen aus Tabelle A des Hauptprompts erreicht werden. Lies vor dem ersten Edit vollständig: docs/BRAIN-IST.md, docs/spec-bots.md, docs/DECISIONS.md (Abschnitte Pacing, Bot-Kalibrierung, Seiten-Fairness), src/ai/runner.ts, src/ai/bot/brain.ts, src/ai/bot/laning.ts, src/ai/bot/lasthit.ts, src/ai/bot/trade.ts, src/ai/bot/macro.ts, src/data/bots/tree.json, tools/botSim.ts.

Ist-Stand (bot-sim, Gold): Laner-CS/min bei 15:00 = 2,8 (Ziel 6,8), Kills/Partie 34 (Ziel 40–60), erster Turm 18 min (Ziel 12–16), Gold vs. Silber 4/8, Diamant vs. Gold 4/8 (Ziel ≥ 65 % / ≥ 80 %). Allein auf der Lane ohne Gegner schaffen die Bots 5,6–7,8 CS/min, in Partien verlieren sie also über die Hälfte des Farms an Stehen, Abwesenheit und Wellen-Blockaden.

Zielwerte nach dem Rework (bot-sim, 50 Partien pro Rang, --mirror, Toleranz ±10 %):

| Kennzahl | Iron | Gold | Diamant | Challenger |
|---|---|---|---|---|
| Laner-CS/min bei 15:00 | 4,8 | 6,5 | 7,4 | 8,2 |
| Laner-CS/min Partieende | 5,0 | 6,8 | 7,7 | 8,6 |
| Kills/Partie (beide Teams) | 55 | 50 | 44 | 40 |
| Erster Turm (min) | 16 | 14 | 13 | 12 |
| Partiedauer (min) | 33 | 31 | 29 | 26 |
| Angriffsauslastung Laner 2:00–14:00 (Anteil der Zeit mit laufendem Angriff oder Wind-up) | 35 % | 50 % | 60 % | 68 % |
| Idle-Anteil Laner (kein Befehl > 1,5 s während Minions in Reichweite) | 25 % | 10 % | 4 % | 2 % |

Siegquoten (gespiegelte Paare, gleiche Aufstellung beide Seiten): Silber vs. Iron ≥ 65 %, Gold vs. Silber ≥ 65 %, Platin vs. Gold ≥ 65 %, Diamant vs. Gold ≥ 80 %, Challenger vs. Diamant ≥ 70 %, Challenger vs. Gold ≥ 95 %.

Was bleibt: Fog-Snapshot ohne Allwissen, Determinismus, Entscheidungs-Log und F9-Overlay, Behavior Tree als JSON für die Ausführung, Rangprofile und Spielstil-Achsen als Daten, Wahrnehmungsmodule (Wolken, Gank-Risiko, Bedrohungskarte, Wellen-Analyse), Last-Hit-Vorhersage (lasthit.ts, trifft den Todestick in > 75 %; sie ist gut, nur ihre Einbettung ist falsch), Team-KI, Harness.

Was wegkommt: die Binarität „Last-Hit oder Pushen“ mit holdTimer, das Abbrechen eigener Autos per move/stop, der pro-Minion-Cache für Aussetzer, die 6-s-Stehpunkt-Hysterese, die Regel „Last-Hit nur wenn er in meinen Takt fällt“, Trade-only-Harass über das tradeWindow-Gate, und die Verteilung der Entscheidung „was ist gerade das Wertvollste“ auf Dutzende Knoten-Schwellen.

Regeln: Nichts hartkodieren, was ein Rang- oder Stilparameter sein kann. Jede Verhaltensänderung zuerst korrekt, dann per Rang verschlechtert. Jede Entscheidung geloggt. Vor jedem Commit npm test und npm run bot-sim -- --rank=gold --games=4 --minutes=20 grün bzw. nicht schlechter als der Stand davor; die Kennzahlen jeder Phase stehen mit Vorher/Nachher in docs/DECISIONS.md. Bei Widersprüchen zwischen diesem Prompt und spec-bots.md gilt dieser Prompt; dokumentiere die Abweichung.

## 2. Diagnose

Die neun Punkte aus BRAIN-IST §9 sind Symptome von vier Wurzelursachen. Behandle die Ursachen, nicht die Symptome einzeln, sonst wandert das Stehen nur in einen anderen Knoten.

| # | Symptom (BRAIN-IST) | Wurzelursache | Abschnitt |
|---|---|---|---|
| 1 | Zwischen Last-Hits passiert nichts; holdTimer sperrt Pushen, sobald ein Kill-Fenster in ~1 Angriffsperiode liegt | A: Ein Timer für alles. Last-Hit und „weiter angreifen“ konkurrieren um denselben Angriffstimer und werden als Entweder-oder modelliert. Richtig ist ein Scheduler, der jede freie Angriffsperiode füllt und nur die eine Periode frei hält, die der Last-Hit braucht | 4.1 |
| 3 | Laufender Auto wird per move/stop abgebrochen, um den Timer frei zu halten | A | 4.1 |
| 4 | Last-Hit nur, wenn er in den Entscheidungstakt fällt; enge Fenster gehen verloren | B: Ein Takt für alles. Reflexe (Auto ausführen, Plan validieren, Dodge) laufen im Rang-Entscheidungstakt (2–8 Hz). Ein Iron-Bot kann mit 2 Hz keinen Last-Hit auf 220 ms Streuung treffen, ein Mensch schon, weil Reaktionszeit und Entscheidungsfrequenz zwei verschiedene Dinge sind | 3, 4.2 |
| 6 | Stehpunkt bleibt bis 6 s gleich, Bot außer Reichweite | B (Stehpunkt wird nur im Takt neu berechnet, Hysterese kompensiert Flackern, das durch den Takt entsteht) | 4.4 |
| 2 | freeze/hold verbieten Pushen; slowPush nur bei ≥ 2 Minions Vorsprung | C: Wellenzustand als Verbot statt als Zielbild. Freeze heißt „halte die Welle hier“, nicht „tu nichts“. Die Zustände werden außerdem zu oft gewählt (Gank-Risiko ≥ 0,4 reicht) | 4.5 |
| 7 | Kein Harass im Leerlauf; Gegner nur über tradeWindow | D: Kein Nutzenmodell. Harass, Pushen, Last-Hit, Roam, Recall sind Knoten mit eigenen Schwellen, keine Kandidaten mit vergleichbarem Wert. Deshalb gewinnt immer der Knoten, der zuerst im Baum steht, und die Lücken dazwischen füllt niemand | 5 |
| 8 | ~30 % der Lane-Minions sterben während Abwesenheit | D (Recall/Heilweg/Roam werden nicht gegen den Wellenwert gerechnet) + C (kein Crash vor dem Weggehen) | 4.6, 7 |
| 9 | Höhere Ränge farmen weniger als Gold | D (Trade-Auslöser Diamant+ „CS-Fenster“ feuert ohne Gegenrechnung des eigenen Farmverlusts) + A (Trade und Farm nicht verzahnt) | 5, 8 |
| 5 | Vergessener Minion bleibt vergessen | Fehlermodell falsch: Aussetzer sind Zeitfenster der Unaufmerksamkeit, nicht Eigenschaften eines Minions | 9 |
| §10 | Rang entscheidet Kämpfe, nicht Partien; Team-Zusammenstellung dominiert | Folge von A–D: Wenn alle Ränge gleich schlecht farmen und gleich oft stehen, bleibt als Unterschied nur der Kampf, und der ist Champion-abhängig. Rang muss über Gold-Tempo, Wellen-Kontrolle und Objective-Konversion wirken, die sich über 30 Minuten aufaddieren | 8 |
| §10 | Kills 34 statt 40–60, erster Turm 18 statt 12–16 | Kein Harass (D), zu wenig Platten-Druck nach Crash (C), Gruppieren erst 14:00 | 6, 7 |

Zusätzlich aus DECISIONS: All-ins liefen in Timeouts (teils behoben), Diamant+ ließ Last-Hits bei Gank-Risiko aus (behoben, aber Symptom von D), Gold-Bots tradeten nur reaktiv (Auslöser „Vorteil“ nachgerüstet, aber immer noch Gate-Logik statt Wert). Behält man die Gate-Logik, kommt der nächste Sonderfall garantiert.

## 3. Zielarchitektur

Der Rang-Entscheidungstakt bleibt (Iron 2 Hz bis Challenger 8 Hz), aber er entscheidet nur noch was getan wird. Wie es ausgeführt wird, läuft in einer neuen Reflex-Schicht jeden Sim-Tick, für alle Ränge gleich schnell. Rang-Unterschiede in der Ausführung kommen ausschließlich aus Reaktionszeit, Timing-Streuung und Fehlerinjektion, nicht aus der Taktrate. Das ist der Grund, warum ein Iron-Mensch Last-Hits trifft, obwohl er langsam entscheidet.

Umsetzung in runner.ts: BotRunner.tick ruft pro Bot jeden Tick reflex(snap, mem) (billig: nur Plan-Queue, Scheduler, Dodge-Check; Ziel < 0,05 ms pro Bot) und nur im fälligen Takt think(...). reflex darf keine neue Absicht bilden, nur die vorhandene ausführen oder per Survive/Dodge unterbrechen. Der Snapshot für reflex ist derselbe fog-gefilterte Snapshot; Wahrnehmungsmodule (Wolken, Gank-Risiko) werden weiterhin nur im Takt aktualisiert.

Nutzen-Auswahl (src/ai/utility/**, neu) ersetzt die Reihenfolge-Logik des bisherigen main-Selectors für alle nicht-reflexiven Knoten (combat, objective, recall, idleAfterShove, role, vision). Diese Knoten werden zu Intent-Subtrees, die der Selector nicht mehr in fester Reihenfolge probiert, sondern die der gewählte Intent aufruft. survive, dodge, peel, dead/recallChannel/fountain und housekeeping bleiben im Baum vor der Auswahl. Abschnitt 5 definiert die Kandidaten und Wertfunktionen.

Pläne (src/ai/plan.ts, neu): Ein Plan ist {kind, targetId, executeAtTick, validUntilTick, preconditions, cancelTags}. Die Reflex-Schicht prüft pro Tick jeden Plan: Vorbedingung noch wahr (Ziel sichtbar, HP-Vorhersage im Fenster, Bot in Reichweite oder rechtzeitig dort), sonst verwerfen und sofort neu planen (Last-Hit-Planer ist billig genug für jeden Tick; messe das). Die bestehende delay-Queue wird durch Pläne ersetzt; busyUntil bleibt.

Logging: Jede Intent-Wahl schreibt alle Kandidaten-Scores. Jeder verworfene Plan schreibt den Grund (lh_cancel: minion_died | prediction_drift | out_of_range | overridden_by_dodge). Das F9-Overlay zeigt pro Bot: aktueller Intent, Top-3-Kandidaten mit Score, aktive Pläne mit Countdown, Angriffsauslastung der letzten 30 s. Ohne diese Anzeige ist Abschnitt 10 nicht prüfbar.

## 4. Laning-Rework

Das ist der wichtigste Abschnitt. Ein Laner-Bot soll sich anfühlen wie ein Mensch seiner Stufe in der Lane: immer in Bewegung oder im Angriff, Last-Hits als Fixpunkte, dazwischen Druck auf Welle oder Gegner.

### 4.1 Angriffs-Scheduler (src/ai/reflex/attackScheduler.ts, läuft jeden Tick)

Grundsatz: Jede Angriffsperiode wird genutzt, außer sie kollidiert mit einem geplanten Last-Hit.

```
period      = ticksPerAttack(AS)
nextLH      = frühester Plan vom Typ lastHit (executeAtTick), sonst null
now         = tick
freeUntil   = nextLH ? nextLH.executeAtTick - windupTicks - travelTicks(targetOfNextLH) : +inf

wenn attackReadyAt(now) <= now UND now + windupTicks <= freeUntil:
    ziel = wähleFillerZiel()      // siehe unten
    wenn ziel: attack(ziel)
sonst wenn attackReadyAt(now) > now UND Bot steht im Backswing:
    orbwalkMove()                  // Abschnitt 4.4
sonst: nichts (warten ist korrekt, aber nur, wenn freeUntil es verlangt)
```

wähleFillerZiel() in dieser Reihenfolge, gefiltert durch den aktuellen Intent und den Wellenzustand (4.5):

1. Gegnerischer Champion in Reichweite, wenn Harass erlaubt (4.3). Das ist die Standard-Füllung ab Gold, wenn der Gegner in Reichweite steht.
2. Minion mit der höchsten HP, der nicht der nächste Last-Hit-Kandidat ist und dessen Tod durch diesen Auto nicht in das Last-Hit-Fenster eines anderen Minions eingreift (Vorhersage aus lasthit.ts nutzen: Minion-HP nach dem Treffer darf nicht in [0, eigener Auto-Schaden] fallen, sonst entsteht ein Fenster, das der Bot nicht bedienen kann). Nur, wenn der Wellenzustand Pushen erlaubt.
3. Gegnerischer Minion, der einen eigenen Minion angreift (Wellen-Erhalt bei Freeze; verlangsamt den Push des Gegners, ohne selbst zu pushen). Nur unter Freeze.
4. Struktur (structureToHit-Regeln aus DECISIONS), wenn keine Minions in Reichweite und Pushen erlaubt.
5. Nichts.

Verboten: move/stop während des Wind-ups, außer durch survive/dodge. Ein Auto, der läuft, läuft zu Ende. Wenn ein Last-Hit-Fenster durch einen laufenden Filler-Auto verpasst würde, war der Scheduler falsch; die Prüfung now + windupTicks <= freeUntil muss das verhindern, und travelTicks muss die Laufzeit zum Last-Hit-Ziel enthalten.

### 4.2 Last-Hit-Planung (lasthit.ts bleibt, Einbettung neu)

- Der Planer läuft jeden Tick, nicht im Takt. Er pflegt pro sichtbarem gegnerischem Minion den vorhergesagten Todestick und das Fenster [frühester Treffer, der tötet; letzter Treffer, bevor Minions/Turm töten]. Erzeuge einen Plan für den nächsten Minion, dessen Fenster erreichbar ist (Laufweg + Wind-up + Projektilflug ≤ Fensterbeginn). Pläne bis 3 s voraus sind erlaubt.
- Zeitfehler: Zielzeitpunkt = Fensterbeginn + N(0, lastHitJitterMs) + Reaktionsanteil. Der Fehler wird beim Erstellen des Plans gewürfelt und beim Validieren beibehalten (ein Mensch korrigiert seinen Timing-Fehler nicht im Flug). Wird der Plan wegen prediction_drift verworfen und neu erstellt, wird neu gewürfelt.
- Zwei Minions gleichzeitig: Wenn zwei Fenster überlappen und beide nicht per Auto erreichbar sind, nutze eine Fähigkeit für eines (Zauber-Last-Hit existiert) oder opfere das kleinere Gold (Caster vor Nahkampf opfern). Ab Platin: Präventiv einen der beiden Minions so anschlagen, dass die Fenster auseinanderlaufen (Vorbereitung 1–2 Autos vorher; das ist die eigentliche Last-Hit-Kunst und der größte Unterschied zwischen Gold und Diamant beim CS).
- Unter Turm: Pre-Hit-Logik aus DECISIONS beibehalten, aber als Plan modellieren (Pre-Hit-Plan, dann Kill-Plan). Belagerungsminion: Turmschüsse zählen, Auto-Anzahl berechnen.
- Aussetzer: siehe Abschnitt 9. Nicht mehr pro Minion.

### 4.3 Harass im Leerlauf

Harass ist ein Filler-Ziel (4.1 Punkt 1), kein Trade. Erlaubt, wenn alle Bedingungen gelten:

- Gegner in Auto-Reichweite oder mit einem Schritt (≤ 150 Einheiten, der auch zum Stehpunkt passt) erreichbar.
- Minion-Aggro akzeptabel: Der Bot steht nicht in der gegnerischen Welle (ab Silber; Iron/Bronze ignorieren das, Fehlerart ignore_minion_aggro), oder der Gegner-Champion ist Nahkämpfer und der Bot Fernkämpfer (dann kostet Aggro nichts, wenn der Bot zurücktritt).
- Kein Last-Hit-Fenster in windup + travel.
- GankRisk < 0,6.
- Harass-Budget: Rang- und Stilabhängige maximale Harass-Rate (Autos pro Minute auf Champions ohne Trade-Absicht): Iron 2 (zufällig), Silber 4, Gold 6, Diamant 10, Challenger 12; Aggression-Achse ± 3.
- Challenger-Zusatz: Harass bevorzugt im CS-Fenster des Gegners (Gegner startet Auto auf Minion: 0,4 s, in denen er nicht zurückschlägt, ohne einen Last-Hit zu verlieren). Dazu liest der Bot den Wind-up des Gegners aus dem Snapshot.
- Fähigkeits-Harass (Poke-Skillshot auf den Gegner) läuft über das Nutzenmodell (5), weil Mana und Cooldown Kosten sind.

### 4.4 Stehpunkt und Orbwalk

- Der Stehpunkt wird jeden Tick aus dem aktuellen Wellen-Schwerpunkt berechnet: P = wellenFront + richtungZumEigenenTurm × (reichweite − puffer), seitlich versetzt um 80–150 Einheiten weg vom gegnerischen Champion (nicht in Skillshot-Linie stehen), begrenzt durch Gank-Risiko-Offset (Richtung Turm) und Turm-Reichweite des Gegners. Hysterese nur räumlich: neuer Bewegungsbefehl erst, wenn |P − pos| > 90 (Challenger) bis > 220 (Iron). Keine Zeit-Hysterese mehr.
- Harte Bedingung: Der nächste geplante Last-Hit muss von P aus ohne Laufweg erreichbar sein; sonst gilt die Position, die das sicherstellt.
- Orbwalk: Nach dem Treffpunkt (atkPhase 1→2) Bewegungsbefehl Richtung P oder Richtung Kite-Ziel, mit Timing-Jitter des Rangs; Kiting-Achse bestimmt die Wahrscheinlichkeit, dass der Orbwalk-Befehl kommt. Negativer Jitter (zu früh) bricht den Auto ab: das ist der gewollte Iron-Fehler.
- Support (ohne Farm-Absicht): Stehpunkt = 170 seitlich und 100 vor dem ADC in Richtung Gegner, mit derselben Skillshot-Linien-Vermeidung.

### 4.5 Wellenzustände als Zielbild

Jeder Zustand definiert ein Ziel für den Wellen-Schwerpunkt und erlaubte Filler-Ziele, kein Verbot:

| Zustand | Ziel | Filler erlaubt | Wann |
|---|---|---|---|
| Push | Schwerpunkt Richtung gegnerischer Turm | Champion, jeder Minion, Struktur | Standard, wenn Gegner abwesend/zurück, vor Recall/Roam/Objective, bei Minion-Vorteil |
| Neutral | Schwerpunkt in Lane-Mitte | Champion, Minions nur wenn eigene Welle kleiner oder gleich | Standard bei Gleichstand |
| Slow-Push | Nur Nahkämpfer-Minions, Caster leben lassen | Champion, gegnerische Nahkämpfer | 60–90 s vor Recall/Objective (ab Gold) |
| Freeze | Schwerpunkt 300–600 vor eigenem Turm, 2–3 gegnerische Minions Überschuss halten | Champion, gegnerische Minions, die eigene angreifen (nur so viele, dass der Überschuss bleibt) | Gegner hinten (Level/Gold), eigener Jungler nicht nah, kein Objective in 90 s; ab Silber; Dauer begrenzt bis Gegner die Welle bricht |
| Hold | Wie Neutral, aber Stehpunkt +200 Richtung Turm | Champion nur ohne Vorrücken, Minions normal | GankRisk 0,4–0,7 |

Streiche die Regel „Gank-Risiko ≥ 0,4 → Freeze“. Hold reicht. Freeze nur mit den genannten Bedingungen; Tempo-Achse ≤ −2 erhöht die Freeze-Neigung, erzwingt sie nicht. Zustandswechsel höchstens alle 10 s (Hysterese), geloggt mit Grund.

### 4.6 Abwesenheit minimieren

- Shove-and-Recall ist der einzige Recall-Weg ab Silber: Recall-Intent (5) wird nur ausgeführt, wenn die Welle gecrasht ist oder in den nächsten 20 s crasht; vorher wechselt der Wellenzustand auf Push. Iron/Bronze recallen weiter willkürlich (late_recall, recall_on_bad_wave).
- Heilwege: retreat führt nicht mehr automatisch heim. Nach dem Rückzug entscheidet das Nutzenmodell: Welle unter Turm farmen mit 40 % HP ist oft besser als 50 s Weg. Heimweg nur, wenn deathProb beim Verbleib > 0,3 oder Gold für ein Item da ist.
- Roams und Objectives zahlen den Wellenwert als Kosten (5). Ein Roam, der eine 7-Minion-Welle unter dem eigenen Turm sterben lässt, kostet ~130 Gold plus XP; das muss der Score sehen.
- Jungler deckt Lanes (ab Gold): Wenn ein Laner tot oder im Recall ist und eine Welle auf den eigenen Turm läuft, bekommt der Jungler-Intent „Lane fangen“ den Wellenwert als Nutzen.
- Messe pro Partie den CS-Verlust nach Ursache (10). Ziel: Abwesenheitsverlust Gold ≤ 12 % der Lane-Minions bis 15:00 (heute ~30 %).

### 4.7 Rang-Degradation im Laning (nur über diese Stellschrauben, nicht über Logik-Abzweige)

| Stellschraube | Iron | Gold | Diamant | Challenger |
|---|---|---|---|---|
| Last-Hit-Streuung σ (ms) | 220 | 110 | 60 | 35 |
| Planungshorizont (s) | 1,0 | 2,0 | 3,0 | 3,0 |
| Fenster-Vorbereitung (zwei Minions auseinanderschlagen) | nein | 30 % | 80 % | 100 % |
| Stehpunkt-Hysterese (Einheiten) | 220 | 150 | 100 | 90 |
| Orbwalk-Wahrscheinlichkeit (Kiting 0) | 20 % | 55 % | 85 % | 97 % |
| Harass-Rate (Autos/min) | 2 | 6 | 10 | 12 |
| Harass im CS-Fenster des Gegners | nein | nein | 50 % | 90 % |
| Aufmerksamkeitsfenster (9) | 35 % der Zeit | 20 % | 9 % | 3 % |
| Wellenzustand bewusst | nein (Push) | 30 % | 80 % | 98 % |
| Shove-and-Recall | 5 % | 50 % | 85 % | 98 % |

Abnahme für diesen Abschnitt: Last-Hit-Trainer-Szenario (Lane allein, 10 min, nur Autos) ergibt Iron 70–78 CS, Gold 88–94, Challenger 100–106 (von 107 möglichen); Lane-Duell gegen gleichen Rang ergibt bei 10:00 Iron 45–55, Gold 70–80, Challenger 90–98 CS.

## 5. Nutzenmodell

Alle nicht-reflexiven Entscheidungen laufen über eine gemeinsame Währung: erwartetes Gold pro Sekunde für das Team, inklusive Gold-Äquivalenten für XP (1 XP ≈ 0,4 Gold), Kills (300 + Bounty), Platten (120), Türme (250 + 150), Objectives (Leviathan 25 Gold + Buff-Wert ≈ 400 je nach Stack, Schleierwächter 300 × 5 + Buff ≈ 2.500), Wards (Siegelward-Wert 75 + Vision-Wert 40–120 je Spot und Phase) und Risiko (eigener Tod = 300 Gold Gegner + verlorene Farmzeit × eigene Gold/s + Objective-Risiko).

Kandidaten (pro Takt bewertet; nur die, deren Vorbedingungen gelten):

| Intent | Nutzen | Kosten | Vorbedingung |
|---|---|---|---|
| Farm (Lane/Jungle) | Wellenwert in den nächsten T s (Minions, die in Reichweite sterben würden) / T, plus XP | Risiko aus GankRisk × Todeskosten | immer |
| Harass-Poke (Fähigkeit) | erwarteter Schaden × Kill-Vorlauf-Wert (Schaden, der später einen Kill ermöglicht: 0,15 Gold je HP bei vollem Gegner, steigend bei niedrigem Gegner) + Gegner-Recall erzwingen (Wellenwert, den der Gegner verliert) | Mana (Mana-Gold-Wert aus verbleibender Lane-Zeit), Cooldown, Aggro | Gegner in Reichweite, Fähigkeit bereit |
| Trade / All-in | killProb × Killwert + erwarteter Schadensvorteil × 0,15 | deathProb × Todeskosten + verpasste Minions während des Trades | Trade-Fenster (spec-bots §6) |
| Push / Platten | Platten-Gold je Angriffsminute + Strukturschaden; vor 14:00 hoch | Gank-Risiko steigt mit Vorrücken; Welle geht verloren, wenn der Gegner zurückkommt | Gegner abwesend oder zurückgedrängt |
| Roam | Gank-Score × Killwert + Objective-Vorbereitung | eigener Wellenwert während der Abwesenheit + Platten-Risiko am eigenen Turm + Weg | spec-bots §5.1 |
| Recall | Item-Wert (Statgewinn in Gold/s über die nächsten 5 min) + HP/Mana-Wiederherstellung | Welle, die während 25–35 s Abwesenheit stirbt; Platten | spec-bots §8, nur nach Crash ab Silber |
| Objective | Objective-Wert × Sicherheits-Score | Wellenwert aller Beteiligten + Risiko eines verlorenen Fights | Team-KI-Desire > 0 |
| Ward / Sweep | Vision-Wert des Spots in der aktuellen Phase (Objective-Spots 60 s vor Spawn hoch) | Weg + Zeit | Ladung vorhanden |
| Gruppieren / Belagern / Beenden | Team-KI-Desire × Strukturwert | eigener Wellenwert | ab 14:00 oder bei Vorteil |
| Lane fangen (Jungler) | Wellenwert der verlassenen Lane | Camp-Wert, der währenddessen verfällt | Laner abwesend |

Auswahl: score = nutzen − kosten; der laufende Intent bekommt + hysteresis × |score| (Rangprofil, Gold 0,25, Challenger 0,10); Rang-Rauschen N(0, σ_rank) auf jeden Score (Iron σ = 40 % des Scores, Gold 20 %, Challenger 7 %); Spielstil-Achsen skalieren einzelne Kandidaten (Farm-Achse × Farm-Nutzen, Roam-Achse × Roam-Nutzen, Aggression × Trade-Nutzen usw., Faktoren 0,6–1,6). Der Gewinner wird Intent mit Zeithorizont (Farm 10 s, Trade bis Abbruch, Roam bis Ankunft + 12 s, Recall bis Brunnen). Alle Scores ins Log.

Wichtig: Farm ist fast immer ein Kandidat mit positivem Wert. Deshalb steht ein Bot nur dann herum, wenn alle Kandidaten negativ sind, und das darf im Log sichtbar und begründet sein (z. B. „Farm −0,8: GankRisk 0,9“). Jeder Idle-Tick ohne negative Begründung ist ein Bug.

Nicht über das Nutzenmodell: Survive, Dodge, Peel, laufende Casts, Shop im Brunnen. Diese bleiben Reflex bzw. Baum.

Daten: Alle Gold-Äquivalente in src/data/bots/values.json, alle Rauschwerte im Rangprofil, alle Stil-Faktoren in playstyleAxes.json. Kein Wert im Code.

## 6. Kampf

Ziel: 40–60 Kills pro Partie bei realistischer Verteilung (Laning-Phase 8–14 Kills bis 14:00, Rest in Skirmishes und Teamfights), ohne dass Bots sinnlos sterben. Mehr Kills entstehen aus mehr Harass (4.3), mehr Trades aus dem Nutzenmodell und aus Ganks, die ankommen.

### 6.1 Trade-Logik (trade.ts, exchange.ts bleiben, Schwellen kommen aus 5)

- Trade ist ein Intent mit winProb/killProb/deathProb aus ExchangeEstimate. Der Horizont ist 3 s für Trades, 6 s für All-ins (bereits so).
- Trade-Abbruch nach Trade-Längen-Achse (spec-bots §6). Nach dem Abbruch Disengage per Orbwalk zum Stehpunkt; während des Disengage läuft der Angriffs-Scheduler weiter (Autos auf Minions/Champion im Rückwärtsgang). Heute endet ein Trade in Stillstand.
- Harass-zu-Trade-Übergang: Wenn der Gegner auf Harass antwortet, wird daraus automatisch ein Trade (Intent-Wechsel ohne Hysterese-Strafe), weil ExchangeEstimate jetzt mit aktiven gegnerischen Autos rechnet.
- Kill-Fenster erkennen: killProb > 0,6 bei bekannten gegnerischen Cooldowns → All-in auch aus dem Farm-Intent heraus (das ist der Grund, warum Harass Kills erzeugt: Der Gegner fällt unter die Schwelle).

### 6.2 All-in und Dive

- All-in endet, wenn killProb < 0,3 fällt, das Ziel 5 s keinen Schaden nimmt oder 20 s vergehen (bereits so). Ergänze: Beim Abbruch sofort Intent-Neubewertung (meist Farm oder Recall), kein Idle.
- Dive-Regeln aus DECISIONS beibehalten (tödlicher Dive ab Silber bei Kill > 0,75). Ergänze Turm-Aggro-Management: Beim Dive wechselt der Bot mit dem Verbündeten die Turm-Aggro (wer gerade anvisiert wird, tritt aus 750 heraus, der andere schlägt), ab Platin. Gold dived und stirbt (flash_in_dive 40 % bleibt).
- Chase-Abbruch: Verfolgung endet, wenn der Gegner Turm-Reichweite + 200 erreicht und killProb < 0,5, oder wenn die Wolke unbekannter Gegner auf dem Weg > 0,4 ist. Iron chased trotzdem (chase_third_kill).

### 6.3 Skirmish und Teamfight

- Beitritt nach spec-bots §8 (Ankunft < Fight-Dauer, ExchangeEstimate > 0,45). Gold-Latenz 5 s bleibt, aber nur als Reaktionsverzögerung; wenn Gold einmal entschieden hat, läuft es.
- Commit-Regel gegen das Pendeln: Wer einen Teamfight betritt, verlässt ihn nur über survive (HP-Schwelle) oder wenn ExchangeEstimate 5v5 unter 0,25 fällt. Keine Intent-Neubewertung während eines laufenden Teamfights außer alle 2 s.
- Fokus: Fokus-Score aus spec-bots §7 mit Rang-Fehler (bereits so). Ergänze: Fokuswechsel kostet (Hysterese 0,2), damit Bots nicht zwischen zwei Zielen flackern.
- Ausführungsrate (55 % + 45 % × Skill/100) bleibt, aber ein ausgelassener Combo-Schritt wird durch einen Auto ersetzt, nie durch Stehen.
- Peel: Support und Tank peelen den Carry mit höchstem Schadensanteil; Peel-CC wird gehalten, bis ein Gegner den Carry in 400 Einheiten erreicht (ab Gold), Iron verschießt es sofort.

### 6.4 Kill-Kennzahlen nach Rang (Zielbild, bot-sim)

| Rang | Kills/Partie | Anteil Laning-Kills bis 14:00 | Deaths durch Türme/Minions ohne Gegnerbeteiligung | Durchschnittliche Trade-Dauer |
|---|---|---|---|---|
| Iron | 55 | 35 % | 8 % | 5 s |
| Gold | 50 | 30 % | 4 % | 4 s |
| Diamant | 44 | 25 % | 1 % | 3 s |
| Challenger | 40 | 22 % | < 1 % | 2,5 s |

Iron hat mehr Kills, weil beide Seiten mehr Fehler machen; das deckt sich mit den Lolalytics-Daten (Iron-Deaths 7,8 vs. Challenger 5,9 pro Spieler bei längeren Partien).

## 7. Makro

### 7.1 Erster Turm bei 12–16 min

Heute fällt der erste Turm bei 18 min, weil niemand Platten nimmt und Gruppieren erst ab 14:00 gewürfelt wird. Änderungen:

- Platten sind ein Intent (5) mit hohem Wert vor 14:00 (120 Gold je Platte, lokal). Nach jedem Crash mit abwesendem oder zurückgedrängtem Gegner schlägt der Laner den Turm, solange ≥ 2 eigene Minions tanken und GankRisk < 0,5. Ab Gold. Support macht dasselbe, wenn der ADC es tut.
- Jungler-Platten-Dive: Nach einem erfolgreichen Gank (Kill oder Flash) bleibt der Jungler für eine Platte, wenn die Welle am Turm steht (ab Gold; Challenger prüft dabei die Wolke des gegnerischen Junglers).
- Kesselbrut-Stacks (je +4 % Strukturschaden) werden im Strukturwert mitgerechnet, damit Teams mit Stacks früher auf Türme gehen.
- Belagern ab 11:00, wenn eine Lane gewonnen ist (gegnerischer Laner ≥ 2 Deaths oder ≥ 1.000 Gold hinten): Jungler + Support rotieren dahin, nicht erst ab 14:00.
- Zielbild: Platten pro Team bis 14:00 im Schnitt Gold 4, Diamant 6, Challenger 8 (heute nahe 0).

### 7.2 Recall

Recall nach spec-bots §8 als Intent im Nutzenmodell; die Gold-Schwelle (nächster Komponenten-Kauf möglich) ist der stärkste Faktor, Shove vorher ist Pflicht ab Silber (4.6). Recall-Dauer ins Kostenmodell: Weg zurück je Lane aus den Kartendaten (23–30 s), nicht geschätzt.

### 7.3 Roams

Roams nach spec-bots §5; neu ist nur, dass der Wellenwert als Kosten gegengerückt wird und dass Roams nach dem Crash starten. Roam-Rate Zielbild (Mid, pro 10 min): Gold 0,8, Diamant 1,5, Challenger 2,0; Support: Gold 0,5, Diamant 1,5, Challenger 2,5. Heute: 0,02/min, also praktisch keine; das ist eine Folge der Vorbedingung „Welle gecrasht“, die nie erfüllt war, weil nie gepusht wurde.

### 7.4 Objectives

- Leviathan: Vorbereitung 60 s vorher ab Platin (Ward am Pit, Bot-Lane pusht, Jungler steht auf der Pit-Seite). Gold startet ohne Prio (bewusst), Iron ignoriert Objectives zu 60 %.
- Kesselbrut wird als Objective behandelt (heute nicht, „ponytail“ in DECISIONS): Jungler + Top ab 6:00, Wert aus Stacks. Ab Gold.
- Schleierwächter: Team-Start nur mit 4 am Pit (bereits so), plus Vision-Prüfung ab Diamant; Smaragd-Throw-Mechanik (Baron-Force bei Vorsprung ohne Sicht, 45 %) aus Tabelle B aktivieren.
- Objective-Konversion nach Fight (Iron 15 % bis Challenger 95 %) muss im Log als eigene Entscheidung erscheinen (convert: tower | dragon | baron | none(reason)).

### 7.5 Gruppieren und Beenden

Bleiben wie in DECISIONS („Vorteil ausspielen“), mit einer Änderung: Side-Laner mit sideLaneFarmAfter15Pct farmen weiter, bis die Gruppe tatsächlich einen Turm angreift (Ping „Gruppieren“), nicht präventiv. Challenger beenden ab 20:00 jedes Spiel mit +5.000 Gold innerhalb von 6 Minuten (Zielbild).

### 7.6 Team-KI-Takt

Neubewertung alle 60 s (Iron) bis 10 s (Challenger) laut Tabelle B; heute fester Takt. Desires fließen als Gewichte ins Nutzenmodell, nicht als Befehle.

## 8. Rang-Differenzierung

Befund: Gold vs. Silber 4/8, Diamant vs. Gold 4/8. Die Champion-Zusammenstellung gewinnt beide Seiten eines gespiegelten Paares. Ursache: Der Rang wirkt heute fast nur im Kampf (Trefferquote, Zielwahl, Reaktionszeit). Kampf ist aber Champion-abhängig und hochvariabel. Was in echten Partien den Rang ausmacht, sind kleine Vorteile, die sich aufaddieren: 1 CS/min mehr sind 20 Gold/min, über 25 Minuten ein ganzes Item; 2 Platten sind 240 Gold; ein Recall zum richtigen Zeitpunkt spart eine Welle; eine Objective-Konversion mehr pro Spiel sind 400–2.500 Gold für das Team.

Pflicht: Nach dem Rework muss jede der folgenden Größen monoton mit dem Rang steigen und zwischen Gold und Diamant mindestens die genannte Lücke haben (bot-sim, gleiche Aufstellung beide Seiten):

| Größe | Mindestlücke Gold → Diamant | Woher sie kommt |
|---|---|---|
| Laner-CS/min | +0,9 | Streuung, Planungshorizont, Fenster-Vorbereitung, Harass statt Stehen, Shove-and-Recall |
| Gold/min Team | +12 % | CS + Platten + Objective-Konversion |
| Platten bis 14:00 | +2 | Push-Intent nach Crash |
| Objective-Konversion nach gewonnenem Fight | +30 Prozentpunkte | Tabelle B |
| Deaths ohne Gegnerbeteiligung (Turm/Minions) | −3 Prozentpunkte | Dive-Logik, Chase-Abbruch |
| Vermeidbare Gank-Tode (Jungler war auf der Minimap sichtbar) | −50 % | Minimap-Intervall, GankRisk |
| Recalls mit Welle unter eigenem Turm | −60 % | Shove-and-Recall |
| Zeit bis erster Turm | −2 min | Platten + Belagern ab 11:00 |
| Idle-Anteil | −6 Prozentpunkte | Nutzenmodell, Reflex-Schicht |

Profil-Tuning-Verfahren (nach der Architektur, nicht vorher):

1. Fixiere die Aufstellung (zwei Standard-Aufstellungen je Seite, z. B. Brom/Vessa/Ilvane/Mira/Ferris gegen Dagny/Grimald/Thessaly/Lysa/Oda) und spiele jeden Rang gegen sich selbst, 8 Partien. Prüfe Tabelle A ±10 %.
2. Dann Rang gegen Rang mit --mirror, 8 Paare je Kombination. Prüfe die Siegquoten aus Abschnitt 1.
3. Stimmt die Siegquote nicht, drehe nur an den Profilparametern aus Tabelle B und 4.7, nie an Logik-Abzweigen. Dokumentiere jede Drehung mit Vorher/Nachher.
4. Erst danach gemischte Aufstellungen. Wenn eine Aufstellung beide Seiten gewinnt, ist das ein Champion-Balance-Problem (tools/balance.ts), kein Bot-Problem; melde es, löse es nicht im Gehirn.

Varianz: Der Varianz-Offset pro Partie (Tabelle B, Iron ±1,5 Stufen bis Challenger ±0,3) bleibt. Prüfe, dass er im Log steht und dass bot-sim ihn mit --variance=0 abschalten kann, sonst sind die Siegquoten nicht reproduzierbar.

Heutige Fehlgewichtung beheben: Diamant farmt weniger als Gold, weil Trade-Auslöser („CS-Fenster“) ohne Gegenrechnung feuern. Mit dem Nutzenmodell kostet jeder Trade den verpassten Farm; ein Diamant-Bot tradet dann nur, wenn der Trade mehr wert ist als die Welle, und harasst sonst im Filler. Teste explizit: Diamant-Laner-CS ≥ Gold-Laner-CS in jeder Rolle, sonst ist das Nutzenmodell falsch gewichtet.

## 9. Fehlerinjektion und Menschlichkeit

Das heutige Modell (errors.ts: feste Rate pro Rang, Aussetzer einmal pro Minion gewürfelt) erzeugt unmenschliche Muster: ein Minion wird für immer ignoriert, der nächste perfekt getroffen. Menschen haben Aufmerksamkeitsfenster: Phasen, in denen sie auf die Minimap schauen, den Shop öffnen, tilten oder einfach spät sind; dann sind sie für 0,5–3 s schlechter in allem.

Neues Modell (src/ai/humanize/attention.ts):

- Jeder Bot hat einen Aufmerksamkeitszustand focused | distracted(reason, until). Ablenkungen starten mit einer Rate aus dem Rangprofil (Iron alle ~8 s, Gold ~20 s, Diamant ~45 s, Challenger ~120 s) und dauern 0,5–3 s (log-normal). Auslöser mit eigener Rate: Minimap-Blick (geplant, dauert 0,3–0,8 s), Shop-Blick nach Gold-Schwelle, Kill-Feed, Chat (Toxizität), Tilt (verlängert alle Fenster um Tilt × 30 %).
- Während distracted: Last-Hit-Pläne werden nicht ausgeführt (verpasster Minion), Harass-Filler pausiert, Reaktionszeit +150 ms, Dodge-Vorhersage aus. Der Angriffs-Scheduler läuft weiter mit dem letzten Ziel (ein Mensch hört nicht auf zu klicken, er klickt falsch).
- Daraus ergibt sich die Fehlerrate aus Tabelle B (Iron 35 %, Challenger 3 %) als Anteil abgelenkter Zeit, nicht als Würfel pro Aktion. Kalibriere Rate × Dauer so, dass der Anteil stimmt, und prüfe es im Harness.
- Benannte Fehlerarten (chase_third_kill, overcommit_after_kill, flash_in_dive, trade_on_cooldown, roam_from_push, late_recall, idle_after_shove, carry_too_far, ignore_minion_aggro, fight_in_enemy_wave, flash_into_wall, no_flash_tracking) bleiben als Entscheidungsfehler mit Rate pro Rang, aber jede hat jetzt eine Dauer (wie lange der Bot beim Fehler bleibt) und eine Erkennung (nach der Dauer merkt er es und korrigiert, ab Silber mit Ping „Mein Fehler“ zu 20 %). idle_after_shove wird durch das Nutzenmodell seltener, bleibt aber als Gold-Fehler mit 8 s Dauer.
- Ausführungsfehler bleiben kontinuierlich: Timing-Streuung, Zielfehler bei Skillshots, Orbwalk-Jitter. Keine Binärentscheidung „schafft er oder nicht“.
- Alles im Log: attention: distracted(minimap) 0,6 s, injectedError: chase_third_kill (dur 4 s). Die Post-Game-Analyse soll aus dem Spieler-Replay dieselben Muster erkennen können.

Tilt (bleibt): +1 pro Tod, −1 pro Kill oder 120 s, max 3. Wirkung jetzt über Ablenkungsfenster und Aggression-Verschiebung (+1 Achse pro Tilt-Stufe), nicht über direkte Parameterverschlechterung.

## 10. Messung und Abnahme

Neue bot-sim-Kennzahlen (tools/botSim.ts, CSV pro Bot und pro Partie):

- csLossByCause: Minions in der eigenen Lane, die gestorben sind, ohne dass der Bot den Last-Hit hatte, aufgeschlüsselt nach absent_recall | absent_heal | absent_roam | absent_dead | in_range_no_attack | timing_miss | window_collision | tower_took | enemy_took | distracted. Das ist die wichtigste Kennzahl des Reworks.
- attackUtilization: Anteil der Ticks 2:00–14:00 mit laufendem Angriff/Wind-up, während Minions oder Gegner in Reichweite + 200 sind.
- idleShare: Anteil der Ticks ohne Befehl > 45 Ticks, während Ziele in Reichweite sind; mit Log-Grund.
- harassAutos, harassSpells, tradesStarted, tradeDurationAvg, killsFromHarassWindow (Kill innerhalb 10 s nach ≥ 3 Harass-Treffern).
- platesByTeam, firstTowerMin, objectiveConversionRate (gewonnene Fights → Objective in 30 s), avoidableGankDeaths (Jungler war ≥ 5 s vor dem Gank im Team-Sichtzustand), recallsWithWaveAtOwnTower, roamsPer10, wardsPerMin.
- intentHistogram: Zeitanteil pro Intent, intentSwitchesPerMin.
- reflexCostMs, thinkCostMs: Rechenzeit, Ziel Reflex < 0,05 ms/Bot/Tick, Think < 2 ms/Bot/Takt im Mittel.

npm run bot-sim -- --rank=gold --games=8 --minutes=25 --report schreibt eine Markdown-Zusammenfassung mit allen Kennzahlen gegen die Zielwerte aus Abschnitt 1, 4.7, 6.4, 7.1 und 8; rot, wenn außerhalb ±10 %.

Testfälle (Vitest, deterministisch; die aus spec-bots.md §10 bleiben, diese kommen dazu):

1. Scheduler füllt: Lane allein, Gold, 60 s ab 1:40 → Angriffsauslastung > 60 %, kein move/stop während eines Wind-ups im Log.
2. Last-Hit trotz Takt: Iron (2 Hz) auf einer Welle ohne Gegner, 10 min → ≥ 70 CS. Vorher: ~56.
3. Fenster-Kollision: Zwei Caster sterben in ≤ 0,3 s Abstand → Diamant bekommt beide in ≥ 80 % der Seeds (Vorbereitung), Gold einen.
4. Stehpunkt folgt: Welle wandert 600 Einheiten in 20 s → Bot ist zu jedem Last-Hit-Fenster in Reichweite (kein lh_cancel: out_of_range).
5. Harass ohne CS-Verlust: Gold, Gegner-Dummy in Reichweite, 3 min → ≥ 12 Harass-Autos, CS-Verlust durch in_range_no_attack = 0.
6. Freeze ist kein Stillstand: Freeze-Zustand gesetzt, 60 s → Welle bleibt im Zielkorridor (Überschuss 2–3), Bot hat ≥ 1 Auto pro 2 s.
7. Kein Idle ohne Grund: 1.000 zufällige Spielstände → jeder Idle-Tick > 45 Ticks hat einen Log-Eintrag mit allen Kandidaten-Scores ≤ 0.
8. Shove-and-Recall: Diamant mit 1.300 Gold, Welle in Lane-Mitte → Recall erst nach Crash, Abwesenheitsverlust ≤ 2 Minions.
9. Diamant ≥ Gold im Farm: 8 gespiegelte Partien → Diamant-Laner-CS/min ≥ Gold in jeder Rolle.
10. Ablenkung: Iron-Bot, 5 min → abgelenkter Zeitanteil 30–40 %, keine Ablenkung länger als 3 s, kein Minion dauerhaft ignoriert (jeder Minion, der ≥ 2 Fenster hatte, wurde mindestens einmal angegriffen).
11. Reflex-Kosten: 10 Bots, 10 min headless → Reflex-Schicht < 0,05 ms/Bot/Tick im Mittel.
12. Determinismus: Gleiche Seeds → bit-identische Replays nach dem Rework (bestehender Test muss grün bleiben).

Abnahme des Gesamt-Reworks: Alle Zielwerte aus Abschnitt 1 innerhalb ±10 %, alle Mindestlücken aus Abschnitt 8 erreicht, alle Testfälle grün, F9-Overlay zeigt Intent/Kandidaten/Pläne, docs/BRAIN-IST.md auf den neuen Stand gebracht (Ablauf, Module, Kennzahlen, bekannte Schwächen).

## 11. Arbeitsreihenfolge

Sechs Phasen, jede mit Gate. Kein Sprung in die nächste Phase, bevor das Gate grün ist und docs/DECISIONS.md den Vorher/Nachher-Vergleich hat. Nach jeder Phase ein Commit mit aussagekräftiger Nachricht und ein kurzer Bericht: was getan, Kennzahlen, was offen, Abweichungen vom Prompt.

- **Phase 0: Messbasis** (halber Tag). Neue Kennzahlen aus Abschnitt 10 in botSim.ts einbauen, --report erzeugen, Stand vor dem Rework für Iron/Gold/Diamant/Challenger festhalten (8 Partien je Rang). Gate: Report existiert, csLossByCause summiert sich auf die tatsächlichen Verluste.
- **Phase 1: Reflex-Schicht und Angriffs-Scheduler** (Abschnitte 3, 4.1, 4.2, 4.4). reflex() in runner.ts, Plan-Objekte, Scheduler, Last-Hit-Planer jeden Tick, Stehpunkt jeden Tick, Orbwalk im Backswing, Verbot von move/stop im Wind-up. Noch ohne Nutzenmodell: Der bestehende Baum bleibt, aber laneLeaf nutzt den Scheduler. Gate: Testfälle 1–4, 11, 12; Lane-allein-CS Iron ≥ 70, Gold ≥ 88, Challenger ≥ 100; Angriffsauslastung Gold > 50 %.
- **Phase 2: Wellenzustände und Harass** (4.3, 4.5). Zustände als Zielbild, Freeze-Bedingungen, Harass-Filler mit Budget, Aggro-Prüfung. Gate: Testfälle 5, 6; bot-sim Gold: Harass-Autos ≥ 40 pro Laner bis 14:00, Kills/Partie ≥ 42, CS/min bei 15:00 ≥ 5,0.
- **Phase 3: Nutzenmodell** (5, 4.6, 7). src/ai/utility/**, values.json, Intent-Subtrees statt Selector-Reihenfolge, Shove-and-Recall, Heilweg-Entscheidung, Platten-Intent, Roam/Recall mit Wellenkosten, Lane fangen, Kesselbrut als Objective. Gate: Testfälle 7, 8; bot-sim Gold: CS/min bei 15:00 ≥ 6,0, Abwesenheitsverlust ≤ 15 %, erster Turm ≤ 15 min, Idle ≤ 12 %.
- **Phase 4: Kampf** (6). Harass-zu-Trade, Kill-Fenster aus dem Farm-Intent, Commit-Regel, Fokus-Hysterese, Dive-Aggro-Wechsel, Chase-Abbruch. Gate: Kills/Partie Gold 45–55, Deaths ohne Gegnerbeteiligung ≤ 5 %, Trade-Dauer-Test aus spec-bots §10 grün.
- **Phase 5: Menschlichkeit** (9). Aufmerksamkeitsmodell, Fehlerarten mit Dauer, Tilt über Ablenkung. Gate: Testfall 10; Fehleranteile pro Rang innerhalb ±5 Punkte der Tabelle B.
- **Phase 6: Rang-Tuning** (8). Profil-Tuning nach dem Verfahren in Abschnitt 8, erst Rang gegen sich selbst, dann gespiegelt. Gate: Alle Siegquoten aus Abschnitt 1, alle Mindestlücken aus Abschnitt 8, Testfall 9, Tabelle A ±10 % für alle zehn Ränge.

Regeln für die Arbeit:

- Lies den Code, bevor du ihn ersetzt. Vieles (Last-Hit-Vorhersage, Exchange-Modell, Wolken, Gank-Risiko) ist gut und bleibt; was wegkommt, steht in Abschnitt 1.
- Kein Verhalten ohne Log-Eintrag, kein Parameter im Code, kein Sichtcheat, kein Bonus.
- Wenn eine Vorgabe hier mit der Sim kollidiert (z. B. der Snapshot liefert den gegnerischen Wind-up nicht), erweitere den Snapshot um öffentlich sichtbare Information (ein Spieler sieht den Wind-up auch) und dokumentiere es. Nicht sichtbare Information bleibt tabu.
- Performance messen, nicht schätzen. Die Reflex-Schicht läuft 300× pro Sekunde für 10 Bots.
- docs/BRAIN-IST.md am Ende vollständig neu schreiben, nicht patchen.
- Wenn du nach Phase 3 feststellst, dass der Behavior Tree für die Intent-Subtrees nur noch Ballast ist, darfst du ihn durch direkte Intent-Funktionen ersetzen; begründe es in DECISIONS. Die JSON-Konfigurierbarkeit der Reflexe (survive, dodge) bleibt.

## 12. Agenten-Aufteilung

Das Rework wird von höchstens drei Arbeits-Agenten mit Claude Opus 5.5 und einem Aufsichts-Agenten mit Claude Fable 5.1 umgesetzt. Mehr Agenten gleichzeitig sind verboten; wenn ein Agent durch das Limit stoppt, übernimmt der Aufsichts-Agent den Stand in docs/agents/<name>-handoff.md und startet denselben Agenten neu mit dieser Datei als Einstieg.

Arbeits-Agenten (Opus 5.5):

| Agent | Aufgabe | Phasen | Dateigebiet (exklusiv) | Branch |
|---|---|---|---|---|
| A1 „Reflex & Laning“ | Messbasis, Reflex-Schicht, Plan-Objekte, Angriffs-Scheduler, Last-Hit-Planer jeden Tick, Stehpunkt, Orbwalk, Wellenzustände, Harass-Filler | 0, 1, 2 | src/ai/runner.ts, src/ai/reflex/**, src/ai/plan.ts, src/ai/bot/laning.ts, src/ai/bot/lasthit.ts, src/ai/bot/kite.ts, tools/botSim.ts, src/ai/harness.ts | brain/a1-reflex |
| A2 „Nutzen & Makro & Kampf“ | Nutzenmodell, values.json, Intent-Subtrees, Shove-and-Recall, Heilweg-Entscheidung, Platten-Intent, Roam/Recall mit Wellenkosten, Lane fangen, Kesselbrut, Trade/All-in/Teamfight-Änderungen | 3, 4 | src/ai/utility/**, src/data/bots/values.json, src/ai/bot/macro.ts, src/ai/bot/trade.ts, src/ai/exchange.ts, src/ai/bot/teamfight.ts, src/ai/bot/teamai.ts, src/ai/roams/**, src/ai/ganks/**, src/ai/bot/combat.ts | brain/a2-utility |
| A3 „Menschlichkeit & Rang“ | Aufmerksamkeitsmodell, Fehlerarten mit Dauer, Tilt, Profil-Tuning, F9-Overlay-Erweiterung (Intent, Kandidaten, Pläne, Auslastung), Neufassung von docs/BRAIN-IST.md | 5, 6 | src/ai/humanize/**, src/ai/errors.ts, src/ai/params.ts, src/data/bots/profiles/*.json, src/data/bots/errors.json, src/data/bots/playstyleAxes.json, src/data/bots/archetypes.json, src/ai/log.ts, src/ui/botDebug.ts, docs/BRAIN-IST.md | brain/a3-humanize |

Reihenfolge und Parallelität:

- A1 startet sofort mit Phase 0 (Messbasis) und Phase 1. Solange die Plan-API (src/ai/plan.ts) nicht auf main ist, bauen A2 und A3 nur gegen eine von A1 am ersten Tag veröffentlichte Schnittstellenbeschreibung (docs/agents/plan-api.md: Typen, Queue-Verhalten, Cancel-Tags).
- A2 beginnt parallel mit values.json, dem Nutzen-Gerüst hinter einem Feature-Flag (BOT_UTILITY=1) und den Intent-Subtrees, ohne den bestehenden Selector zu entfernen. Umschalten auf das Nutzenmodell erst, wenn A1s Phase 2 auf main ist.
- A3 beginnt parallel mit dem Aufmerksamkeitsmodell und den Overlay-Erweiterungen; Profil-Tuning (Phase 6) erst, wenn Phase 4 auf main ist, vorher wäre jedes Tuning wertlos.
- Jeder Agent arbeitet nur in seinem Dateigebiet. Änderungen an gemeinsamen Dateien (src/ai/bot/types.ts, src/ai/bot/brain.ts, src/data/bots/tree.json, src/ai/bt/**, Snapshot-Typen in src/sim/**) werden als Vorschlag in docs/agents/shared-changes.md eingetragen und vom Aufsichts-Agenten freigegeben und gemergt; kein Agent ändert sie direkt.
- Merge nach main nur durch den Aufsichts-Agenten, nur nach bestandenem Gate der Phase.

Aufsichts-Agent (Fable 5.1). Er baut keine Features. Seine Aufgaben:

1. Review jedes Merges gegen diesen Prompt: Hat der Agent die Ursache behoben oder ein Symptom umgangen? Steht jeder neue Wert in einer JSON-Datei? Hat jede Entscheidung einen Log-Eintrag? Gibt es Sichtcheats (Testfall 7 aus spec-bots.md und der Allwissenheits-Test laufen bei jedem Merge)?
2. Gates selbst messen, nicht glauben: npm test und npm run bot-sim -- --report auf dem Merge-Kandidaten ausführen, Zahlen mit den Zielwerten aus Abschnitt 1, 4.7, 6.4, 7.1, 8 vergleichen, Ergebnis in docs/DECISIONS.md eintragen (Vorher/Nachher, Seeds, Commit).
3. Konflikte entscheiden: Streit um gemeinsame Dateien, Widersprüche zwischen Prompt und Code, Abweichungswünsche der Agenten. Entscheidung mit Begründung in docs/DECISIONS.md.
4. Replays stichprobenartig anschauen (mindestens 3 pro Gate, F9-Overlay an): Steht ein Bot ohne begründeten Log-Eintrag? Wirkt ein Verhalten robotisch? Befund an den Agenten zurück, als Issue in docs/agents/review-<datum>.md.
5. Masterplan und Ist-Zustand pflegen: docs/ROADMAP.md nach jedem Gate aktualisieren, docs/BRAIN-IST.md nach Phase 6 abnehmen.
6. Handoffs: Bei Agenten-Stopp den Stand sichern, Handoff-Datei schreiben, Neustart.
7. Kleine Fixes (< 30 Zeilen, gemeinsame Dateien, Build-Brüche) darf er selbst machen, mit Commit-Nachricht supervisor:.
8. Täglicher Statusbericht an den Nutzer in docs/agents/status.md: pro Agent Phase, Gate-Stand, Kennzahlen, Blocker, nächste 24 Stunden. Ehrlich: Was nicht erreicht ist, steht als nicht erreicht da.

Berichtsformat der Arbeits-Agenten (docs/agents/<name>.md, nach jedem Arbeitsabschnitt): Was getan (Dateien, Commits), Kennzahlen vorher/nachher mit Seeds, offene Punkte, Abweichungen vom Prompt mit Grund, Fragen an den Aufsichts-Agenten. Keine Prosa über Absichten; nur Stand.

Definition of Done pro Phase: Gate grün (vom Aufsichts-Agenten gemessen), Tests grün, Determinismus-Test grün, DECISIONS-Eintrag, Bericht, Merge auf main, Live-Build auf GitHub Pages aktualisiert.

## 13. Anhang: Sim- und UI-Punkte außerhalb des Gehirns

Diese Punkte gehören nicht zum Gehirn-Rework, blockieren es aber teilweise oder wurden vom Nutzer gemeldet. Sie sind für den Lead bzw. einen separaten Agenten; der Gehirn-Agent meldet nur, wenn er auf sie stößt.

Blockiert das Gehirn direkt:

- Wards sind für alle sichtbar (Bug). Schleierwards müssen für das gegnerische Team unsichtbar sein, außer in Reichweite eines Siegelwards, eines Suchfeuers oder einer Enthüllung. Solange das falsch ist, sind Vision-Score, Ward-Räumen, Pfadwahl „hinter den Wards“ und das Gank-Risiko-Modell der Bots wertlos, weil Bots gegnerische Wards im Snapshot sehen. Prüfe vision/** und den Fog-Filter für Kind.Ward; Test: Ward des Gegners außerhalb von Sweeper-Reichweite ist nicht im Team-Snapshot.
- Snapshot-Ergänzungen für das Gehirn, alle öffentlich sichtbar: gegnerischer Wind-up-Zustand (atkPhase, bereits im Render), Minion-Zielwahl (wen greift der Minion an), Turm-Zielwahl, Plattenanzahl.

Vom Nutzer gemeldet, Gehirn-unabhängig:

- Scoreboard: Drachen-/Seele-/Objective-Übersicht oben, Beschwörerzauber-Cooldowns der Gegner mit Klick-Timer, tote Spieler mit Respawn-Timer über der Minimap (eigenes und gegnerisches Team).
- Toplane: nach 1.500 Gold aus Minions wird Teleport als dritter Beschwörerzauber freigeschaltet (Slot, HUD, Bot-Nutzung: Top-Bots nutzen ihn für Lane-Rückkehr nach Recall und für Bot-Lane-Fights ab Gold).
- Fehlende LoL-Funktionen und Menüs (Audit-Auftrag). Der Nutzer meldet, dass viele Funktionen und Menüs fehlen. Erstelle docs/FEATURE-GAP.md als Checkliste gegen LoL, mit Status (fehlt / teilweise / da) und Aufwand, mindestens: Champion-Auswahl mit Bann-Phase und Rollen-Tausch; Prägungen-Editor mit eigenen Seiten; Item-Sets/Empfehlungen im Shop; Tab-Scoreboard vollständig (siehe oben); Chat-Befehle (/mute, /surrender, /ff, Allchat); Ping-Rad komplett (Gefahr, Achtung, Auf dem Weg, Zurück, Vermisst, Vision erbeten, Objective-Ping mit Timer, Gegenstands-Ping); Minimap-Pings auf Türme/Objectives; Kamera-Sperre-Umschalter, Kamera-Geschwindigkeit, Minimap-Skalierung; Keybind-Editor mit Quick-Cast pro Taste; Zielrahmen über HUD (Zielportrait mit HP, Buffs, Items); Buff-/Debuff-Leiste am eigenen Champion mit Tooltips; Schadensaufteilung beim Tod (da) und Todeszusammenfassung; Spielstatistik-Graphen im Post-Game (Gold, XP, Schaden, Vision); Replay-Browser mit Zeitleiste; Einstellungen für HUD-Skalierung, Schadenszahlen, Gesundheitsleisten-Stil; Ladebildschirm-Tipps; Profil mit Verlauf; Lobby-Bot-Konfiguration für alle zehn Slots mit Archetyp-Preset und Achsen-Editor (teilweise da). Jeder fehlende Punkt bekommt eine Zeile im Masterplan unter „Offen“, priorisiert nach Nutzen für das Training.

Verwandt, bereits im Masterplan: Dashes/Knock-ups ohne Flugbogen, Render liest atkStart/atkEnd nicht, Blickrichtung springt, Fähigkeiten-Effekte individueller, Auto-Reset-Zeit.
