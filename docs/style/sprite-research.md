# Sprite-Recherche: Lesbarkeit und Premium-Look kleiner Top-down-Figuren

Stand: Oktober 2026. Kontext: Veilgrounds-Champions sind prozedurale, gemalte 2D-Sprites
(„Gouache-Dämmerung“: Gouache-Wertstufen, kühle violette Schatten, warmes Randlicht, Tuschkontur),
aus einem 3D-artigen Rig in Atlanten gebacken. Spielgröße: 112 px Zelle (Champions), 96 px (Vasallen),
Kamera ca. 56° von oben, Hauptlicht = tiefe warme Abendsonne von hinten-rechts plus violette Himmelsfüllung.
Teamfarbe nur über den Bodenring.

Hinweis zur Quellenlage: Befunde stammen nur aus Seiten, die tatsächlich geöffnet wurden. Gefundene, aber
nicht abrufbare oder nicht selbst geöffnete Seiten sind als solche markiert und tragen keine Aussage.
Alle **Zahlenwerte** in Abschnitt 3 sind **Ableitungen für Veilgrounds**, keine Quellenangaben.

---

## 1. Kurzfassung

- **Silhouette zuerst.** Riot, Valve und Stunlock nennen die Silhouette übereinstimmend als wichtigstes Erkennungsmerkmal. Sie muss auch die **Blickrichtung** zeigen.
- **Wert vor Farbe.** Valves Dota-2-Guide: Werte (hell/dunkel) zählen mehr als Farbtöne. Unten dunkel, oben hell; Kontrast und Sättigung im Oberkörper und am Kopf bündeln, Beine ruhig halten.
- **Detail ist relativ zur Spielgröße.** Zu kleine Details werden zu Rauschen. Große ruhige Flächen lesen von oben besser als dichtes Detail (Dota, Diablo IV).
- **Rauschen minimieren, Hierarchie wahren.** Effekte dürfen den Körper nicht übertönen und müssen Größe und Richtung zeigen (Riot „Clarity in League“, Riot-VFX-Blog).
- **Gemalter Look im Spiel** entsteht bei Supergiant aus vorgerenderten 2D-Frames (Hades: 32 Winkel pro Animation), Tusche-Ästhetik und gezieltem Randlicht. Licht und Schatten müssen zur Welt passen (HD-2D).
- **Animation:** kurze Vorspannung, 1-2 Smear-Frames vor dem Treffer, gehaltene Endposen, Hitstop am Kontakt. Nichts davon darf die Reaktionszeit verlängern.

---

## 2. Quellen und Befunde

### 2.1 League of Legends (Riot Games)

- **Silhouette ist das wichtigste Erkennungsmerkmal.** Jeder Champion braucht ein eigenes Hauptmerkmal, das kein Skin entfernen darf. Animation hilft nur zusätzlich. Die Silhouette soll die Machtquelle (Bogen, Stab) und die Blickrichtung zeigen; Größe signalisiert die Rolle (Tank vs. Schütze).
- **Drei Leitziele:** Erkennbarkeit, Hierarchie (Wichtiges zieht am meisten Aufmerksamkeit) und minimales Rauschen. Skins verteilen ein festes „Budget“: Wenn Modell oder Animation stark abweichen, bleiben VFX/SFX näher am Original und umgekehrt. Nie alles gleichzeitig maximal aufdrehen.
- **Was die Silhouette trägt:** Am Beispiel Blitzcrank erklärt Riot, dass große Hände, Kopf und Schulterteile die Figur erkennbar halten. Spitze Bohrer statt Hände plus große Schulterplatten machen die Kontur dagegen unlesbar. Lee Sin wird fast nur über Animation erkannt; Riot nennt das selbst eine Schwäche.
- **Chromas = nur Texturwechsel.** Mit wachsendem Katalog überschneiden sich Farbvarianten mit anderen Champions. Körperfarbe ist also Identität und konkurriert mit jeder weiteren Farbbedeutung.
- **VFX vs. Körper:** Effekte sollen Größe und Richtung einer Fähigkeit klar zeigen, weder ablenken noch zu subtil sein, und idealerweise nie Klarheit kosten (VFX-Dev-Blog 2015). Das Rift-Update 2014 stellte „Clarity & Readability“ an erste Stelle: mehr Detail wirkt schnell unruhig.
- **Teamfarbe:** Keine der geöffneten Riot-Quellen sagt ausdrücklich „Ring statt Körperfarbe“. Dass LoL Teams über Lebensbalken und Auswahlkreis statt über die Modellfarbe trennt, ist eine **eigene Beobachtung** im Spiel. Die Chroma-Aussage oben stützt die Folgerung.

Quellen:
- https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/ (Riot, 12.03.2021)
- https://www.leagueoflegends.com/en-us/news/dev/ask-riot-let-s-talk-clarity/ (Riot, 09.04.2021)
- https://www.surrenderat20.net/2015/06/red-post-collection-dev-blog-on-vfx.html (Repost des Riot-VFX-Blogs)
- https://www.surrenderat20.net/2014/06/red-post-collection-dev-blog-on-sr.html (Repost des Summoner's-Rift-Update-Blogs)

### 2.2 Wild Rift (Riot Games, Mobile)

- Das Gameplay-Dev-Diary (Juni 2020) bestätigt nur, dass Modelle, Texturen und Animationen „von Grund auf“ neu gebaut wurden, teils mit Designmodernisierung (Malphite, Miss Fortune). Eine eigene Kamera-Abstimmung gab es für Champions mit großer Reichweite.
- Design-Lead Brian Feeney (März 2020) beschreibt nur Gameplay-Anpassungen (Skillshots statt Point-and-Click, Reichweiten).
- **Ehrlicher Befund:** Für die oft genannte These „größere Köpfe und Waffen für Mobile“ wurde **keine offizielle Quelle** gefunden. Die Proportionsregel in Abschnitt 3 stützt sich deshalb auf die Blitzcrank-Analyse (2.1), den Dota-Guide (2.3) und Sivers (2.9), nicht auf Wild Rift.

Quellen:
- https://www.taptap.io/post/414116 (Repost „Wild Rift Dev Diary: June 2020“)
- https://www.pocketgamer.com/wild-rift/league-of-legends-wild-rifts-latest-dev-update-details-the-teams-approach-to-adj/

### 2.3 Dota 2 Character Art Guide (Valve)

Volltext gelesen auf der Steam-Support-Seite. Die alte PDF-URL
(media.steampowered.com/.../Dota2CharacterArtGuide.pdf) liefert heute nur noch einen einseitigen
Hinweis, dass der Guide in eine Webseite umgewandelt wurde.

- **Silhouette:** auf den ersten Blick erkennbar, zeigt die Orientierung. Waffen brauchen eine eigene Lesart. Ruhezonen mit einfachen Formen gleichen komplizierte Formen aus.
- **Wertverlauf:** Die Standardhelden gehen von dunkel an Füßen/Unterkörper zu hell an Oberkörper und Kopf. Der Wertkontrast zwischen Teilen wird im Oberkörper erhöht und im Unterkörper gering gehalten. Jedes eigenständige Teil bekommt einen eigenen Wert. **Kein reines Weiß oder Schwarz**, weil beides unter Spielbeleuchtung flach wird oder ausbrennt.
- **Sättigung:** Grundsättigung senken; zum Oberkörper hin steigern, zu den Füßen hin senken. Höchste Sättigung nur auf sehr kleinen Flächen. Keine maximal gesättigten RGB-Kanäle, damit Licht Spielraum hat. Farben vermeiden, die auf der Karte dominieren.
- **Ruhe und Detail:** Detailzonen sind ein kleiner Anteil der Figur und liegen an wichtigen Stellen. Detailgröße hängt von der Spielgröße ab; zu Kleines wird Rauschen. Detail auf großen Flächen nur mit Werten nah am Untergrund.
- **Richtung und Kontext:** Kopf, Waffe und Blickrichtung müssen von oben sofort klar sein. Valve bewertet Assets zuerst in der Spielansicht, auf beiden Kartenseiten, bei Tag und Nacht.
- **Fallbeispiele (Witch Doctor, Lion, Beastmaster):** stärkerer Verlauf von den Füßen zum Oberkörper, weniger Kontrast im Unterkörper, Augen/Zähne/Perlen am Gesicht aufgehellt, Sättigung nur an Blickpunkten (mutierte Hand, Stabspitze, Schulterteile). Bei Lion wurden schwere aufgemalte Schatten entfernt, für diffuseres Licht.

Quellen:
- https://help.steampowered.com/faqs/view/0688-7692-4D5A-1935 (Volltext; Primärquelle)
- https://media.steampowered.com/apps/dota2/workshop/Dota2CharacterArtGuide.pdf (nur noch Weiterleitungshinweis)
- https://www.cgchannel.com/2012/06/valve-releases-useful-character-design-guide (Einordnung der Originalfassung)
- https://www.gamedeveloper.com/design/how-to-reduce-visual-confusion-in-your-game (Angstadt 2015: in Dota sind Einheiten die hellsten und kontrastreichsten Elemente, der Boden dunkler; Test per Entsättigung)

### 2.4 Supergiant: Hades, Bastion, Transistor/Pyre

- **Vorgerenderte 2D-Frames:** Hades hat laut einem Supergiant-Entwickler kein Echtzeit-3D. Jeder Zagreus-Frame ist ein eigenes Bild, z. B. der Bogenangriff mit 104 Frames in 32 Winkeln. Das ist derselbe Ansatz wie bei Veilgrounds (Rig → gebackene Atlanten).
- **Tusche statt Malerei:** Für Hades wechselte das Team in der Vorproduktion vom malerischen Stil zu Feder und Tusche (Einfluss: Mike Mignola). Tusche war bei der großen Asset-Menge auch schneller. 3D-Modelle aus Maya wurden in After Effects nachbearbeitet. Der Stil ist Gameplay-geführt.
- **Palette:** Für Transistor beschreibt Jen Zee bewusst kontrollierte, gedämpftere Paletten statt ihrer Vorliebe für viel Farbe (Vorbilder: Waterhouse, Klimt); für Bastion malte sie Umgebung und UI in 2D.
- **Randlicht:** In einer 80.lv-Fan-Rekonstruktion (Chronos aus Hades II) gilt das Randlicht als zentrales Merkmal. Auf die Modellseiten gemalt funktionierte es nicht; eine eigene, in der Dicke steuerbare Kontur ersetzte es, dazu schwarze Outlines und tiefe Schatten. Das ist eine Praktikerquelle, **keine Aussage von Supergiant**. Ein Interview von Jen Zee zu Randlicht oder Lesbarkeit wurde nicht gefunden.

Quellen:
- https://steamcommunity.com/app/1145360/discussions/0/1864993755183591660 (Supergiant-Entwickler kid_zomb, März 2020)
- https://mcvuk.com/business-news/behind-the-art-of-hades-we-value-artistic-integrity-and-excellence-in-artistic-craft-at-supergiant-however-were-first-and-foremost-a-game-design-lead-team/ (Jen Zee, 07.06.2021)
- https://nerdybutflirty.com/2013/07/11/unicorn-sparkle-an-interview-with-jen-zee-of-supergiant-games/ (Jen Zee, 2013: gedämpfte Paletten für Transistor, Waterhouse/Klimt)
- https://80.lv/articles/creating-hand-painted-3d-fan-art-of-chronos-from-hades-2 (08.09.2025)

### 2.5 Darkest Dungeon (Red Hook Studios)

- Chris Bourassa verbindet die **harten Linien und Kanten** mit dem kompromisslosen Gameplay. „Zusammenlaufende“ tiefe Schwarzflächen sollen das Gefühl erzeugen, im Dunkeln verloren zu sein.
- Einflüsse: Holzschnitt, illuminierte Handschriften, moderne Comics (Mignola, Guy Davis). Ein Hauch „Niedlichkeit“ stützt die Ikonografie.
- Bewusst Seitenansicht statt Top-down-Icons, um nah an den Figuren zu sein.
- Ein GameSpot-Interview zu Tinte, Vermeidung von reinem Schwarz/Grau und warmer Grundpalette war laut Suchtreffer relevant, die Seite war aber **nicht abrufbar (HTTP 403)**. Die dort vermutete Aussage wird hier nicht verwendet.

Quellen:
- https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon (Bourassa, 09.06.2015)
- https://en.wikipedia.org/wiki/Darkest_Dungeon (Entwicklung/Einflüsse)
- https://www.gamespot.com/articles/the-gothic-sensibilities-of-darkest-dungeon/1100-6424880/ (gefunden, nicht abrufbar)

### 2.6 Battlerite, Diablo IV, Path of Exile

- **Battlerite (Stunlock):** Die Grafik soll zuerst das Gameplay sichtbar erklären, für Spieler und Zuschauer. Man soll die Klasse eines Champions schon am Aussehen erkennen.
- **Diablo IV (Blizzard, 2021):** Die Spielkamera hat Priorität; Figuren müssen aus der isometrischen Sicht lesbar sein. Große Rüstungsformen, lesbarkeitsschädliche Elemente werden reduziert. Formsprache von groß nach klein (primär → sekundär → tertiär). Farben müssen gruppieren; ein kleiner gesättigter Akzent auf kühlem, gedämpftem Körper zieht den Blick. Jedes Asset wird in Spielkamera und Nahkamera geprüft. Physikalisch basiertes Licht. **Randlicht wird in der Quelle nicht erwähnt.**
- **Path of Exile 2:** Keine belastbare Entwicklerquelle zu Figurenlesbarkeit oder Licht gefunden.

Quellen:
- https://80.lv/articles/battlerite-interiew (Johan Ilves, 28.04.2016)
- https://news.blizzard.com/en-us/article/23665024/diablo-iv-quarterly-updatejune-2021

### 2.7 Octopath Traveler (HD-2D), Eastward

- **HD-2D:** Pixel-Sprites stehen in vollständig beleuchteten 3D-Umgebungen. Laut Unreal-Spotlight (zitiert nach Wikipedia) wird eine Punktlichtquelle gesetzt, damit Figuren Schatten auf die Umgebung werfen. Produzent Asano betonte Licht und Schatten. Dazu kommen Tiefenschärfe, Bloom und Tilt-Shift für den Diorama-Look. Ein Unreal-Interview zu Octopath II (Sprites wirken wie „flache Papierbögen“) war **nicht abrufbar (403)**.
- **Eastward (Pixpil):** offiziell „Retro-Pixel + 3D-Licht“ auf eigener Engine. Zu Schatten gibt es keine Entwickleraussage.
- **Folgerung:** Sprites in einer beleuchteten Welt brauchen eine Lichtrichtung, die zur Welt passt, und eine sichtbare Bodenverbindung (Schatten), sonst schweben sie als „Papier“ über dem Boden.

Quellen:
- https://en.wikipedia.org/wiki/HD-2D
- https://www.unrealengine.com/en-US/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true (in Wikipedia zitiert; nicht selbst geöffnet)
- https://www.unrealengine.com/en-us/developer-interviews/octopath-traveler-ii-builds-a-bigger-bolder-world-in-its-stunning-hd-2d-style (gefunden, nicht abrufbar)
- https://chucklefish.org/?p=1263 (Eastward-Ankündigung, 2018)

### 2.8 Animationsprinzipien und Treffergefühl

- **Vorspannung (Anticipation):** Designer wollen sie kurz, Animatoren länger. Telegrafierte Angriffe brauchen mehr, Spieleraktionen weniger. Lösung: Bereitschaft schon in Idle/Stand-Pose legen („pose readiness“), damit die Aktion sofort startet.
- **Nachschwung und Halten:** Starke Endposen kurz halten, damit die Aktion lesbar ist. Zu langer Nachschwung macht träge, also früh Kontrolle zurückgeben. Übergänge bei Abbruch mitplanen.
- **Squash & Stretch / Übertreibung:** In Spielen meist subtil über gestreckte Posen. Wegen der entfernten Spielkamera Posen „plussen“ und länger halten als in der Realität.
- **Smear-Frames:** simulierte Bewegungsunschärfe (gestreckte Zwischenbilder, Mehrfachbilder, Schlierenformen). Typisch für Nahkampfschläge, meist nur 1-2 Frames, als Brücke **in** die Trefferpose, nicht statt ihr.
- **Hitstop:** kurzes Einfrieren von Angreifer und Getroffenem beim Kontakt (Street Fighter 2 etwa 10 Frames). Es gibt dem Auge Zeit, den Treffer zu registrieren. In Smash skaliert es mit dem Schaden, der Getroffene zittert. Ohne Hitstop wirken Treffer schwächer (Beispiel Dark Souls 2).

Quellen:
- https://www.gamedeveloper.com/production/the-12-principles-of-animation-in-video-games (Auszug aus Jonathan Cooper, „Game Anim“, 2019)
- https://anim.works/?p=23056 (Rex Ahn, „The 12 Principles of Animation, Reframed for Games“)
- https://en.wikipedia.org/wiki/Smear_frame
- https://prolificstudio.co/blog/smear-frames/
- https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/
- https://www.ssbwiki.com/Hitlag

### 2.9 Allgemeine Zeichengrundlagen (Kontur, Proportion)

- **Linienstärke (Proko):** schwerere Linie auf der lichtabgewandten Seite, sehr dünne oder fehlende auf der Lichtseite. Kräftige Außenkontur betont die Silhouette, Innenlinien bleiben leichter. Dickere Linien an Berührungsstellen trennen Teile, ohne sie auseinanderzureißen.
- **Proportionen (Sivers):** Cartoon-Figuren liegen bei 2-6 Kopflängen. Weniger Köpfe heißt mehr Ausdrucksfläche. In der Draufsicht überdeckt ein großer Kopf aber Teile des Körpers.

Quellen:
- https://proko.com/course-lesson/how-to-draw-with-line-weight/notes
- https://www.gamedeveloper.com/design/design-tips-in-game-proportions-and-scale (Yuriy Sivers, 2016)

---

## 3. Regeln für Veilgrounds

Abgeleitet aus Abschnitt 2. Zahlen sind Startwerte für Veilgrounds und werden im Spiel bei 112/96 px
geprüft, nicht aus Quellen übernommen.

1. **Silhouettentest:** Jeder Champion muss als schwarze Fläche bei 112 px (und im 64-px-Test) eindeutig und mit erkennbarer Blickrichtung lesbar sein. Waffe/Fokus bricht die Kontur sichtbar (Riot, Valve).
2. **Werthierarchie:** Kopf, Hände und Waffe sind die hellsten Zonen. Torso liegt in der Mitte, Beine und Füße eine bis zwei Gouache-Stufen dunkler. Kein reines Weiß/Schwarz: Lichter ≤ ca. 92 % Helligkeit, Tiefen ≥ ca. 8 % (Dota).
3. **Sättigungshierarchie:** höchste Sättigung nur auf kleinen Akzenten an Kopf, Händen und Waffe (Richtwert ≤ 10-15 % der Figurfläche). Beine/Füße um ca. 20-30 % entsättigen. Kein RGB-Kanal auf Maximum (Dota, Diablo IV).
4. **2-3 Wertgruppen pro Figur:** hell (Kopf/Hände/Waffe), mittel (Torso/Hauptmaterial), dunkel (Beine/Schattenmasse). Innerhalb einer Gruppe nur kleine Wertsprünge (Dota „value patterning“).
5. **Randlicht konsistent mit dem Weltlicht:** warmes Randlicht nur auf der Seite zur Abendsonne (hinten-rechts), kühles violettes Gegenlicht auf der Schattenkante. Als Effekt auf die Gesamtsilhouette, nicht pro Körperteil, damit keine Innenkanten aufleuchten (HD-2D-Folgerung; Hades-Look laut 80.lv-Rekonstruktion).
6. **Konturgewichtung:** Außenkontur ca. 1,5-2 px bei Spielgröße, auf der Schattenseite ca. 30-50 % schwerer. Innenlinien höchstens halb so stark. Berührungsstellen (Arm vor Torso) bekommen eine etwas dickere Trennlinie (Proko, Darkest Dungeon, Hades-Tusche).
7. **Detailschwelle:** Alles, was bei Spielgröße unter ca. 2-3 px fällt (Nähte, Kratzer, feine Innenlinien, kleine Nieten), wird weggelassen oder auf einen Wert nah am Untergrund gesetzt (Dota „noise“).
8. **Proportionen für Spielgröße:** Kopf und Hände (inkl. Waffengriff/Fokus) ca. 10-25 % größer als anatomisch. Den Kopf dabei nicht so breit machen, dass er in der 56°-Sicht die Schultern verdeckt (Riot/Blitzcrank, Dota „head and weapon“, Sivers).
9. **Teamfarbe nur am Bodenring.** Körperfarben bleiben Champion-Identität. Team-Rot/-Blau sowie die dominanten Kartenfarben (Wiese, Stein) als Hauptfarbe von Champions vermeiden (Riot-Chromas, Dota „Kartenfarben vermeiden“).
10. **Bodenkontakt:** weiche Kontakt-AO direkt unter den Füßen im Sprite (dunkelster Wert der Figur, schmal, ca. 3-5 px hoch), zusätzlich zum Weltschatten. Sonst „schwebt“ das Papier (HD-2D).
11. **Pinseltextur nach Größe:** Gouache-Strukturen nur in Flächen, die bei 112 px mindestens ca. 6-8 px breit sind. Kein hochfrequentes Rauschen; der Wertunterschied der Textur bleibt klein (Dota: Detail nah am Untergrundwert).
12. **VFX vs. Körper:** Fähigkeiten-VFX dürfen Kopf und Waffe nicht dauerhaft überdecken und müssen Größe und Richtung zeigen (Riot-VFX). Effekte sind heller oder gesättigter als der Körper nur dann, wenn sie gameplay-relevant sind.
13. **Animation, ohne Timing zu ändern:** Vorspannung im Ausholframe als stärkere Gegenbewegung (Pose, nicht zusätzliche Frames). Smear-Bogen am Trefferframe schneller Schläge (1 Frame). Nachschwung-Pose im vorhandenen Folgeframe halten. Frame-Anzahl und Trefferframe bleiben gleich, damit Sim und Optik synchron bleiben (Cooper, anim.works, Prolific).
14. **Hitstop optional und kurz:** falls später eingeführt, nur visuell (Render-Freeze 2-4 Frames bei 60 fps, stärker bei schweren Treffern), nie im Simulationstakt (critpoints, SmashWiki).
15. **Prüfen im Kontext:** jede Änderung als Screenshot bei Spielzoom auf hellem und dunklem Terrain, zusätzlich entsättigt (Wertprüfung nach Angstadt/Valve).

---

## 4. Was wir übernehmen

a) **Silhouetten-Randlicht:** warm auf der Seite zur Abendsonne (hinten-rechts) und kühles violettes Gegenlicht (Himmelsfüllung) auf der Schattenkante. Auf Ebene der ganzen Figur, nicht pro Teil. *(Hades/Supergiant: gebackene 2D-Frames, Randlicht als Stilmerkmal laut 80.lv-Rekonstruktion; Diablo IV: Kamera-zuerst-Lesbarkeit und weltkonsistentes Licht. Randlicht selbst ist in der D4-Quelle nicht erwähnt, sondern unsere Ableitung.)*

b) **Wert-/Sättigungshierarchie:** Kopf, Hände und Waffe am hellsten und gesättigtsten; Beine und Füße dunkler und entsättigt. *(Dota-2-Character-Art-Guide: „darker below, lighter above“, Sättigung zum Oberkörper steigend.)*

c) **Konturgewichtung:** dickere Außenkontur, auf der Schattenseite schwerer; dünnere Innenlinien; Innenlinien und Kratzer/Nähte unter der Schwellgröße weglassen. *(Darkest Dungeon: harte Linien; Hades: Tuschstil; Proko: Linienstärke; Dota-Guide: zu kleines Detail wird Rauschen.)*

d) **Proportionen für Spielgröße:** Kopf und Hände leicht vergrößert. *(LoL: Blitzcrank wird über Hände, Kopf und Schultern erkannt; Dota: Kopf und Waffe müssen von oben lesbar sein. Für Wild Rift gibt es keine Quelle zu Proportionen.)*

e) **Bodenkontakt:** Kontaktabdunklung an Sohlen und Unterschenkeln *innerhalb* der Figur, Bodenschatten kommt weiter aus dem Schatten-Pass der Welt. (Ein weicher AO-Fleck neben den Füßen ist im Sprite nicht möglich: alle Sprite-Materialien nutzen `alphaTest: 0.5`, halbtransparente Pixel verschwinden oder werden zur harten Scheibe.) *(Octopath/HD-2D: Figuren werfen bewusst Schatten in die 3D-Welt; Eastward: Pixel-Sprites unter 3D-Licht.)*

f) **Animation:** Smear-Bogen am Trefferframe schneller Schläge, Vorspannung im Ausholframe, Nachschwung halten, ohne Frame-Anzahl oder Trefferframe zu ändern. *(Animationsprinzipien nach Cooper/anim.works, Smear-Frames, Hitstop in Kampfspielen.)*

g) **Teamfarbe nur am Bodenring:** Körperfarbe bleibt Champion-Identität. *(LoL: Identität über Hauptmerkmal und Farbe, Chroma-Überschneidungen; Ring-Konvention als eigene Beobachtung.)*

h) **Pinseltextur nur in Größen, die bei 112 px überleben:** große Flächen, kein Feinrauschen. *(Dota-Guide: Detailmaßstab relativ zur Spielgröße, große ruhige Flächen lesen besser; Angstadt: Entsättigungs-Test.)*

## 5. Umsetzung (Stand Revision 1)

Siehe `docs/style/revision/` (vorher/nachher). Umgesetzt in `src/render/champions/atlas.ts` (`finishFigure`: Wert-/Sättigungsverlauf
aus der echten Figurenhöhe, Fokuslicht Kopf + Waffe, warmes Sonnen-Randlicht + kühle Himmelskante, schattenseitig schwerere Kontur,
deckender Smear-Bogen am Trefferframe von chop/slash/swipe/bash/thrust), `core.ts` (Detail-Schwelle für Maserung/Kratzer/Nähte/Falten,
Innenlinien 0,72x, hellere Lichtseite), `humanoid.ts` (Champions: Kopf x1,1, Hände x1,15; Minions unverändert) und `props*.ts`
(Waffenspitze via `markTip` für den Smear). Bekannte Grenze: W/SW/NW sind gespiegelte Zellen, ihr Randlicht liegt daher gespiegelt
(das Randlicht ist deshalb überwiegend von oben gerichtet, damit der Unterschied klein bleibt).
