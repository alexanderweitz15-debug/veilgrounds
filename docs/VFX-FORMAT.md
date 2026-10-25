# VFX-Format: datengetriebene GPU-Partikel (A4, Stand 2026-10-25)

Alle Partikeleffekte des Spiels sind **eine JSON-Datei je Effekt** unter `src/render/vfx/effects/<id>.json`. Der Dateiname
ist die Id. Beim Start liest `src/render/vfx/registry.ts` alle Dateien (Vite-Glob), `schema.ts` validiert sie. Eine kaputte
Datei wird mit `console.warn` übersprungen; `tests/vfx.test.ts` verlangt, dass es keinen Fehler gibt. Es gibt weiterhin
keine Bilddateien: die Glyphen (Punkt, Funke, Ring ...) malt `glyphs.ts` zur Laufzeit in einen 4x2-Atlas.

## 1. Architektur in Kürze

- **Spawn schreibt, Shader rechnet.** `VfxSystem.emit()` schreibt je Partikel einmal Startposition, Geschwindigkeit,
  Geburtszeit, Lebensdauer, Effekt-Index und Tönung in einen Ringpuffer. Position (Schwerkraft, Luftwiderstand), Farbe,
  Alpha und Größe über die Lebenszeit berechnet der Vertex-Shader aus einer Kurventabelle (Float-Textur, 3 Zeilen je Effekt).
  Pro Frame macht die CPU nur: Zeit-Uniform setzen, die neu beschriebenen Slots hochladen (Teilbereich je Klassen-Segment).
- **Zwei Draw Calls** für alle Partikel des Spiels: eine Alpha-Schicht (`blend: normal`) und eine additive (`blend: add`).
- **Gepoolt, keine Allokation im Hot Path:** feste Typed Arrays, `emit()` allokiert nicht (Test misst das), Zufall aus
  einem eigenen xorshift (`seed()` für Tests).
- **Harte Grenzen** (Zahlen in `schema.ts`):

  | Klasse | Ring je Schicht | max. Spawns je Frame | Zweck |
  |---|---|---|---|
  | `projectile` | 1024 | 160 | Schweife von Geschossen |
  | `hit` | 1024 | 300 | Treffer, Würfe, Tod, Level-up |
  | `aura` | 1024 | 160 | Auren, Bodenflächen, Dauerzonen |
  | `telegraph` | 512 | 120 | Warnfunken an Telegraph-Rändern |
  | `ultimate` | 1024 | 400 | Ultimates |

  Ist ein Ring voll, wird das älteste Partikel überschrieben. Dazu gilt je Effekt `maxLive` (nie mehr gleichzeitig lebende
  Partikel dieses Effekts; Überschuss wird verworfen und in `stats.dropped` gezählt). `maxLive` darf die Klassengröße nicht
  überschreiten, `count` nicht das Frame-Budget (Validator).
- **Reduce Motion:** `VfxSystem.scale` (Fx setzt 0,35) dünnt jeden Burst aus.

## 2. Felder einer Effektdatei

```jsonc
{
  "_doc": "Freitext, wird ignoriert",
  "id": "hit_spark",                 // = Dateiname, [a-z][a-z0-9_]{1,40}
  "class": "hit",                    // projectile | hit | aura | telegraph | ultimate  (Standard-Pool)
  "blend": "add",                    // add (leuchtet, summiert) | normal (Alpha, bleibt auf hellem Boden sichtbar)
  "glyph": "spark",                  // dot | spark | ring | shard | smoke | streak | cross | wisp
  "tint": { "mode": "team" },        // none | hue | team, siehe 3.
  "life": [140, 260],                // ms, je Partikel zufällig dazwischen
  "count": 6,                        // Standardmenge eines emit()-Aufrufs
  "emitter": { "shape": "point", "jitter": 6, "jitterH": 4 },
  "velocity": { "dir": "radial", "speed": [120, 360], "rise": [0, 80], "back": 0 },
  "gravity": 0, "drag": 4,           // Weltenheiten/s² nach unten; 1/s Luftwiderstand
  "size": [90, 150],                 // Weltenheiten (perspektivisch verkleinert wie THREE.PointsMaterial)
  "sizeOverLife":  [[0, 1], [1, 0.3]],                       // Faktor auf size
  "colorOverLife": [[0, "#ffffff"], [1, "#ffe2b0"]],         // wird mit der Tönung multipliziert
  "alphaOverLife": [[0, 1], [0.6, 0.8], [1, 0]],
  "flicker": 0,                      // 0..1 Tiefe des Flackerns
  "spin": [-8, 8],                   // rad/s
  "maxLive": 256
}
```

Kurven (`*OverLife`): 2 bis 16 Stützstellen `[t, Wert]`, t aufsteigend, erste bei 0, letzte bei 1, dazwischen linear.

**Emitter-Formen** (`emitter.shape`): `point` (Quadrat `jitter`/`jitterH` um den Punkt), `disc` (gleichverteilt in `radius`),
`ring` (Rand bei `radius`, nach innen `thickness` dick), `line` (von (x,y) nach `x2,y2` des Aufrufs), `cone` (Spitze am
Punkt, Achse `dx,dy`, voller Öffnungswinkel `angle` in Grad, Reichweite `radius`). `height` ist der Höhenbereich über dem
Aufrufpunkt.

**Richtung** (`velocity.dir`): `radial` (zufällig in der Ebene), `outward` / `inward` (vom/zum Emittermittelpunkt),
`forward` (entlang `dx,dy`, gestreut um `emitter.angle`). `speed` wird mit dem `spread` des Aufrufs multipliziert, `rise`
ist die Vertikalgeschwindigkeit, `back` schiebt die Partikel gegen `dx,dy` (Schweif).

## 3. Tönung

- `none`: Farbe nur aus `colorOverLife`.
- `hue`: HSL aus dem Element-Farbton des Aufrufs (`hue` 0..360) mit `saturation`, `lightness`, Streuung `hueJitter` (Grad)
  und `lightnessJitter`. So bekommen Fähigkeiten ihre Elementfarbe (`abilityTheme.ts`).
- `team`: Beziehungsfarbe aus `palette.ts` (`REL.ownShot` blau / `REL.enemyShot` rot, folgt dem Farbmodus für Farbenblinde);
  `neutral` = ungetönt. Der Aufruf gibt `team: 'own' | 'enemy' | 'neutral'` an.

## 4. Effekt abspielen

```ts
// Fx besitzt particles.vfx (VfxSystem) und bus (VfxBus)
fx.particles.vfx.emit('hit_spark', x, y, h, now, { team: 'enemy', count: 8 });   // direkt; Handle statt Id im Hot Path
const hSpark = fx.particles.vfx.handle('hit_spark');                              // einmal auflösen
```

`EmitOpts`: `count`, `hue`, `team`, `dx/dy` (Flug-/Blickrichtung, Einheitsvektor in Sim-Koordinaten), `spread`, `radius`
(überschreibt den Emitterradius), `x2/y2` (Linie), `cls` (anderer Klassen-Pool als der Standard). Das Objekt wird nicht
behalten: im Hot Path ein Objekt wiederverwenden, wie `Fx` es tut.

**Alte Aufrufe bleiben:** `Particles.emit('ember' | 'spark' | 'drip' | 'mote' | 'shard' | 'blackflame', ...)` (fx.ts,
groundObjects.ts) ist jetzt eine Fassade auf `VfxSystem`. Die Emissionsraten (`trail`, `burst`, `ambient`) bleiben in
`abilityMotifs.json`, das Aussehen steht in den gleichnamigen Effektdateien.

## 5. Abonnier-Schnittstelle (für A3 Animation und A8 Game Feel)

`fx.bus` (`src/render/vfx/bus.ts`) verbindet Auslöser mit Effekten. Wer ein Ereignis kennt, ruft nur `trigger`:

```ts
const off = world.fx.bus.on('hitFrame', (ev) => { /* eigene Reaktion, z. B. Kamera-Ruck (A8) */ });
world.fx.bus.trigger('hitFrame', { x: target.x, y: target.y, h: 70, team: 'own', hue: 22, now });
world.fx.bus.trigger('release',  { x: caster.x, y: caster.y, dx, dy, hue, team, slot: 2, now });   // Zauber-Release-Frame
```

Gebundene Auslöser (`src/render/vfx/bindings.json`, Datei ändern genügt): `hitFrame` (Treffer-Frame eines Auto-Angriffs),
`release` (Cast-Release-Frame), `impact` (bestätigter Fähigkeitstreffer), `ultimate`, `death`, `levelUp`. Eintrag:
`{ "effect": "id", "count"?, "cls"?, "h"?, "radius"?, "team"?: ["own"|"enemy"|"neutral"], "minSlot"?: n }`. Freie Auslöser
ohne Eintrag erreichen nur `on`-Handler.

Heute löst `Fx` aus Sim-Ereignissen `hitFrame` (Auto-Angriffe zwischen Champions), `ultimate` (Cast Slot 3+), `death` und
`levelUp` selbst aus. Sobald A3 den Treffer-Frame der Sprites veröffentlicht, setzt A3/Integrator
`world.fx.animatedHits = true`; dann entfällt der sim-getriebene Funke und `hitFrame` kommt nur noch aus der Animation.

## 6. Lesbarkeit vor Spektakel (Zeichenreihenfolge, `src/render/vfx/order.ts`)

- Transparente Objekte werden nach `renderOrder` sortiert. Partikel schreiben keine Tiefe, also überdeckt, was **später**
  gezeichnet wird, alles davor, egal wo es im Raum liegt.
- **Gegnerische Telegraphs** (Füllung 8, Rand 9) liegen über **allem** anderen (eigene Telegraphs 2/3, Säulen 4, Partikel 5/6,
  Bodenobjekte 3). Kein eigener, verbündeter oder neutraler Effekt kann einen gegnerischen Skillshot oder eine
  Bodenfläche verdecken. Pings (10) und der Angst-Vignette (100) bleiben darüber. Test: `tests/vfxReadability.test.ts`.
- Der gegnerische Rand bleibt, solange er gezeigt wird, mindestens `readability.json telegraph.enemyRimMin` (0,85) deckend
  (auch Dash-Projektionen) und trägt die Gegnerfarbe (`REL.enemyShot`, bei der Umriss-Einstellung `REL.enemy`).
- Gegnerische Telegraphs bekommen zusätzlich rote Warnfunken am Rand (`telegraph_warn`, Klasse `telegraph`,
  `telegraph.warnRate` = 22/s je Form). Sie liegen unter dem Rand und ändern die Hitbox-Fläche nicht.

## 7. Neuen Effekt anlegen

1. `src/render/vfx/effects/<id>.json` schreiben (Vorlage: ein ähnlicher Effekt).
2. `npx vitest run tests/vfx.test.ts` (Validator, Klassengrenzen).
3. Per Aufruf (4.) oder Binding (5.) abspielen. Keine Codeänderung nötig.
