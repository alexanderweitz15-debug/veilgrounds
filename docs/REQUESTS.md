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
