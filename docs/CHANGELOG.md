# Changelog

Ein Eintrag pro abgeschlossener Aufgabe: **was**, **warum**, **wie getestet**. Neue Einträge oben.

---

## 2026-10-26 · Welle 1 + Gehirn (A3, A4, A5, A6, A7, A13, A14) · Integrator-Zusammenfassung

Details, Messwerte und offene Punkte je Agent: `docs/agents/wave1-a<nr>.md`.

- **A3 Animation:** Zustandsmaschine je Einheit (Ausholen/Treffer/Ausklingen, Cast je Art, Recall, Zucken, Tod),
  Angriffstempo skaliert die Animation, Cast-Abbruch durch CC sichtbar, Animations-Events; Format `docs/ANIM-FORMAT.md`.
- **A4 VFX:** GPU-Partikel datengetrieben (20 Effekte, `docs/VFX-FORMAT.md`), harte Obergrenzen, gegnerische Telegraphs
  immer oben; CPU je Frame ~0,2 ms -> ~0,01 ms, Draw-Calls 6 -> 2. Integrator-Fix: Teamfarbe wurde je Effekt neu geparst
  (~110 Byte Müll je Aufruf -> ~3), Allokationstest deterministisch.
- **A5 Audio:** Busse SFX/UI/Ambient/Musik mit Reglern, räumlicher Sound, Stimmenlimit (global 20), Trigger-API; `docs/AUDIO.md`.
- **A6 Benchmark:** `tools/benchmark` (run/report/compare, ~15 Kennzahlen, Bootstrap-Fehler), Baseline beider Gehirne
  `docs/BENCHMARK-BASELINE.md` (dünn: 4 Partien je Rang).
- **A7 Item-Engine:** Items vollständig datengetrieben (11 Auslöser, 17 Effekte, Validator); alle 47 Items bit-genau
  unverändert (93 Golden-Tests, 84 Prüfpunkte in Bot-Partien); `docs/ITEMS-FORMAT.md`.
- **A13 Gehirn Kampf (nur Beta):** Bot-Hints je Champion (generiert, `src/data/bots/hints/`), Zielvorhersage, Ausweichen,
  Fokus/Peel. Combo-Executor und Spacing sind standardmäßig **aus**, weil sie in den Messungen des Agents schlechter waren.
- **A14 Gehirn Makro (nur Beta):** Leerlauf zuerst (Farm-/Ward-Fallback, Leerlauf-Gründe im Log), Wellenzustände steuern
  die Reflex-Schicht, Shop-Phantomgold-Fix; letzter Stand als WIP gesichert.
- **Nicht erfüllt:** A13/A14 brachen am Nutzungslimit ab, **ohne** Abschlussmessung gegen die Baseline. Gemergt auf
  Nutzerwunsch, weil nur das Beta-Gehirn betroffen ist (Standard aus).

**Wie getestet:** volle Suite 111 Dateien / 1398 Tests grün; tsc sauber; Standard-Gehirn bit-identisch (bot-sim Gold,
Seeds 7-8, 12 min, CSV vor/nach dem Brain-Merge byte-gleich); Browser-A/B Produktionsbuild vor/nach A3+A4: gleiche
Startzeit, alle Atlanten fertig.


## 2026-10-24 · A2 · Simulations-Bugs (Wave 0), Branch feat/a2-sim-bugs

**Was:** Drei Minion-Stillstandsfehler in `src/sim` behoben (Details und Beweise in [docs/BUGS.md](BUGS.md)):
(1) Minions jagen keine gegnerischen Minions mehr, die im Busch stehen (`minions.ts` `attackable`/`nearest`);
(2)+(3) Lane-Minions überspringen einen Lane-Knoten, wenn sie ihm auf zwei Körperradien nahekommen (`minions.ts` `walkLane`) –
ein Belagerungs-Minion stand sonst für immer am eigenen Turm (Knoten im Turmkreis), zwei Minions blockierten sich an einem
Knoten zwischen ihnen (Wellen blieben an Lane-Ecken stehen, bewiesen > 10 s); Neu: `tools/bughunt/matchProbe.ts` (Invarianten-Prüfung je Tick für komplette Bot-Partien).

**Warum:** Befunde aus 12 kompletten Probe-Partien und mehreren Teilläufen (Seeds 11-13, 21, 22; Standard- und Beta-Gehirn; Iron/Gold/Challenger).
Kein Ausnahmefehler, kein NaN, keine Konsolenmeldung gefunden; die drei Fehler waren Stillstände im Kern (Wellen).

**Wie getestet:** Je Fehler ein Regressionstest in `tests/a2SimBugs.test.ts` (vor dem Fix rot, nach dem Fix grün); dazu
Sweeps in `tests/a2Wards.test.ts`, `tests/a2Interrupts.test.ts` (Tod und Betäubung je Champion x Fähigkeit),
`tests/a2Respawn.test.ts`, `tests/a2Fuzz.test.ts` (feindliche Befehle). Replay-/Determinismus-Tests grün. **Spielergebnisse
ändern sich** (stateHash jeder Partie, in der einer der Fälle vorkommt); es gibt keine festen Hash-Fixtures in `tests/`.

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
