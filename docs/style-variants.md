# Stilvarianten – Veilgrounds / „Der Schleierbruch“

Drei vollständige Art-Direction-Varianten für Minions, Karte, Strukturen und Champions. Alle drei respektieren Spec §11 (Lichtwerk = Kupfer/Elfenbein/Messing, Aschehalle = Schiefer/Rost/Kohle, Dschungel moosgrün, Fluss silbrig, Schleier violettgrau; eigene Skillshots kaltes Blau, gegnerische warmes Signalrot) und die technischen Randbedingungen des Spiels: feste Kamera (56° Neigung, FOV 38), Einheiten als kamerazugewandte Billboard-Sprites, Gelände/Strukturen als Lowpoly-Meshes, alles prozedural.

**Ansehen:** `npx vite` im Projektordner, dann <http://localhost:5173/stylelab.html> (läuft ein Dev-Server bereits, reicht die URL). Tabs A/B/C, „Lane-Szene“ / „Strukturen“, Ziehen = verschieben, Mausrad = Zoom. Direktlinks: `stylelab.html?v=B&view=structures`. Code: `src/stylelab/` (unabhängig von `src/render`, nichts im Spiel geändert). Die Seite ist nur im Dev-Server erreichbar; für `vite build` müsste `stylelab.html` als zusätzlicher `rollupOptions.input` eingetragen werden (bewusst nicht gemacht).

Screenshots (Stand dieser Fassung): `docs/style/variant-{a,b,c}-lane.jpg`, `docs/style/variant-{a,b,c}-structures.jpg`, `docs/style/silhouette-test-64px.png`.

---

## 1. Recherche: Prinzipien, die alle Varianten tragen

| Prinzip | Was es konkret heißt | Quelle |
|---|---|---|
| Silhouette zuerst | Jede Figur braucht ein *primäres* Merkmal, das nie verschwindet (Riot: Sennas Gewehr, Yuumis Katzenform). Größe darf Rolle andeuten (schwer = Tank). Silhouette soll Blickrichtung zeigen. | Riot „Clarity in League“; Valve Dota 2 Character Art Guide |
| Wert vor Farbe | Wert (hell/dunkel) ist wichtiger als Farbton. Test: Screenshot entsättigen – liest er sich noch? | Valve Dota 2 Guide; Game Developer „How to reduce visual confusion“ |
| Boden ruhig, Einheiten am kontrastreichsten | Dota: Boden dunkler als Helden, Helden tragen hellste Werte und stärksten Kontrast. Begehbarer Boden mit kleiner Hell-Dunkel-Spanne. Umgekehrt (helle Welt, dunkle Figuren, wie Limbo) geht auch – nur nicht gemischt. | Game Developer „How to reduce visual confusion“ |
| Ebenen-Hierarchie | Riot beim Summoner's-Rift-Update: Hintergrund = Leinwand, Champions an zweiter Stelle bei Kontrast, VFX dritte, UI oben aber klein. Karte „rahmt“ die Champions. | Riot Red Post zum SR-Update (Archiv Surrender at 20) |
| Ruhezonen vs. Detail | Kleine Detailflecken sehen in der Profilansicht gut aus, werden aber aus der Spielkamera unlesbar. Einfache Ruheflächen balancieren komplizierte Formen. Wert-Verlauf Kopf → Füße (Füße nicht so intensiv wie der Kopf). | Valve Dota 2 Guide (zitiert über CGChannel/Polycount) |
| Teamfarben über Material + Form | TF2: RED = warme Farben, Holz, kantige Formen; BLU = kühl, Industrie, orthogonal. Umgebung entsättigt, Figuren gesättigt. Schatten gehen nach kühl, nicht nach Schwarz; Sättigung an der Licht-Schatten-Grenze; Randlicht trennt Figuren vom Hintergrund. | Mitchell/Francke/Eng, „Illustrative Rendering in Team Fortress 2“ (NPAR 2007) |
| Starke Tuschelinie trägt Farbe | Bourassa (Darkest Dungeon): kein „totes Grau“ oder Schwarz außer in der Tusche; starke Linien erlauben überraschende Farbspritzer, ohne Formen zu verlieren; warme Grundpalette, selbst kühle Töne leicht vergilbt → Pergament-Gefühl. | GameSpot „The Gothic Sensibilities of Darkest Dungeon“; Game Developer „Road to the IGF: Darkest Dungeon“ |
| Gedämpfte Welt, klare Bedrohung | Bad North: „watered down tones“ – ruhige Welt, bis der Gegner kommt. | PocketGamer.biz Interview mit Plausible Concept |
| Palettenkontrolle | Transistor bewusst „palette-controlled“ und dunkler als Bastion. | Destructoid-Interview mit Jen Zee |
| Echtzeit-Schraffur | Tonal Art Maps: Strich-Texturen je Tonstufe, gemischt nach Licht. Unser Lab nutzt eine einfache Bildschirmraum-Variante davon. | Praun/Hoppe/Webb/Finkelstein, „Real-Time Hatching“ (SIGGRAPH 2001) |
| Ansagen statt Überraschungen | Into the Breach: gegnerische Absichten jederzeit sichtbar, Felder vorher markiert → Bodenmarkierungen mit klarem Rand + Füll-Animation. | Rezensionen/Zusammenfassungen zu Into the Breach; GDC-Postmortem (nicht eingesehen, Login) |

**Ehrliche Lücken:** Für Hades/Supergiant, Bad North, Northgard, Townscaper und Kingdom Two Crowns habe ich keine Primärquelle gefunden, die *Lesbarkeit* konkret behandelt (nur Stimmungs-/Palettenbeschreibungen). Was diese Spiele in den Varianten beeinflusst, ist meine Ableitung aus Screenshot-Wissen plus den Valve/Riot/TF2-Regeln oben, nicht deren dokumentierte Methode. Valves Dota-Guide selbst war nicht abrufbar (Seite lädt den Inhalt dynamisch); die Punkte stammen aus Sekundärzitaten.

### Regeln, die in allen drei Varianten gelten (im Lab umgesetzt)

1. **Rost wird braun.** Aschehalles „Rost“ liegt in allen Varianten bei braunen Tönen (`#7e4a33`, `#9a5e46`, `#7c4632`) statt des alten `#a5492a`. Warmes Signalrot (`#e0473a` / `#ff4a2e`) bleibt exklusiv gegnerischen Fähigkeiten und Gegner-Markierungen vorbehalten.
2. **Formsprache je Team.** Lichtwerk rund (Kuppelhelme, Rundschilde, Linsen, Laternen, Kuppel-Nexus), Aschehalle kantig (Keilhelme, Turmschilde, Dornen, Kohlebecken, Schmiedehallen-Nexus). Teams unterscheiden sich damit auch für Farbfehlsichtige und in der Silhouette (siehe 64-px-Streifen).
3. **Champions behalten ihre Farben auf beiden Seiten;** Team zeigt der Bodenring (blau/rot) und später die Lebensleiste. Primärmerkmale: Mira = Bogen länger als die Figur (hoch-schlank), Renn = sieben Klingen als Fächer/Stern auf dem Rücken (stachelig), Mutter Hagen = Joch über die Schultern mit großer Glocke vorn und Eimer hinten (breit-schwer), Isolde = großer Glasarm als Splitterklinge + Drahtspule als *Ring mit Loch* (kantig-asymmetrisch). Vier deutlich verschiedene Gesamtmassen.
4. **Negativraum statt dünner Linien.** Dünne Drähte verschwinden bei 64 px; Löcher bleiben. Deshalb ist Isoldes „Drahtwerk“ eine große Spule mit Loch, nicht ein Gespinst.
5. **Gameplay-Ebene identisch.** Ringe, Skillshots (Rechteck mit Rand + durchlaufender Füllung) und AoE-Kreise (Rand + radiale Füll-Animation) sehen in allen Varianten gleich aus – so lässt sich vergleichen, auf welchem Grund sie am besten lesbar sind.
6. **Minimap im Kartenstil**, Türme dort zusätzlich nach Form codiert (eigene rund, gegnerische eckig).

---

## 2. Variante A – „Kupferstich“ (Tusche & Schraffur)

**Idee:** Die Welt als Kupferstich/Holzschnitt aus einem Werkstatthandbuch. Passt zu Handwerkern, Deserteuren und Gelehrten und zum trockenen Ton – wie eine technische Tafel, auf der zufällig ein Krieg stattfindet. Weit weg von LoL und generischer Fantasy.

**Palette**

| Rolle | Hex |
|---|---|
| Papier | `#efe4c8` |
| Tusche | `#1d1712` |
| Lichtwerk Kupfer / Elfenbein / Messing | `#b0653a` / `#f1e6cb` / `#c49a3e` |
| Aschehalle Schiefer / Rost (braun) / Kohle | `#5a6170` / `#7e4a33` / `#2c2a2e` |
| Moos / Moos dunkel | `#a9ad84` / `#8e9468` |
| Weg | `#ebdcb8` |
| Fluss / Fluss hell | `#b4c0bf` / `#dfe4de` |
| Schleier / Rissglühen | `#8e7fa8` / `#9d8bb8` |

**Kontur & Schattierung**
- Kontur: 9 px pro 256-px-Sprite, Tusche; Meshes mit Inverted-Hull-Kontur 9–10 Einheiten – auch Gelände, Bäume, Büsche.
- Schattierung: Grundfarbe bleibt flach (leicht ins Papier gemischt); Ton entsteht nur durch Schraffurlagen: 1 Lage diagonal (Halbschatten), Kreuzschraffur (Schatten), dritte waagerechte Lage (Kernschatten). In Sprites: Formschatten-Band unten links als Schraffur, bei dunklen Materialien Kreuzschraffur.
- Glanz nur auf Metall/Glas: weißer Schnitt an der Lichtkante von Messing, Klingen, Glocke, Glasarm.
- Schlagschatten (Shadow Map) werden vom Shader automatisch zu Kreuzschraffur.

**Minions:** Lichtwerk-Nahkämpfer mit Kuppelhelm, Hammer, rundem Messingschild; Zauberer als Laternenträger mit Leuchtkugel; Belagerung als Kupferkarren mit Linsenkanone; Super als Messing-Automat mit Kesselbauch. Aschehalle: Keilhelm + Turmschild + Hackmesser; Heizer mit Kohlebecken am Stab; kantiger Mörser mit Schornstein und Sechseckrädern; Rußbrute mit Ofenbuckel und Schornstein-Hörnern.

**Türme/Inhibitor/Nexus:** Lichtwerk-Turm = Laternenturm (Kupferschaft, Messingband, leuchtende Linse unter kleiner Kappe), Inhibitor = Gyroskopringe um Leuchtkern, Nexus = Observatoriumskuppel mit Linse und vier Messingmasten. Aschehalle-Turm = quadratischer Schieferschaft mit Rostplatten und Kohlebecken voller Glut + Dornen, Inhibitor = Amboss mit Glutspalt, Nexus = Schmiedehalle mit drei glühenden Schornsteinen und Ofenmaul.

**Terrain:** Papiergrund mit Fasern; Wege hell mit Punktierung und gestrichelten Stichelkanten; Dschungel als Moos-Lavierung mit Tusche-Grasbüscheln; Fluss mit gravierten Wellenlinien und Tusche-Ufern; Riss als echtes Loch mit Tuschelippe und radialen Schnittlinien; Felswände als Haufen umrissener Blöcke; Schleier als gestochene Wolken (Muschelrand-Umriss).

**Lesbarkeit – pro:** Stärkste Eigenständigkeit; Konturen + Schraffur trennen Einheiten unabhängig vom Licht; Schatten werden zu klaren Formen; erfüllt die Spec-Sätze „dicke dunkle Konturen, Highlights nur auf Metall/Glas“ wörtlich. Gameplay-Rot/Blau sind die einzigen gesättigten Farben im Bild → springen sofort heraus.
**Lesbarkeit – contra:** Heller Boden + helle Figuren (Elfenbein-Zauberer auf Weg) leben nur von der Kontur – das ist das „Limbo-Prinzip“ (dunkle Figur auf hellem Grund), nicht das Dota-Prinzip. Bildschirmraum-Schraffur „schwimmt“ beim Kameraschwenk (Duschvorhang-Effekt) und kann bei kleinen Auflösungen moirieren. Viel Tusche überall → Gefahr, dass alles gleich laut ist.
**Performance:** Mittel. Ein paar ALU-Operationen pro Pixel (Schraffur), Konturen verdoppeln die Mesh-Draw-Calls, Bodentextur wie heute (eine große Canvas-Textur). Keine Post-Processing-Pässe nötig.
**Inspiration:** Darkest Dungeon (Tusche trägt Farbe, Pergament-Wärme), Praun et al. (Schraffur nach Ton), TF2 (Teams über Form/Material).

---

## 3. Variante B – „Werkstatt-Lowpoly“ (flach, weich, klobig)

**Idee:** Spielbrett aus bemaltem Holz – ein Werkstattmodell der Hochebene. Gelände ohne Konturen, weiche Schatten, viel Himmelslicht; Einheiten als konturierte Spielfiguren mit gestauchten Proportionen.

**Palette**

| Rolle | Hex |
|---|---|
| Einheitenkontur (Pflaume statt Schwarz) | `#2b2430` |
| Lichtwerk Kupfer / Elfenbein / Messing | `#d2875a` / `#f7efdc` / `#e4b65a` |
| Aschehalle Schiefer / Rost (braun) / Kohle | `#6b7587` / `#9a5e46` / `#3d3e48` |
| Moos / Moos dunkel | `#8fa572` / `#7a935f` |
| Weg / Wegrand | `#dcc79a` / `#c8b083` |
| Fluss | `#8fbfcc` |
| Fels / Fels dunkel | `#b8ae9a` / `#978d7a` |
| Schleier / Rissglühen | `#b8a8d8` / `#a894d8` |
| Himmel (Hintergrund) | `#a7c1c8` |

**Kontur & Schattierung**
- Gelände/Strukturen: keine Konturen; facettierte Flächen (Flat Shading), Lambert-Licht mit kräftigem Halbkugel-Himmelslicht, weiche PCF-Schatten.
- Einheiten: 7 px Kontur in Pflaume, zweitöniger Formschatten (leicht nach Violett verschoben), Glanzkante nur auf Metall/Glas. Proportionen 1,10 × 0,92 (klobig).

**Minions/Champions:** gleiche Figuren wie A, aber flache, freundliche Flächen; wirken wie bemalte Spielfiguren.
**Türme/Inhibitor/Nexus:** gleiche Bauformen, 15 % breiter, 14 % niedriger, sechseckig statt achteckig – „Bauklotz“-Charakter.
**Terrain:** echtes Relief statt Textur: Fluss als eingetiefte Rinne mit halbtransparenter Wasserfläche und Sandufer, Riss als tiefe Grube mit violett glimmendem Grund, Felswände als terrassierte Blöcke mit Graskappen, Bäume als Lollipop-Kronen, Büsche als runde Lowpoly-Kugeln, Schleier als aufsteigende transparente Lowpoly-Bällchen. Keine Bodentextur – Farben pro Dreieck.

**Lesbarkeit – pro:** Sehr ruhiger Boden (große Flächen, kein Rauschen) → Einheiten mit Kontur stehen klar davor; Höhe erklärt das Gelände (Rinne, Grube, Klippe) ohne Worte; freundlich, kindgerecht, gut auf kleinen Bildschirmen.
**Lesbarkeit – contra:** Bodenwerte (Sand, helles Moos) liegen nah an den Einheitenwerten – der Kontrast kommt fast nur aus der Kontur und der Sättigung. Weicht von der Spec ab („dicke dunkle Konturen, flache Zweiton-Schattierung“ gilt hier nur für Einheiten). Am nächsten an bekannten Indie-Looks (Bad North, Townscaper) → am wenigsten eigene Identität; die Schleierbruch-Stimmung (Nebel, Riss) wirkt eher niedlich als unheimlich. Zackige Facettenkanten an Ufern/Plätzen sind stilbedingt.
**Performance:** Am besten. Keine Shader-Patches, keine große Bodentextur (Speicher!), keine Konturmeshes im Gelände. Das Relief-Mesh kostet für die ganze Karte grob 50–60 k Dreiecke bei 95 Einheiten Raster – unkritisch. Weiche Schatten (PCFSoft) sind der teuerste Posten.
**Inspiration:** Bad North (gedämpfte, „verwässerte“ Töne, Bedrohung als einziger Kontrast), Townscaper (Pastell, Flächen), Riot-Ebenenhierarchie (Karte als ruhige Leinwand).

---

## 4. Variante C – „Gouache-Dämmerung“ (harte Schattenformen, Randlicht)

**Idee:** Ewige Abendstunde über dem Plateau. Tiefe Sonne von hinten rechts, lange Schlagschatten zur Kamera, Schatten kippen nach kühlem Violett; Figuren bekommen warmes Randlicht. Der Riss ist die hellste Fläche der Umgebung – er leuchtet violett und wird zur Landmarke.

**Palette**

| Rolle | Hex |
|---|---|
| Nacht-Tusche (Kontur) | `#1a1420` |
| Schattenviolett | `#3a2d5a` |
| Randlicht | `#ffbf72` |
| Lichtwerk Kupfer / Elfenbein / Messing | `#c46d3c` / `#f2dfbd` / `#e2a944` |
| Aschehalle Schiefer / Rost (braun) / Kohle | `#4c5566` / `#7c4632` / `#24222a` |
| Moos / Moos dunkel | `#55613f` / `#434f33` |
| Weg / Wegrand | `#9c8158` / `#77633f` |
| Fluss / Himmelsspiegelung | `#6f7f99` / `#e3ad87` |
| Schleier / Rissglühen | `#9a86c8` / `#a58ae0` |
| Hintergrund/Nebel | `#221c2c` / `#2a2338` |

**Kontur & Schattierung**
- Kontur: 6 px Sprites, 5–6 Einheiten Meshes (Nacht-Tusche statt Schwarz).
- 3 harte Wertstufen (Licht/Halbton/Schatten), Schatten = Grundfarbe × 0,38 gemischt mit Violett; warmer Saum an der Licht-Schatten-Grenze (TF2-Prinzip); Fresnel-Randlicht auf Meshes.
- Sprites: großer Formschatten (halber Körper) + 6 px warmes Randlicht auf allen Flächen der Lichtseite; Glanz zusätzlich auf Metall/Glas. Proportionen 0,94 × 1,06 (gestreckt).
- Entfernungsnebel in Violett.

**Minions/Champions:** gleiche Figuren; wirken durch Schattenhälfte + Randlicht plastisch und ernst.
**Türme/Inhibitor/Nexus:** gleiche Bauformen, 14 % höher, 8 % schlanker; glühende Linsen/Glut flackern, lange Schatten über den Platz.
**Terrain:** dunkler, entsättigter Boden aus kurzen Pinselstrichen (Gouache), Weg ockerfarben, Fluss blaugrau mit warmem Himmelsstreifen, Büsche als hohes, stacheliges Gras („hier kann man sich verstecken“), Felswände mit spitzen Zinnen, schlanke Kiefern; Riss als echtes Loch mit violett beleuchteten Wänden, Glutnaht am Grund und additivem, leuchtendem Schleier.

**Lesbarkeit – pro:** Stärkste Werthierarchie der drei: dunkler Boden, helle gesättigte Einheiten mit Randlicht → erfüllt das Dota-Prinzip am saubersten. Blaue AoE und rote Skillshots leuchten auf dem dunklen Grund. Größte Stimmung, der Schleierbruch wirkt bedrohlich.
**Lesbarkeit – contra:** Lange Schlagschatten legen dunkle Streifen über die Lane und konkurrieren mit Bodenmarkierungen. Randlicht auf *allem* bricht die Spec-Regel „Highlights nur auf Metall/Glas“. Dauerhafte Dämmerung ist dunkel (helle Räume, schlechte Monitore) und eher melancholisch als „trocken, leicht ironisch“. Nähe zu Darkest Dungeon/Hades-Moodboards.
**Performance:** Wie A (Shader-Patch, große Bodentextur), plus: tiefe Sonne braucht ein größeres Schattenfrustum (mehr verschwendete Shadow-Map-Texel), additiver Nebel erzeugt Overdraw am Riss.
**Inspiration:** TF2 (Schatten nach kühl, warme Terminatorkante, Randlicht), Darkest Dungeon (harte Schattenformen, Tusche statt totem Grau), Transistor/Hades (kontrollierte, dunklere Palette).

---

## 5. Vergleich auf einen Blick

| | A Kupferstich | B Werkstatt-Lowpoly | C Gouache-Dämmerung |
|---|---|---|---|
| Spec-Treue (Konturen, Zweiton, Glanz nur Metall/Glas) | hoch (Schraffur ersetzt den zweiten Ton) | mittel (Gelände ohne Kontur, weiche Verläufe) | mittel (Randlicht überall) |
| Einheit vs. Boden (Wert) | über Kontur (helle Welt, dunkle Linien) | über Kontur + Sättigung | über Wert (dunkler Boden, helle Figuren) – am stärksten |
| Eigenständigkeit | sehr hoch | niedrig–mittel | mittel |
| Ton (trocken, ironisch) | passt am besten | freundlich | düster |
| Performance | mittel | am besten | mittel (–) |
| Risiko | Schraffur-Flimmern beim Schwenk | generisch | Schatten-Clutter, zu dunkel |

## 6. Empfehlung

**Variante A „Kupferstich“ als Richtung – mit der Werthierarchie-Regel aus C.**

Entscheidend war die Regel „Einheiten tragen den höchsten Kontrast im Bild“ (Valve/Dota, Riot-Ebenen). A erreicht sie über Tuschekontur und Schraffur, also *unabhängig von Licht und Tageszeit*; C erreicht sie nur über die Beleuchtung und erkauft das mit einer dauerhaft dunklen Stimmung, langen Schatten über der Lane und Randlicht entgegen der Spec. B ist am billigsten, liest sich gut, ist aber die am wenigsten eigene Welt und weicht beim Gelände von der Spec ab. A ist außerdem die einzige Variante, die den Ton (Handwerker, Gelehrte, trocken-ironisch) schon im Material erzählt.

Konkrete Auflagen, falls A gewählt wird:
1. **Papier abdunkeln, wo gekämpft wird:** Wege und Dschungel eine Stufe tiefer im Wert (Ziel: Boden-Luminanz ≈ 0,55–0,70, Einheiten-Lichter ≥ 0,80), Papierweiß nur noch für Plätze/Basen. Elfenbein-Flächen der Lichtwerk-Einheiten behalten so Abstand zum Weg.
2. **Schraffur in Weltkoordinaten** statt Bildschirmraum (Boden: x/z-Ebene; Wände: triplanar), damit nichts beim Schwenken schwimmt; Strichabstand mit Zoomstufe koppeln.
3. **Schraffur nie auf Einheiten-Sprites im Licht** – dort nur Formschatten, damit Figuren ruhiger als der Boden bleiben (Valve: Ruhezonen).
4. Gameplay-Farben bleiben die einzigen gesättigten Rot/Blau-Töne; Aschehalle-Rost bleibt braun.

Fallback: Wenn Leistung auf schwacher Hardware wichtiger ist als Identität, B – aber dann mit Konturen auf Strukturen, um die Spec näher zu treffen.

---

## 7. Quellen

- Valve, Dota 2 Workshop – Character Art Guide: <https://help.steampowered.com/faqs/view/0688-7692-4D5A-1935> (Inhalte über CGChannel: <https://www.cgchannel.com/2012/06/valve-releases-useful-character-design-guide>)
- Game Developer, „How to reduce visual confusion in your game“: <https://www.gamedeveloper.com/design/how-to-reduce-visual-confusion-in-your-game>
- Riot Games, „Clarity in League“: <https://www.riotgames.com/en/news/dev-clarity-in-league>
- Riot Red Post zum Summoner's-Rift-Update (Archiv): <https://www.surrenderat20.net/2014/11/red-post-collection-defining-rifts.html>
- Mitchell, Francke, Eng – „Illustrative Rendering in Team Fortress 2“ (NPAR 2007): <https://www.cs.princeton.edu/courses/archive/fall07/cos597B/papers/mitchell-team-fortress.pdf>, Folien: <https://cdn.fastly.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2_Slides.pdf>
- GameSpot, „The Gothic Sensibilities of Darkest Dungeon“: <https://www.gamespot.com/articles/the-gothic-sensibilities-of-darkest-dungeon/1100-6424880/>
- Game Developer, „Road to the IGF: Red Hook Studios' Darkest Dungeon“: <https://www.gamedeveloper.com/audio/road-to-the-igf-red-hook-studios-i-darkest-dungeon-i->
- PocketGamer.biz, „Indie Spotlight: Plausible Concept on Bad North“: <https://www.pocketgamer.biz/interview/68638/indie-spotlight-plausible-concept-on-bad-north/>
- Destructoid, Interview zu Transistor (Jen Zee): <https://destructoid.com/?p=146820>
- Praun, Hoppe, Webb, Finkelstein – „Real-Time Hatching“ (SIGGRAPH 2001): <https://hhoppe.com/proj/hatching/>
- GDC Vault, „Into the Breach Design Postmortem“ (nur Beschreibung gesehen): <https://gdcvault.com/play/1025772/-Into-the-Breach-Design>
