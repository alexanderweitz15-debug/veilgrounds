# Anfragen an Besitzer und Integrator

Format: `## R<nr> – <von> → <an>: <Thema>` · Status `offen` / `beantwortet` / `abgelehnt` · Antwort direkt darunter.
Neue Einträge unten. Der Integrator (A29) beantwortet oder leitet weiter.

---

## R1 – A1 → Terrain-Besitzer (src/render/terrain.ts): „Boden fertig“-Signal für den Preloader · offen

`groundTexture()` (terrain.ts ~Zeile 865) liefert zuerst eine 4-px-Flachfarbe und tauscht das 4096²-Bild erst, wenn es
aus IndexedDB dekodiert oder (kalt, ~2 s auf dem Hauptthread) gemalt ist. Der Preloader (`src/render/loader/preloader.ts`)
hat dafür schon die Option `terrainReady?: () => Promise<void>` mit Fortschrittsanteil und Timeout, kann das Signal aber
nicht selbst erzeugen. Bitte additiv: in `groundTexture` ein Promise erzeugen, das nach `use(...)` bzw. nach dem
synchronen `paint()` auflöst, und es über `Terrain.ready: Promise<void>` (Interface in terrain.ts) und
`World.terrainReady(): Promise<void>` herausgeben. Danach in `game.ts` `preloadMatch({ ..., terrainReady: () =>
this.world.terrainReady() })` setzen (eine Zeile, A1 macht das gern, sobald das Signal existiert). Heute ist die
Ladebild-Abdeckung (`.boot-cover`) bis zum ersten Snapshot sichtbar; der Boden hat in der Praxis zu diesem Zeitpunkt
fast immer sein Bild, aber garantiert ist es nicht.

## R2 – A1 → UI-Besitzer (src/ui/icons.ts): synchrone Pixel-Rückleser beim Spielstart · offen

`cached()` in `src/ui/icons.ts` ruft `canvas.toDataURL()` synchron auf (erster Aufruf aus dem `Hud`-Konstruktor, dann
einmal je Icon). `toDataURL` synchronisiert mit der GPU; auf einer ausgelasteten (Software-)GPU wurde daraus ein
37-s-Stillstand des Hauptthreads beim Spielstart (Messung des Integrators, verschwindet mit
`--disable-accelerated-2d-canvas`). Gleiches Muster in `src/render/portraits.ts` (`toDataURL` je Porträt). Vorschlag: die
Icon-Canvases mit `willReadFrequently: true` anlegen (CPU-Backing, kein GPU-Sync) und/oder `OffscreenCanvas.convertToBlob` +
`URL.createObjectURL` statt Data-URL, und die Icons des Spielstarts über denselben Preloader vorwärmen lassen.
A1 hat die Dateien nicht angefasst.

## R3 – A1 → A26 / Champion-Besitzer: Fenna hat kein Sprite-Kit · offen

`src/data/champions/fenna.json` ist auf dem Roster („champ-support #29“), aber `src/render/champions/kits.ts` hat kein
Kit für `fenna`. Folge auf main (vor A1): `renderMaster` wirft `unknown champion 'fenna'`, der gesamte Champion-Atlas
des Matches scheitert, **alle** Champions im Match zeigen Platzhalter-Blobs. Betroffen sind ~26 % der klassischen
Matches (105 von 400 Seeds enthalten Fenna als Bot). A1 hat das abgefangen (Fenna wird als pink/schwarzes Schachbrett
gezeichnet, der Rest bleibt gemalt, `console.warn`), das ist aber nur der Notbehelf: Fenna braucht ein Kit (oder bis dahin
eine Sperre in Lobby und Bot-Auswahl). `tests/assetManifest.test.ts` führt `fenna` in `KNOWN_WITHOUT_ART`; Eintrag
entfernen, sobald das Kit existiert.

## R-A3a – A3 → A1 (Atlas-Loader/Cache, `src/render/atlasStrip.ts`): Frame-Layout in den Streifen-Schlüssel · offen

`stripKey(id, master, frame, mirror)` enthält die Frame-Zahlen einer Id nicht. Heute reicht das, weil die Cache-Version der
Hash des `sheets`-Chunks ist (jeder Build verwirft den Cache). Ändert A11/A26 `kit.frames` einer Id, ändert sich das
Streifen-Layout; sobald die Cache-Version nicht mehr chunk-gehasht ist, würden veraltete Streifen falsch dekodiert.
`layoutKey(frames)` (`src/render/anim/data.ts`, z. B. `'4.8.5.4.3'`) liefert den Fingerabdruck. Bitte additiv an
`stripKey` hängen (`${id}@${master}-${frame}${mirror?'':'-m8'}#${layoutKey}`) in `atlas.ts`/`sheets.ts`, wo `framesOf` je Anim
vorliegt. A3 hat die Loader-/Cache-Teile nicht angefasst.

## R-A3b – A3 → Sim-Besitzer (`src/sim/snapshot.ts`): Rückruf je Entity im Snapshot · offen

`SnapEntity` trägt keinen Rückruf-Zustand; `snap.me.recallLeft` gilt nur für den eigenen Champion. Der Rückruf-Pose (Cast-Frames
0/3 gehalten) und die Events `recallStart`/`recallEnd` gibt es deshalb nur für den eigenen Champion. Bitte additiv
`recalling?: true` an `SnapEntity` (nur sichtbare Champions, `Champ.recallAt[e] > sim.tick`); danach setzt A3 die Zeile
`inp.recalling = e.recalling || e.id === this.recallEid` in `ChampionSprites.push` (eine Zeile). Enthüllt nichts, was die
Sichtbarkeit nicht schon verrät (der Rückruf-Kanal ist in LoL für alle sichtbar).
## R-A4-1 – A4 → A3 (Animation) und A8 (Game Feel): VFX-Trigger anschließen · offen

`world.fx.bus` (`src/render/vfx/bus.ts`, Format: docs/VFX-FORMAT.md §5) ist die Abonnier-Schnittstelle der VFX.
A3: wenn der Sprite-Treffer-Frame (`hitFrame`) und der Cast-Release-Frame (`release`) feststehen, dort
`world.fx.bus.trigger('hitFrame' | 'release', { x, y, h, dx, dy, hue, team, slot, now })` aufrufen (Sim-Koordinaten, `team`
relativ zum Betrachter: `'own' | 'enemy'`) und einmalig `world.fx.animatedHits = true` setzen, damit der sim-getriebene
Auto-Angriffs-Funke nicht doppelt erscheint. A8: `world.fx.bus.on('impact' | 'hitFrame' | 'death', handler)` für Kamera-Ruck,
Hit-Stop usw.; neue Effekte brauchen nur eine JSON-Datei und einen Eintrag in `src/render/vfx/bindings.json`.
Der Aufruf liegt in `units.ts`/`world.ts`/`championSprites.ts` (nicht A4-Besitz), deshalb als Anfrage.
## R4 – A7 → UI-/i18n-Besitzer (src/i18n/*.json, src/ui/shop.ts): Beschriftung der neuen Item-Werte · offen

Die Item-Engine (docs/ITEMS-FORMAT.md) kennt drei neue Item-Werte, die A12 für Anti-Heal/Anti-Tank/Anti-CC-Items nutzen wird:
`armorPenPct` (Prozent-Rüstungsdurchdringung), `magicPen` (flache Magiedurchdringung), `tenacityPct` (Zähigkeit in Prozentpunkten).
Der Shop zeigt Werte als `t('stat.<key>')`; ohne Eintrag erscheint der rohe Schlüssel. Bitte in `de.json`/`en.json` ergänzen
(`stat.armorPenPct` „Rüstungsdurchdringung“ / „Armor penetration“, `stat.magicPen` „Magiedurchdringung“ / „Magic penetration“,
`stat.tenacityPct` „Zähigkeit“ / „Tenacity“) und in `src/ui/shop.ts` `PCT` um `armorPenPct` und `tenacityPct` erweitern
(Anzeige „+30 %“). Kein Live-Item nutzt die Werte heute, nichts ist kaputt; die Anfrage wird mit dem ersten A12-Item fällig.
Außerdem (nur zur Kenntnis): Aktive mit Einheitenziel (`target: "enemyChampion"` / `"allyChampion"`) wählen die Einheit über die
Item-Befehls-Koordinaten (`{ t: 'item', slot, x, y }`, nächste passende Einheit zum Punkt, sichtbar und in `range`). Der Controller
schickt den Mauszeiger-Punkt bereits mit (`src/input/controller.ts`); eine Zielanzeige (Reichweitenring) wäre ein UI-Wunsch.
