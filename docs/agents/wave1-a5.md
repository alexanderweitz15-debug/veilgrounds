# Welle 1 – A5 Audio (feat/a5-audio)

## Was
Neue Audio-Schicht unter `src/audio/` (Anleitung: `docs/AUDIO.md`):

- `manager.ts`: ein `AudioContext`, Busse `sfx`/`ui`/`ambient`/`music` unter Master + Kompressor, Kontext erst in
  `audioUnlock()` (Geste), Stimmen-Kette pro Klang mit Aufräumen über `onended`, Debug-Zähler.
- `voices.ts`: reiner, deterministischer Stimmen-Verteiler: Limit je Kategorie (Cast 8, Auto 6, Minion 4, Structure 3,
  Event 5, Ui 5) und global 20, Priorität (eigener Champion 100 > gegnerischer Champion nah > Verbündeter > Minion/fern),
  Verdrängung der schwächsten/ältesten Stimme, Dedupe/Cooldown je Klang oder je Quelle.
- `spatial.ts`: Pan + Dämpfung relativ zur Kamera, Off-Screen deutlich leiser, Hörradius 2600, eigener Champion nie
  verworfen (>= 0,85, Pan ±0,5).
- `sfx.ts`: bestehende Synthese unverändert im Klang, jetzt über Klangtabelle (Kategorie, Bus, Priorität, Cooldown);
  neue Klänge `footstep`, `killConfirm`. API rückwärtskompatibel (`play`, `playCast`, `playAnnounce`, `playFizzle`,
  `setListener`, `setVolume`, `audioUnlock`); neu optionales `opts` (`rel`, `src`, `boost`) und `audioStop()`.
- `triggers.ts`: `emitTrigger`/`onTrigger` für `hitFrame`, `release`, `footstep` (A3) und `killConfirm` (A8), mit
  Standard-Klängen.
- `ambient.ts`: leiser Wind als Platzhalter auf dem Kanal `ambient`. Musik: nur der Kanal, kein Inhalt.
- `eventSounds.ts`: gibt Beziehung (eigener/verbündet/gegnerisch) und Quelle an die Klänge weiter.

Einstellungen (additiv): `volumeSfx`, `volumeUi`, `volumeAmbient`, `volumeMusic` (+ bestehendes `volume` = Master);
i18n `set.volumeSfx/Ui/Ambient/Music`; Label `set.volume` jetzt „Gesamtlautstärke" / „Master volume".
Keine Audiodateien; `docs/ASSETS-LICENSES.md` hat den Abschnitt „Audio" (leere Tabelle, Regeln).

## Geteilte Änderungen (außerhalb des Besitzbereichs, minimal)
- `src/game/game.ts`: `soundForFire(e, this.state)` (Beziehung zum eigenen Champion), `audioStop()` in `dispose()`.
- `src/ui/settingsPanel.ts`: vier weitere Schieberegler in der vorhandenen Slider-Liste (A19 darf sie neu anordnen).
- `src/game/settingsIO.ts`: Wertebereiche 0..1 für die vier neuen Schlüssel (Import-Klemmung).

## Tests
`tests/audioVoices.test.ts` (13: Caps, Verdrängung, Dedupe, Ablauf, Determinismus, Teamfight), `tests/audioSpatial.test.ts`
(6), `tests/audioManager.test.ts` (14, Mock in `tests/audioMock.ts`: Autoplay blockiert/ok, fehlendes WebAudio, Busse und
Lautstärken, Culling, Kategorie-Limit, Dedupe, verdrängte Stimme, **30 Minuten simuliert: danach 0 Knoten am Ausgang**,
Trigger, Ambient). Auch grün: `i18n`, `settingsIO`. `npx tsc --noEmit` sauber, `npx vite build` ok.

## Produktionsprüfung (vite preview, Chromium/SwiftShader, `?play=lane&bench`, ~70 s, Gesten per Klick)
Keine Konsolenfehler (nur die bekannte Fenna-Warnung der Asset-Pipeline). Weil die 1-gegen-1-Lane in der Minute kaum
Klänge erzeugt, feuert der Test über `window.__vgAudio.stress(60)` alle 60 ms zufällige Teamfight-Klänge: 945 gestartet,
422 dedupliziert, 262 abgelehnt, 406 verdrängt, **Spitze 20 gleichzeitig (Limit 20)**, je Kategorie höchstens
[7, 4, 1, 1, 4, 2] (Limits 8/6/4/3/5/5), Spitze 298 lebende Knoten, am Ende `active 0`.
Debug: `window.__vgAudio.stats()` (nur mit `?bench` oder Dev).

## Offen / Risiken
- Gehört nicht zu mir, aber vorbereitet: A3 und A8 müssen `emitTrigger(...)` selbst aufrufen; bei `hitFrame`/`release`
  klingt es doppelt, solange `eventSounds.ts` `hit`/`cast` ebenfalls spielt (siehe `docs/AUDIO.md`, Abschnitt Auslöser).
- Echte Hörprüfung (Lautheit der neuen Ambient-Schicht, Fußtritte) fehlt, es gibt hier kein Audiogerät. Ambient-Pegel
  0,05 × Kanal 0,5 ist bewusst sehr leise gewählt.
- Gestohlene Stimmen halten ihre Knoten bis zum natürlichen Ende der Quellen (höchstens ~1,5 s).
- Musik-Kanal ohne Inhalt; Schieberegler ist trotzdem sichtbar.
