# Sev Aschenblick – Fassung 3 (aktuell)

Nutzer-Feedback (über den Lead): „Sev spielt sich zu langweilig und sieht nicht aus wie Itachi – reworke die Abilities.“
Sev soll klar Itachi-inspiriert sein. Name bleibt Sev Aschenblick. Nur die geschützten Marken bleiben draußen (kein
Rote-Wolken-Mantelmuster, kein Blatt-Stirnband-Symbol, kein kopiertes Komma-Auge); alles andere darf nach Itachi aussehen.

AUSSEHEN: blasses Gesicht, lange schwarze Haare mit tiefem Pferdeschwanz und langen Ponysträhnen, die das Gesicht rahmen,
Tränensäcke-Linien unter den Augen, leuchtend rote Augen mit langsam drehendem Dreiklingen-Muster (eigenes Design),
dunkler langer hochgeschlossener Mantel mit karmesinrotem Futter und Krähenfeder-Muster, Halskette mit drei Ringen,
Krähen kreisen im Idle um ihn und brechen bei Casts hervor. Silhouette bei 64 px: „langhaarige Mantelfigur mit Krähen“.

KIT (Spaß zuerst; Zahlen in sev.json, gegen die anderen Mids mit tools/balance.ts und Bot-Sim tunen):
- Passiv „Rabenblick“: Fähigkeitstreffer geben einen Blick-Stack (max. 3, 6 s); bei 3 fällt das Ziel in ein kurzes
  Genjutsu: Betäubung 0,75 s, Abklingzeit pro Ziel 12 s. Die Augen flackern sichtbar bei 3 Stacks.
- Q „Feuerball“: großer Feuerball als Linien-Skillshot (~900), explodiert als Fläche beim ersten Treffer oder bei
  maximaler Reichweite, hinterlässt ~1,5 s brennenden Boden. Der Fake-Recast bleibt (Re-Cast innerhalb 0,4 s bricht ab,
  Mana zurück, kurze Abklingzeit) – Trainingswert.
- W „Krähendoppel“: sofortiger Blink ~400 Richtung Cursor, auch gewurzelt/verlangsamt wirkbar (nicht betäubt), lässt an
  der alten Stelle einen Krähen-Klon mit Sevs Aussehen und falscher Lebensleiste; der Klon zerplatzt in Krähen, wenn er
  von irgendetwas getroffen wird oder nach 1,5 s (Flächenschaden + Verlangsamung + Blick-Stack). Projektile, die schon
  auf Sev fliegen, wechseln auf den Klon (Gefühl eines Tausch-Jutsu).
- E „Bannblick“: gezielt ~650, 0,4 s Blickkontakt; schaut das Ziel zu Sev (Winkel < 90°), wird es 1,25 s betäubt,
  sonst verlangsamt. Wegschauen ist der Konter; Telegraph, damit der Gegner reagieren kann.
- R (Level 6): der Spieler WÄHLT eines von dreien, dauerhaft für das Match (Wahlkarten über der Fähigkeitsleiste,
  Tasten 1/2/3, Bots wählen aus den Daten `botUltChoice`, deterministisch):
  1. „Amaterasu“: gezielt, schwarze Flammen mit karmesinrotem Kern auf dem Ziel: starker Schaden über Zeit, nicht
     reinigbar, schwere Wunden; springt einmal auf den nächsten Gegner, wenn das Ziel brennend stirbt; brennender Boden
     darunter.
  2. „Susanoo“: 6 s riesiger durchscheinender orange-roter Geisterkrieger um Sev: großer Schild, Immunität gegen
     Verlangsamung, Autos werden breite Schwerthiebe; einmal Re-Cast: langer Schwertstoß als Skillshot.
  3. „Tsukuyomi“: gezielt 500, Unterdrückung 1,5 s (Bildschirm des Ziels rot-schwarz getönt, roter Mond), Sev
     währenddessen gewurzelt, Schaden am Ende skaliert mit fehlendem Leben des Ziels.
Wiederverwenden: Trugbild-Entity, Furcht-CC, uncleansable, falsche Lebensleiste. Visuals auffällig und je Fähigkeit
verschieden (Feuerball, Krähenexplosion, Augenflackern, schwarze Flamme, Geisterkrieger, roter Mond); neues Sprite nach
obigem Look. Bot-Regeln in docs/agents/issues.md (A2 ergänzt Build/Ult-Wahl). Tests: Kit-Tests aktualisiert,
Ult-Wahl dauerhaft + Bot-Default, Determinismus, sideMirror, validate. Screenshots jeder Fähigkeit und der drei Ults in
docs/ist/e-sev3-*.jpg.

---

# Frühere Fassung (2), nicht mehr gültig

Prompt: Neuer Champion „Sev Aschenblick“ (Fassung 2)
Baue einen 27. Champion nach den Konventionen aus `docs/spec-champions.md` (JSON in `src/data/champions/sev.json`, Hooks in `src/sim/champions/sev.ts`, Eintrag in `champion-hooks.md`, Build, Prägungen, drei Signature-Combos, Sprite nach Stilvariante A, Silhouette bei 64 px erkennbar, Visuals für jeden Zustand).
Konzept: Mid/Jungle, Ranged 525, AP-Mage um ein Thema: das Auge, das brennt und täuscht. Schweigsamer Deserteur der Aschehalle; greift nie zuerst an, bestraft stattdessen. Trainingszweck: Fake-Casts lesen, unlöschbaren Brand managen, Trugbild vom echten Ziel unterscheiden, lange Cooldowns tracken.
Aussehen (eigener Stil, keine Vorlage kopieren): bodenlanger, hochgeschlossener Mantel in Kohle mit Kupfersaum und einem Muster aus grauen Aschewirbeln, Kragen bis zur Nase; eine Hand ragt aus dem Mantel, Handfläche nach oben, darüber schwebt ein kleines Glutauge. Linkes Auge glüht kupferrot mit einem dreiarmigen Riss statt Pupille. Idle: Mantel bewegt sich, die Hand kreist. Primärmerkmal für die Silhouette: die ausgestreckte Hand mit dem schwebenden Auge.
Fähigkeiten
* Passiv – Nachbild: Jeder Fähigkeitstreffer hinterlässt 3 s ein Nachbild. Sevs Autos auf Gegner mit Nachbild machen +10–30 (+15 % AP) und verlängern laufende Schwarzglut um 0,5 s.
* Q – Glutblick: Linien-Skillshot aus dem Auge, 950 Reichweite, Breite 60, 70/110/150/190/230 (+60 % AP). Re-Cast innerhalb 0,4 s bricht ab (Fake, 2 s CD, Mana zurück). CD 7.
* W – Schwarzglut: Zielgerichtet 650 auf Champion oder Minion: 4 s schwarzes Feuer, 20/32/44/56/68 (+22 % AP) pro Sekunde, schwere Wunden (−40 % Heilung), nicht durch Reinigen entfernbar, nur durch Tod oder Ablauf. Stirbt das Ziel, springt die Glut auf den nächsten Gegner in 300 (einmal). Auf ein eigenes Trugbild gecastet: Trugbild brennt 4 s und macht 50 % der Glut an allen Gegnern in 250. CD 14/13/12/11/10.
* E – Trugbild: Blink 450 (einziger Dash). An der Startposition bleibt 2,5 s ein Trugbild mit Sevs Aussehen und gefälschter HP-Leiste stehen, das Autos ohne Schaden ausführt. Trifft ein Gegner es mit einer Fähigkeit, erhält er ein Nachbild. CD 18/17/16/15/14.
* R – Augenbann (Genjutsu-artig): Zielgerichtet 700 auf einen Champion mit Nachbild, 0,5 s Blickkontakt-Kanal (bricht bei Sichtverlust ab). Dann 1,5 s Bann: das Ziel wird für Sevs Team enthüllt, seine Fähigkeiten und Beschwörerzauber sind gesperrt, es sieht drei Trugbilder um sich und läuft 50 % verlangsamt von Sev weg (neuer CC-Typ Furcht, zwischen Wurzel und Betäubung in der CC-Hierarchie, Tenacity wirkt). Am Ende 180/300/420 (+70 % AP); hat das Ziel während des Banns Schwarzglut, +50 %. CD 110/90/70.
Spike: Level 6. Combos: W→Q→Auto; E→Q (Fake)→Q→W; W→R→Q→Auto.
Bot-Regeln (Gehirn-Team): Q-Fakes ab Platin gezielt gegen erkannte Dodge-Muster; Bots ab Gold greifen Trugbilder nicht mit Fähigkeiten an (darunter 40 %); Bots mit Schwarzglut recallen nicht in Panik, sondern rechnen den Brand in `ExchangeEstimate` ein; Furcht wird im Escape-Knoten wie Betäubung behandelt.
Sim-Erweiterungen nötig: Trugbild-Entity mit Fake-HP-Leiste, CC-Typ Furcht (Bewegungszwang weg vom Verursacher), Buff-Flag `uncleansable`.
Nicht erlaubt: Namen, Symbole, Wolkenmuster oder Augenformen aus bestehenden Werken; Glut ist schwarz mit kupferrotem Kern, keine fremde Flammenform.
Einwand: Das Kit hat mit Schwarzglut (schwere Wunden, unlöschbar, springt) und Augenbann (Fähigkeiten gesperrt, Furcht, Enthüllung) zwei sehr starke Debuffs plus ein Trugbild. Für die Balance würde ich eines davon abschwächen, am ehesten die Glut ohne Sprung. Entscheide das nach dem ersten Bot-Sim-Lauf, nicht vorher.
