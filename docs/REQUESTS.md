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

## R13-1 – A13 → A14 (src/ai/utility/intents.ts `uPoke`): Poke im Modus 'poke' werfen · offen

`castSlot(v, ctx, rng, t, slot, mode)` hat einen sechsten Parameter `mode: 'poke' | 'fight'` (Standard `'fight'`, A13). Im
Beta-Gehirn hält der Modus `'poke'` einen Wurf zurück, dessen Trefferzuversicht unter `micro.json` `aim.minConfidence.poke`
liegt, und verschwendet keine Fähigkeit mit `holdFor ≠ none` (Engage, Ult, Peel-CC aus `src/data/bots/hints`). `uPoke`
ruft heute `castSlot(n.v, n.ctx, n.rng, t, d.slot)`; bitte `, 'poke'` ergänzen (eine Stelle). Außerdem kann `pokeValue` die
Slots aus `hintsOf(ctx.champ).abilities[i].roles.includes('poke')` wählen statt aus eigenen Regeln.

## R13-2 – A13 → A29 (Tests `tests/bots.test.ts`, `tests/botPerception.test.ts`): Fog-Guard-Globs um `src/ai/combat` erweitern · offen

Die statischen Guards (kein Import von `sim/sim|ecs|vision`, `bitecs`, keine Uhren) decken `src/ai/combat/*.ts` nicht ab. Bis
die Globs erweitert sind, prüft `tests/a13Hints.test.ts` ("combat micro modules never import sim state or clocks") das
Verzeichnis selbst. Die Dodge-Logs (`node: 'dodge'`) enthalten nur Skalare, keine Positionen (Test in `tests/a13Game.test.ts`),
`checkFogConvention` braucht den Knoten deshalb nicht.

## R13-3 – A13 → A27 / A18: Hints kuratieren, Profilfelder · offen

`src/data/bots/hints/<id>.json` sind generiert (`status: "generated"`). A27 kuratiert, indem er die Datei ändert und
`"status": "curated"` setzt (`tools/botHints/generate.ts` überschreibt sie dann nicht; `--check` meldet veraltete generierte
Einträge, `tests/a13Hints.test.ts` den Rest). Profile: keine neuen Felder nötig. Der Rang wirkt über `reactionMedianMs`,
`reactionSigmaMs`, `predictiveDodgePct`, `aimErrorDeg`, `situationalAbilityPct`, `apmCap`, `cooldownTracking`; `dodgeRateLine900Pct`
und `skillshotHitPct` werden vom Mikro nicht mehr als Würfel benutzt (Ausweich- und Trefferquote ergeben sich aus Reaktionszeit,
Geometrie und Zielrauschen). Falls A18 diese beiden Felder als Zielwerte behalten will: sie sind die Kalibrierziele, gegen die
`tools/botHints/arenaBench.ts` / `combatBench.ts` messen.
