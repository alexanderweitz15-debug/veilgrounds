# Benchmark-Bericht

Stand: `ee6f8a7`. 

## Läufe

| Gehirn | Menge | Paar (Rang X vs Referenz) | Partien | Ø Dauer (min) |
|---|---|---|---|---|
| new | L | challenger:gold | 2 | 15.0 |
| new | L | diamond:gold | 3 | 15.0 |
| new | L | gold:gold | 3 | 15.0 |
| new | L | iron:gold | 3 | 15.0 |
| old | L | challenger:gold | 3 | 15.0 |
| old | L | diamond:gold | 4 | 15.0 |
| old | L | gold:gold | 4 | 15.0 |
| old | L | iron:gold | 4 | 15.0 |

Menge L = kurze Partien (Lane-Metriken), Menge F = Partien bis zum Nexus oder Zeitlimit (Spiellänge, Objectives, Siegquote). Werte: gepoolter Wert ± Standardfehler (Bootstrap über Partien, 1000 Ziehungen, fester Seed). Eine Partie ist eine Einheit; die zehn Champions einer Partie sind nicht unabhängig.

## Altes Gehirn (Standard): Kernmetriken je Rang

| Metrik | Erwartung | Iron | Gold | Diamond | Challenger | Monoton? |
|---|---|---|---|---|---|---|
| CS@10 [L] | steigt | 17.8 ±0.8 | 26.8 ±0.8 | 34.1 ±1.3 | 27.3 ±3.9 | **nein** (Diamond -> Challenger: im Rauschen) |
| Idle-Anteil Laner (Hirn-Spec) [L] | sinkt | 10.1 ±0.9 | 10.8 ±0.8 | 10.2 ±0.4 | 10.4 ±1.6 | **nein** (Iron -> Gold: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Idle-Anteil breit (A2: kein Auftrag) [L] | sinkt | 11.7 ±0.9 | 12.8 ±0.5 | 14.9 ±0.6 | 16.5 ±1.8 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: signifikant; Diamond -> Challenger: im Rauschen) |
| Angriffsauslastung Laner [L] | steigt | 30.0 ±1.0 | 28.5 ±1.2 | 29.0 ±1.4 | 25.3 ±1.9 | **nein** (Iron -> Gold: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Trade-Bilanz in der Lane [L] | steigt | 39.8 ±7.1 | 50.0 ±0.0 | 48.3 ±4.7 | 54.7 ±3.4 | **nein** (Gold -> Diamond: im Rauschen) |
| Tode ohne Sicht [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Tode nach Überfall aus dem Nebel [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Skillshot-Trefferquote (auf Champions gezielt) [L] | steigt | 30.4 ±7.0 | 51.7 ±7.5 | 60.2 ±8.9 | 75.4 ±2.0 | ja |
| Ausweichquote [L] | steigt | 18.5 ±4.9 | 17.4 ±3.9 | 24.0 ±6.0 | 7.7 ±4.1 | **nein** (Iron -> Gold: im Rauschen; Diamond -> Challenger: signifikant) |
| Reaktionszeit (Median) [L] | sinkt | 450 ±16 | 500 ±14 | 500 ±37 | 367 ±37 | **nein** (Iron -> Gold: signifikant; Gold -> Diamond: im Rauschen) |
| Recall abgeschlossen [L] | steigt | 75.5 ±1.6 | 78.3 ±1.1 | 69.0 ±2.2 | 72.3 ±6.6 | **nein** (Gold -> Diamond: signifikant) |
| Gold ausgegeben pro abgeschlossenem Recall [L] | steigt | 272 ±26 | 502 ±16 | 529 ±50 | 508 ±134 | **nein** (Diamond -> Challenger: im Rauschen) |
| Recall mit gecrashter Welle [L] | steigt | 4.8 ±1.7 | 11.0 ±0.9 | 10.5 ±2.8 | 14.8 ±2.6 | **nein** (Gold -> Diamond: im Rauschen) |
| Recall mit Gegnerwelle am eigenen Turm [L] | sinkt | 8.0 ±1.9 | 7.6 ±2.6 | 11.8 ±5.6 | 9.8 ±2.2 | **nein** (Gold -> Diamond: im Rauschen) |
| Partiedauer (entschieden) [F] | sinkt | - | - | - | - | ja |
| Erster Turm (min) [F] | sinkt | - | - | - | - | ja |
| Siegquote (Nexus) [F] | steigt | - | - | - | - | ja |
| Siegquote (Nexus oder Gold-Vorsprung) [L] | steigt | 25.0 ±21.0 | 50.0 ±0.0 | 25.0 ±21.8 | 33.3 ±27.0 | **nein** (Gold -> Diamond: im Rauschen) |
| Objective-Kontrolle gesamt [F] | steigt | 0.0 ±0.0 | 50.0 ±0.0 | 20.0 ±20.3 | 25.0 ±15.4 | **nein** (Gold -> Diamond: im Rauschen) |

## Neues Gehirn (Beta, --brain=new): Kernmetriken je Rang

| Metrik | Erwartung | Iron | Gold | Diamond | Challenger | Monoton? |
|---|---|---|---|---|---|---|
| CS@10 [L] | steigt | 24.2 ±1.4 | 28.4 ±2.6 | 28.1 ±0.9 | 31.0 ±5.0 | **nein** (Gold -> Diamond: im Rauschen) |
| Idle-Anteil Laner (Hirn-Spec) [L] | sinkt | 4.5 ±1.6 | 6.2 ±0.2 | 7.2 ±1.0 | 7.7 ±1.0 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Idle-Anteil breit (A2: kein Auftrag) [L] | sinkt | 11.3 ±1.1 | 11.5 ±0.6 | 18.3 ±2.5 | 19.4 ±0.2 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: signifikant; Diamond -> Challenger: im Rauschen) |
| Angriffsauslastung Laner [L] | steigt | 49.9 ±1.9 | 37.1 ±0.7 | 31.3 ±1.1 | 27.4 ±0.4 | **nein** (Iron -> Gold: signifikant; Gold -> Diamond: signifikant; Diamond -> Challenger: signifikant) |
| Trade-Bilanz in der Lane [L] | steigt | 45.2 ±3.3 | 50.0 ±0.0 | 51.7 ±2.4 | 56.9 ±2.0 | ja |
| Tode ohne Sicht [L] | sinkt | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | 0.0 ±0.0 | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Tode nach Überfall aus dem Nebel [L] | sinkt | 0.0 ±? | 0.0 ±? | 0.0 ±0.0 | 0.0 ±? | **nein** (Iron -> Gold: im Rauschen; Gold -> Diamond: im Rauschen; Diamond -> Challenger: im Rauschen) |
| Skillshot-Trefferquote (auf Champions gezielt) [L] | steigt | 35.4 ±1.3 | 43.6 ±6.3 | 65.5 ±2.3 | 69.2 ±5.9 | ja |
| Ausweichquote [L] | steigt | 21.9 ±9.3 | 24.7 ±5.3 | 21.4 ±6.0 | 35.3 ±6.9 | **nein** (Gold -> Diamond: im Rauschen) |
| Reaktionszeit (Median) [L] | sinkt | 500 ±18 | 500 ±26 | 433 ±49 | 400 ±36 | **nein** (Iron -> Gold: im Rauschen) |
| Recall abgeschlossen [L] | steigt | 75.7 ±5.3 | 82.0 ±1.6 | 70.8 ±2.6 | 61.9 ±5.3 | **nein** (Gold -> Diamond: signifikant; Diamond -> Challenger: im Rauschen) |
| Gold ausgegeben pro abgeschlossenem Recall [L] | steigt | 406 ±36 | 465 ±16 | 420 ±22 | 533 ±92 | **nein** (Gold -> Diamond: im Rauschen) |
| Recall mit gecrashter Welle [L] | steigt | 11.8 ±1.5 | 13.8 ±1.9 | 15.6 ±5.5 | 35.3 ±8.0 | ja |
| Recall mit Gegnerwelle am eigenen Turm [L] | sinkt | 1.5 ±1.1 | 6.3 ±0.5 | 6.5 ±1.0 | 3.9 ±3.8 | **nein** (Iron -> Gold: signifikant; Gold -> Diamond: im Rauschen) |
| Partiedauer (entschieden) [F] | sinkt | - | - | - | - | ja |
| Erster Turm (min) [F] | sinkt | - | - | - | - | ja |
| Siegquote (Nexus) [F] | steigt | - | - | - | - | ja |
| Siegquote (Nexus oder Gold-Vorsprung) [L] | steigt | 0.0 ±0.0 | 50.0 ±0.0 | 33.3 ±26.8 | 50.0 ±35.0 | **nein** (Gold -> Diamond: im Rauschen) |
| Objective-Kontrolle gesamt [F] | steigt | - | 50.0 ±0.0 | 25.0 ±? | - | **nein** (Gold -> Diamond: signifikant) |

## Neu gegen Alt (gleiche Seeds)

Differenz Neu minus Alt je Rang; fett = außerhalb von 1,96 x Standardfehler der Differenz (Paarung der Seeds wird konservativ nicht ausgenutzt).

| Metrik | Iron | Gold | Diamond | Challenger |
|---|---|---|---|---|
| CS@10 | **+6.4** | +1.6 | **-6.0** | +3.7 |
| Idle-Anteil Laner (Hirn-Spec) % | **-5.6** | **-4.6** | **-3.0** | -2.7 |
| Idle-Anteil breit (A2: kein Auftrag) % | -0.4 | -1.3 | +3.3 | +2.8 |
| Angriffsauslastung Laner % | **+19.9** | **+8.6** | +2.3 | +2.2 |
| Trade-Bilanz in der Lane % | +5.4 | -0.0 | +3.4 | +2.2 |
| Tode ohne Sicht % | +0.0 | +0.0 | +0.0 | +0.0 |
| Tode nach Überfall aus dem Nebel % | +0.0 | +0.0 | +0.0 | +0.0 |
| Skillshot-Trefferquote (auf Champions gezielt) % | +5.1 | -8.1 | +5.3 | -6.2 |
| Ausweichquote % | +3.4 | +7.2 | -2.6 | **+27.6** |
| Reaktionszeit (Median) ms | **+50** | +0 | -67 | +33 |
| Recall abgeschlossen % | +0.2 | +3.8 | +1.8 | -10.4 |
| Gold ausgegeben pro abgeschlossenem Recall | **+135** | -37 | **-109** | +25 |
| Recall mit gecrashter Welle % | **+7.0** | +2.7 | +5.1 | **+20.5** |
| Recall mit Gegnerwelle am eigenen Turm % | **-6.5** | -1.3 | -5.3 | -5.9 |
| Partiedauer (entschieden) min | - | - | - | - |
| Erster Turm (min) min | - | - | - | - |
| Siegquote (Nexus) % | - | - | - | - |
| Siegquote (Nexus oder Gold-Vorsprung) % | -25.0 | +0.0 | +8.3 | +16.7 |
| Objective-Kontrolle gesamt % | - | +0.0 | +5.0 | - |

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
