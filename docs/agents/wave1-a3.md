# Welle 1 – A3 Animationssystem (Branch `feat/a3-anim`)

Format und Nutzung: `docs/ANIM-FORMAT.md`. Dieses Dokument: was gebaut wurde, was schon da war, Messwerte, offene Punkte.

## Was schon existierte (Audit vor dem Bau)

| Thema | Stand vorher |
|---|---|
| Atlas-Clips | `ANIMS = idle run attack cast death`, Champions 4/8/5/4/3 Frames, Legacy 4/6/4/0/3, 5 gemalte Richtungen + 3 gespiegelt (`atlas.ts`, `anim.ts`) |
| Trefferframe | `ATTACK_HIT = 2`, `atlas.hit[id]`; `CAST_RELEASE = 1`, `CAST_FLEX = 3` |
| Angriff | `ChampionSprites.push`: Phase 1 -> 2 aus `atkPhase`, Wind-up aus gemessener Dauer (erster Angriff: Schätzung), Nachschwung `afterFrame` (`spriteTiming.ts`), Orbwalk bricht ab |
| Cast | `onCast(eid, now, dur, kind)`: directed/self/dash, ein Cast-Clip für alle Slots |
| Hit | Rückstoß-Versatz (9 Einheiten, 150 ms, 320-ms-Gate); kein Hit-Frame |
| Tod | Geister mit Todes-Clip (`ghosts`, `corpseMs`) |
| Richtung | geglättete Blickrichtung (D2, `turnToward`) |
| **Fehlte** | Rückruf-Zustand; exakte Wind-up-Dauer aus dem Snapshot (`atkStart/atkEnd` wurden nicht gelesen); Angriffstempo-Skalierung des Nachschwungs; Cast-Abbruch durch CC; Cast je Slot; Animations-Events; Laufphase/-tempo; dokumentiertes Datenformat; Tests der Zustandslogik (nur `afterFrame`) |

## Was neu ist

- `src/render/anim/` (neu): `types.ts`, `data.ts` (Clip-Tabelle `ANIM_OVERRIDES`, `buildClipSet`, `validateClipSet`, `layoutKey`),
  `machine.ts` (`UnitAnim`, reine Zustandsmaschine ohne three/canvas), `events.ts` (`animEvents`-Bus), `index.ts`.
- `championSprites.ts`: die verstreute Zustandslogik in `push()` ist durch `UnitAnim` ersetzt (gleiches Verhalten, wo nichts
  anderes verlangt war), Bus-Anbindung, Geister lösen `land` aus, `setRecall`, `clipsOf(id)`, `castKindOf(type, champ, slot)`.
- `spriteTiming.ts`: `backswingScale`, `runSpeedScale` (pur, getestet).
- Zustände: idle, walk, windup/release/recovery, cast (je Slot-Art), recall, Hit-Versatz, Tod (Geist). Events: `windup`,
  `hitFrame`, `castStart`, `release`, `castCancel`, `footstep`, `hit`, `death`, `land`, `recallStart`, `recallEnd`.
- Verhalten gegenüber vorher:
  - Wind-up wird über `atkEnd - atkStart` (exakte Sim-Ticks) verteilt, auch beim ersten Angriff; Fallback wie vorher.
  - Nachschwung wird bei hoher Angriffsgeschwindigkeit bis 2,2x schneller (Zyklus minus Wind-up aus dem Snapshot).
  - Cast wird bei Betäubung/Schweigen/Luftstoß/Unterdrückung/Stase/Furcht vor der Auslösung abgebrochen (vorher spielte der
    Release-Frame trotzdem), Tod im Cast verwirft den Cast.
  - Sofort-Self-Buffs im Laufen halten den Schritt; Laufzyklus behält die Phase über Angriffe; Lauftempo folgt der echten
    Geschwindigkeit (Verlangsamung = langsamere Beine); `walk -> idle` mit 50 ms Gnadenfrist.
  - Rückruf: Cast-Frames 0/3 (nur eigener Champion, siehe Request R-A3b).
- `atlas.ts` (mein Teil, 2 Zeilen): `hitOf`/`rateOf` lesen die Tabelle. Atlas-Layout und Cache-Schlüssel unverändert (keine
  Frame-Zahl geändert), deshalb kein Cache-Bruch; `layoutKey` für später (Request R-A3a).

## Geteilte Dateien (kleine additive Hooks)

- `src/render/world.ts`, 1 Zeile: `onCast(... castKindOf(ab?.type, src?.champ, ev.slot), ev.slot)` (Slot und Per-Slot-Override).
- `src/render/units.ts`, 1 Zeile: `champs?.setRecall(myEid, (snap?.me?.recallLeft ?? 0) > 0)`.
- `src/render/champions/anim.ts`: nur der Kopfkommentar.

## Tests

`tests/animMachine.test.ts` (26: Wind-up/Treffer auf dem Sim-Tick, exakte Dauer, Angriffstempo, Orbwalk-Abbruch, Laufphase,
Gnadenfrist, Lauftempo, Footsteps, CC-Abbruch je Bit, Tod im Cast, Recall, Flinch), `tests/animData.test.ts` (58: jede Sprite-Id
valide, Overrides, Validierung, Helfer), `tests/animEvents.test.ts` (3), plus bestehend `spriteTiming`, `assetManifest`.

## Messwerte

- Zustandsmaschine allein (Node, 70 Einheiten, gemischt laufen/angreifen): 0,005–0,009 ms pro Frame.
- Frame-Budget: `units.update` (Sprite-Teil des Render-Frames) im Browser, Produktions-Build, Swiftshader, klassisches Match mit
  10 Champions, Sim bei Tick 3000 pausiert (9 Champions + ~52 Minions), je Lauf 9 x 1500 Aufrufe; Median / Minimum in ms pro Aufruf,
  Vorher = Sammelbranch `22f59f4` als eigener Build, Nachher = dieser Branch (Maschine mit Last ~22 auf 4 Kernen, deshalb Streuung):
  Nachher 0,55 / 0,13 und 0,24 / 0,15; Vorher 0,72 / 0,09, 0,63 / 0,28 und 0,90 / 0,16. Kein messbarer Unterschied (Streuung
  größer als jede Differenz); die Mehrarbeit ist die Maschine mit 0,005–0,009 ms. Einsparungen: `Math.hypot` (langsam in V8) im
  Hot Path vermieden, Clip-Set je Einheit gecacht, Event-Objekt wiederverwendet (keine Allokation ohne Abonnenten).
  Befehl: `tools`-frei, Playwright-Skript im Scratch (`perf.js`: `?play=classic&bench`, Speed 8 bis Tick 3000, Pause, `units.update` 1500x).
- Sichtprüfung (`?play=sandbox&bench`, Mira): Wind-up 0/1, Treffer-Frame 2, Nachschwung 3/4, Cast 0/1/2/3, Lauf, Rückruf (Frame 0 und
  3), Tod-Geist; Screenshots in `/tmp/claude-0/-home-user-veilgrounds/a4971f03-f6dd-5b73-acc9-9a8be0bf30ee/scratchpad/shots2/`.

## Offen / Risiken

- Rückruf nur für den eigenen Champion sichtbar (R-A3b). Keine eigenen Rückruf-Frames im Atlas (Cast-Frames wiederverwendet).
- Echte Pose je Slot braucht mehr Cast-Frames (Atlasgröße, siehe ANIM-FORMAT §7); heute nur Art (`directed/self/dash`) je Slot.
- Cast-Abbruch erkennt nur CC aus dem Snapshot; ein Abbruch durch Bewegungsbefehl oder `cancelCast` eines Champion-Hooks ist im
  Snapshot nicht sichtbar (Sprite spielt dann den Release-Frame ohne Wirkung; betrifft Recast-Fähigkeiten, die der Hook mit `cancelCast` zurücknimmt).
- Wind-up-Beginn nutzt die Ankunftszeit des Snapshots (<= 1 Tick Versatz zur Sim), nicht den Sim-Tick selbst; Treffer-Frame und
  `damage`-Event kommen aus demselben Snapshot, bleiben also gleichzeitig.
- Hartes Umschalten Nachschwung -> neuer Wind-up bleibt (Sprites sind nicht überblendbar).
