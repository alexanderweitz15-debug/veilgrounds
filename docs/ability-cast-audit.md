# Fähigkeiten: Bewegung beim Wirken (Audit B2)

16. Okt. 2026 · Agent B. Quelle der Wahrheit: `movesWhileCasting` und `castTime` in `src/data/champions/*.json` und
`src/data/summoners.json`; Engine: `movementLocked` in `src/sim/systems/abilities.ts` (statt `isBusy` setzt
`stats.ts` die Laufgeschwindigkeit nur noch auf 0, wenn der Wind-up die Bewegung sperrt). Test:
`tests/sim/castMovement.test.ts` (jede Fähigkeit: läuft 600, wirkt bei 300; `B2_AUDIT=1` druckt die Spalten unten).

Regel (AGENTS-PLAN §4 B2): Selbst-Buffs, Nächster-Auto-Verstärkungen, Stances, Pet-Befehle und Schilde unterbrechen die
Bewegung nicht (der Champion läuft während des Wind-ups weiter, die Wirkung kommt am Ende des Wind-ups). Gezielte Casts,
Skillshots und Selbst-Flächen (Schaden/CC um sich) stehen für ihren Wind-up (castTime, bei Blink/Kegel/Linie inkl.
`delay`), danach läuft der Champion seinen Pfad weiter (wie LoL). Kanäle (Renn R, Teleport, Rückruf) stehen voll.
Dashes/Blinks bewegen: während ihres kurzen Wind-ups läuft der Champion weiter, dann springt er.

Erweiterungen gegenüber der Liste im Prompt (Begründung): Verbündeten-Buffs Ferris E, Kiran E, Oda E wie Schilde
behandelt (gezielter Buff auf Verbündete, kein Angriff); Selbst-Buffs ohne Schaden Grimald W, Hagen R (Aura), Nyx W,
Nyx R (Sicht), Ottilie R, Renn W laufen; Oleth Q und Isolde R (Sprung auf Ziel) zählen als Dash. Selbst-Flächen mit
Schaden/CC (Brom Q, Hagen Q, Kaelen E, Ferris R, Gorvam R, Harrow R) bleiben Wind-up-Casts (stehen).

Spalten: Wind-up = Ticks, in denen der Wind-up lief (30 Ticks = 1 s); gelaufen = Einheiten während des Wind-ups;
Ankunft = Ankunfts-Tick minus Ankunft ohne Cast (Dashes/Blinks versetzen, dort ist die Ankunft nicht aussagekräftig;
Tempo-Buffs wie Oda R oder Seraphynes Passiv holen Zeit auf).

| Champion | Slot | Name | Typ | castTime (s) | delay (s) | läuft beim Wirken | Kategorie | Wind-up (Ticks) | gelaufen | Ankunft (Ticks) |
|---|---|---|---|---|---|---|---|---|---|---|
| aurel | Q | Zeiger | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 6 | 0 | +6 |
| aurel | W | Unruhefeld | zone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 6 | 0 | +6 |
| aurel | E | Zurückspulen | blink | 0.2 | 0.5 | ja | Dash/Blink | 16 | 168 | +42 |
| aurel | R | Stillstand | skillshot_circle | 0.3 | 1 | nein | Skillshot/Fläche (Wind-up) | 7 | 0 | +7 |
| brom | Q | Eisenwirbel | self | 0.2 | 0.5 | nein | Selbst-Fläche (Wind-up) | 7 | 0 | +7 |
| brom | W | Wurzelgriff | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 68 | +0 |
| brom | E | Anziehen | cone | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| brom | R | Fällen | targeted | 0.3 |  | nein | Gezielt (Wind-up) | 10 | 0 | +10 |
| corvin | Q | Doppelschuss | targeted | 0.2 |  | nein | Gezielt (Wind-up) | 7 | 0 | +7 |
| corvin | W | Pulverfass | summon | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| corvin | E | Abrollen | dash | 0.2 |  | ja | Stance | 7 | 68 | +20 |
| corvin | R | Salve | cone | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| dagny | Q | Kesselschlag | self | 0 |  | ja | Nächster-Auto-Verstärkung | 0 | 0 | +0 |
| dagny | W | Dampfstoß | cone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| dagny | E | Schildwall | self | 0.2 |  | ja | Stance | 7 | 68 | -4 |
| dagny | R | Kesselbruch | dash | 0.25 |  | ja | Dash/Blink | 9 | 91 | +11 |
| ferris | Q | Lichtstoß | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| ferris | W | Laterne | targeted | 0.2 |  | ja | Schild | 7 | 67 | +0 |
| ferris | E | Wegweiser | targeted | 0.2 |  | ja | Verbündeten-Buff (wie Schild) | 7 | 67 | -4 |
| ferris | R | Dämmerung | self | 0.3 |  | nein | Selbst-Fläche (Wind-up) | 10 | 0 | +10 |
| gorvam | Q | Kettenhaken | skillshot_line | 0.5 |  | nein | Skillshot/Fläche (Wind-up) | 16 | 0 | +16 |
| gorvam | W | Kettenschlag | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 67 | +0 |
| gorvam | E | Ankerwurf | skillshot_circle | 0.25 | 1 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| gorvam | R | Kettenzug | self | 0.3 |  | nein | Selbst-Fläche (Wind-up) | 10 | 0 | +10 |
| grimald | Q | Fangeisen | targeted | 0.25 |  | nein | Gezielt (Wind-up) | 9 | 0 | +9 |
| grimald | W | Dickes Fell | self | 0.2 |  | ja | Selbst-Buff | 7 | 68 | +0 |
| grimald | E | Netzwurf | skillshot_circle | 0.25 | 1 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| grimald | R | Bärensprung | dash | 0.25 |  | ja | Dash/Blink | 9 | 91 | +11 |
| hagen | Q | Läuten | self | 0.25 |  | nein | Selbst-Fläche (Wind-up) | 9 | 0 | +9 |
| hagen | W | Schutzglocke | targeted | 0.2 |  | ja | Schild | 7 | 67 | +0 |
| hagen | E | Glockenstoß | dash | 0.2 |  | ja | Dash/Blink | 7 | 67 | +37 |
| hagen | R | Sturmgeläut | self | 0.25 |  | ja | Selbst-Buff | 9 | 89 | +0 |
| harrow | Q | Rammstoß | targeted | 0.2 |  | nein | Gezielt (Wind-up) | 7 | 0 | +7 |
| harrow | W | Schildpflicht | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 69 | +0 |
| harrow | E | Anmarsch | self | 0.2 |  | ja | Stance | 7 | 69 | -5 |
| harrow | R | Beschworene Mauer | summon | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| ilvane | Q | Fadenriss | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| ilvane | W | Spinnwirbel | skillshot_circle | 0.25 | 0.6 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| ilvane | E | Fadenrückzug | dash | 0.2 |  | ja | Dash/Blink | 7 | 67 | +31 |
| ilvane | R | Netz des Schleiers | cone | 0.35 |  | nein | Skillshot/Fläche (Wind-up) | 12 | 0 | +12 |
| isolde | Q | Schliff/Bruch | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 69 | +0 |
| isolde | W | Glasbogen | cone | 0.2 | 0.5 | nein | Skillshot/Fläche (Wind-up) | 22 | 0 | +22 |
| isolde | E | Drahtzug | dash | 0.2 |  | ja | Dash/Blink | 7 | 69 | +0 |
| isolde | R | Glaskuppel | targeted | 0.25 |  | ja | Dash/Blink | 9 | 92 | +2 |
| kaelen | Q | Klingenwurf | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| kaelen | W | Schattenschritt | dash | 0.2 |  | ja | Dash/Blink | 7 | 69 | +27 |
| kaelen | E | Fächerhieb | self | 0.2 |  | nein | Selbst-Fläche (Wind-up) | 7 | 0 | +7 |
| kaelen | R | Hinrichtung | targeted | 0.25 |  | nein | Gezielt (Wind-up) | 9 | 0 | +9 |
| kiran | Q | Fadenschuss | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| kiran | W | Knoten | skillshot_circle | 0.25 | 1 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| kiran | E | Schicksalsfaden | targeted | 0.2 |  | ja | Verbündeten-Buff (wie Schild) | 7 | 67 | -2 |
| kiran | R | Garnnetz | skillshot_circle | 0.3 | 0.75 | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| lio | Q | Funkenstein | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| lio | W | Funkensprung | dash | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 68 | +27 |
| lio | E | Blendfunken | skillshot_circle | 0.25 | 0.5 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| lio | R | Funkenregen | skillshot_circle | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| lysa | Q | Nadelsalve | self | 0.2 |  | ja | Stance | 7 | 67 | +0 |
| lysa | W | Fadenpfeil | skillshot_line | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| lysa | E | Stolperdraht | zone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| lysa | R | Durchschuss | skillshot_line | 0.3 | 1 | nein | Skillshot/Fläche (Wind-up) | 40 | 0 | +40 |
| mira | Q | Bogenspannung | self | 0 |  | ja | Stance | 0 | 0 | +0 |
| mira | W | Nebelpfeil | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| mira | E | Rolle | dash | 0 |  | ja | Dash/Blink | 0 | 0 | +7 |
| mira | R | Pfeilregen | skillshot_circle | 0.25 | 1 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| nyx | Q | Schattendolch | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| nyx | W | Verhüllen | self | 0.2 |  | ja | Selbst-Buff | 7 | 68 | -3 |
| nyx | E | Hohlsprung | dash | 0.2 |  | ja | Dash/Blink | 7 | 68 | +32 |
| nyx | R | Schleiernacht | self | 0.3 |  | ja | Selbst-Buff | 10 | 102 | +0 |
| oda | Q | Wasserstrahl | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| oda | W | Quellkreis | zone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| oda | E | Strömung | targeted | 0.2 |  | ja | Verbündeten-Buff (wie Schild) | 7 | 67 | -2 |
| oda | R | Flut | skillshot_line | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +3 |
| oleth | Q | Banner | targeted | 0.25 |  | ja | Dash/Blink | 9 | 91 | +0 |
| oleth | W | Ruf | self | 0.2 |  | ja | Stance | 7 | 68 | -3 |
| oleth | E | Sturmschritt | dash | 0.2 |  | ja | Dash/Blink | 7 | 68 | +3 |
| oleth | R | Mahnmal | zone | 0.3 | 0.7 | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| ottilie | Q | Hetzpfeil | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| ottilie | W | Spürnase | summon | 0.2 |  | ja | Pet-Befehl | 7 | 68 | +0 |
| ottilie | E | Rückzugsschuss | dash | 0.2 |  | ja | Dash/Blink | 7 | 68 | +25 |
| ottilie | R | Jagdruf | self | 0.2 |  | ja | Selbst-Buff | 7 | 68 | +0 |
| renn | Q | Klingenwurf | targeted | 0.25 |  | nein | Gezielt (Wind-up) | 9 | 0 | +9 |
| renn | W | Klinge in die Luft | self | 0.2 |  | ja | Selbst-Buff | 7 | 68 | -5 |
| renn | E | Sprung zur Klinge | blink | 0.2 |  | ja | Dash/Blink | 7 | 68 | +0 |
| renn | R | Siebenfacher Schnitt | self | 0.2 |  | nein | Kanal (steht voll) | 7 | 0 | +81 |
| seraphyne | Q | Blitzspeer | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +6 |
| seraphyne | W | Wetterfeld | zone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +6 |
| seraphyne | E | Donnerschritt | blink | 0.2 | 0.3 | ja | Dash/Blink | 16 | 170 | +10 |
| seraphyne | R | Gewitterfront | skillshot_circle | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +7 |
| thessaly | Q | Lichtlanze | targeted | 0.25 |  | nein | Gezielt (Wind-up) | 9 | 0 | +9 |
| thessaly | W | Prisma | self | 0.2 |  | ja | Schild | 7 | 67 | +0 |
| thessaly | E | Blendung | cone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| thessaly | R | Sonnenurteil | targeted | 0.3 |  | nein | Gezielt (Wind-up) | 10 | 0 | +10 |
| tobin | Q | Harpune | skillshot_line | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| tobin | W | Beidrehen | dash | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 67 | +14 |
| tobin | E | Netz auswerfen | skillshot_circle | 0.25 | 0.75 | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| tobin | R | Sturmflut | skillshot_line | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| vessa | Q | Pranke | targeted | 0.2 |  | nein | Gezielt (Wind-up) | 7 | 0 | +7 |
| vessa | W | Reißzahn | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 69 | +0 |
| vessa | E | Anpirschen | self | 0.2 |  | ja | Stance | 7 | 69 | -4 |
| vessa | R | Sprungangriff | dash | 0.25 |  | ja | Dash/Blink | 9 | 92 | +2 |
| wren | Q | Brandpfeil | self | 0.2 |  | ja | Nächster-Auto-Verstärkung | 7 | 67 | +0 |
| wren | W | Ascheteppich | zone | 0.25 |  | nein | Skillshot/Fläche (Wind-up) | 9 | 0 | +9 |
| wren | E | Rauchsprung | dash | 0.2 |  | ja | Dash/Blink | 7 | 67 | +25 |
| wren | R | Feuersturm | skillshot_circle | 0.3 |  | nein | Skillshot/Fläche (Wind-up) | 10 | 0 | +10 |
| Beschwörer | – | Sprung | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Heilen | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Geist | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Entflammen | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Erschöpfen | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Reinigen | sofort | 0 |  | ja | sofort | – | – | – |
| Beschwörer | – | Teleport | kanal | 0 | 4 (Kanal) | nein | Kanal (steht voll) | – | – | – |
| Beschwörer | – | Bannen | sofort | 0 |  | ja | sofort | – | – | – |
