# Changelog

Ein Eintrag pro abgeschlossener Aufgabe: **was**, **warum**, **wie getestet**. Neue Einträge oben.

---

## A1 – Asset- und Render-Pipeline: Grafiken laden zuverlässig (2026-10-24, Branch `feat/a1-asset-pipeline`)

**Was war.** „Grafiken laden nicht zuverlässig“. Es gibt keine Bilddateien (alles wird prozedural gemalt, `docs/ART.md`),
also war es kein 404-Problem. Gefunden und belegt:

1. **Champion ohne Sprite-Kit lässt den ganzen Champion-Atlas scheitern** (reproduziert auf main im Browser).
   `src/data/champions/fenna.json` steht im Roster, `kits.ts` hat kein Kit für `fenna`. `renderMaster` wirft
   `unknown champion 'fenna'`, der Worker-Pool fällt auf den Hauptthread zurück, wirft dort wieder, `game.ts` fängt das
   ab: **kein** Champion im Match hat ein gemaltes Sprite (alle Platzhalter-Blobs). 105 von 400 klassischen Seeds (26 %)
   enthalten Fenna als Bot. Messung auf main (Seed 1008, Produktionsbuild, Chromium): `champion atlas failed, keeping
   placeholder sprites Error: unknown champion 'fenna'`.
2. **Die Sim startete vor Minions und Monstern.** `game.ts` wartete nur auf den Champion-Atlas; Minion- und
   Monster-Atlas wurden danach gebacken (main, Seed 1000, kalt: erster Tick bei 22 s mit `minions: null, monsters: []`,
   Monster erst nach 25 s). Lane-/Sandbox-/Trainer-Modi gehen direkt in `game.ts`, ohne Ladebild.
3. **Kein Timeout im Worker-Pool.** `bakeInWorkers` wartete auf `left === 0`; ein Worker, der nie antwortet (oder
   `messageerror`), ließ den Ladebildschirm ewig stehen.
4. **Atlas-Größe:** 10 Champions + Hark = 1285 Zellen à 152 px -> 8192x4096 = 33,5 Mpx, über dem Canvas-Limit von
   Safari/iOS (16.777.216 px = 4096x4096; darüber zeichnet der Canvas still nichts: unsichtbare Champions). In Chromium
   (Limit 268 Mpx) **nicht reproduzierbar**; belegt nur über Test der Layout-Mathe und eine Emulation (siehe unten).
5. **Alte Chunks nach einem Deploy:** ein offener Tab mit altem Build lädt einen nicht mehr vorhandenen Lazy-Chunk
   („Failed to fetch dynamically imported module“), `vite:preloadError` wurde nicht behandelt.
6. **Schriften** kamen als render-blockierendes Stylesheet von `fonts.googleapis.com`.

**Was jetzt.**
- `src/render/loader/` (neu): `preloader.ts` (ein Promise für Champion-, Minion-, Monster-Atlanten mit gewichtetem
  Gesamtfortschritt), `pipeline.ts` (Schritte mit No-Progress-Wächter 30 s, hartem Limit 90-150 s, Fallback,
  nachgelieferter echter Atlas via `onLate`, Schritte pro Sitzung geteilt), `manifest.ts` (alle prozeduralen Asset-Ids,
  Prüfung beim Start und im Test), `placeholder.ts`/`checker.ts` (pink/schwarzes Schachbrett), `layout.ts` und
  `canvasProbe.ts` (Flächenlimit), `preloadError.ts` (ein geschützter Reload), `progressBar.ts`.
- `game.ts`: Sim bleibt pausiert, bis `preloadMatch` fertig ist; Fortschrittsbalken in der Abdeckung. `classicLobby.ts`:
  Ladebild nutzt denselben Preloader (Balken statt Text), 20-s-Kappe entfällt (der Preloader löst immer auf).
- `champions/atlas.ts`: Ids ohne Maler werden nicht gebacken, sondern zeigen das Schachbrett (reservierte letzte Zelle,
  `ChampionAtlas.placeholders`); wirft ein Maler, ist nur diese Id betroffen und wird nicht gecached; Worker-Pool:
  `stallMs` (20 s), `onmessageerror`, Fehlermeldung je Zelle aus `spriteWorker.ts`; `planAtlas` (exportiert) mit
  `maxArea`. `sheets.ts`: Flächenlimit per Laufzeit-Test (`canvasKeepsPixels` auf 8192x2049 px) und Nachbacken, wenn der
  Atlas leer ausliest; Strip-Cache wird über einen CPU-Canvas gelesen (warme Monster-Atlanten 14,4 s -> 7,8 s im
  Sandbox-Chromium); der Leerlauf-Vorbackdurchlauf backt auch Monster und Pflanzen vor.
- `main.ts`: `vite:preloadError` -> ein Reload (sessionStorage-Zeitstempel, 60 s), sonst Banner „Neue Version“.
- Schriften selbst gehostet (`public/fonts`, OFL, `docs/ASSETS-LICENSES.md`), `index.html` ohne Google-Fonts;
  `public/sw.js` v2 (nur Same-Origin, Navigations-Timeout 4 s, nur Status 200 cachen).
- `README.md`, `docs/ART.md`, `docs/ASSETS-LICENSES.md`, `docs/REQUESTS.md` (R1 Terrain-Signal, R2 `toDataURL`-Sync in
  `icons.ts`, R3 Fenna ohne Kit). i18n additiv: `loading.graphics`, `loading.degraded`, `loading.waitGraphics`,
  `error.newVersion`, `error.reload` (de + en).

**Wie getestet.** Neue Tests (rot vor dem Fix, danach grün): `tests/loaderLayout.test.ts` (10-Champion-Atlas
8192x4096 = 33,5 Mpx -> mit Limit 8192x2048 @112), `loaderWorker.test.ts` (stummer Worker, `messageerror`, `error`-Event,
Maler-Fehler, Id ohne Kit; ohne Wächter hängt der Stumm-Test, gemessen mit `stallMs: 1e9`), `loaderPipeline.test.ts`,
`loaderPreloadError.test.ts`, `loaderPlaceholder.test.ts`, `assetManifest.test.ts` (jeder Roster-Champion hat Kit und
Frames; Ausnahme `fenna` ist eingetragen). Browser: Produktionsbuild, headless Chromium (SwiftShader), siehe Bericht des
Agenten in der Übergabe: kalt/warm, Hauptmenü-Pfad, Emulation des Safari-Canvas-Limits, hängende Worker, fehlender Chunk.
Nicht belegt: echtes Safari/iOS (keine Hardware), Terrain-Fertigsignal (R1).
