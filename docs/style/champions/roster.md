# Champion-Roster: Körpertypen und Silhouetten

Stil: Gouache-Dämmerung (Variante C), LoL-ähnliche Proportionen. Alle Champions laufen über dasselbe
gemalte Rig (`src/render/champions/humanoid.ts`); nicht-menschliche Völker sind **Körper-Varianten** dieses
Rigs (`BodySpec.digi` / `BodySpec.float`, `Outfit.skinKind`, `snout`, `ears`, `horns`, `tail`, `tusks`, `feet`,
gezeichnet in `src/render/champions/beast.ts`) plus eigene Requisiten. Hark (Ottilies Wolf) bleibt ein eigener
Zeichner (`wolf.ts`). Jeder Champion hat **eine dominante Farbe**, die Teamfarbe ist nur der Bodenring.

12 von 26 Champions sind nicht-menschlich oder kein Standard-Mensch.

| Champion | Titel / Archetyp | Körpertyp | Lesbares Merkmal (64 px) | Leitfarbe |
|---|---|---|---|---|
| Ilvane | Schleierweberin, Skillshot-Magierin | **Spinnenvolk** (4 Chitinbeine aus dem Rücken, leuchtende Augen) | Spinnenbeine über den Schultern | Dämmerviolett |
| Thessaly Vorn | Lichtprüferin, Burst-Magierin | Mensch, sehr groß und schmal | Lanze diagonal vor dem Körper (Port-Haltung) | Elfenbein/Gold |
| Kaelen Rasch | Kurier, Dash-Assassine | Mensch, drahtig, geduckt | Kurierkappe + langer Ockerschal | Moos/Ocker |
| Renn Sieben | Deserteur der sieben Klingen | Mensch | Sieben Klingen als Fächer auf dem Rücken | Kohle/Weinrot |
| Aurel Stundenwerk | Uhrmacher, Kontrollmagier | Mensch, alt, stark gebeugt | Stützt sich auf den Pendelstab, Uhr auf dem Rücken | Flaschengrün/Messing |
| Seraphyne Sturm | Blitzableiter, Kampfmagierin | Mensch, athletisch | Weißes Sturmhaar, Speer schräg über der Schulter | Sturmblau |
| Brom Eisenwurz | Holzfäller, Juggernaut | **Baumvolk** (Rinde, Laubbart, Astgeweih, Wurzelfüße) | Äste auf dem Kopf + Riesenaxt | Rindenbraun/Moos |
| Schwester Oleth | Mauer des Ordens, Engage-Tank | **Steinkonstrukt** (lebende Statue, glühende Augen) | Graue Steinhaut, Stachel-Schulterplatten, rotes Banner | Steingrau/Rot |
| Old Harrow | Torbrecher, Splitpusher | **Widdervolk** (Ziegenmaul, Spiralhörner, Hufe, digitigrad) | Widderhörner + Turmschild | Wollweiß/Blau |
| Isolde Glasmacherin | Glasbläserin, Duellantin | Mensch | Glasklinge am Unterarm, Kupferspule | Leinen/Glas-Cyan |
| Dagny Kessel | Kesselschmiedin, Tank-Bruiser | **Zwergin** (klein, sehr breit) | Kesselschild + Dampfventile | Rost/Kupfer |
| Vessa Wildherz | Fährtenleserin, Bruiser | **Wolfsvolk** (Wolfskopf, Mähne, Buschschwanz, Pfoten, digitigrad) | Schnauze + Ohren + Schwanz, geduckt | Graubraun/Rot |
| Nyx Hohlschatten | Lampenlöscher, Stealth-Assassine | **Geist/Wraith** (schwebt, keine Beine, Schattenschleppe) | Leere Kapuze, zerfetzte Schleppe statt Beinen | Nachtviolett |
| Grimald Fell | Fallensteller, Engage-Jungler | **Bärenvolk** (riesig, gebeugt, Bärenkopf) | Bärenkopf + Bärenfalle an der Kette | Dunkelbraun/Jägergrün |
| Lio Funkenkind | Funkenlehrling, Burst-Magier | **Funkenvolk (Yordle-artig)**: kniehoch, große Ohren | Riesenohren + übergroße Steinhandschuhe | Orange/Messing |
| Ottilie Wolfsrufer | Rudelführerin, Pet-Jägerin | Mensch (+ Wolf Hark) | Weiße Pelzkapuze + Langbogen | Waldbraun/Weiß |
| Mira Quell | Bognerin, Marksman | Mensch | Bogen länger als sie selbst, roter Zopf | Blattgrün |
| Corvin Pulver | Büchsenmacher | Mensch | Breiter schwarzer Hut, rote Schärpe, Trommelpistolen | Kohle/Rot |
| Lysa Nadel | Näherin, Hypercarry | Mensch, schmal | Riesiges Nadelgewehr | Bordeaux/Elfenbein |
| Tobin Sturmkiel | Harpunier | Mensch, Seemann | Dreispitz + Harpunenkanone | Ölzeug-Gelb |
| Wren Aschenflug | Köhlerin, Zonen-Marksman | **Rabenvolk** (Schnabel, Federmantel, Krallen, digitigrad) | Langer Schnabel + Federschleppe | Schwarz/Glutorange |
| Ferris Lampenhand | Laternenträger, Enchanter | Mensch, lang und dünn | Zylinder + Laterne hoch am Stab | Kupfer |
| Gorvam Kettenmund | Hafenschlepper, Hook-Support | **Oger (Brutalo-Volk)**: riesige Schultern, Hauer | Kleiner Kopf auf Riesenkörper + Haken an der Kette | Graugrün/Schiefer |
| Mutter Hagen | Glöcknerin, Engage-Support | Mensch, alt und rund | Joch mit großer Glocke, rotes Kopftuch | Pflaume |
| Kiran Fadenleser | Garnleser, Mage-Support | Mensch, kahl, Augenbinde | Zwei Handspindeln mit rotem Faden | Indigo/Rot |
| Oda Brunnen | Wasserträgerin, Heal-Enchanter | **Froschvolk** (breiter Froschkopf, Glubschaugen) | Kegel-Strohhut + Wasserkrug auf der Schulter | Teal/Grün |

## Animation (alle Champions)

- Idle (4): Atmen + Gewichtsverlagerung (Hüfte/Schulter-Kontrapost), Schwebe-Bob bei Geistern; Frame 0 bleibt
  die neutrale Pose (Porträts, `headAnchor`, Balkenhöhe).
- Lauf (8): Kontakt/Passing pro Schritt, Knie hoch, Gegenrotation Schultern, Armschwung, nachschwingender
  Stoff (Umhang/Schal/Schwanz).
- Angriff (5): Ausholen, Spannung, **Treffer** (= Hit-Point der Sim, `ATTACK_HIT`), Durchschwung, Erholung.
  Die Ausholframes werden über die echte Wind-up-Zeit gestreckt; der Trefferframe erscheint genau beim
  Wechsel `atkPhase 1 -> 2` (gleichzeitig Körperlunge bei Nahkampf, Rückstoß bei Fernkampf).
- Zauber (4): Sammeln (über die Cast-Zeit der Sim), Auslösen, Nachschwung, Selbst-Buff-Pose. Fähigkeitstyp
  bestimmt die Wiedergabe: gerichtet (Skillshot/Ziel/Kegel/Zone) = Sammeln -> Auslösen -> Nachschwung;
  `self` = Sammeln -> Buff-Pose; `dash`/`blink` = Sammeln -> Ausfallschritt.
- Treffer-Zucken: kurzer Rückstoß weg von der Schadensquelle (Instanz-Offset), Tod (3): Zurückwerfen,
  Einknicken, Liegen.
- Minions behalten 4 Angriffsframes (Treffer auf Frame 1) mit derselben Hit-Point-Synchronisation.
