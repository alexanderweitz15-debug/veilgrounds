# Wie die Grafik entsteht (Art-Pipeline, Stand 2026-10-24)

Kurzfassung für Art-Agenten (A11 Champion-Art, A26 neue Champions): **Es gibt keine Bilddateien.** Alle Sprites
(Champions, Minions, Monster, Pflanzen, Hark), alle UI-Icons, Porträts und das Terrain werden zur Laufzeit im Code mit
Canvas 2D gemalt. „Neue Art“ heißt Code schreiben (Kits, Props, Drawer), nicht Bitmaps liefern. `public/` enthält nur
App-Icon, Manifest, Service-Worker und Schriften (`public/fonts`).

## 1. Champion-Sprites: Paper-Doll-Rig -> Master -> Zelle -> Atlas

Dateien in `src/render/champions/`:

| Datei | Inhalt |
|---|---|
| `types.ts` | `Kit` (was ein Champion ist), `BodySpec`, `Outfit`, `Pose`, Enums für `Hold`/`AttackStyle`/`CastStyle`, `ANIMS`, `DIRS` |
| `kits.ts` | `KITS`: ein `kit({...})`-Aufruf je Champion: Körper, Outfit, Palette, Halteweise, Angriffs- und Zauberstil, Props. `WORLD_SCALE` skaliert die Weltgröße |
| `humanoid.ts`, `core.ts` | Rig lösen (`solveRig`, IK), Teile zeichnen (`drawHumanoid`), Mathe, orthografische Paper-Doll-Projektion, Gouache-Maler (`Painter`: 3 harte Wertstufen, kühle Violett-Schatten, warmes Rim-Licht, dünne Innenlinien) |
| `anim.ts` | `poseFor(kit, anim, frame)`: Posen je Frame, Frame-Zahlen (`FRAMES`, `LEGACY_FRAMES`), Raten, `ATTACK_HIT`, `CAST_RELEASE`, `CAST_FLEX` |
| `props.ts`, `props2.ts` | Signaturgegenstände (Klingen, Bögen, Spulen ...) als Maler-Funktionen |
| `beast.ts`, `wolf.ts`, `cavalry.ts` | Nicht-Humanoide: Beast-Teile, Hark (Ottilies Wolf, `drawWolf`, `HARK`), Vargrim (Reiter, `VARGRIM_DRAWER`) |
| `sev.ts` | Props für Sev (Krähen, Augen, Haare; sein Kit steht in `kits.ts`) |
| `minions.ts`, `monsters.ts` | Minions (`MINION_KITS`, `MINION_DRAWERS`), Dschungel-Monster und Pflanzen (`MONSTER_DRAWERS`, `MONSTER_SPRITE`, `BIG_MONSTER_IDS`, `CAMP_MONSTER_IDS`) |
| `atlas.ts` | Öffentliche API: `renderMaster`, `renderCell`, `planAtlas`, `buildChampionAtlas(Async)`, `framesOf`, `rendererOf` ... |

Weg eines Frames (`atlas.ts`):

1. **Master:** `renderMaster(id, anim, yaw, frame, res)` malt die Figur auf ein Master-Canvas (`res` = 240 px für
   Champions, 144 px Minions, 320 px große Monster, 192 px Camp-Monster). Eine Standardfigur ist ~180 px von Sohle bis
   Scheitel im 256er-Raster. Danach `finishFigure`: Kontur-Tinte, Rim-Licht, Kantenlicht, ggf. Schlag-Smear.
2. **Zelle:** `renderCell` skaliert den Master auf `(Zelle - 2)²` herunter (1 px Rand je Seite gegen Mip/AlphaTest-Bluten).
   Zellgrößen (Kantenlänge): Champions **152 px**, Minions 96, große Monster/Buffs/Epics 200, Camp-Monster und
   Pflanzen 128 (`src/render/sheets.ts`).
3. **Atlas:** alle Zellen eines Ids-Satzes werden in eine Zweierpotenz-Textur gepackt (`planAtlas`, Layout-Mathe in
   `src/render/loader/layout.ts`). Pro Champion-Match: die Champions des Matches (+ Hark, wenn Ottilie dabei ist), also
   bis zu 10 Champions + Hark in **einer** Textur. Dazu ein Minion-Atlas (8 Sprites) und zwei Monster-Atlanten
   (`big` 4096², `camp` 4096x2048). Eine reservierte letzte Zelle jedes Atlas ist das Platzhalter-Schachbrett.
4. **Rendern:** `src/render/championSprites.ts` (`ChampionSprites`) ist ein `InstancedMesh`; je Instanz wählt ein
   UV-Rechteck (`aUvRect`) den Frame. `src/render/units.ts` hält je einen Batch für Champions, Minions, Monster.

**Richtungen und Spiegeln:** 8 Richtungen (`S SE E NE N NW W SW`). Gemalt werden nur 5 (`S SE E NE N`); `W`, `SW`, `NW`
sind die gespiegelten Zellen von `E`, `SE`, `NE` (UV `u0/u1` vertauscht, `flip = true`; Option `mirror`). Deshalb liegt
das Rim-Licht fest oben (`SUN_RIM`), nicht seitlich.

**Frame-Zahlen** (`anim.ts`): Champions `idle 4, run 8, attack 5, cast 4, death 3` = 24 Frames x 5 Richtungen = 120
Zellen je Champion. Altes Layout (Hark, Minions): `4/6/4/0/3` (kein Cast). Monster `3/4/3/0/3` (Mooswolf `4/6/4/0/3`),
Pflanzen `2/0/0/0/2`. Ein Kit kann Frames je Anim überschreiben (`kit.frames`). Der Treffer-Frame ist `ATTACK_HIT = 2`;
das Spiel dehnt Attack/Cast-Frames über den echten Wind-up der Sim (`spriteTiming.ts`): Die Animation richtet sich
nach der Sim, nie umgekehrt.

**Jobs und Worker:** `planAtlas` erzeugt eine Job-Liste (Id x Anim x Richtung x Frame). `src/render/spriteWorker.ts`
(Modul-Worker) rendert Zellen als `ImageBitmap`; `bakeInWorkers` verteilt reihum auf `min(6, Kerne-1, Jobs/30)` Worker.
Fällt ein Worker aus, antwortet unlesbar (`messageerror`) oder schweigt 20 s, wird auf dem Hauptthread gebacken. Wirft
ein Maler für eine Id, wird nur diese Id zum Schachbrett (Rest des Atlas bleibt), mit `console.warn`.

**Caching:** `src/render/atlasStore.ts` speichert je Sprite-Id einen PNG-Streifen (`STRIP_COLS = 16` Zellen je Zeile,
`src/render/atlasStrip.ts`) in IndexedDB (`veilgrounds-atlas`/`strips`). Schlüssel `<id>@<master>-<zelle>` (`stripKey`),
Version = Hash der URL des gebauten `sheets`-Chunks (jede Code-Änderung im Bundle verwirft den Cache; der Dev-Server
cached nicht). Ein warmer Start dekodiert nur Streifen. Das Terrain-Bodenbild (`ground-4096`) liegt im selben Store.
Während das Hauptmenü im Leerlauf ist, backt `precacheRoster` (sheets.ts) alle Champions einzeln vor.
Hinweis: Eine vom Canvas-Limit verkleinerte Zelle (siehe unten) wird beim Platzieren aus dem 152er-Streifen skaliert.

**Canvas-Grenze:** Safari/iOS zeichnet in Canvases über 16.777.216 px (4096x4096) still nichts (Champions unsichtbar).
Ein Match mit 10 Champions braucht bei 152 px **8192x4096 = 33,5 Mpx**. `src/render/loader/canvasProbe.ts` prüft zur
Laufzeit, ob ein Canvas knapp über der Grenze Pixel behält; wenn nicht (oder wenn der gebackene Atlas leer ausliest),
plant `planAtlas({ maxArea: 16_777_216 })` kleinere Zellen (10 Champions: 8192x2048 bei 112 px). Chromium/Firefox
behalten 152 px.

## 2. Alles andere ist ebenfalls Code

| Was | Wo | Wie |
|---|---|---|
| Fallback-Blob-Sprites (alt, Platzhalter bis ein Atlas da ist) | `src/render/sprites.ts` | ein 256er-Atlas mit flachen Figuren, `SPRITE_KEYS` |
| Fehlende Assets | `src/render/loader/checker.ts`, `placeholder.ts` | pink/schwarzes Schachbrett + `console.warn` |
| Porträts (Lobby, Ladebild) | `src/render/portraits.ts` | Kopf-Ausschnitt aus `renderMaster` (512 px), 128 px Data-URL, lazy, im Speicher gecached |
| Item-/Fähigkeits-/Summoner-Icons | `src/ui/icons.ts` | 64-px-Canvas, Motiv aus `abilityTheme`/`abilityMotifs.json`, Data-URL als CSS-Hintergrund |
| Terrain | `src/render/terrain.ts` | gemaltes 4096²-Bodenbild (Pinselstriche, Wege, Fluss) + Klippen, Kiefern, Kristalle als Meshes |
| Türme, Inhibitoren, Nexus | `src/render/structures.ts` | zusammengeführte Three.js-Meshes im Stil C (Lichtwerk blau / Aschehalle rot) |
| Effekte, Partikel, Telegraphs | `fx.ts`, `particles.ts`, `telegraph.ts`, `sevFx.ts`, `pings.ts` | Three.js-Meshes/Instanzen, keine Texturen |
| Töne | `src/audio/` | prozedural (Web Audio), keine Dateien |

## 3. `src/render/champions3d`: **nicht benutzt**

Der Ordner (8 Dateien, ~3.400 Zeilen, Three.js-Mesh-Humanoide mit Skelett: `rig.ts`, `mesh.ts`, `anim.ts` ...) wird von
**keiner** Datei importiert (`grep -rn champions3d src tests tools` trifft nur eine Fehlermeldung im Ordner selbst).
Er wird nur von `tsc` geprüft, kommt nicht ins Bundle und beeinflusst nichts, was auf dem Bildschirm zu sehen ist.
Wer Champion-Optik ändert, arbeitet in `src/render/champions/`, nicht dort. (Ob der Ordner gelöscht werden soll, ist
Sache des Integrators; A1 hat ihn nicht angefasst.)

## 4. Was ein Art-Agent konkret tut

- **Champion ändern:** `kit({...})` in `kits.ts` (Körper, Outfit, Props, Stile) und ggf. neue Props in `props*.ts`.
  Kein Asset-Import, kein Build-Schritt. Prüfen mit `tests/assetManifest.test.ts` (Kit und Frame-Zahlen vorhanden) und
  im Spiel (`?play=classic`), der Atlas-Cache invalidiert sich beim nächsten Build selbst.
- **Neuer Champion:** JSON in `src/data/champions/<id>.json` (Sim-Werte), Hooks in `src/sim/champions/<id>.ts`, **und**
  ein Kit in `kits.ts` (oder ein `SpriteDrawer` wie `cavalry.ts`/`sev.ts`). Ohne Kit zeichnet das Spiel den Champion als
  pink/schwarzes Schachbrett und warnt (`[assets] no-renderer: ...`); der Test `assetManifest` führt die Champions ohne
  Art in `KNOWN_WITHOUT_ART` (heute: **fenna**) und schlägt fehl, sobald ein neuer ohne Kit dazukommt oder wenn Fenna
  ihr Kit bekommt (Eintrag dann entfernen).
- **Neue Monster/Minions:** `SpriteDrawer` in `monsters.ts` bzw. `minions.ts` registrieren (`frames`, `world`, `foot`,
  `draw`) und die Id in `BIG_MONSTER_IDS`/`CAMP_MONSTER_IDS` bzw. `MINION_IDS` eintragen.
- **Bitmap-Assets** gibt es nicht und sind nicht vorgesehen; wer welche einführen will, braucht erst einen Eintrag in
  `docs/DECISIONS.md` (Ladeweg: `public/` + `src/render/loader/manifest.ts` erweitern).

## 5. Ladeweg und Fehlerverhalten (A1)

`src/render/loader/preloader.ts` lädt alles, was ein Match zeichnet, in einem Promise mit gemeinsamem Fortschritt:
Champion-Atlas, Minion-Atlas, Monster-Atlanten (Reihenfolge, weil sie sich einen Worker-Pool teilen). Die Sim startet
erst danach (`game.ts`, Ladebild `classicLobby.ts`). Jeder Schritt hat einen Wächter (30 s ohne Fortschritt) und ein
hartes Limit (90-150 s); danach `console.warn` und ein Schachbrett-Atlas, der durch den echten ersetzt wird, falls er
doch noch fertig wird. Beim Start prüft `src/render/loader/manifest.ts` jede Sprite-Id (Maler vorhanden? Frames je
Anim > 0? löst jeder Sim-Monstertyp auf einen gebackenen Sprite auf?) und meldet Lücken einmal mit `console.warn`.
