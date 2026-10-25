// Benchmark metric registry: id, label, unit, direction of "better" and the written definition (German, shown in
// the report). Values are accumulated per team and game by observer.ts / play.ts as ratio pairs [num, den] (value =
// sum(num) / sum(den) over games) or as raw sample lists (median / mean / p90). Role splits use the id suffix
// ".top" / ".mid" / ".adc" / ".jungle" / ".support".

export type MetricKind = 'ratio' | 'samples';
export interface MetricDef {
  id: string;
  label: string;
  /** Display unit; 'pct' multiplies by 100. */
  unit: 'pct' | 'count' | 'ms' | 's' | 'min' | 'cs' | 'x';
  kind: MetricKind;
  /** Expected direction with a rising rank (null: informational, no monotonicity check). */
  better: 'up' | 'down' | null;
  /** Part of the monotonicity table (DoD: Iron < ... < Challenger). */
  core: boolean;
  /** Which game set the headline value comes from: lane set (short games) or full set (until the nexus). */
  set: 'L' | 'F';
  /** Meaningful only against a fixed reference rank (the value of a same-rank game is 50 % by construction). */
  vsOnly?: boolean;
  /** Roles with their own split row. */
  roles?: boolean;
  def: string;
}

const m = (d: MetricDef): MetricDef => d;

export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
export const LANERS = ['top', 'mid', 'adc'] as const;
export const isLanerRole = (r: string): boolean => r === 'top' || r === 'mid' || r === 'adc';

export const METRICS: MetricDef[] = [
  m({ id: 'cs10', label: 'CS@10', unit: 'cs', kind: 'ratio', better: 'up', core: true, set: 'L', roles: true,
    def: 'Champ.cs der Laner (Top, Mid, ADC) genau bei 10:00 (Tick 18000), Mittel über Laner und Partien. Rollen-Zeilen zählen auch Jungle/Support (deren cs).' }),
  m({ id: 'csEnd', label: 'CS/min Partieende', unit: 'cs', kind: 'ratio', better: 'up', core: false, set: 'L',
    def: 'Laner: Champ.cs am Ende des Laufs geteilt durch die gespielten Minuten (Lauflänge der Menge, nicht Partielänge).' }),
  m({ id: 'idle', label: 'Idle-Anteil Laner (Hirn-Spec)', unit: 'pct', kind: 'ratio', better: 'down', core: true, set: 'L', roles: true,
    def: 'Zähler: Ticks, in denen der Laner (Top/Mid/ADC) lebt, nicht recallt, nicht castet (isBusy), keinen Angriff laufen hat (Atk.phase 0), nicht läuft (Move.mode 0) und seit mehr als 45 Ticks (1,5 s) keinen Order-Befehl (move, attack, attackMove, stop, cast, spell, item, recall, ward) ausgegeben hat. Nenner: Ticks 2:00-14:00, in denen ein gegnerischer Minion oder Champion in Reichweite+200 (Angriffsreichweite + eigener Radius + 200 + Radius des Ziels) ist. Entspricht der Definition in docs/BRAIN-REWORK.md; zählt anders als die Harness-Kennzahl nur Order-Befehle (kein buy/ping/chat).' }),
  m({ id: 'idleAll', label: 'Idle-Anteil breit (A2: kein Auftrag)', unit: 'pct', kind: 'ratio', better: 'down', core: true, set: 'L', roles: true,
    def: 'Zähler: Ticks, in denen ein lebender Bot keinen Bewegungsauftrag (Move.mode 0), keinen Angriff (Atk.phase 0, kein Atk.target), keinen Recall und keinen Cast/Kanal hat. Nenner: lebende Ticks ab 1:45 außerhalb des Brunnens und ohne Recall. Alle Rollen, ganzer Lauf (Idee: tools/bughunt/matchProbe.ts).' }),
  m({ id: 'util', label: 'Angriffsauslastung Laner', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L', roles: true,
    def: 'Anteil der Ticks 2:00-14:00 mit laufendem Angriff (Wind-up oder Backswing), während ein Gegner (Minion/Champion) in Reichweite+200 ist (gleicher Nenner wie Idle-Anteil).' }),
  m({ id: 'tradeBal', label: 'Trade-Bilanz in der Lane', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L', vsOnly: true,
    def: 'Schaden des Teams an gegnerischen Champions geteilt durch (Schaden gemacht + Schaden erlitten), nur Champion-gegen-Champion-Schaden vor 14:00, bei dem im Umkreis von 1600 um das Opfer höchstens 4 lebende Champions stehen (Lane-Duelle, 2v2, kein Teamfight). 50 % = ausgeglichen. Nur gegen eine feste Referenz aussagekräftig (gleicher Rang: 50 % per Konstruktion).' }),
  m({ id: 'exchWon', label: 'Gewonnene Lane-Trades', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'L', vsOnly: true,
    def: 'Ein Trade ist eine Folge von Lane-Schaden (Definition oben) mit Lücken von höchstens 4 s im Umkreis von 1800 um den ersten Treffer, mit mindestens 200 Gesamtschaden. Gewonnen = das Team hat mehr Schaden gemacht als erlitten; Unentschieden zählen nicht. Anteil gewonnener von entschiedenen Trades.' }),
  m({ id: 'deathsNoVision', label: 'Tode ohne Sicht', unit: 'pct', kind: 'ratio', better: 'down', core: true, set: 'L',
    def: 'Anteil der Champion-Tode durch einen gegnerischen Champion, bei denen das Team des Opfers den Killer in den 5 s (150 Ticks) bis 1 s vor dem Tod zu keinem Tick gesehen hat (Fog/Busch; die letzte Sekunde ist ausgenommen, weil der Angreifer sich beim Schlag zwangsläufig zeigt). Tode durch Türme/Minions/Monster zählen nicht (nicht im Nenner).' }),
  m({ id: 'deathsPer10', label: 'Tode pro Champion und 10 min', unit: 'x', kind: 'ratio', better: 'down', core: false, set: 'L',
    def: 'Alle Champion-Tode des Teams geteilt durch (Champions x Lauflänge in Minuten / 10).' }),
  m({ id: 'ssHit', label: 'Skillshot-Trefferquote (alle)', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'L', roles: true,
    def: 'Linienprojektile von Fähigkeiten (Kind.Projectile, kind 1, Ausgangsflug) der Champions des Teams: Anteil, der mindestens einen gegnerischen Champion getroffen hat (payload.hit). Enthält auch Schüsse auf Minions.' }),
  m({ id: 'ssAimed', label: 'Skillshot-Trefferquote (auf Champions gezielt)', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L', roles: true,
    def: 'Wie oben, aber nur Schüsse, deren Cursor beim Wirken höchstens 300 Einheiten von einem lebenden, für das Schützen-Team sichtbaren gegnerischen Champion entfernt war (der Bot hat auf einen Champion gezielt).' }),
  m({ id: 'dodge', label: 'Ausweichquote', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L', roles: true,
    def: 'Bedrohungen = gegnerische Linien-Skillshots, die einen Champion des Teams getroffen hätten, wenn er mit seiner Geschwindigkeit beim Abschuss geradeaus weitergelaufen wäre (geschlossene Form: kleinster Abstand von linear extrapolierter Champion- und Projektilbahn <= Champion-Radius + halbe Breite), mit Auftreffzeit >= 0,2 s und wenn das Schützen-Team-Champion für das Opfer-Team sichtbar war. Ausgewichen = Projektil hat den Champion nicht getroffen, obwohl es nicht vorher blockiert wurde (Minion, anderer Champion, Reichweite) und der Champion noch lebt. Quote = ausgewichen / Bedrohungen.' }),
  m({ id: 'dodgeMove', label: 'Ausweichquote ohne Fähigkeit', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'L',
    def: 'Wie Ausweichquote, aber ausgewichen gilt nur, wenn der Champion während des Fluges keinen cast/spell/item-Befehl ausgegeben hat (reine Bewegung). Nenner sind alle Bedrohungen.' }),
  m({ id: 'rtAll', label: 'Reaktionszeit (Median)', unit: 'ms', kind: 'samples', better: 'down', core: true, set: 'L', roles: true,
    def: 'Zeit vom Reiz bis zum ersten Auftragswechsel-Befehl des Bots, über alle Reizarten gepoolt (siehe unten). Untergrenze 33 ms (1 Tick). Reize ohne Antwort in 2 s zählen als "keine Antwort" und gehen nicht in den Median ein.' }),
  m({ id: 'rtDodge', label: 'Reaktionszeit Skillshot', unit: 'ms', kind: 'samples', better: 'down', core: false, set: 'L',
    def: 'Reiz: gegnerischer sichtbarer Linien-Skillshot, der den Champion bedroht (Definition der Ausweichquote). Antwort: erster move/attackMove mit Richtungswechsel >= 40 Grad und >= 150 Einheiten Zielversatz zum letzten Auftrag, oder cast/spell/item/stop/recall.' }),
  m({ id: 'rtVision', label: 'Reaktionszeit Gegner taucht auf', unit: 'ms', kind: 'samples', better: 'down', core: false, set: 'L',
    def: 'Reiz: ein gegnerischer Champion wird für das Team sichtbar, nachdem er >= 3 s unsichtbar war, und steht <= 1500 Einheiten vom Bot. Antwort: erster Auftragswechsel (anderer Befehlstyp, Angriff auf anderes Ziel, Bewegung mit >= 40 Grad / >= 150 Einheiten Versatz, cast/spell/recall/stop/item/ward).' }),
  m({ id: 'rtAmbush', label: 'Reaktionszeit Überfall', unit: 'ms', kind: 'samples', better: 'down', core: false, set: 'L',
    def: 'Reiz: der Bot erleidet Schaden von einem gegnerischen Champion, nachdem er >= 5 s keinen Champion-Schaden erlitten hat. Antwort: erster Auftragswechsel (wie bei "Gegner taucht auf").' }),
  m({ id: 'rtNone', label: 'Reize ohne Antwort in 2 s', unit: 'pct', kind: 'ratio', better: 'down', core: false, set: 'L',
    def: 'Anteil aller Reize (Skillshot, Gegner taucht auf, Überfall), auf die der Bot binnen 2 s keinen Auftragswechsel-Befehl gegeben hat.' }),
  m({ id: 'recallPer10', label: 'Recalls pro Champion und 10 min', unit: 'x', kind: 'ratio', better: null, core: false, set: 'L',
    def: 'Begonnene Recalls (Champ.recallAt wechselt von 0 auf > 0) pro Champion und 10 Minuten.' }),
  m({ id: 'recallDone', label: 'Recall abgeschlossen', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L',
    def: 'Anteil der begonnenen Recalls, die im Brunnen enden (nicht durch Schaden/Bewegung/Tod abgebrochen).' }),
  m({ id: 'recallGold', label: 'Gold beim Recall-Start', unit: 'count', kind: 'ratio', better: null, core: false, set: 'L',
    def: 'Mittleres Champ.gold zu Beginn des Recalls.' }),
  m({ id: 'recallSpent', label: 'Gold ausgegeben pro abgeschlossenem Recall', unit: 'count', kind: 'ratio', better: 'up', core: true, set: 'L',
    def: 'Zuwachs von (totalGold - gold) vom Recall-Start bis der Champion den Brunnen verlässt (spätestens 20 s nach Ankunft): im Shop ausgegebenes Gold.' }),
  m({ id: 'recallLeft', label: 'Ungenutztes Gold nach dem Shoppen', unit: 'count', kind: 'ratio', better: 'down', core: false, set: 'L',
    def: 'Champ.gold beim Verlassen des Brunnens (abgeschlossene Recalls).' }),
  m({ id: 'recallHp', label: 'HP beim Recall-Start', unit: 'pct', kind: 'ratio', better: null, core: false, set: 'L',
    def: 'Mittlerer Anteil Hp.cur / Hp.max zu Beginn des Recalls.' }),
  m({ id: 'recallCrashed', label: 'Recall mit gecrashter Welle', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L',
    def: 'Anteil der Recalls von Laner/Support, bei denen >= 3 eigene Minions der Lane innerhalb von 1200 Einheiten um den vordersten lebenden gegnerischen Turm der Lane stehen (Welle crasht, kein Farm-Verlust für den Gegner-Push).' }),
  m({ id: 'recallBad', label: 'Recall mit Gegnerwelle am eigenen Turm', unit: 'pct', kind: 'ratio', better: 'down', core: true, set: 'L',
    def: 'Anteil der Recalls von Laner/Support, bei denen >= 3 gegnerische Minions der Lane innerhalb von 1000 Einheiten um den vordersten lebenden eigenen Turm der Lane stehen (gleiche Definition wie recallsWaveAtTower im Harness).' }),
  m({ id: 'killsGame', label: 'Kills pro Partie (beide Teams)', unit: 'count', kind: 'ratio', better: null, core: false, set: 'F',
    def: 'Alle Champion-Kills beider Teams pro Lauf.' }),
  m({ id: 'gameLen', label: 'Partiedauer (entschieden)', unit: 'min', kind: 'ratio', better: 'down', core: true, set: 'F',
    def: 'Mittlere Dauer der Partien, die per Nexus entschieden wurden (nicht entschiedene Läufe hängen vom Zeitlimit ab und zählen nicht).' }),
  m({ id: 'decided', label: 'Entschiedene Partien', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F',
    def: 'Anteil der Läufe, die vor dem Zeitlimit per Nexus endeten.' }),
  m({ id: 'firstTowerMin', label: 'Erster Turm (min)', unit: 'min', kind: 'ratio', better: 'down', core: true, set: 'F',
    def: 'Minute, in der der erste Turm (egal welches Team) fiel; Läufe ohne Turmfall zählen nicht.' }),
  m({ id: 'firstTower', label: 'Erster Turm für das Team', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F', vsOnly: true,
    def: 'Anteil der Läufe mit Turmfall, in denen das Team den ersten Turm zerstört hat.' }),
  m({ id: 'winNexus', label: 'Siegquote (Nexus)', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'F', vsOnly: true,
    def: 'Siege per Nexus geteilt durch die entschiedenen Läufe.' }),
  m({ id: 'winLead', label: 'Siegquote (Nexus oder Gold-Vorsprung)', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'L', vsOnly: true,
    def: 'Wie botSim --vs: Sieg per Nexus, bei Zeitablauf der Lauf mit mehr verdientem Team-Gold. Zähler gewonnen / alle Läufe (Gleichstand nicht gewonnen).' }),
  m({ id: 'goldPerMin', label: 'Gold/min pro Champion', unit: 'count', kind: 'ratio', better: 'up', core: false, set: 'L',
    def: 'Verdientes Gold (Summe der positiven Gold-Zuwächse) pro Champion und Minute.' }),
  m({ id: 'objTower', label: 'Turm-Anteil', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F', vsOnly: true,
    def: 'Vom Team zerstörte Türme / alle zerstörten Türme (nur Läufe mit mindestens einem Turmfall).' }),
  m({ id: 'objDrake', label: 'Leviathan-Anteil (Drache)', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F', vsOnly: true,
    def: 'Vom Team getötete Leviathane / alle getöteten Leviathane.' }),
  m({ id: 'objHerald', label: 'Kesselbrut-Anteil (Herold)', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F', vsOnly: true,
    def: 'Vom Team getötete Kesselbrut-Einheiten / alle getöteten Kesselbrut-Einheiten (3 Einheiten je Lager).' }),
  m({ id: 'objBaron', label: 'Schleierwächter-Anteil (Baron)', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'F', vsOnly: true,
    def: 'Vom Team getötete Schleierwächter / alle getöteten Schleierwächter.' }),
  m({ id: 'objAll', label: 'Objective-Kontrolle gesamt', unit: 'pct', kind: 'ratio', better: 'up', core: true, set: 'F', vsOnly: true,
    def: 'Summe der Teil-Ereignisse des Teams (Türme + Inhibitoren + Leviathane + Kesselbrut-Lager (Einheiten / 3) + Schleierwächter) geteilt durch die Summe beider Teams.' }),
  m({ id: 'plates', label: 'Platten-Anteil (vor 14:00)', unit: 'pct', kind: 'ratio', better: 'up', core: false, set: 'L', vsOnly: true,
    def: 'Vom Team abgebaute Turmplatten vor 14:00 / alle abgebauten Platten.' }),
];

export const METRIC_BY_ID = new Map(METRICS.map((d) => [d.id, d]));
