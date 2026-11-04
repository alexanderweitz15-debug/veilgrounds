# Audio (A5)

Alle Töne sind prozedural (WebAudio, keine Dateien). Aufbau in `src/audio/`:

| Datei | Aufgabe |
|---|---|
| `manager.ts` | `AudioManager`: ein `AudioContext`, vier Kanäle (Busse) `sfx`, `ui`, `ambient`, `music` unter Master + Kompressor; Räumlichkeit, Stimmenbegrenzung, Aufräumen der Knoten |
| `voices.ts` | `VoiceAllocator`: Stimmenlimit je Kategorie und global, Priorität, Dedupe (rein, deterministisch, ohne AudioContext) |
| `spatial.ts` | Pan und Entfernungsdämpfung relativ zur Kamera, Off-Screen-Dämpfung, eigener Champion immer hörbar, Prioritätsformel |
| `sfx.ts` | Klangtabelle (`CUES`) und die Synthese je Klang; Fassade `play`, `playCast`, `playAnnounce`, `playFizzle`, `audioUnlock`, `audioStop` |
| `eventSounds.ts` | Sim-Ereignisse (schon nebelgefiltert) auf Klänge abbilden, mit Beziehung zum eigenen Champion |
| `triggers.ts` | Abonnement-API für Animations- und Game-Feel-Ereignisse |
| `ambient.ts` | Platzhalter-Umgebung (leiser Wind), läuft auf dem Kanal `ambient` |

## Kanäle und Lautstärken

Einstellungen (`src/settings.ts`, Werte 0..1, im Einstellungsmenü): `volume` (Gesamt), `volumeSfx` (Welt: Fähigkeiten,
Autoangriffe, Türme, Tode), `volumeUi` (Rückmeldungen: Klick, Ping, Gold, Level-up, Last-Hit, Ansage, Kill-Bestätigung),
`volumeAmbient` (Umgebung), `volumeMusic` (reserviert, es gibt noch keine Musik). Der Bus je Klang steht in der Tabelle.

## Räumlichkeit

Hörer = Kamerazentrum (`setListener`, jeden Frame aus `game.ts`). Innerhalb des Bildschirmradius (1300 Einheiten) fällt
die Lautstärke linear von 1 auf 0,7; außerhalb quadratisch auf 0 beim Hörradius (2600): Off-Screen deutlich leiser, danach
verworfen. Pan = seitlicher Abstand / Bildschirmradius. Der eigene Champion (`rel: Rel.Own`) wird nie verworfen,
mindestens 0,85 laut, Pan höchstens ±0,5. Klänge ohne Position (UI, Ansage, Ping, Welle) sind überall gleich laut.

## Stimmenbegrenzung

Jeder Klang gehört zu einer Kategorie (`Cat`): Cast 8, Auto 6, Minion 4, Structure 3, Event 5, Ui 5 Stimmen, global 20
(`DEFAULT_LIMITS` in `voices.ts`). Ist eine Grenze erreicht, verdrängt ein Klang mit höherer Priorität die schwächste
laufende Stimme (bei Gleichstand die älteste); sonst wird der neue Klang verworfen. Ein abgelehnter Klang schneidet nie
etwas ab. Dedupe: derselbe Klang (je Klang oder je Quelle, `perSource`) startet frühestens nach `cooldown` Sekunden erneut.

Priorität = Basis aus der Tabelle + Beziehung + Nähe:

- eigener Champion: immer 100 (`PRIORITY_OWN`), verdrängt alles, nur ein 12-ms-Schutz gegen Doppelstart
- gegnerischer Champion +25, verbündeter +10, Neutral/Minions/Türme +0 (die Beziehung setzen nur Aufrufer, die einen
  Champion meinen; `eventSounds.ts` tut das)
- bis +10 für Klänge nahe der Bildschirmmitte, nichts außerhalb des Bildes

## Autoplay

Der `AudioContext` entsteht erst in `audioUnlock()` (Eingabe-Handler in `game.ts`: `pointerdown`, `keydown`). Solange er
nicht `running` ist, tun alle `play*`-Aufrufe nichts. Ein abgelehntes `resume()` wird verschluckt; die nächste Eingabe
versucht es erneut. Fehlt WebAudio ganz, bleibt der Client stumm, ohne Fehler.

## Speicher

Jeder Klang legt eine Gain-/Panner-Kette plus je Quelle Oszillator oder Rauschen mit Hüllkurve an. Endet die letzte
Quelle (`onended`), wird die Kette abgetrennt und freigegeben; eine verdrängte Stimme wird in 8 ms ausgeblendet und
ebenso freigegeben. Der Rauschpuffer ist einmalig. `tests/audioManager.test.ts` spielt 30 simulierte Minuten und prüft,
dass danach kein Knoten mehr am Ausgang hängt.

## Neuen Klang hinzufügen

1. In `sfx.ts` den Namen zum Typ `Cue` hinzufügen und eine Zeile in `CUES` ergänzen:
   `def(Cat.<Kategorie>, '<sfx|ui>', <Basispriorität 0..99>, <Cooldown s>, { perSource, gain, spatial })`.
   Viele gleichzeitige, leise Klänge: eigene niedrige Priorität und `perSource`/Cooldown; Rückmeldung an den Spieler:
   Bus `ui`, `spatial: false`.
2. In `play()` ein `case` mit der Synthese: `tone(v, Wellenform, f0, f1, Dauer, Spitze, Anstieg, Verzögerung)` und
   `noise(v, Dauer, Frequenz, Q, Spitze, Filtertyp, Verzögerung)`. Mehrere Noten: `Verzögerung` statt neuer Stimme.
3. Auslösen: aus einem Sim-Ereignis in `eventSounds.ts` (`play('name', x, y, champOpts(e, me))`) oder über einen Trigger.
4. Klangdatei statt Synthese: Datei nach `public/audio/`, Eintrag mit Quelle und Lizenz in `docs/ASSETS-LICENSES.md`
   (nur CC0 o. ä.). Dann in `manager.ts` einen Dateiweg ergänzen (Puffer laden, `AudioBufferSourceNode` über `track()`
   durch dieselbe Kette führen); die Stimmenlogik bleibt gleich.

## Auslöser (A3 Animation, A8 Game Feel)

```ts
import { emitTrigger, onTrigger, Rel } from '../audio/sfx';
emitTrigger('footstep', { x, y, src: eid, rel: Rel.Own });                       // Fußaufsatz
emitTrigger('hitFrame', { x, y, src: eid, rel: Rel.Enemy });                     // Treffer-Frame
emitTrigger('release', { x, y, src: eid, abilityId, abilityType, ultimate });   // Projektil / Effekt verlässt den Wirker
emitTrigger('killConfirm');                                                     // Kill-Bestätigung (A8)
const off = onTrigger('footstep', (p) => { /* eigener Klang */ });              // zusätzlicher Handler, off() zum Abmelden
```

Standard-Handler (`installDefaultTriggers`): `footstep` -> Klang `footstep`, `hitFrame` -> `hit`, `release` -> `playCast`,
`killConfirm` -> `killConfirm`. Ein werfender Handler stört den Aufrufer nicht. Achtung beim Anbinden: `eventSounds.ts`
spielt heute schon `auto` (Abschuss) und `hit` (Schaden-Ereignis) sowie `playCast` beim `cast`-Ereignis; wer
`hitFrame`/`release` zusätzlich auslöst, muss die entsprechende Stelle in `eventSounds.ts` abschalten, sonst klingt es doppelt.

## Debug

Mit `?bench` (und im Dev-Server) liegt `window.__vgAudio.stats()` bereit: `active`, `activeByCat`, `peak`, `started`,
`deduped`, `denied`, `stolen`, `liveNodes`, `peakLiveNodes`, `running`.
