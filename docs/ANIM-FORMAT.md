# Animations-Format (A3, Stand 2026-10-25)

Für Art-Agenten (A11 bestehende Champions, A26 neue Champions) und alle, die auf Animationen reagieren (A4 VFX,
A5 Audio, A8 Spielgefühl). Es gibt keine Bilddateien (siehe `docs/ART.md`): Frames werden im Code gemalt und in den
Atlas gebacken. Dieses Dokument beschreibt, **wie die gebackenen Frames abgespielt werden** und wo man was einträgt.

## 1. Vier Schichten

| Schicht | Datei | Entscheidet |
|---|---|---|
| Frames malen | `src/render/champions/anim.ts` (`poseFor`), `kits.ts`, `props*.ts` | wie jeder Frame aussieht |
| Frame-Zahlen | `kit.frames` (Kit) bzw. `frames` (`SpriteDrawer`), Standard `FRAMES` in `anim.ts` | wie viele Frames je Anim im Atlas liegen |
| Abspiel-Tabelle | `src/render/anim/data.ts` (`ANIM_OVERRIDES`) | fps, Loop, Frame-Events, Trefferframe, Cast-Art je Slot |
| Zustandsmaschine | `src/render/anim/machine.ts` (`UnitAnim`), eingebunden in `championSprites.ts` | welcher Clip/Frame wann, Übergänge, Events |

**Frame-Zahlen stehen absichtlich nicht in der Abspiel-Tabelle**, sondern bei der Kunst: Sie bestimmen das
Atlas-Layout. `buildClipSet` liest sie aus dem gebackenen Atlas, die Tabelle ergänzt nur das Abspielen.

## 2. Clips: Anims, Frame-Zahlen, Raten

Fünf Atlas-Clips je Id und Richtung (`ANIMS` = `idle run attack cast death`), 5 gemalte Richtungen, 3 gespiegelt.

| Layout | idle | run | attack | cast | death | gilt für |
|---|---|---|---|---|---|---|
| Champion (`FRAMES`) | 4 | 8 | 5 | 4 | 3 | alle Kits in `KITS` |
| Legacy (`LEGACY_FRAMES`) | 4 | 6 | 4 | 0 | 3 | Hark, Minions |
| Monster | 3 | 4 | 3 | 0 | 3 | Dschungel-Monster (Mooswolf 4/6/4/0/3); Pflanzen 2/0/0/0/2 |

Raten (Frames pro Sekunde, `CHAMP_FPS` bzw. `FPS`): Champion `idle 3.2, run 14, attack 13, cast 12, death 8`; Legacy
`5, 11, 12, 9, 7`. **Attack und Cast werden nicht mit fps abgespielt**, sondern auf die Sim-Zeiten gedehnt (Abschnitt 5);
die fps gelten für idle, run und death.

Loop-Flags: `idle` und `run` laufen in Schleife, `attack`, `cast`, `death` nicht (halten den letzten Frame).

Ein Clip einer Id (`ClipSpec`, aufgelöst von `buildClipSet(id, base)`):

```ts
{ frames: number,            // gebackene Frames je Richtung, 0 = Anim existiert nicht
  fps: number,               // Abspielrate
  loop: boolean,
  events: { frame: number, name: 'footstep' | 'hitFrame' | 'release' | 'land' }[] }
```

## 3. Pro Champion überschreiben: `ANIM_OVERRIDES`

`src/render/anim/data.ts`, Schlüssel = Sprite-Id (`'mira'`, `'vargrim'`, Minion-/Monster-Id). Alles optional; ohne
Eintrag gelten die Standardwerte.

```ts
export const ANIM_OVERRIDES: Record<string, AnimOverride> = {
  vargrim: {
    clips: {
      attack: { events: [{ frame: 3, name: 'hitFrame' }] }, // Trefferframe 3 statt Standard 2
      run: { fps: 18, events: [{ frame: 0, name: 'footstep' }, { frame: 2, name: 'footstep' }, { frame: 4, name: 'footstep' }, { frame: 6, name: 'footstep' }] }, // Vierbeiner: 4 Hufschläge
    },
    refSpeed: 400,                    // Bewegungstempo, bei dem der Lauf mit nominalem fps spielt (Standard 340)
    castKinds: { 2: 'dash' },         // Slot E wird als Dash-Cast abgespielt
  },
};
```

| Feld | Bedeutung |
|---|---|
| `clips.<anim>.fps` | Abspielrate dieses Clips |
| `clips.<anim>.loop` | Schleife ja/nein |
| `clips.<anim>.events` | **ersetzt** die Standard-Events dieses Clips (immer die komplette Liste angeben) |
| `refSpeed` | Lauftempo (Welteinheiten/s) bei nominalem run-fps; die Laufanimation skaliert mit dem echten Tempo (0,55x bis 1,7x), damit die Füße nicht rutschen |
| `castKinds[slot]` | Cast-Art je Fähigkeitsslot 0..3 (Q W E R): `directed` (Release nach vorn), `self` (Buff-Flex), `dash` (Ausfallschritt). Ohne Eintrag entscheidet der Fähigkeitstyp (`self` -> self, `dash`/`blink` -> dash, sonst directed) |

Standard-Events (`defaultEvents`): `run`: `footstep` auf Frame 0 und `frames/2` (Kontaktframes, linker/rechter Fuß);
`attack`: `hitFrame` auf dem Trefferframe (`atlas.hit[id]`, Standard 2 bei 5 Frames, sonst 1); `cast`: `release` auf
Frame 1 (`CAST_RELEASE`); `death`: `land` auf dem letzten Frame. `idle`: keine.

Regeln (prüft `validateClipSet`, Test `tests/animData.test.ts` läuft über **alle** Sprite-Ids):
- Jede Event-Frame-Nummer liegt in `0 .. frames-1`.
- Genau ein `hitFrame` im attack-Clip (wenn attack-Frames > 0), genau ein `release` im cast-Clip (wenn cast-Frames > 0).
- `fps > 0` für idle/run/death mit mehr als einem Frame, `refSpeed > 0`.
- Ein `hitFrame`-Override verschiebt auch `atlas.hit[id]` (`hitOf` liest die Tabelle). **Die Pose muss dazu passen:** Die
  Schlag-Pose steckt in `attackKeys` (`anim.ts`, Key 2 = Schlag). Wer den Trefferframe verschiebt, ändert die Keys mit.

### Frame-Zahlen einer Id ändern (Atlas-Layout!)

Anderes `kit.frames` = anderes Atlas-Layout. Der IndexedDB-Streifen-Cache ist an den Hash des gebauten `sheets`-Chunks
gebunden (jeder Build verwirft ihn), im Dev-Server wird nicht gecached, deshalb sind veraltete Streifen heute nicht
möglich. Für den Fall, dass der Cache später versioniert statt chunk-gehasht wird, liefert `layoutKey(frames)`
(`'4.8.5.4.3'`) einen Fingerabdruck, der an `stripKey` gehängt werden sollte (Request R-A3a). Test:
`tests/animData.test.ts`.

## 4. Zustände und Übergänge (`LogicalState`)

`idle`, `walk`, `windup`, `release`, `recovery`, `cast`, `recall` (plus Tod als eigener Geist, siehe unten). Mehrere
Zustände teilen sich einen Atlas-Clip:

| Zustand | Atlas-Clip / Frame | Wann |
|---|---|---|
| `idle` | `idle`, Schleife; beginnt auf dem neutralen Frame 0 | nichts anderes aktiv |
| `walk` | `run`, Schleife, Phase läuft über Angriffe/Casts hinweg weiter | `moving` im Snapshot |
| `windup` | `attack`, Frames `0 .. hit-1` über den Sim-Wind-up verteilt, hält auf `hit-1` | `atkPhase 1` |
| `release` | `attack`, Frame `hit` (Schlag, kurz gehalten) | beginnt im selben Frame wie `atkPhase 1 -> 2` |
| `recovery` | `attack`, Frames `hit+1 ..` (Nachschwung, Rückkehr) | bis Ende des Zyklus; Laufen bricht ab (Orbwalk) |
| `cast` | `cast`: 0 = Sammeln, `release` (1) = Auslösen, danach Nachschwung 2; `self` hält Frame 3 (Flex), `dash` hält 1 | `cast`-Event der Sim |
| `recall` | `cast`: Frame 0 (220 ms), danach Frame 3 (Flex) gehalten | Rückruf wird kanalisiert |
| Tod | `death` als Geist (`ghosts`), 3 Frames, danach liegt die Leiche `corpseMs` | `death`-Event der Sim |
| Treffer | kein Zustand: Rückstoß-Versatz 9 Einheiten, 150 ms, max. alle 320 ms | `damage`-Event (kleiner, 0,35x, im Wind-up/Cast/Recall) |

Vorrang: Cast > Wind-up > Release/Recovery > Recall > Walk > Idle. (Die Sim bricht Auto-Angriff und Rückruf ohnehin ab,
wenn gezaubert wird oder man sich bewegt.)

Saubere Übergänge (keine Sprünge, wo es Frames erlauben):
- **Walk -> Angriff mitten im Schritt:** Wind-up beginnt im selben Frame, die Lauf-Phase bleibt gemerkt und läuft danach
  dort weiter, statt bei Frame 0 neu zu starten.
- **Stoppen:** `walk` -> `idle` erst nach 50 ms ohne `moving` (ein verlorenes Tick-Flag flackert nicht zu Idle).
- **Cast durch CC unterbrochen** (Betäubung, Schweigen, Luftstoß, Unterdrückung, Stase, Furcht – wie `canCast` der Sim)
  vor der Auslösung: Cast bricht ab, kein Release-Frame, Event `castCancel`. Wurzel/Verlangsamung unterbrechen nicht.
- **Tod im Cast/Angriff:** laufende Aktionen werden verworfen, nur der Todes-Geist spielt (kein spätes `release`).
- **Sofort-Self-Buff im Laufen** (Cast-Zeit 0, Typ `self`): der Körper läuft weiter, Events kommen trotzdem.
- **Neuer Wind-up während des Nachschwungs** (hohe Angriffsgeschwindigkeit): Nachschwung wird abgeschnitten, Wind-up
  beginnt bei Frame 0. Das ist ein harter Schnitt (Sprites lassen sich nicht überblenden), aber nur bei Angriffstempo > ~2.

## 5. Zeitvertrag mit der Sim (Schaden entscheidet die Sim, nie die Animation)

- **Wind-up:** Die Anticipation-Frames (`0 .. hit-1`) werden über `(atkEnd - atkStart)` Ticks verteilt, die der Snapshot in
  Phase 1 liefert (Angriffsgeschwindigkeit, Items, Buffs inklusive). Fehlt der Snapshot-Wert, gilt die zuletzt gemessene
  Dauer, sonst die Schätzung aus den Champion-Daten (`windEstimate`). Hält die Sim länger, bleibt der Sprite auf dem
  letzten Anticipation-Frame stehen; er schlägt nie früher zu.
- **Treffer:** Der Schlag-Frame (`hit`) erscheint im Render-Frame, in dem `atkPhase` von 1 auf 2 wechselt – derselbe
  Snapshot, der das `damage`-Event und den Projektilstart liefert. Das Event `hitFrame` wird in genau diesem Moment
  ausgelöst.
- **Angriffsgeschwindigkeit skaliert den Nachschwung:** Bleibt im Zyklus (`atkEnd - atkStart` in Phase 2) weniger Zeit als
  `(attack - hit) * 95 ms`, läuft der Nachschwung schneller (bis 2,2x). Langsame Angreifer spielen mit Normaltempo.
- **Cast:** `release` fällt auf das Ende der Sim-Cast-Zeit (`cast`-Event, Feld `at`, sonst `castTime` der Fähigkeit); der
  Sprite wartet bis dahin im Sammeln-Frame. Cast-Zeit 0: kein Sammeln, sofort Release.

## 6. Events abonnieren (VFX, Audio, Spielgefühl)

```ts
import { animEvents } from '../render/anim';

const off = animEvents.on('hitFrame', (e) => impact(e.x, e.y, e.id));
animEvents.on('footstep', (e) => step(e.x, e.y, e.foot));
animEvents.on('release', (e) => castSound(e.id, e.slot, e.kind));
animEvents.on('*', (e) => debug(e.name));
off(); // abmelden
```

`AnimEvent`: `name`, `eid` (Sim-Entity), `id` (Sprite-Id), `t` (Render-Zeit ms), `x`/`y` (Füße, interpoliert), `dir`,
`slot` (Cast-Events, sonst -1), `kind` (`directed|self|dash`), `foot` (Schritt 0/1, sonst -1). **Das Objekt wird wiederverwendet**
(keine Allokation): im Callback lesen, nichts aufheben. Ohne Abonnenten kostet ein Event nichts.

| Event | Wann | Quelle |
|---|---|---|
| `windup` | Angriffs-Wind-up beginnt (Phase 0/2 -> 1) | Snapshot |
| `hitFrame` | Schlag-Frame wird gezeigt = Schadens-Tick des Auto-Angriffs / Projektilstart | Snapshot Phase 1 -> 2, Frame `hit` |
| `castStart` | Zauber beginnt (`slot`, `kind`) | `cast`-Event der Sim |
| `release` | Zauber löst aus (Ende der Cast-Zeit) | Cast-Beginn + Sim-Cast-Zeit, Frame `release` |
| `castCancel` | Cast vor der Auslösung durch CC abgebrochen | CC-Maske |
| `footstep` | Fuß setzt auf (Frames laut `run.events`); nur Champions, nicht Minions/Monster | Lauf-Clip |
| `hit` | Treffer-Rückstoß beginnt (nicht öfter als alle 320 ms je Einheit) | `damage`-Event |
| `death` | Einheit stirbt | `death`-Event |
| `land` | Leiche ist am Boden (letzter death-Frame) | Todes-Clip |
| `recallStart` / `recallEnd` | Rückruf beginnt / endet | `snap.me.recallLeft` (nur eigener Champion, s. u.) |

Nur gezeichnete Einheiten lösen Events aus (Nebel/Off-Screen-Kulling der Sprite-Batches gelten wie beim Zeichnen).
`ChampionSprites` nimmt optional einen eigenen Bus (Konstruktor), Tests nutzen `new AnimEventBus()`.

## 7. Cast je Slot

Die Cast-Art (`directed`/`self`/`dash`) wird je Slot bestimmt: Override `castKinds[slot]` vor Fähigkeitstyp. Die Kopf-/Arm-Pose
kommt weiterhin aus dem Kit (`kit.cast`: `raise forward slam ring spin`), also eine Pose-Familie je Champion.
**Echte Pose pro Slot** (vier verschiedene Cast-Clips) würde die Cast-Frames vervierfachen: +12 Frames x 5 Richtungen = +60
Zellen je Champion (von 120 auf 180); bei 10 Champions passt das nicht mehr in 8192x4096 bei 152 px. Falls A11 das braucht:
Slot-spezifische Release-Frames (`release`-Event je Slot) und ein Atlas mit kleineren Zellen – erst mit dem Integrator klären.

## 8. Rückruf

Atlas-seitig gibt es keinen eigenen Clip (kein zusätzlicher Speicher): Der Rückruf zeigt die Cast-Frames 0 und 3
(Sammeln, dann Flex gehalten). Der Snapshot trägt `recallLeft` nur für den eigenen Champion (`snap.me`), deshalb sehen
heute nur die Spielenden ihren eigenen Rückruf-Pose; Gegner und Verbündete rufen im Sprite nicht ab (Request R-A3b: Flag
`recalling` je Entity im Snapshot).

## 9. Checkliste für neue/überarbeitete Champions

1. Kit/Drawer mit Standard-Frame-Zahlen (`FRAMES`) bauen; weicht ein Clip ab: `kit.frames` bzw. `frames` im Drawer.
2. Trefferframe: Standard ist Frame 2 (5 Attack-Frames). Anders? `hitFrame`-Override **und** `attackKeys` anpassen.
3. Nicht-humanoid (Vierbeiner, Schwebende): `refSpeed`, `run.fps`, `run.events` (Hufschläge) eintragen.
4. Cast-Arten prüfen: weicht ein Slot vom Fähigkeitstyp ab, `castKinds` setzen.
5. `npx vitest run tests/animData.test.ts tests/assetManifest.test.ts` – validiert Frames, Events und Trefferframe aller Ids.
6. Im Spiel prüfen (`?play=sandbox&bench`, Attack-Wind-up und Casts an der Puppe): Schlag-Frame auf dem Treffer, kein Hängen.
