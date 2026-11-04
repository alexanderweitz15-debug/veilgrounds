# Welle 1 – A4: VFX- und Partikelsystem (Branch `feat/a4-vfx`)

Format und Nutzung: `docs/VFX-FORMAT.md`. Hier: was, warum, Test, Messwerte, offene Punkte.

## Was gebaut wurde

- **`src/render/vfx/`** (neu): `schema.ts` (Effektformat + Validator), `registry.ts` (lädt `effects/*.json` per Vite-Glob,
  validiert, Warnung statt Absturz), `system.ts` (GPU-Partikel: Spawn schreibt in Ringpuffer, Vertex-Shader rechnet Position,
  Farbe, Alpha, Größe aus einer Kurventabelle), `glyphs.ts` (prozeduraler 4x2-Glyphenatlas), `bus.ts` + `bindings.json`
  (Abonnier-Schnittstelle), `order.ts` (Zeichenreihenfolge-Regel), `effects/` (20 Effekte als JSON).
- **Harte Grenzen:** Ringgröße je Effektklasse und Schicht (projectile/hit/aura 1024, telegraph 512, ultimate 1024),
  Spawn-Budget je Klasse und Frame (160/300/160/120/400), `maxLive` je Effekt, alles im Validator und im Test erzwungen.
  Gepoolt, `emit()` allokiert nicht (Test misst 200k Aufrufe), **2 Draw Calls** für alle Partikel.
- **Lesbarkeit:** Gegnerische Telegraphs (Füllung/Rand) werden mit `renderOrder` 8/9 über **alle** anderen Effekte
  gezeichnet (eigene Telegraphs 2/3, Säulen 4, Partikel 5/6); der gegnerische Rand bleibt mindestens 0,85 deckend
  (`readability.json telegraph.enemyRimMin`); rote Warnfunken (`telegraph_warn`) am Rand gegnerischer Telegraphs, unterhalb
  des Rands. Test: `tests/vfxReadability.test.ts` (Ordnungsregel, Rand-Farbe/Alpha, Warnfunken nur bei Gegnern;
  Mutationsprobe: mit Order 3 statt 8/9 schlagen 3 Tests fehl).
- **Abonnier-Schnittstelle** für A3 (`hitFrame`, `release`) und A8 (`impact` ...): `world.fx.bus.trigger(name, {x,y,h,dx,dy,hue,team,slot,scale,now})`,
  `bus.on(name, fn)`. Trigger → Effekte steht in `bindings.json`. `Fx` selbst löst `hitFrame` (Auto-Angriff zwischen
  Champions), `ultimate` (Cast Slot 3+), `death`, `levelUp` aus; `fx.animatedHits = true` schaltet den sim-getriebenen
  Treffer-Funken ab, sobald A3 `hitFrame` aus der Sprite-Animation liefert (Anfrage R-A4-1 in `docs/REQUESTS.md`).

## Migriert / nicht migriert

Migriert (gleiches Aussehen, Werte 1:1 aus `abilityMotifs.json` übernommen; Test `migration of the six D1b particle kinds`
prüft Leben 0,7–1,3x, Tempo 0,4–1x, Aufstieg 0,6–1,4x, Schwerkraft, Rückstoß, Größe, Helligkeit, Blend):
`ember`, `spark`, `drip`, `mote`, `shard`, `blackflame` (CPU-Points-Pools -> Effekt-JSON, `particles.ts` ist nur noch eine
Fassade, `Particles.emit` unverändert); Turm-Lanzen-Schweif (`lance_trail`, vorher `spark`) und Turm-Einschlag
(`tower_impact`, vorher `spark`-Burst) jetzt in Teamfarbe statt Fest-Farbton. `abilityMotifs.json` `particleKinds` enthält
nur noch die Emissionsraten (trail/burst/ambient).

Neu (vorher nicht vorhanden): `hit_spark`, `hit_slash`, `release_flare`, `release_motes`, `aura_glow`, `aura_ring`,
`telegraph_warn`, `ult_ring`, `ult_pillar`, `ult_dust`, `death_dust`, `levelup_sparks`.

**Nicht migriert** (bewusst): die Boden-Telegraphs (`ShapeView`: exakte Hitbox-Geometrie, kein Partikelproblem), die
Cast-/Tod-/Klick-/Level-Ringe (`pulse()`) und Lichtsäulen in `fx.ts` (wenige Meshes, Form = Aussage), die Geschoss-Instanzen
(InstancedMesh, 1 Draw Call), `sevFx.ts` (Sev-Bodeneffekte sind animierte Flächen-Meshes mit eigener Prozedur, ~25 Meshes
je Objekt; Umbau würde das abgenommene Aussehen ändern), `groundObjects.ts` (Besitz A-fremd). Audit-Befund `sevFx.ts`: je Frame
`material.color.set(string)` (Farbparsing) pro Teil; bei vielen Sev-Objekten ein möglicher CPU-Posten, ungemessen.

## Audit-Befunde, die behoben wurden

- `particles.ts`: CPU-Schleife über 6 x 640 Slots je Frame, voller Upload von Position + Farbe (105 KB/Frame) solange
  irgendein Partikel lebt, 6 Draw Calls, je Spawn drei temporäre Arrays (`pos.set([..])`).
- `fx.ts`: je Projektil und Frame ein neues `trails`-Objekt und ein `{dx,dy}`-Objekt; `abilityParticles` je Projektil und
  Frame ohne Cache (jetzt memoisiert in `abilityTheme.ts`).
- Gegnerische Telegraphs lagen auf derselben Ordnung wie eigene Pulse/Partikel (konnten verdeckt werden): behoben (oben).
- Low-Grafik dünnt die Partikel aus (`scale` 0,6, vorher nur Reduce Motion 0,35).

## Messwerte (vorher = Basis `claude/veilgrounds-next-level-f6na23`, nachher = dieser Branch)

Synthetische Teamfight-Last, gleiche Aufrufe in beiden Ständen (20 Geschoss-Schweife + Einschläge, 6 Zonen mit Ambient,
Cast-Funken alle 70 ms; ~1110 lebende Partikel). Werkzeuge: `tools/scratch/a4VfxMicro.ts`, `a4VfxAB.cjs`, `a4VfxBench.cjs`.

| Messung | vorher | nachher |
|---|---|---|
| CPU je Frame, `Particles.update` (Node, 4000 Frames, 3 Läufe) | 0,18–0,27 ms | 0,001–0,011 ms |
| CPU je Frame, Emit-Aufrufe + Update zusammen | 0,27–0,29 ms | 0,09–0,18 ms |
| GPU-Upload je Frame | 105 KB (immer voll) | 4,3 KB (nur neue Spawns) |
| Draw Calls der Partikel | 6 | 2 |
| Draw Calls Szene gesamt (Sandbox, Last an/aus) | 31 / 25 | 27 / 25 |
| Gezeichnete Vertices der Partikelschicht | 3840 | 9216 (tote werden im Shader verworfen) |
| Render-Mehrkosten der Partikelschicht (SwiftShader, 960x540, p50 an minus aus, 3 Läufe) | +1,2 / 0,0 / +1,4 ms | 0,0 / -0,2 / +0,1 ms (Rauschgrenze) |

**Grenzen der Messung (ehrlich):** SwiftShader ist eine Software-GPU, und vier Agents teilten sich 4 Kerne: der gesamte
Spielframe dauerte ~1,3 s (HUD, Fog, Minimap dominieren, nicht der Render-Aufruf, der 6–12 ms braucht), p95-Werte
springen bis 2 s. Darum sind absolute FPS-Aussagen nicht möglich; belastbar sind Draw Calls, Upload-Bytes, die
Node-CPU-Messung und die Reihenfolge-Tests. Die 5v5-Messung (`a4VfxBench.cjs`, Classic-Match auf 8x Tempo bis Tick 6000,
10 Champions im Match, 5–9 davon im Snapshot sichtbar, + Wellen + Last) lieferte 27–43 Frames je 40-s-Fenster mit gleichem Render-p50 (6,1–10,7 ms vorher, 6,8–8,8 ms
nachher, je nach Szene); das ist kein Beleg für 60 FPS auf echter Hardware. Ein Messlauf auf einem Mittelklasse-Laptop steht aus.

## Tests

`tests/vfx.test.ts` (17): alle Effektdateien gültig, Klassenabdeckung, Klassen-/Frame-Budgets, Validator lehnt über ein Dutzend Fehlerarten
ab, Migration der 6 Kinds (Zahlen), Kurventabelle, Spawn-Budget, `maxLive`, Ringgrenze je Klasse, Lebensdauer, Skalierung,
Determinismus + Pufferinhalt, 2 Draw Calls und feste Puffer, keine Allokation im `emit`, Bus (Bindings, Filter, Abmelden).
`tests/vfxReadability.test.ts` (6): Ordnungsregel (rein + am echten `Fx`), Rand-Farbe und Mindest-Alpha gegnerischer Rand,
eigene Telegraphs unten, Warnfunken nur bei Gegnern. Unverändert grün: `telegraph`, `readability`, `abilityMotifs`,
`abilityVisuals*`, `aimPreview`, `sev` (228 Tests).

## Geteilte Dateien (kleine, additive Eingriffe)

Keine in `world.ts`, `units.ts`, `game.ts`. `world.ts` hängt `fx.particles.group` schon an die Szene; die neue Gruppe ist
dieselbe Instanz (`Particles.group`). Besitz-Dateien geändert: `fx.ts`, `particles.ts`, `abilityTheme.ts`,
`abilityMotifs.json` (nur `particleKinds`, `particleDoc`), `readability.ts/json` (nur `telegraph`).

## Offene Punkte / Risiken

- A3/A8 müssen `bus.trigger` aufrufen (R-A4-1); bis dahin kommt der Treffer-Funke aus dem Sim-Ereignis.
- Echt-Hardware-Messung (60 FPS mit 10 Champions + Wellen) steht aus, siehe oben.
- Additive Effekte auf hellem Boden werden weißlich; neue Farbtöne sind darum mittelhell (0,52–0,62) oder alpha-geblendet.
- Float-Textur im Vertex-Shader (`texelFetch`) braucht WebGL2 (das Spiel setzt es ohnehin voraus).
- `sevFx.ts` und die Pulse-Meshes sind nicht datengetrieben (oben begründet).

## Verifikation

`npx tsc --noEmit` sauber, `npx vite build` ok (Build der Endfassung: 35 s). Volle Suite einmal komplett
(`npx vitest run`, 1745 s bei Load 21 auf 4 Kernen): 93/94 Dateien, 1054/1055 Tests grün; der eine Ausfall war mein
Allokationstest (`emitting does not allocate per call`: 15,4 MB Heap-Wachstum gegen 12,6 MB Grenze, GC-Verzug unter Last).
Danach auf „kleinstes Wachstum über 6 Runden" umgestellt, `tests/vfx.test.ts` neu grün (17/17); die volle Suite wurde
danach nicht erneut gefahren (Regel: höchstens zweimal, der erste Lauf wurde bei 39 Dateien vom 30-min-Limit abgebrochen).
