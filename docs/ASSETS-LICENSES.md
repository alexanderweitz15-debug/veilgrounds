# Assets und Lizenzen

Veilgrounds hat keine Bild-, Ton- oder Modelldateien: Sprites, Icons, Terrain und Töne werden zur Laufzeit im Code
erzeugt (siehe `docs/ART.md`). Die einzigen mitgelieferten Fremddateien sind die Schriften.

## Schriften (`public/fonts/`)

Selbst gehostet seit A1 (2026-10-24). Vorher kamen sie von `fonts.googleapis.com` als render-blockierendes Stylesheet; ist
dieser Host langsam oder gesperrt, wartete die ganze Seite. Jetzt: gleiche Familien, gleiche Schnitte, `font-display:
swap`, Stylesheet `public/fonts/fonts.css` (gleicher Ursprung), Aufruf in `index.html`.

| Schrift | Schnitte | Datei(en) | Lizenz | Quelle |
|---|---|---|---|---|
| Barlow | 400, 500, 600 | `barlow-400/500/600.woff2` | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) |
| Barlow Condensed | 500, 600, 700 | `barlow-condensed-500/600/700.woff2` | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors |
| Spectral SC | 600, 700 | `spectral-sc-600/700.woff2` | SIL Open Font License 1.1 | Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral) |

- Dateien: die **Latin**-Teilmenge der WOFF2-Dateien, wie Google Fonts sie ausliefert (abgerufen 2026-10-24 von
  `fonts.gstatic.com`, Barlow v13). Sie deckt Deutsch ab (ä ö ü ß, €, typografische Anführungszeichen und Striche,
  Unicode-Bereiche U+0000-00FF, U+2000-206F, U+20AC u. a.). Zeichen außerhalb (z. B. Latin-Extended wie ő) fallen auf
  die Systemschrift zurück (`sans-serif` / `Georgia`, wie bisher im CSS).
- Die vollständigen Lizenztexte liegen unverändert in `public/fonts/OFL.txt` und werden mit ausgeliefert (die OFL
  verlangt, dass Kopie und Copyright-Hinweis die Schrift begleiten). Die OFL erlaubt Einbetten, Weitergeben und
  kommerzielle Nutzung; die Schriften dürfen nicht für sich allein verkauft werden und geänderte Fassungen dürfen den
  reservierten Namen nicht tragen (wir haben nichts geändert).
- Die Schriften werden nicht mehr von Google nachgeladen: Es gehen keine Besucherdaten an fremde Hosts.

## Andere Bestandteile

| Teil | Lizenz |
|---|---|
| Three.js 0.170, bitecs 0.4 (npm-Abhängigkeiten, im Bundle) | MIT |
| `public/icon.svg`, `public/manifest.webmanifest` | eigene Arbeit (Projekt) |
| Sprites, Icons, Terrain, Töne | prozedural im Projektcode erzeugt, keine Fremdassets |
