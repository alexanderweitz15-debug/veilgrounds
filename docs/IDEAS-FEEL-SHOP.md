# Ideen: Spielgefühl („clumsy“) und Shop / Items / Prägungen vs. LoL

Stand: 23. Okt 2026, main `95ed287`. Ideen-Agent, nichts davon ist umgesetzt. Jede Idee: Problem, Evidenz (Datei:Zeile
oder Messung), LoL-Vergleich (LoL-Werte aus dem Gedächtnis, „ca.“ = nicht nachgemessen), Vorschlag, Aufwand S/M/L, Dateien.

Zeilenangaben beziehen sich auf die Arbeitskopie vom 23. Okt (`src/render/championSprites.ts` hat dort uncommittete Änderungen – Gouache-Beleuchtung, CHAMPION_SCALE –, deshalb stehen bei Sprite-Zitaten auch Funktionsnamen).

Messungen: headless mit `npx tsx tools/scratch/feelMeasure.ts` gegen die Sim (Ergebnisse unten), Browser-Messung am
gebauten Spiel (`vite preview --port 4398`, `?bench` → `window.__vg`, Skript im Abschnitt „Browser-Messung“ beschrieben),
Code-Lesen.

---

## Teil A: Spielgefühl

### Was NICHT das Problem ist (gemessen, damit niemand dort Zeit verliert)

| Verdacht | Messung (Sim, 30 Hz) | Fazit |
|---|---|---|
| Pfadfindung macht Umwege / ist langsam | Brunnen → Mid-/Top-/Bot-Außenturm: **0,0 % Umweg, 1 Wegpunkt** (Luftlinie frei). Mid-Außenturm → Top-Außenturm durch den Jungle 5,3 % (4 Wegpunkte), Mid-Außenturm → Moosrudel 0,6 %, Dornenbock → Hohlkäfer 2,2 %, Top-Außenturm → Leviathan-Grube 4,7 %, Moosrudel → Glutwächter 13,3 % (Wand dazwischen, der Umweg ist real). A* + String-Pulling: 0,04–4 ms pro Aufruf; 20 Aufrufe/s bei gehaltenem Rechtsklick auf freier Strecke ≈ 0,4 ms | kein Befund (Umwege sind Geometrie, nicht Algorithmus) |
| Drehrate / Beschleunigung | Die Sim hat keine Drehrate und keine Beschleunigung: Richtung und volles Tempo ab dem ersten Tick (`movement.ts:83-112`); der Render dreht die Figur in 80 ms pro 180° (`readability.json facingMs180`) | kein Befund – LoL (ca.) hat ebenfalls keine spürbare Beschleunigung und nur eine minimale Drehzeit |
| Move-Befehl braucht mehrere Ticks | Befehl → erste Positionsänderung: **1 Tick** (`input.ts` → `movement.ts` im selben Step) | kein Befund |
| Angriffsbefehl verzögert | Attack in Reichweite → Wind-up-Start **Tick 1**, Schaden (Mira, 8 Wind-up-Ticks + Projektil 2000 u/s über 400 u) Tick 14 | kein Befund |
| Einheiten-Kollision bremst / schubst | 1600 u geradeaus (Brom, 340 MS): frei 141 Ticks; durch eigene Welle (6 Minions) 142 (+0 %, 4 u seitlich); durch gegnerische Welle 143 (+1 %, 21 u); gegen stehenden Champion auf der Linie 145 (+2 %, 81 u seitlich) | kein Befund, LoL-ähnlich (Minions weichen, Champion gleitet vorbei) |
| Wind-up-Quantisierung | round(30·w/AS): Mira L1 267 ms statt 274 (−7 ms), Aurel 333 statt 320 (+13), Kaelen 367 statt 353 (+13); mit 1,6× AS max. 12 ms Fehler | ≤ 13 ms, nicht spürbar |

Die Kollisionsschubs (`movement.ts:173-239`) sind weich und symmetrisch; die Wand-Gleitlogik (`movement.ts:100-107`)
greift nur nach Schubs, weil Pfade schon wandfrei sind (`map.ts` UNIT_CLEARANCE 75). Hier gibt es nichts zu holen.

### Latenzbudget Eingabe → Bild (Code-Kette, Browser-Messung siehe unten)

| Stufe | Datei | Zeit |
|---|---|---|
| mousedown → `link.send` → `postMessage` an den Worker | `controller.ts:142-208`, `link.ts:28` | ≈ 1 ms |
| Worker wartet auf die nächste Tick-Grenze (Timer 4 ms, Akkumulator) | `worker.ts:62-84` | 0–33 ms, Ø 17 |
| Step + Snapshot bauen + `postMessage` zurück | `worker.ts:78-80`, `snapshot.ts` | ≈ 1–3 ms |
| Client ingest, dann warten auf das nächste rAF-Frame | `game.ts:111-123`, `game.ts:294` | 0–16 ms, Ø 8 |
| `BUFFER_TICKS 0.5`: das neue Segment wird erst einen halben Tick nach Ankunft gezeigt, davor läuft das alte Segment weiter | `state.ts:10`, `state.ts:112` | 17 ms |
| Erste sichtbare Verschiebung (1 Pixel ≈ 3 u bei 2500 Kameraabstand, 11 u/Tick bei 340 MS) | `state.ts:119-135` | + ≈ 3 ms |
| **Summe** | | **≈ 45–70 ms** (+ Monitor/Compositor ≈ 10–20 ms) |

LoL (ca.): Server-Tick 30 Hz wie hier, keine clientseitige Bewegungs-Vorhersage; Latenz ≈ Ping + 0–33 ms Tick-Wartezeit,
also bei 20 ms Ping ≈ 40–60 ms. Unsere Kette ist in der gleichen Liga; „clumsy“ kommt deshalb weniger aus der
Rohlatenz als aus den fehlenden sofortigen Rückmeldungen und den Animationsbrüchen unten.

Browser-Messung (Abschnitt am Ende von Teil A): **Median 50 ms, max 55 ms** vom `send` bis zur ersten sichtbaren Verschiebung – das Budget stimmt.

### P1

**A1. Cast-Pose „gleitet“ beim Loslaufen (Moonwalk).**
- Problem: Nach jedem Zauber bleibt die Figur für Cast-Zeit + 342 ms in der Cast-Animation, auch wenn sie längst läuft; sie rutscht in Wurfpose über den Boden. Bei Quick-Cast-Kombos (Q, Rechtsklick, W, Rechtsklick) sieht man fast nur Gleiten.
- Evidenz: `src/render/championSprites.ts:278-280` in `push()` (`if (ca && now - ca.t0 < this.castLen(ca)) anim = 'cast'` – ohne Prüfung von `e.moving`), `:221-223` (`castLen = dur + AFTER_MS*3.6` = 342 ms directed, 300 self, 280 dash). Der Angriffs-Backswing hat genau diese Prüfung (`:286`: `!e.moving || now - a.atkHit < AFTER_MS`), der Cast nicht.
- LoL: Bewegungsbefehl blendet sofort in den Laufzyklus (nur Kanalisierungen halten die Pose); Cast-Animationen sind „move-cancelable“ ab dem Release-Frame.
- Vorschlag: Cast-Pose nur halten, solange `now - ca.t0 < ca.dur + AFTER_MS` **oder** `!e.moving`; beim Laufen danach sofort `run`. Dashes ausgenommen (die sind nicht `moving`, aber `dashing`).
- Aufwand: S. Dateien: `src/render/championSprites.ts`; Test in `tests/spriteTiming.test.ts` (castFrame/castLen sind pur).

**A2. Laufzyklus läuft immer mit 14 fps, egal wie schnell die Figur ist (Foot-Sliding).**
- Problem: Mit Stiefeln (365–400 MS), Geist, Slows oder Eiferschwert bleibt die Schrittfrequenz gleich; schnelle Figuren rutschen, verlangsamte trippeln auf der Stelle.
- Evidenz: `src/render/champions/anim.ts:21` (`CHAMP_FPS.run = 14`), `src/render/championSprites.ts:295` (Frame aus `(now - t0) * rate`, keine MS-Abhängigkeit). Snapshot trägt `moving`, aber kein Tempo (`snapshot.ts:412`).
- LoL (ca.): Laufanimation wird mit dem Bewegungstempo skaliert (Animationsgeschwindigkeit ∝ MS/Basis-MS, gedeckelt).
- Vorschlag: `ms` (quantisiert, 1 Byte: ms/4) in `SnapEntity`; Rate = `CHAMP_FPS.run * clamp(ms/340, 0.75, 1.5)`; Phase beim Ratenwechsel fortschreiben (Akkumulator statt `(now - t0) * rate`, sonst springt der Frame).
- Aufwand: S–M. Dateien: `src/sim/snapshot.ts`, `src/render/championSprites.ts`, `src/render/champions/anim.ts`, Minions ebenso (`sprites.ts`).

**A3. Keine sofortige lokale Rückmeldung auf den Klick außer dem Bodenmarker.**
- Problem: Zwischen Rechtsklick und der ersten sichtbaren Reaktion der Figur vergehen 45–70 ms (Budget oben), weil die Blickrichtung (`fx/fy`) erst mit dem Snapshot kommt. Der Marker (`fx.ts:424`, 380 ms Puls) ist da, die Figur selbst „antwortet“ erst später. Das ist der klassische Grund, warum sich Netz-MOBAs „schwammig“ anfühlen.
- Evidenz: `championSprites.ts:256-261` (Richtung nur aus `e.fx/e.fy`), `controller.ts:185-208` (sendet, zeigt nur den Marker).
- LoL: dreht ebenfalls erst mit der Server-Antwort, kompensiert aber mit sehr kurzer Turn-Zeit und sofort einsetzendem Laufzyklus im Frame der Antwort; bei 20 ms Ping ist die Antwort schneller als unsere Tick+Buffer-Kette.
- Vorschlag (render-only, ohne Sim-Änderung): bei `move`/`attackMove`/`attack` auf dem eigenen Champion sofort `ChampionSprites.intentFacing(eid, dx, dy, now)` setzen; die Sprite-Richtung dreht mit der bestehenden 80-ms-Drehung (`readability.json facingMs180`) dorthin, bis der nächste Snapshot ein Facing liefert (das überschreibt). Optional: Laufzyklus 1 Frame „vorlaufen“ lassen (erster Schritt direkt). Netto fühlt sich die Reaktion ≈ 1 Tick schneller an.
- Aufwand: S. Dateien: `src/input/controller.ts`, `src/render/championSprites.ts`, `src/render/world.ts`.

**A4. Standbilder bei verspäteten Snapshots (erste Minute) statt Extrapolation.**
- Problem: `BUFFER_TICKS 0.5` (17 ms) deckt den Jitter im Steady State (p99 13,7 ms), aber nicht in der ersten Minute: p99 27,7 ms, max 71 ms (Browser-Messung unten; Ursache vermutlich die Hintergrund-Bakes der Monster-Atlanten, nicht isoliert). Jeder Überlauf ist ein Standbild der ganzen Szene für 1–2 Frames – genau das „Ruckeln“, das man zu Spielbeginn spürt.
- Evidenz: `state.ts:10`, `state.ts:112` (`alpha` wird bei 1 gedeckelt → Einheiten frieren ein), `game.ts:98-105` (Minion-/Monster-Atlanten nach dem Start im Hintergrund), `worker.ts:62` (Timer 4 ms); Jitter-Test `tests/interp.test.ts` prüft nur 0–12 ms.
- LoL: puffert ca. 1 Tick und extrapoliert kurz, statt stehen zu bleiben (ca.).
- Vorschlag: (a) Bake-Worker erst nach dem ersten Snapshot + 2 s starten oder mit `requestIdleCallback`-Taktung; (b) in `beginFrame` bei `v > 1` bis zu 1 Tick mit der letzten Tick-Geschwindigkeit weiterlaufen, beim nächsten Snapshot weich (≤ 1 Tick) einrasten; `tests/interp.test.ts` um einen 40-ms-Ausreißer erweitern (kein Standbild, kein Rückwärtsschritt). `BUFFER_TICKS` **nicht** senken (p90 8,7 ms).
- Aufwand: S + S. Dateien: `src/game/game.ts`, `src/game/state.ts`, `tests/interp.test.ts`.

### P2

**A5. Kamera-Lock ist hart; kein Halb-Lock, kein Offset.**
- Problem: Mit Lock klebt der Champion exakt in der Bildmitte (jedes Frame `rig.focus`), ohne Lock muss man per Kante scrollen; LoL-Spieler nutzen oft „Kamera halb gesperrt“ (folgt erst, wenn der Champion dem Rand näher kommt) oder Offset per Mausposition.
- Evidenz: `controller.ts:446-449`, `camera.ts:33-37` (kein Lerp, kein Offset).
- LoL: Lock, Halb-Lock (Option „Kamera semi-locked“), Kamera-Offset in Richtung Cursor (ca. bis 1/3 Bildschirm); Kameratempo-Slider.
- Vorschlag: Modus `semi` (Fokus folgt nur, wenn der Champion > 35 % vom Zentrum weg ist, weich mit `lerp(0.2)`), optional Cursor-Offset (bis 300 u, nur im Lock). Kameratempo gibt es schon (`settings.cameraSpeed`).
- Aufwand: S–M. Dateien: `src/input/controller.ts`, `src/render/camera.ts`, `src/ui/settingsPanel.ts`, `src/settings.ts`.

**A6. Erster Auto nach Item-Kauf: Wind-up-Frames falsch getimt.**
- Problem: Der erste Angriff nach einer AS-Änderung verteilt die Vorbereitungs-Frames nach `windEstimate` (Basis-AS + Level, ohne Items/Buffs); erst der zweite Auto misst (`a.wind`). Mit Eiferschwert/Präzision-Stacks landet der Strike-Frame zu früh und die Figur „friert“ bis zum Hit.
- Evidenz: `championSprites.ts:22-26` (`windEstimate` nur Basis), `:281-285`.
- LoL: Animation kennt die exakte Wind-up-Zeit.
- Vorschlag: Der Snapshot trägt bereits `atkStart`/`atkPhase`; zusätzlich `atkEnd` (phaseEnd-Tick) mitgeben und die Frames darauf verteilen – kein Schätzen mehr.
- Aufwand: S. Dateien: `src/sim/snapshot.ts`, `src/render/championSprites.ts`.

**A7. Treffer-Feedback: Trefferblitz ist gedrosselt, Hitstop nur im Backswing.**
- Problem: Der weiße Blitz am Ziel ist auf 1 pro 250 ms gedeckelt (`readability.json hitFlash.minGapMs`), bei 1,5 AS (Autos alle 667 ms) ok, bei Multi-Hit-Kombos fehlen Treffer. Der Rückstoß (`FLINCH 9 u / 150 ms`) ist klein; LoL-Treffer wirken durch Partikel + Sound + kurzen Hitstop „satt“.
- Evidenz: `readability.json`, `championSprites.ts:17-18`, `fx.ts:446-449` (Hit-Spark nur bei Champion-Kämpfen).
- LoL (ca.): Trefferpartikel pro Treffer, Hit-Sound pro Treffer, kein Flash-Limit.
- Vorschlag: minGapMs 250 → 120; Flinch 9 → 14 u für Champion-Treffer; Hit-Spark auch für die eigenen Minion-Treffer (gedämpft), damit Last-Hits „klicken“.
- Aufwand: S. Dateien: `src/render/readability.json`, `src/render/championSprites.ts`, `src/render/fx.ts`.

**A8. Geschobene Einheiten „schweben“ (kein Laufzyklus bei Kollisionsschub).**
- Problem: `moving` ist absichtlich nur bei echtem Laufen gesetzt; Minions, die von einem Champion zur Seite geschoben werden (bis 20 u/Tick), gleiten im Idle.
- Evidenz: `movement.ts:20-26`, `snapshot.ts:412`, DECISIONS „`moving` im Snapshot“.
- LoL: geschobene Minions spielen eine kurze „Shuffle“-Animation.
- Vorschlag: render-seitig: wenn |Δpos| zwischen zwei Snapshots > 3 u und nicht `moving`, `run` mit halber Rate.
- Aufwand: S. Dateien: `src/render/sprites.ts`, `src/render/championSprites.ts`.

**A9. Rechtsklick-Halten: Marker nur beim ersten Klick, Re-Path alle 50 ms kostet nichts – aber kein Richtungs-Hinweis.**
- Problem: Beim Steuern mit gehaltener Maus fehlt jede Rückmeldung, wohin die Figur gerade läuft (LoL zeigt auch dort nichts, aber dort reagiert die Figur sichtbar schneller, siehe A3).
- Evidenz: `controller.ts:21-22`, `:437`.
- Vorschlag: mit A3 erledigt (sofortige Blickrichtung); zusätzlich optional ein dezenter Richtungspfeil am Fuß während Hold (Einstellung).
- Aufwand: S. Dateien: `src/render/fx.ts`.

### P3

**A10. Acht Sprite-Richtungen → Blick und Laufrichtung weichen bis 22,5° ab.** `src/render/champions/types.ts:7` (DIRS 8), Drehung 80 ms. LoL: 3D, stufenlos. 16 Richtungen verdoppeln den Atlas (Bake-Zeit, Textur); Alternative: Sprite um bis zu ±10° scheren/neigen in Bewegungsrichtung (nur Render). S. Dateien: `championSprites.ts`.

**A11. Zoom-Spanne klein (2000–2500).** `camera.ts:7-10`. LoL (ca.): deutlich weiter heran. Für das Gefühl unwichtig, für Screenshots/Lesbarkeit nett: MIN_DIST 1400. S.

**A12. Kantenscroll-Zone 20 px fest.** `controller.ts:19`. LoL (ca.): ~ 1 % der Bildschirmbreite, mit Beschleunigung zum Rand. Vorschlag: 2 Zonen (20 px voll, 40 px halb). S.

**A13. Attack-Move: Standard verlangt A + Linksklick.** `settings.ts:67` (`attackMoveOnCursor: false`). LoL-Standard ebenso, aber die meisten Spieler schalten auf „Attack Move on Cursor“. Vorschlag: in den Standard-Presets des Lobby-Setups „Schnell“ = on; kein Code-Thema. S.

**A14. Eingabepuffer 8 Ticks nur für Zauber, nicht für Autos.** `abilities.ts:476`. In LoL puffert auch ein Angriffsbefehl während Dash/Cast. Vorschlag: `attack`/`attackMove` während `isBusy` in dieselbe 1-Platz-Queue. S–M. Dateien: `src/sim/systems/input.ts`, `abilities.ts`.

**A15. Zaubermodus-Standard.** `settings.ts:68` (`castIndicator: true` → Standard „Schnellzauber mit Anzeige“: halten zeigt die Form, loslassen wirkt; `castMode.ts:9-11`). LoL-Standard ist „Normal“ (Klick bestätigt), die meisten Spieler stellen auf „Schnellzauber“ um. Vorschlag: im Einstellungs-Preset „Schnell“ alle vier Tasten auf `quick`, in „Anfänger“ auf `normal`; kein Code-Thema, nur Presets. S.

### Browser-Messung (gebautes Spiel, Sandbox, Mira, 1280×720, Chrome im Claude-Browser-Pane)

Methode (in der Konsole mit `?bench`): `__vg.link.onSnap` umwickeln und Ankunftszeiten stempeln; Champion per `stop` 500 ms stehen lassen, `performance.now()` merken, `__vg.link.send({t:'move',…})`, rAF-Schleife bis `__vg.state.x(me)` sich um > 0,5 u geändert hat; Frame-Zeiten aus rAF-Abständen; Client-Arbeit aus `__vg.perf`.

| Messung | Ergebnis |
|---|---|
| Rechtsklick (`link.send move`) → erste sichtbare Verschiebung der interpolierten Position, 10 Proben | **Median 50 ms, min 43, max 55 ms**; immer 1 Sim-Tick nach dem Befehl, 3 Frames (einmal 2) |
| Snapshot-Ankunftsjitter, Steady State (≈ 1:00, 239 Intervalle) | Abweichung von 33,3 ms: p50 2,0 ms, p90 8,7, **p99 13,7, max 15,2**; 0 Snapshots später als der 17-ms-Puffer |
| Snapshot-Ankunftsjitter in den ersten 30 s (258 Intervalle) | p50 1,8, p90 7,5, **p99 27,7 ms, max 70,7 ms** (danach 2 Snapshots in 0,3 ms = Nachholer) → ca. 1 % der Snapshots überlaufen den Puffer: kurze Standbilder in der ersten Minute. Ursache **nicht isoliert** (Ankunft wurde im Main-Thread gestempelt, ein Main-Thread-Stall sieht genauso aus); Kandidaten: Monster-Atlas-Bakes (`game.ts:98-105`), Textur-Upload beim Fertigwerden, GC |
| Frame-Zeit (rAF, 477 Frames) | p50 16,6 ms (vsync), p90 18,5, p99 25,0, max 34,2 → vereinzelt ein verlorenes Frame |
| Client-Arbeit pro Frame (`__vg.perf`) | world 2,8–3,2 ms, input 0,35, hud 0,24–0,31, overlay 0,12, minimap 0,1, **gesamt 3,6–4,1 ms** |

Fazit: Rohlatenz und Render-Last sind in Ordnung (50 ms ≈ LoL bei 20 ms Ping). Der 0,5-Tick-Puffer passt im Steady State
(p99 13,7 < 17 ms); **A4 nicht auf 0,25 senken** (p90 8,7 ms würde schon überlaufen). Stattdessen: (a) Hypothese
prüfen, indem die Ankunft im Worker gestempelt wird (`postMessage` mit `performance.now()`), und falls es die Bakes sind,
die Monster-Atlas-Bakes erst nach dem ersten Snapshot + 2 s starten (`game.ts:98-105`); (b) unabhängig davon bei
verspätetem Snapshot statt Standbild bis zu 1 Tick extrapolieren (`state.ts:112-135`, letzte Geschwindigkeit weiterführen,
dann weich einrasten). Beides S.

---

## Teil B: Shop, Items, Prägungen

### Bestand vs. LoL

| | Veilgrounds | LoL (ca., Kluft 14.x/15.x) |
|---|---|---|
| Items gesamt | **47** (`src/data/items.json`): 2 Verbrauch, 5 Start, 7 Basis, 14 Komponenten, 14 Legendär (2 mit Aktiv), 5 Stiefel | ≈ 170 kaufbar auf der Kluft: ≈ 65 Legendär, ≈ 35 Komponenten/Epic, ≈ 20 Basis, 7 Stiefel-Upgrades, ≈ 8 Verbrauch/Elixiere, 4 Support-Quest-Items |
| Item-Stats | 16 Schlüssel (`schema.ts:6-22`); **fehlen in `ItemStat`: `magicPen`, `armorPenPct`, `tenacity`** – obwohl `Stats` sie führt und `damage.ts:76,84` sie anwendet | AD, AP, HP, Mana, Rüst, MR, AS, Krit, Lebensraub, Omnivamp, Hast, MS, Lethalität, Rüstungsdurchdringung %, Magiedurchdringung flach/%, Zähigkeit, Heil-/Schildkraft, Regeneration |
| Prägungen | **16** (`runes.json`): 4 Schlüssel + 12 kleine; Seite = 1 + 3 (`runes.ts:9-12`, `runePages.ts MINORS=3`) | 5 Pfade × 3–4 Schlüssel (16) + 5 × 9 kleine (45) + 3 Splitter-Reihen; Seite = Schlüssel + 3 Primär + 2 Sekundär + 3 Splitter |
| Presets | 27 Champions × 4 (`runePresets.json`), Bot-Builds 27 × {starter, standard, vsAD, vsAP} + runes (`src/data/builds/*.json`) | Empfohlene Seiten im Client, Item-Sets |

### Shop-Funktionen: was fehlt / anders ist als in LoL

Vorhanden und gut: Kategorien, Suche (Name), Bau-Baum mit „besitzt ✓“, reduzierter Preis (rekursiv, `inventory.ts:57-77`), Rechtsklick kauft, Alt-Klick pingt, Gold-Effizienz, Verkaufen 70 % (`SELL_RATIO`), Kaufen im Tod, Esc schließt, Scroll/Focus bleibt beim Rebuild.

| # | Fehlt / Abweichung | Evidenz | LoL | Vorschlag | Aufwand | Dateien |
|---|---|---|---|---|---|---|
| B1 | **Rückgängig (Undo)** | kein `undo`-Befehl (`types.ts:85-86` nur buy/sell), FEATURE-GAP 5.2 „fehlt“ | Undo-Stapel im Shop, solange man im Brunnen ist; ungültig, sobald man den Shop-Bereich verlässt oder ein gekauftes Aktiv-/Verbrauchsitem benutzt hat (ca.) | Sim: pro Champion `ledger: {kind: 'buy'|'sell', item, slot, gold, consumed: Inventory}[]` in `inventory.ts`; `{t:'undo'}` in `input.ts` stellt den letzten Eintrag wieder her (Inventar + Gold aus dem Eintrag). Leeren bei: Brunnen verlassen (Tick-Check in `economySystem`), Item benutzt (`useItem`), Tod/Respawn. Snapshot `me.undo: number` (Stapeltiefe). UI: Button „Rückgängig (Strg+Z)“ im Kopf, aktiv solange Tiefe > 0 | M | `src/sim/items/inventory.ts`, `src/sim/systems/input.ts`, `src/sim/types.ts`, `src/sim/snapshot.ts`, `src/ui/shop.ts`, `src/i18n/*.json`, Test `tests/inventory.test.ts` |
| B2 | **Empfohlen ist ein Stern + flache Liste** | `shop.ts:162-164` (recList = starter + boots + core, nur `standard`), `:219-223` (nur sichtbar, wenn nichts gewählt ist) | Tab „Empfohlen“ mit Blöcken **Start · Kernitems · Stiefel · Situativ** in Kaufreihenfolge; der nächste Schritt ist hervorgehoben; Komponenten des nächsten Items zeigen „kaufbar“ | Eigene Ansicht (Standard beim Öffnen): Reihen Start / Stiefel / Kern (1→4) / Situativ (vsAD, vsAP aus `builds/*.json`); jedes Kern-Item mit seiner Komponenten-Kette darunter, „als Nächstes“ = erstes Kern-Item, das nicht besessen ist; Komponenten davon, die man sich leisten kann, grün umrandet. Rechtsklick auf die Reihe kauft das nächste leistbare Teil („Quick Buy“) | M | `src/ui/shop.ts`, `src/ui/shop.css`, `src/ai/bot/builds.ts` (Typ `BuildData` um `situational?: string[]` erweitern), `src/data/builds/*.json` |
| B3 | **Verbrauchsgüter stapeln nicht** | `inventory.ts:4` („consumables do not stack“), `itemHooks.ts:344` (zweiter Trank reiht sich nur an) | Tränke ×5 pro Slot, Kontrollward ×2, Elixiere 1 | `Inventory` von `(string|null)[]` zu `{id, n}`: `ITEM_SLOTS` bleibt, `stack` im Schema (`trank: 5`, `siegelward: 2`), HUD zeigt Zähler; `useItem` dekrementiert | M (Schema-Änderung zieht durch Sim, Snapshot, HUD, Bots) | `src/sim/items/schema.ts`, `inventory.ts`, `itemHooks.ts`, `snapshot.ts`, `src/ui/hud.ts`, `src/ai/bot/*` |
| B4 | **Kein Hotkey/Quick-Buy** | `shop.ts` kennt nur Klick/Rechtsklick; Suche fokussiert nicht beim Öffnen | Shop öffnen → Tippen filtert sofort; Enter kauft den ersten Treffer; Doppelklick kauft; Strg+Z Undo | Beim Öffnen `search.focus()`, Enter = Kauf des ersten sichtbaren Items, Doppelklick kauft, Strg+Z → B1 | S | `src/ui/shop.ts` |
| B5 | **Suche nur nach Namen** | `shop.ts:205` (`name.includes(q)`) | Suche trifft auch Stats („Rüstung“, „Hast“) und Passiv-Namen | Suchindex pro Item: Name (de/en), `t('stat.*')` der Stats, Passiv-/Aktiv-Name, Tags | S | `src/ui/shop.ts` |
| B6 | **Hover zeigt nicht, welche Inventar-Teile verbraucht würden** | `recipePrice` liefert `consumes`, UI nutzt es nur für den Preis (`shop.ts:139`) | Beim Hover auf ein Item leuchten die eigenen Komponenten im Inventar auf | `consumes` → `.sp-slot.consumed` markieren (Gold-Rahmen) | S | `src/ui/shop.ts`, `shop.css` |
| B7 | **„Fehlt noch X Gold“ nur im Alt-Klick-Ping** | `shop.ts:326` berechnet `missing`, Karte zeigt nur Preis | Tooltip „Noch 320 Gold“ + Anzeige, wann es reicht | Preis-Badge: fehlendes Gold rot, mit Zeitangabe aus der Gold-Rate (`matchStats` kennt Gold/min) | S | `src/ui/shop.ts` |
| B8 | **Kein Kauf-/Verkaufs-Sound, kein Feedback-Blitz** | `eventSounds.ts` hat nur `gold` ≥ 100; HUD `flashItem` nur beim Benutzen (`hud.ts:316`) | Kauf-Klirren, Verkaufs-Sound, Slot leuchtet kurz | Cue `buy`/`sell` (prozedural in `sfx.ts`), Inventar-Slot-Flash beim Inventarwechsel | S | `src/audio/sfx.ts`, `src/ui/hud.ts`, `src/ui/shop.ts` |
| B9 | **Inspiration-Rabatt (−10 % Stiefel) wird im Shop nicht angezeigt** | `inventory.ts:86` (ponytail) | Preis zeigt den Rabatt | Snapshot `me.bootsMult` (PlayerHud trägt heute keine Runen, `snapshot.ts:140`) → `recipePrice` × mult | S | `src/sim/snapshot.ts`, `src/ui/shop.ts` |
| B10 | **Verkaufswert nur beim Hover über den Slot (+X unten), nicht im Tooltip** | `shop.ts:276-279` | Tooltip „Verkaufen: 2170“ | Zeile im Item-Tooltip (`tooltip.ts item:`), Verkaufs-Button sichtbar wenn Shop offen | S | `src/ui/tooltip.ts`, `shop.css` |
| B11 | **Keine Item-Sets** | nichts | Item-Sets pro Champion/Rolle im Client, im Shop als Tab | erst nach B2; eigene Sets in IndexedDB wie Prägungsseiten (`store/kv`) | M | `src/ui/shop.ts`, `src/store/kv.ts` |
| B12 | **Legendär-Struktur**: `unique` nur für Start/Stiefel; keine gemeinsamen „einzigartigen Passiva“ (z. B. zwei Lebensraub-Passiva stapeln) | `schema.ts:38-39`, `inventory.ts:90-92` | Legendäre einzigartig, Passiva mit Namen sind einzigartig über Items hinweg (ca.) | `unique` auch als Passiv-Gruppe (`uniqueGroup: 'spellblade'`), Kauf erlaubt, Passiv stapelt nicht | S | `schema.ts`, `itemHooks.ts` |
| B13 | **Shop öffnet nicht automatisch im Tod** | – | öffnet nicht automatisch (Option „Shop bei Tod öffnen“ gibt es nicht; Spieler drücken P) | nichts tun; Hinweis im Todes-Balken „P: Shop“ | S | `src/ui/deathBar.ts` |
| B14 | **Kategorie-Chips ohne Mehrfachauswahl, keine „Nur leistbar“-Option** | `shop.ts:26-29` | Filter kombinierbar (ca.) | Checkbox „Nur leistbar“ im Kopf | S | `src/ui/shop.ts` |

### Icons: Befund und Stilvorschlag

Alle Item-Icons sind prozedural (`src/ui/icons.ts:342-377`): Hintergrund-Farbton nach Stat-Kategorie (`itemHue`, `:245-261`),
ein Glyph aus **Regex auf der Item-ID** (`itemGlyph`, `:226-242`), Element-Badge rechts unten (`ITEM_ACCENT`, `:266-279`),
Tier-Rahmen (`tierFrame`, `:308-340`). Das Ergebnis ist hübsch, aber nicht unterscheidbar:

| Gruppe gleicher Glyph + Farbe | Items (Tier) |
|---|---|
| Schwert, rot | Kurzschwert (Start), Dornenklinge (Start), Langschwert (Basis), Klingenbrecher (Komp.), Kaltstahl (Komp.) |
| Stab, violett | Großer Stab (Komp.), Lehrlingsstab (Komp.), Schleierstab (Leg.), Hüterstab (Leg.) |
| Edelstein, violett | Kristallschale (Komp.), Frostkern (Leg.), Brandglas (Leg.), Funkenkelch (Leg.) |
| Schild, braun | Lederweste (Basis), Kettenhemd (Komp.), Wallherz (Leg.) |
| Mantel, blau | Wollmantel (Basis), Zauberschutzmantel (Komp.), Sturmgewand (Leg.) |
| Axt, rot | Spitzhacke (Komp.), Scharfrichterbeil (Leg.) |
| Sanduhr, violett | Uhrwerk (Komp.), Zeitglas (Leg.) |
| Stiefel (5× gleicher Glyph, nur Farbton anders) | alle 5 Stiefel |

47 Items ergeben nur **27 verschiedene Glyph+Farb-Kombinationen**; 28 Items teilen sich ein Motiv mit mindestens einem
anderen. Unterschiede entstehen nur über Rahmen und Badge, die bei 34 px im HUD (`hud.ts:214-236`) verschwinden.
Prägungs-Icons sind sogar **zufällig** (`icons.ts:709-721`: Glyph und Farbton aus dem Hash der ID; „Präzision“ kann ein Horn sein).

**Stilvorschlag (prozedural bleibt, wie vom Nutzer gewünscht):**

1. **Motiv-Tabelle statt Regex** – neue Datei `src/data/itemIcons.json`: `{ id: { glyph, hue, accent?, accentHue? } }`, jedes Item mit eigenem Glyph; Test `tests/itemIcons.test.ts`: jede ID hat einen Eintrag, kein Glyph+Hue-Paar doppelt.
2. **Vier Ebenen, pro Ebene eine Bedeutung** (Lesbarkeit bei 34 px zuerst):
   - Hintergrund = **Kategorie** (fest, satter als jetzt, ohne Pinselstriche bei < 40 px): Angriff rot-orange, Krit/Tempo gelb, Magie violett, Mana/Support türkis, Rüstung ocker, MR stahlblau, HP grün, Stiefel braun, Verbrauch grau-rosa.
   - Objekt = **Item** (eine klare Silhouette, max. 2 Farben + Glanz, 70 % der Fläche, dicke Tusche-Kontur wie die Champion-Sprites).
   - Badge = **Passiv/Aktiv** (Flamme, Frost, Blitz, Tropfen, Wundbrand-Schädel, Schild, Zahnrad), links oben statt rechts unten, 30 % größer; Aktiv-Items zusätzlich ein kleiner Cooldown-Ring-Rahmen.
   - Rahmen = **Tier** (Basis Holz, Komponente Silber, Legendär Gold mit Eckgemmen – wie jetzt; Start Leder, Stiefel Schnalle).
3. **Motiv-Schema pro Kategorie** (Beispiele, komplett in der Tabelle unten): Angriff = Klingenfamilie mit *verschiedenen* Silhouetten (kurzes breites Blatt, langes schmales, gezackt, Hacke, Dolch, Doppelaxt), Magie = Stab/Buch/Ring/Gefäß, Verteidigung = Weste/Kettengeflecht/Mauerherz/Mantel/Gürtel/Horn/Wurzel, Support = Lampe/Kelch/Relais, Stiefel = 5 Stiefelformen (flach, geflügelt, Platte, Filz, Zahnrad).
4. **Komponente → Legendär sichtbar verwandt**: Legendär übernimmt das Objekt der teureren Komponente und bekommt Akzent + Gold (Spitzhacke → Scharfrichterbeil = Hacke wird Doppelaxt; Kristallschale → Brandglas = Schale wird Linse mit Flamme).
5. **Kontaktbogen** `tools/scratch/iconSheet.html` (alle Items 64/48/34 px nebeneinander) als Abnahme-Werkzeug.

Motiv-Tabelle (Vorschlag, de-Namen; Glyph = neues Canvas-Motiv in `icons.ts`):

| Item | Glyph | Akzent | Item | Glyph | Akzent |
|---|---|---|---|---|---|
| Kurzschwert | kurzes breites Blatt | Tropfen (Lebensraub) | Langschwert | langes schmales Blatt | – |
| Dornenklinge | Blatt mit Dornenranke | Blatt grün | Wetzdolch | Dolch + Wetzstein | – |
| Spitzhacke | Hacke | – | Eiferschwert | geflügeltes Kurzschwert | Flügel |
| Blutdolch | Dolch, Tropfen am Blatt | Tropfen | Klingenbrecher | gezacktes, gebrochenes Blatt | Riss |
| Kaltstahl | Blatt mit Frostglanz | Schneeflocke | Sturmbogen | Bogen mit Blitzsehne | Blitz |
| Blutkrone | Krone mit Tropfen | Tropfen | Scharfrichterbeil | Doppelaxt | Totenkopf |
| Schwarze Kette | Kette mit Kugel | Mond | Zauberring | Ring mit Stein | – |
| Verstärkerbuch | offenes Buch | – | Großer Stab | Knotenstab, Kugel | – |
| Lehrlingsstab | kurzer Stab, Kristallspitze | – | Uhrwerk | Zahnrad | Zahnrad |
| Kristallschale | Schale mit Kristall | – | Saphirkristall | blauer Kristall | – |
| Schleierstab | Stab mit Schleier/Halbmond | Mond | Brandglas | Linse mit Flamme | Flamme |
| Funkenkelch | Kelch mit Blitz | Blitz | Frostkern | Eiskern | Schneeflocke |
| Zeitglas | Sanduhr | Zahnrad | Hüterlampe | Laterne | Sonne |
| Hüterstab | Stab mit Schild-Sonne | Sonne | Spenderlampe | Lampe mit Münzen | Münze |
| Rubinsplitter | roter Splitter | – | Riesengürtel | Gürtel mit Schnalle | – |
| Lederweste | Weste | – | Kettenhemd | Kettengeflecht | – |
| Wallherz | Herz in Mauer | – | Wollmantel | Mantel | – |
| Zauberschutzmantel | Mantel mit Rune | Rune | Sturmgewand | Gewand mit Blitz | Blitz |
| Wetterhorn | Horn | – | Lebenswurzel | Wurzelknolle | Blatt |
| Kettenrelais | Kettenring mit Schildglyph | Schild | Jägerzahn | Reißzahn | Fährte |
| Stiefel | flacher Stiefel | – | Stiefel der Schnelligkeit | Stiefel mit Flügel | Flügel |
| Panzerstiefel | Stiefel mit Platte | Schild | Filzstiefel | weicher Stiefel, Runenband | Rune |
| Uhrmacherstiefel | Stiefel mit Zahnrad | Zahnrad | Trank | Flasche rot | – |
| Siegelward | Auge im Siegel | – | | | |

Prägungen bekommen dieselbe Tabelle (`runeIcons.json`): Schlüssel groß mit Pfad-Farbe, kleine Prägungen als Glyph auf Pfad-Farbe (Vorschlag unten bei den Pfaden). Aufwand Icons gesamt: **M** (≈ 45 Motive à 10–20 Zeilen Canvas, Tabelle, Test, Kontaktbogen). Dateien: `src/ui/icons.ts`, `src/data/itemIcons.json`, `src/data/runeIcons.json`, `tests/itemIcons.test.ts`, `tools/scratch/iconSheet.html`.

### Neue Items (40: 7 Komponenten, 26 Legendäre, 3 Stiefel, 4 Verbrauch)

Preise mit der vorhandenen Gold-Effizienz-Methode (`src/ui/goldEfficiency.ts`: AD 35/Pkt, AP 21,75, HP 2,67, Rüst 20, MR 16, AS 25, Mana 1,4, Hast 50, Krit 40, Lebensraub 37,5, Lethalität 30, MS % 39,5, Heil-/Schildkraft 55), Ziel ≈ 90–105 % für die Stats, Rest ist das Passiv. Hooks: vorhandene `PassiveHook`-Callbacks (`src/sim/champions/hooks.ts:118-144`, `itemHooks.ts onTick`); Buffs: `addBuff` kinds (`buffs.ts:30`), `grievous` existiert.
**Vorbedingung V1 (S):** `ItemStat` um `magicPen`, `magicPenPct`, `armorPenPct`, `tenacity`, `hpRegenPct` als echte Stats erweitern und in `stats.ts`/`applySecondaryStats` falten; `damage.ts:84` zusätzlich % Magiedurchdringung. **V2 (M):** Stapel (B3) für Tränke/Elixiere.

Neue Komponenten (7):

| Item | Tier · Preis · aus | Stats | Passiv | Hook / Machbarkeit | Nutzen |
|---|---|---|---|---|---|
| Verbandszeug | Basis · 150 | +50 % HP-Regeneration | – | Stat (V1) | Baustein für Tank/Support |
| Fadenspule | Basis · 250 | +25 % Mana-Regeneration | – | Stat | Baustein Enchanter |
| Rabenfeder | Komp. · 1000 · Wetzdolch | +25 % AS | **Federtreffer**: Autos +15 Magieschaden | `onAutoHit` dealDamage | Recurve-Bow-Pendant (On-Hit-Pfad) |
| Sturmsehne | Komp. · 1100 · Wetzdolch + Langschwert | +20 AD, +15 % AS | – | Stat | Noonquiver-Pendant |
| Hohlspiegel | Komp. · 1050 · Verstärkerbuch + Verstärkerbuch | +50 AP, +8 Magiedurchdringung | – | Stat (V1) | Pen-Pfad für Magier |
| Hexensplitter | Komp. · 1000 · Verstärkerbuch + Rubinsplitter | +30 AP, +200 HP | – | Stat | AP-Bruiser-Baustein |
| Dornenweste | Komp. · 1100 · Lederweste + Rubinsplitter | +30 Rüst, +150 HP | **Dornen**: erlittene Autos reflektieren 12 (+8 % Bonus-Rüst) Magieschaden | `onDamageTaken` (DamageInfo braucht `isAuto`; prüfen, sonst S-Erweiterung in `damage.ts:137`) | Bramble-Pendant |

Legendär Angriff (7):

| Item | Preis · aus | Stats | Passiv / Aktiv | Hook | Nutzen |
|---|---|---|---|---|---|
| Nachtsichel | 3000 · Klingenbrecher + Kaltstahl | +55 AD, +15 Leth., +15 Hast | **Nachtjagd**: Fähigkeitstreffer auf Champions +15 % MS 2 s | `onAbilityHit` → `addBuff stat ms` | Assassinen-Mobilität |
| Sensenschwert | 3100 · Blutdolch + Spitzhacke | +55 AD, +8 % Lebensraub | **Wundbrand**: Treffer auf Champions −40 % Heilung 3 s | `onAutoHit`/`onAbilityHit` → `grievous` | AD-Anti-Heal (fehlt völlig) |
| Donnerschneide | 3000 · Rabenfeder + Spitzhacke | +35 AD, +35 % AS | **Dritter Schlag**: jeder 3. Auto +60 (+50 % Bonus-AD) Magieschaden | `onAutoHit` + Zähler im Item-State | On-Hit-Carry |
| Gezeitenbogen | 2800 · Eiferschwert + Rabenfeder | +35 % AS, +20 % Krit, +5 % MS | **Entladung**: 100 Energie durch Laufen/Autos, dann nächster Auto +80 Magie und springt auf 3 Ziele in 400 | `onTick` (Energie aus `walkedLastTick`), `onAutoHit`, `enemiesInRadius` | Statikk-Pendant, Wave-Clear für ADCs |
| Drachenzahn | 3000 · Spitzhacke + Riesengürtel | +45 AD, +400 HP | **Zahn**: Autos +2 % Max-HP des Ziels physisch (Nahkampf 3 %), max 60 vs. Monster | `onAutoHit` dealDamage | Bruiser-Anti-Tank |
| Sturmhammer | 3200 · Kaltstahl + Wetzdolch + Rubinsplitter | +35 AD, +25 % AS, +250 HP, +15 Hast | **Dreiklang**: nach einer Fähigkeit nächster Auto +150 % Basis-AD (1,5 s CD) | `onCast` armiert, `onAutoHit` löst aus | Trinity-Pendant |
| Mauerbrecher | 3100 · Klingenbrecher + Riesengürtel | +50 AD, +300 HP, +25 % Rüstungsdurchdringung | **Bresche**: +10 % Schaden an Gebäuden | Stat (V1) + `modifyDamage` (isStructure) | Splitpusher |

Legendär Magie (7):

| Item | Preis · aus | Stats | Passiv / Aktiv | Hook | Nutzen |
|---|---|---|---|---|---|
| Leerenstab | 3000 · Hohlspiegel + Lehrlingsstab | +90 AP | **Leere**: +35 % Magiedurchdringung | Stat (V1 `magicPenPct`) | Void-Staff-Pendant |
| Gewitterschale | 3200 · Kristallschale + Hohlspiegel | +95 AP, +600 Mana, +10 Hast | **Echo**: Fähigkeitstreffer trifft Gegner in 350 um das Ziel mit 100 (+10 % AP) Magie, CD 10 s | `onAbilityHit` + `enemiesInRadius` | Luden-Pendant, Poke/Clear |
| Totenbuch | 2800 · Hexensplitter + Lehrlingsstab | +80 AP, +250 HP | **Verwesung**: Fähigkeitstreffer −40 % Heilung 3 s | `onAbilityHit` → `grievous` | AP-Anti-Heal |
| Hexenfang | 3000 · Rabenfeder + Lehrlingsstab | +80 AP, +50 % AS, +15 Hast | **Fang**: Autos +15 (+20 % AP) Magieschaden | `onAutoHit` | Nashor-Pendant (AP-Autos) |
| Manaquell | 2900 · Kristallschale + Fadenspule + Verstärkerbuch | +60 AP, +800 Mana, +20 Hast | **Quelle**: +3 % Max-Mana als AP | `onComputeStats` (liest `Mana.max`) | Archangel-Pendant |
| Sternenlauf | 3000 · Hexensplitter + Uhrwerk | +70 AP, +300 HP, +25 Hast | **Lauf**: Fähigkeitstreffer auf Champions +10 % MS 3 s | `onAbilityHit` → `addBuff stat ms` | Cosmic-Drive-Pendant |
| Zauberklinge | 3000 · Lehrlingsstab + Wetzdolch + Verstärkerbuch | +90 AP, +10 Hast, +4 % MS | **Zauberklinge**: nach einer Fähigkeit nächster Auto +75 % Basis-AD +40 % AP Magie (1,5 s CD) | `onCast` + `onAutoHit` | Lich-Bane-Pendant |

Legendär Verteidigung (7):

| Item | Preis · aus | Stats | Passiv / Aktiv | Hook | Nutzen |
|---|---|---|---|---|---|
| Dornenpanzer | 2900 · Dornenweste + Kettenhemd | +70 Rüst, +350 HP | **Dornen**: reflektiert 25 (+10 % Bonus-Rüst) Magie und Wundbrand 40 % 3 s bei erlittenen Autos | `onDamageTaken` (isAuto) | Thornmail; Anti-Heal für Tanks |
| Glutpanzer | 2800 · Kettenhemd + Riesengürtel | +50 Rüst, +450 HP | **Glut**: 15 (+1,5 % Bonus-HP) Magieschaden/s an Gegner in 350 | `onTick` + `enemiesInRadius` (jeden 5. Tick) | Sunfire; Wave-Clear für Tanks |
| Seelenspiegel | 2900 · Zauberschutzmantel + Verbandszeug + Rubinsplitter | +50 MR, +400 HP, +10 Hast, +100 % HP-Regen | **Spiegel**: eigene Heilung +25 % | `modifyHeal` wenn `target === eid`; prüfen, ob `healUnit` (Lebensraub) `modifyHeal` durchläuft, sonst dort anhängen | Spirit-Visage |
| Naturkraft | 2800 · Zauberschutzmantel + Wollmantel + Rubinsplitter | +60 MR, +350 HP, +5 % MS, +20 Zähigkeit | **Erdung**: nach Magieschaden +10 MR pro Stapel (max 5, 5 s) | `onDamageTaken` (type magic) → `addBuff stat mr` | Force-of-Nature |
| Kriegsschild | 2800 · Kettenhemd + Wetterhorn | +60 Rüst, +350 HP | **Aktiv**: Gegner in 450 −50 % MS 2 s (CD 60 s); **Passiv**: Kritschaden gegen dich −20 % | `USE` + `enemiesInRadius` + `slow`; Passiv `modifyDamage`-Seite fehlt → als Stat `dmgReduction` nur vs. Krit: M, oder Passiv weglassen (S) | Randuin |
| Abgrundmaske | 2800 · Zauberschutzmantel + Wetterhorn | +50 MR, +350 HP, +10 Hast | **Abgrund**: Aura 550: Gegner −10 % MR | wie `rampart_heart` (`addBuff stat mr pct −10`) | Abyssal |
| Steinhaut | 3000 · Kettenhemd + Zauberschutzmantel | +45 Rüst, +45 MR, +10 Hast | **Aktiv**: Schild 40 % Max-HP für 2,5 s, −50 % Schaden ausgeteilt (CD 90 s) | `USE` → `addShield` + `addBuff stat dmgDealt −50` | Gargoyle |

Legendär Unterstützung (5):

| Item | Preis · aus | Stats | Passiv / Aktiv | Hook | Nutzen |
|---|---|---|---|---|---|
| Glutweihrauch | 2300 · Hüterlampe + Verstärkerbuch + Fadenspule | +50 AP, +15 Hast, +10 % Heil-/Schildkraft | **Weihrauch**: geheilte/geschildete Verbündete +25 % AS und +15 Magie auf Autos 6 s | `modifyHeal` (target ≠ eid) → `addBuff stat as` + Markierung, `onAutoHit` des Verbündeten prüft Buff (`hasBuff`) | Ardent Censer |
| Quellstab | 2300 · Hüterlampe + Lehrlingsstab | +45 AP, +15 Hast, +10 % Heil-/Schildkraft | **Strom**: geheilte/geschildete Verbündete +40 AP und +15 % MS 4 s | `modifyHeal` → `addBuff stat ap/ms` | Staff of Flowing Water |
| Mondstein | 2300 · Hüterlampe + Wetterhorn | +200 HP, +20 Hast, +12 % Heil-/Schildkraft | **Echo**: Heilungen/Schilde auf Verbündete heilen zusätzlich den schwächsten Verbündeten in 700 um 30 % | `modifyHeal` → `heal` auf `nearestAlly`-Variante (niedrigste HP) | Moonstone |
| Sturmruf | 2400 · Wetterhorn + Uhrwerk | +250 HP, +20 Hast, +8 % Heil-/Schildkraft | **Aktiv**: Verbündete in 1000 +30 % MS 4 s (CD 90) | `USE` + `alliedChampionsIn` | Shurelya |
| Reinigungsgefäß | 2200 · Hüterlampe + Fadenspule + Wollmantel | +40 MR, +15 Hast, +10 % Heil-/Schildkraft | **Aktiv**: entfernt CC von einem Verbündeten in 650 und heilt 150 (+15 % AP) (CD 120) | `USE` mit Ziel (`useItem` hat x/y → nächster Verbündeter am Punkt) + `removeBuffs` CC-Kinds wie Reinigen | Mikael |

Stiefel (3) und Verbrauch (4):

| Item | Tier · Preis · aus | Stats | Passiv | Hook | Nutzen |
|---|---|---|---|---|---|
| Flinkstiefel | Stiefel · 1100 · Stiefel | +45 MS, +30 % AS | – | Stat | Berserker |
| Zauberstiefel | Stiefel · 1100 · Stiefel | +45 MS, +15 Magiedurchdringung | – | Stat (V1) | Sorcerer |
| Pfadfinderstiefel | Stiefel · 1000 · Stiefel | +45 MS | **Pfad**: außerhalb des Kampfes (5 s) +70 MS | `onTick` + `lastCombatTick` → `addBuff stat ms flat` | Mobility |
| Nachfüllbarer Trank | Verbrauch · 150 | – | 2 Ladungen à 100 HP über 12 s, lädt im Brunnen nach | Ladungs-Zähler im Item-State (V2-nah) | LoL-Standard-Start |
| Elixier des Zorns | Verbrauch · 500 (ab Level 9) | – | 3 min: +30 AD, +12 % MS, Kills verlängern | `useItem` → `addBuff stat ad/ms` 5400 Ticks | Late-Game-Kaufziel |
| Elixier der Zauberei | Verbrauch · 500 (ab Level 9) | – | 3 min: +50 AP, Autos/Fähigkeiten +25 absoluter Schaden | `addBuff stat ap` + `onAutoHit`/`onAbilityHit` true dmg solange Buff | – |
| Elixier des Eisens | Verbrauch · 500 (ab Level 9) | – | 3 min: +300 HP, +25 Zähigkeit, Figur 15 % größer (nur Render) | `addBuff stat`, `tenacity` (V1) | – |

Bots: jedes neue Item braucht Einträge in `src/data/builds/*.json`, sonst kaufen Bots es nie (Build-Validierung in `src/ai/bot/builds.ts`); Vorschlag: pro Archetyp 1–2 neue Items in `vsAD`/`vsAP`/`situational`.

### Prägungen: Befund

- 16 Prägungen, davon 8 reine Stat-Zeilen („+6 Rüstung“); Seite = 1 Schlüssel + 3 kleine (`src/sim/items/runes.ts:9-12`, `src/game/runePages.ts:8`, `validPage`). Das ist LoL-Stufe „Splitter“, nicht „Pfade“.
- Nur 4 Schlüsselprägungen: ADC/Duellant (Präzision), Burst (Dauerhafter Schaden), Tank (Zähigkeit), Enchanter/Magier (Inspiration). Kein Schlüssel für Kiting/Fleetfoot-Spiel, Tank-Engage (Aftershock), Skirmish-Heilung (Conqueror), Bruiser-Sustain (Grasp), Poke (Arcane Comet), Mobilität (Phase Rush), Objektiv/Splitpush (Demolish-ähnlich).
- Icons zufällig (`icons.ts:709-721`).
- UI: Editor zeigt Schlüssel + 12 Kacheln (`src/ui/runePages.ts`), keine Pfadlogik.

### Prägungen: Vorschlag in zwei Stufen

**Stufe 1 (passt ins heutige 1+3-Modell, S–M, „mehr Runen“ sofort):** 9 neue Schlüssel + 14 neue kleine in `runes.json`, Hooks in `runeHooks.ts`, Presets/Builds ergänzen. Namen deutsch wie bisher. Wo unten „umbenannt“ steht, ist der Anzeigename gemeint; die `id` bleibt (Presets, `builds/*.json` und `tests/runes.test.ts` hängen daran).

Neue Schlüsselprägungen:

| Prägung | Effekt (Zahlen) | Hook | Passt zu |
|---|---|---|---|
| Eroberer | Autos/Fähigkeitstreffer auf Champions stapeln +2 Adaptiv (max 10 Stacks, 6 s); bei 10 Stacks heilen 8 % des Schadens an Champions | `onAutoHit`/`onAbilityHit` (Stack-Buff `stat ad/ap`), `modifyDamage` → heal | Kämpfer, Nahkampf |
| Flinkfuß | 100 Energie durch Laufen/Autos (wie Gezeitenbogen); voll → nächster Auto heilt 10 (+10 % AD, +5 % AP) (Fernkampf 60 %) und +20 % MS 1 s | `onTick`, `onAutoHit` | Kiting-ADC, Lane-Sustain |
| Nachbeben | nach eigenem CC auf einen Champion: +35 (+50 % Bonus-Rüst/MR) Rüst/MR 2,5 s, dann Explosion 25 (+8 % Max-HP) Magie in 350 (CD 20 s) | `onAbilityHit` mit CC-Prüfung (`ctx.ability.effects` enthält stun/root/knockup) → `addBuff`, `onTick` Explosion | Tank-Engage |
| Erstschlag | Schaden an einem Champion, der dich in den letzten 3 s nicht getroffen hat: +7 % Schaden 3 s und 100 % davon als Gold (max 50; CD 25 s) | `modifyDamage` + `onDamageTaken`-Zeitstempel, `reward` | Poke/Assassinen, Gold-Skalierung |
| Frostbann | eigener CC auf einen Champion hinterlässt ein Frostfeld (Radius 250, 3 s): Gegner darin −30 % MS und −10 % Schaden | `onAbilityHit` mit CC-Prüfung → Zone (`addZone`-Event + `onTick`-Slow) | Tank-/Support-Engage |
| Komet | Fähigkeitstreffer auf Champion: Komet nach 0,8 s 30–100 (+20 % Bonus-AD, +10 % AP) Magie am Ziel (CD 12 s) | `onAbilityHit` → verzögerte Projektil-/Zone-Instanz (`spawnProjectile` kind homing existiert) | Poke-Magier |
| Phasenlauf | 3 Treffer auf Champion in 3 s: +30 % MS 3 s (CD 25 s) | wie `rune_lasting_harm` Zähler → `addBuff stat ms` | Mobilität |
| Dunkle Ernte | Treffer auf Champion unter 50 % HP: +20 (+5 pro Seele, +25 % Bonus-AD, +15 % AP) adaptiv; Seele pro Proc (CD 40 s, Takedown setzt zurück) | `onAutoHit`/`onAbilityHit`, `onTakedown`, Seelenzähler | Skalierende Assassinen/Magier |
| Hüterin | Verbündete in 350, die du heilst/schildest oder die neben dir Schaden nehmen: Schild 40–120 (+15 % AP) für 2 s auf beide (CD 70 s) | `modifyHeal`, `onDamageTaken` des Verbündeten → braucht Hook-Dispatch für „nahe Verbündete“: M | Support |

(`dauerhafter_schaden` ist bereits das Electrocute-Pendant; kein Duplikat nötig. Zähigkeit bleibt als Keystone bestehen, „Griff“ ist die Bruiser-Variante daneben.)

Neue kleine Prägungen:

| Prägung | Effekt | Hook |
|---|---|---|
| Abriss | nach 3 s neben einem gegnerischen Turm: nächster Auto +100 (+30 % Max-HP) auf den Turm (CD 45 s) | `onTick` (Turm in 600), `onAutoHit` (isStructure) |
| Überheilung | Überschüssige Heilung/Lebensraub wird Schild (max 10 % Max-HP, verfällt nach 25 s) | `onAutoHit` `info.overheal` wie Blutkrone, plus `modifyHeal`-Überschuss |
| Triumph | Takedown heilt 10 % fehlende HP, +20 Gold | `onTakedown` → `heal`, `reward` |
| Letzter Stand | unter 60 % HP +5 % Schaden, unter 30 % +11 % | `modifyDamage` |
| Zielstrebigkeit | +3 % Schaden an Zielen mit mehr aktueller HP als du (≥ 200 Unterschied) | `modifyDamage` |
| Gelegenheit | nach einem Dash/Blink oder dem Ende von Unsichtbarkeit: +12 Lethalität / +10 Magiedurchdringung 5 s | `onDashEnd` → `addBuff stat` (`lethality`/`magicPen` als StatKey fehlen: S) |
| Verwüstung | Schaden über Zeit (DoTs, Brandglas, Glut) +20 % | `modifyDamage` (braucht `dot`-Flag in `DamageOpts`: S) |
| Wasserlauf | im Fluss (Band um die Diagonale Leviathan–Schleierwächter) +25 MS und +8 Adaptiv | `onTick` + Fluss-Test (Polygon in `map.json` ergänzen) |
| Knochenpanzer | nach Schaden durch einen Champion: −20 % Schaden für 1,5 s (CD 40 s) | `onDamageTaken` → `addBuff stat dmgReduction` |
| Erholung | unter 25 % HP: +100 % HP-/Mana-Regeneration | `onTick` → `addBuff stat` (Regen über `hpRegenPct`, V1) |
| Überwucherung | +6 HP pro 8 getöteten Minions/Monstern (max 20×), bei 20× zusätzlich +3,5 % Max-HP | `onKill` Zähler → `runeStats` |
| Unerschütterlich | +15 Zähigkeit, +15 % Slow-Resistenz | Stat (V1 `tenacity`; Slow-Resistenz in `finalMs` einziehen, S) |
| Keksvorrat | bis 6:00 alle 2 min außerhalb des Kampfes unter 40 % HP: +10 % fehlende HP/Mana, +50 permanentes Max-Mana (max 3×) | `onTick` + `lastCombatTick`, Zähler → `runeStats` |
| Zeitgewinn | +10 Hast, +1 Hast pro 2 Minuten (max +15) | `runeStats` (tick-abhängig) |

**Stufe 2 (LoL-Pfadmodell, L):** 5 Pfade × (3 Schlüssel + 3 Reihen × 3 kleine) = 15 Schlüssel + 45 kleine + 3 Splitter-Reihen; Seite = Schlüssel + 3 Primär (je Reihe 1) + 2 Sekundär (2 Reihen eines zweiten Pfads) + 3 Splitter.

| Pfad | Farbe/Glyph | Schlüssel (3) | Reihe 1 | Reihe 2 | Reihe 3 |
|---|---|---|---|---|---|
| **Präzision** (Gelb, Pfeilbündel) | | Präzision (bestehend), Eroberer, Flinkfuß | Überheilung · Triumph · Vorwärtsdrang (= bestehend `angriffstempo`) | Legende: Tempo · Legende: Blutlinie (`blutdurst` skalierend) · Legende: Zähigkeit | Gnadenstoß (bestehend) · Letzter Stand · Zielstrebigkeit |
| **Dominanz** (Rot, Dolch) | | Dauerhafter Schaden (bestehend, umbenannt Elektrisierung), Dunkle Ernte, Hagel (Autos auf Champions nach 1 s Abstand +Schaden) | Gelegenheit · Blutgeschmack (Schaden heilt 15–40 alle 20 s) · Plötzlicher Einschlag | Augenball-Sammlung (+Adaptiv pro Takedown) · Spähfrucht-Jäger · Ward-Jäger | Schatzjäger (Gold pro Takedown) · Erbarmungslos (+MS gegen Gegner < 50 %) · Ultimativer Jäger (R-Hast pro Takedown) |
| **Zauberei** (Blau, Komet) | | Komet, Phasenlauf, Beschwörung: Aery (Schild/Schaden-Pet) | Nullifizierender Orb (Magieschild unter 30 %) · Manafluss (bestehend) · Nimbus-Mantel (MS nach Beschwörerzauber) | Transzendenz (Hast pro Level) · Beschleunigung (+5 % MS für 1,5 s nach jedem Zauber) · Absolute Konzentration (+Adaptiv über 70 % HP) | Sengen (Burn alle 10 s) · Wasserlauf · Sturm sammeln (+AP/AD alle 10 min) |
| **Entschlossenheit** (Grün, Schild) | | Zähigkeit (bestehend, = Grasp-Pendant), Nachbeben, Hüterin | Abriss · Lebensquelle (CC → Heilung durch Verbündete) · Schildschlag (Auto nach Schild +Schaden) | Knochenpanzer · Konditionierung (+Rüst/MR ab 12:00) · Zweiter Wind (bestehend) | Überwucherung · Wiedergeburt (unter 25 % HP Heilung + Zähigkeit) · Unerschütterlich (Slow-Resistenz) |
| **Inspiration** (Türkis, Zahnrad) | | Inspiration (bestehend, umbenannt Magisches Schuhwerk), Glacial-Augment-Pendant „Frostbann“ (CC → Slow-Feld), Erstschlag (erster Treffer +Schaden & Gold) | Hextech-Flashtraption („Blinkkanal“) · Magisches Schuhwerk (= Inspiration) · Keksvorrat | Tempoanpassung (+Hast Beschwörer) · Zeitgewinn · Bio-Brennstoff (Elixier-Boost) | Kosmische Einsicht (+Beschwörer-/Item-Hast) · Herannahende Geschwindigkeit (MS zu verlangsamten Gegnern) · Zeitverzerrter Tonikum (Tränke sofort) |

Migration: `RuneData` um `path`, `row` (0 = Schlüssel, 1–3), `shard?: 'offense'|'flex'|'defense'`; `RuneChoice` → `{ keystone, primary: [a,b,c], secondary: [d,e], shards: [s1,s2,s3] }` mit Rückwärts-Lesen alter Seiten (alte 1+3 → Primärreihen füllen, Rest Standard); `validPage` prüft Pfad/Reihen; `runePresets.json` und `builds/*.json` per Skript (`tools/scratch`) regenerieren; Lobby-UI `src/ui/runePages.ts` neu (Pfad-Spalten wie LoL, `classicLobby.ts` Preset-Karten zeigen Pfad-Farben), `botRunes` unverändert (Presets). **Aufwand L** (Datenmodell M, Hooks für ≈ 50 neue Prägungen M–L, UI M).

---

## Empfehlung

### Die 5 Änderungen, die „clumsy“ am meisten reduzieren (Reihenfolge = Reihenfolge)

1. **A1 Cast-Pose beim Laufen abbrechen** – S, sofort sichtbar in jedem Kampf.
2. **A3 Sofortige Blickrichtung/erster Schritt beim Klick (render-only)** – S, nimmt der Eingabe die „Netz-Schwammigkeit“, ohne die Sim anzufassen.
3. **A2 Laufzyklus ans Bewegungstempo koppeln** – S–M, beendet das Foot-Sliding mit Stiefeln/Slows.
4. **A6 Wind-up-Frames aus dem Snapshot (`atkEnd`) statt Schätzung** + **A7 Treffer-Feedback (Flash-Gate 120 ms, Flinch 14, Hit-Spark bei Last-Hits)** – S, macht Autos „satt“.
5. **A4 Standbilder in der ersten Minute weg (Atlas-Bake nach dem Start drosseln + 1 Tick Extrapolation statt Freeze)** – S, trifft genau den „ruckelt am Anfang“-Eindruck; danach A5 (Halb-Lock-Kamera) als Komfort.

### Reihenfolge für Shop / Items / Prägungen

1. **Fundament (S):** V1 Stat-Schema (`magicPen`, `magicPenPct`, `armorPenPct`, `tenacity`, `hpRegenPct`) + B12 Passiv-Gruppen – ohne das sind ein Drittel der neuen Items nicht baubar.
2. **Shop-Funktionen, die LoL-Spieler sofort vermissen (M):** B1 Undo (Sim-Befehl + Button + Strg+Z), B2 Empfohlen-Ansicht mit Start/Stiefel/Kern/Situativ und „als Nächstes“, B4/B5/B6/B7 Kleinkram (Suche fokussiert + Enter kauft, Stat-Suche, verbrauchte Komponenten markieren, fehlendes Gold), B8 Kauf-Sound.
3. **Icons (M):** Motiv-Tabelle `itemIcons.json` + `runeIcons.json`, ≈ 45 neue Glyphen, Kontaktbogen; Test auf Eindeutigkeit. Erst nach Schritt 4 fertig abnehmen, damit die neuen Items gleich mit drin sind.
4. **Items (M–L, in Paketen):** Paket 1 = 7 Komponenten + Anti-Heal (Sensenschwert, Totenbuch, Dornenpanzer) + Stiefel; Paket 2 = Angriff/Magie-Legendäre; Paket 3 = Verteidigung/Support; Paket 4 = Verbrauch (braucht B3 Stapeln). Jedes Paket mit Build-Einträgen für Bots und `tests/items.effects.test.ts`-Fällen.
5. **Prägungen Stufe 1 (M):** 9 Schlüssel + 14 kleine im 1+3-Modell, Presets erweitern (5. Preset „Experimentell“ pro Champion). **Stufe 2 (L)** Pfadmodell erst, wenn Stufe 1 bespielt ist.
