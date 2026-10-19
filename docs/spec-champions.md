# Spec §3 Champions (aus dem Design-Prompt, unverändert übernommen)

27 Champions (26 + Sev, Agent E), mindestens fünf pro Rolle. Jeder Champion: Passiv, Q/W/E (ab Level 1 wählbar, Maximalrang 5), R (Level 6/11/16, Rang 3). Rang n frühestens auf Level 2n−1.

Design-Prinzipien:
- Jede Fähigkeit: sichtbare Cast-Animation (Wind-up 0,2–0,45 s), erkennbares Projektil oder Bodenanzeige, Audio-Cue. Hitbox = sichtbare Fläche.
- Genau ein Power-Spike-Level (2, 3 oder 6) in der Beschreibung (einige Champions nennen zwei; so übernehmen).
- Kein Champion hat mehr als einen harten Dash.
- Scaling pro Level (HP, HP-Reg, AD, Rüstung, MR, AS) folgt LoL-Kurven; jede Fähigkeit mit Rang-Tabelle für Schaden, Abklingzeit, Kosten, Reichweite.
- Je Champion: Rollen (Primär, Sekundär), Standard-Build, Max-Reihenfolge, drei Signature-Combos.

## Roster

1. **Ilvane, die Schleierweberin** – Mid, Skillshot-Mage (AP), Ranged 550. Training: Skillshots landen, Abstand halten.
   - Passiv Fadenmarke: Fähigkeitstreffer markieren 4 s; Auto auf markierte Ziele 10–40 (+20 % AP) Bonusschaden, +20 % Bewegung 1 s.
   - Q Fadenriss: Linie 950, Breite 60, Speed 1.700, 70/110/150/190/230 (+60 % AP). CD 7. Nur erstes Ziel.
   - W Spinnwirbel: Kreis auf Zielposition (Reichweite 800, Radius 250), 0,6 s Verzögerung, 40 % Slow 1,5 s. CD 12.
   - E Fadenrückzug: Rückwärts-Hop 350, 0,4 s unverwundbar gegen Projektile. CD 16. Einziger Dash.
   - R Netz des Schleiers: Kegel 1.100, 40°, 250/400/550 (+80 % AP), wurzelt Ziele mit Fadenmarke 1,2 s. CD 100.
   - Spike 6. Combos: W→Q, E→Q (Kite), Q→Auto→R→W.
2. **Thessaly Vorn** – Mid, Point-and-Click-Burstmage (AP), Ranged 575. Training: P&C-Trades einschätzen, CD-Tracking.
   - Passiv: alle 12 s nächste Fähigkeit kostet kein Mana.
   - Q Lichtlanze: zielgerichtet 625, 80/125/170/215/260 (+55 % AP). CD 6.
   - W Prisma: Schild 60–200 (+40 % AP) 2 s, reflektiert 25 % des absorbierten Schadens als Magie. CD 14.
   - E Blendung: Kegel 500, Blind 1,2 s, 60/90/120/150/180. CD 11.
   - R Sonnenurteil: zielgerichtet 700, 300/450/600 (+75 % AP), +50 % unter 30 % HP. CD 80.
   - Spike 6. Combos: Q→E→Auto, W→Q, E→Q→R.
3. **Kaelen Rasch** – Mid/Jungle, Melee-Assassine (AD), 150. Training: Dash-Combos.
   - Passiv Nachlauf: nach Dash nächster Auto in 2 s 30–120 (+40 % Bonus-AD).
   - Q Klingenwurf: Linie 850, Breite 70, 60/95/130/165/200 (+70 % Bonus-AD), markiert erstes Ziel 3 s. CD 8.
   - W Schattenschritt: Dash 450 zu Position oder zu markiertem Ziel (dann 900). CD 14/13/12/11/10.
   - E Fächerhieb: Kreis 300 um sich, 70/105/140/175/210 (+60 % Bonus-AD), W-CD −2 s bei Champion-Treffer. CD 9.
   - R Hinrichtung: zielgerichtet 600, unaufhaltbar, 150/250/350 (+100 % Bonus-AD) + 15 % fehlende HP; Kill: 10 s unsichtbar beim Verlassen des Kampfes. CD 90.
   - Spike 3 und 6. Combos: Q→W→Auto→E, Q→W→E→R, E→W.
4. **Brom Eisenwurz** – Top, Juggernaut (AD), Melee 175. Training: gegen Juggernauts kiten.
   - Passiv Blutsaft: Fähigkeiten stapeln bis 5 Blutungen (je 8/s über 5 s); bei 5 Stacks heilt er 2 % Max-HP pro Stack-Tick.
   - Q Eisenwirbel: nach 0,5 s Kreis 400, 50/80/110/140/170 (+100 % AD); Außenring 250–400 +50 % Schaden und +1 Stack. CD 9.
   - W Wurzelgriff: nächster Auto in 4 s +30 % Schaden, 60 % Slow 1 s. CD 7.
   - E Anziehen: Kegel 500, zieht Gegner 300 zu sich; passiv 25 % Rüstungsdurchdringung. CD 20/18/16/14/12.
   - R Fällen: zielgerichtet 450, wahrer Schaden 100/200/300 (+75 % Bonus-AD) +20 % pro Stack; Kill setzt CD zurück. CD 120/100/80.
   - Spike 6. Combos: E→W→Auto→Q, Auto→Q (Kante), E→Q→R.
5. **Sister Oleth** – Top/Jungle, Tank mit Engage, Melee 125. Training: Engage antizipieren, Peel.
   - Passiv Glaubensmauer: nach Schaden ≥ 15 % Max-HP ein 8 % Max-HP-Schild (CD 10).
   - Q Banner: zielgerichtet 450, 60/95/130/165/200 (+80 % AD), 0,5 s Stun wenn sie in den letzten 2 s gedasht ist. CD 10.
   - W Ruf: Umkreis 600, Verbündete +20 % Bewegung 2 s, sie selbst −20 % Schaden 3 s. CD 16.
   - E Sturmschritt: Dash 600, stoppt am ersten Gegner, Hochwurf 0,75 s. CD 18/17/16/15/14.
   - R Mahnmal: nach 0,7 s Steinwand (Länge 800) 350 vor ihr, Gegner in der Linie 1,5 s Stun, Wand blockt 4 s. CD 120.
   - Spike 6. Combos: E→Q→R, W→E, R→E.
6. **Mira Quell** – ADC, Marksman (AD), Ranged 550. Training: Orbwalking, Positionierung, Last-Hitting. (Wird von Agent B gebaut.)
7. **Ferris Lampenhand** – Support, Enchanter (AP), Ranged 550. Training: Laning als Support, Heal/Schild-Timing.
   - Passiv Gefährte: Verbündeter Champion in 800 +10 % Heilung/Schilde.
   - Q Lichtstoß: Skillshot 850, erstes Ziel, 30 % Slow 1,5 s, 60/95/130/165/200 (+50 % AP). CD 8.
   - W Laterne: Schild auf Verbündeten (700) 70/110/150/190/230 (+50 % AP) 2,5 s. CD 11.
   - E Wegweiser: Verbündeter und er +25 % Bewegung 2 s, entfernt Slows. CD 14.
   - R Dämmerung: Umkreis 650, heilt Verbündete 150/250/350 (+60 % AP), blendet Gegner 1 s. CD 110.
   - Spike 1 und 6. Combos: Q→Auto→W, E→W, R→W.
8. **Gorvam Kettenmund** – Support, Hook-Support (Tank). Training: Hooks dodgen und landen (wichtigstes Dodge-Objekt).
   - Passiv Schwere Ketten: jeder vierte Auto 40 % Slow 1 s.
   - Q Kettenhaken: Linie 1.050, Breite 70, Speed 1.900, Wind-up 0,5 s, zieht erstes Ziel 1,5 s zu sich, 80/120/160/200/240 (+100 % AP). CD 18/17/16/15/14. Re-Cast bricht ab (Fake-Hook).
   - W Kettenschlag: nächster Auto Hochwurf 0,5 s. CD 9.
   - E Ankerwurf: Kreis 300 auf 650, 1 s Verzögerung, 1 s Wurzel. CD 14.
   - R Kettenzug: zieht alle Gegner in 500 1,5 s mit 60 % Slow zu sich. CD 120.
   - Spike 2 und 3. Combos: Q→W→E, Flash→W→Q, E→Q.
9. **Vessa Wildherz** – Jungle, Bruiser (AD), Melee 150. Training: Pathing, Gank-Timing.
   - Passiv Fährte: Monster-Kills 1 Stack (max 10), je +1 % AS und +1 Bewegung.
   - Q Pranke: zielgerichtet 300, 60/90/120/150/180 (+90 % AD), Monster +30 %. CD 5.
   - W Reißzahn: nächster Auto heilt 30/45/60/75/90 (+10 % fehlende HP). CD 10.
   - E Anpirschen: 3 s +30 % Bewegung in Busch/Jungle; nächster Auto aus Busch/Fog 50 % Slow 2 s. CD 15.
   - R Sprungangriff: Sprung 700 auf Champion, 150/250/350 (+100 % Bonus-AD), Hochwurf 0,5 s, Verbündete in 500 +20 % AS 4 s. CD 90.
   - Spike 3 und 6. Combos: E→R→Q→Auto→W, E→Auto→Q.
10. **Nyx Hohlschatten** – Jungle, Assassine (AP), Ranged 450. Training: unsichtbare Ganks lesen.
    - Passiv Dunkelsaat: jedes getötete Lager hinterlässt 90 s eine unsichtbare Saat; Gegner darüber 3 s aufgedeckt.
    - Q Schattendolch: Linie 800, Breite 50, 70/110/150/190/230 (+70 % AP), kehrt zurück (Doppeltreffer). CD 7.
    - W Verhüllen: 2 s unsichtbar, +20 % Bewegung; Auto aus Unsichtbarkeit wurzelt 0,75 s. CD 22/20/18/16/14.
    - E Hohlsprung: Dash 500. CD 16.
    - R Schleiernacht: 6 s alle Gegner in 1.200 für ihr Team sichtbar; +15 % Schaden an Zielen, die niemand sonst sieht. CD 100.
    - Spike 6. Combos: W→Auto→Q→E, E→Q→R.
11. **Old Harrow** – Top, Splitpusher (AD), Melee 150. Training: Splitpush-Makro.
    - Passiv Belagerer: +25 % Schaden an Türmen; jede vierte vollständig gesicherte Welle +40 Gold.
    - Q Rammstoß: zielgerichtet 250, 70/105/140/175/210 (+100 % AD), an Minions AoE 200. CD 6.
    - W Schildpflicht: 3 s 25 % Schadensreduktion, nächster Auto Stun 0,5 s. CD 13.
    - E Anmarsch: 4 s +40 % Bewegung Richtung nächster gegnerischer Turm. CD 18.
    - R Beschwörte Mauer: 3 Belagerungsminions auf eigener Lane-Seite (12 s, bevorzugen Türme). CD 110.
    - Spike 9 (Q maxed). Combos: E→Q→W→Auto, R→E.
12. **Seraphyne Sturm** – Top/Mid, Battlemage (AP), Ranged 475. Training: Zonen, DoT-Trades, Mana.
    - Passiv Elektrisiert: Fähigkeiten geben 3 s +15 % Bewegung.
    - Q Blitzspeer: Linie 900, Breite 60, trifft alle, 60/95/130/165/200 (+65 % AP). CD 6.
    - W Wetterfeld: Kreiszone 350 auf 750, 4 s, 20/35/50/65/80 (+20 % AP)/s, 20 % Slow. CD 14.
    - E Donnerschritt: Teleport 350, 0,3 s Verzögerung, danach 1 s −10 % Schaden. CD 20/18/16/14/12. Blink, nicht durch Wände > 350.
    - R Gewitterfront: 3 Einschläge im Abstand 0,8 s (Radius 220, Reichweite 1.000), je 120/200/280 (+50 % AP), dritter Stun 1 s. CD 90.
    - Spike 6. Combos: W→Q→Auto, E→Q→W, W→R→Q.
13. **Renn Sieben, der Siebenklingen-Deserteur** – Mid, Melee-Reset-Assassine (AD+AP), 150. Training: Reset-Assassinen überleben, Klingen lesen.
    - Passiv Klingen sammeln: geworfene Klinge liegt 4 s; Aufheben = Rundumhieb (Radius 320, 50–200 +60 % Bonus-AD +40 % AP). Takedowns −12 s auf Q/W/E.
    - Q Klingenwurf: zielgerichtet 625, 70/105/140/175/210 (+40 % AP), springt auf bis zu zwei weitere, landet hinter dem letzten Ziel als Klinge. CD 9.
    - W Klinge in die Luft: Klinge landet nach 1,25 s an seiner Position; +50 % Bewegung abklingend 1,25 s. CD 15/14/13/12/11.
    - E Sprung zur Klinge: Blink 725 zu Klinge, Gegner oder Verbündetem; Klinge sofort aufgehoben. CD 12; Aufheben setzt E-CD auf 1,5 s.
    - R Siebenfacher Schnitt: 2,5 s Kanal, alle 0,15 s Klinge auf bis zu drei nächste Gegner (je 25/37/50 +22 % Bonus-AD +19 % AP), schwere Wunden. CC unterbricht. CD 90/60/45.
    - Spike 6. Combos: Q→E (Klinge)→Auto→W→E, W→E→Q, E→R.
14. **Isolde Glasmacherin** – Top, Duellantin (AD, wahrer Schaden), Melee 125. Training: Wand-Engages, 1v1, Splitpush.
    - Passiv Temperglas: nach 2 s ohne Schaden: nächster gegnerischer Treffer gibt Schild 20 % Max-HP gegen dessen Schadenstyp, 2 s. CD 16 (L1) bis 8 (L18).
    - Q Schliff/Bruch: nächster Auto +20/40/60/80/100 % AD. Re-Cast nach 1,5 s (bis 3,5 s): +40 % mehr, davon 40–100 % wahrer Schaden (Level), 25 % Slow 1 s. CD 9.
    - W Glasbogen: nach 0,5 s Kegel 650, 70/100/130/160/190 (+60 % Bonus-AD); äußere Hälfte 80 % Slow 1 s, heilt 50 % des Schadens an Champions. CD 17/16/15/14/13.
    - E Drahtzug: Draht 800 an Terrain, zieht sich hin; Re-Cast in 1 s: Dash 400, erster Champion 0,75 s Stun, +AS 5 s. CD 16/15/14/13/12.
    - R Glaskuppel: Sprung auf Champion (400), Kuppel Radius 450, 3,5 s; niemand sonst rein, Projektile von außen zerbrechen. Autos in der Kuppel +Bonusschaden an aktueller HP. CD 140/115/90.
    - Spike 3 und 6. Combos: E→Q→Auto→W→Q, R→Q→W→Q, E (Flucht über Wand).
15. **Dagny Kessel** – Top, Tank-Bruiser (HP), Melee 150. Training: gegen Tanks traden, Minion-Aggro.
    - Passiv Glühender Schild: jeder dritte Auto 4 % Max-HP magisch an Gegnern in 200 um das Ziel.
    - Q Kesselschlag: Auto-Reset, 60/95/130/165/200 (+6 % Max-HP), 15 % Schadensreduktion 2 s. CD 7.
    - W Dampfstoß: Kegel 450, 50/80/110/140/170 (+5 % Max-HP), 50 % Slow 1 s, −10 % Rüstung 4 s. CD 12.
    - E Schildwall: 2 s blockt Projektile von vorn, +30 % Bewegung in Blickrichtung. CD 18/17/16/15/14.
    - R Kesselbruch: Sprung 500, Kreis 400, 200/300/400 (+10 % Max-HP), Zentrum (150) Stun 1 s, Rest Slow. CD 120/100/80.
    - Spike 9 (Q). Combos: E→Q→Auto→W, R→Q→Auto.
16. **Grimald Fell** – Jungle, Tank-Jungler mit Engage, Melee 175. Training: CC-Ganks lesen, Dive-Druck.
    - Passiv Fallensteller: Monster-Kills hinterlassen 60 s unsichtbare Falle (0,5 s Wurzel, max 3).
    - Q Fangeisen: zielgerichtet 450, 70/110/150/190/230 (+80 % AD), 60 % Slow 1,25 s. CD 8.
    - W Dickes Fell: 4 s +20/25/30/35/40 % Rüstung/MR, heilt 2 % Max-HP/s bei Monstern. CD 16.
    - E Netzwurf: Kreis 250 auf 900, 1 s Verzögerung, Wurzel 1,5 s. CD 14/13/12/11/10.
    - R Bärensprung: Sprung 650 auf Zielbereich, Gegner in 300 Hochwurf 1 s, danach 3 s Aura −20 % AS. CD 110/90/70.
    - Spike 3 und 6. Combos: E→R→Q→Auto, R→E.
17. **Lio Funkenkind** – Jungle, AP-Burst-Jungler, Ranged 500. Training: Burst-Ganks aus dem Fog.
    - Passiv Funkenlast: Fähigkeiten laden 3 Funken; dritter Treffer explodiert (40–180 +30 % AP), Monster +50 %.
    - Q Funkenstein: Linie 850, Breite 60, 60/95/130/165/200 (+65 % AP), explodiert am Ende in 200. CD 6.
    - W Funkensprung: Dash 450; nächster Auto in 3 s +40 (+30 % AP). CD 14/13/12/11/10, Reset bei Champion-Takedown.
    - E Blendfunken: Kreis 300 auf 700, 0,5 s Verzögerung, Blind 1 s, 50/80/110/140/170 (+40 % AP). CD 12.
    - R Funkenregen: 5 Steine über 1 s (Radius 400, Reichweite 1.000), je 80/130/180 (+35 % AP), ab dem dritten Treffer am selben Ziel 1 s Stun. CD 100/80/60.
    - Spike 6. Combos: W→Auto→E→Q→R, Q→W→Auto.
18. **Ottilie Wolfsrufer** – Jungle, Jägerin mit Wolf (AD), Ranged 525. Training: Begleiter, Slow-Ganks, Jungle-Tracking.
    - Passiv Rudel: Wolf Hark kämpft mit (HP skaliert, 50 % ihres AD), Respawn 30 s, Monster-Kills heilen Hark.
    - Q Hetzpfeil: Linie 1.000, 60/95/130/165/200 (+90 % AD), markiert; Hark springt Ziel an (300, 50 % Slow 0,75 s). CD 8.
    - W Spürnase: Hark läuft 6 s zur Zielposition (bis 2.000) und gibt Sicht. CD 20/18/16/14/12.
    - E Rückzugsschuss: Hop 300 rückwärts, Pfeil nach vorn (Auto +30 %). CD 16.
    - R Jagdruf: 8 s Hark groß (+100 % Schaden, +300 HP), Ottilie +30 % AS, Harks Ziele 30 % Slow. CD 100/85/70.
    - Spike 6. Combos: Q→Auto→E→Auto, W→Q→R.
19. **Aurel Stundenwerk** – Mid, Control-Mage (AP), Ranged 550. Training: Zonen umlaufen, lange CDs tracken.
    - Passiv Unruh: alle 8 s nächste Fähigkeit 30 % schneller im Cast.
    - Q Zeiger: Linie 1.000, Breite 70, 70/110/150/190/230 (+70 % AP), durchdringt Minions, bis zu 2 Champions. CD 7.
    - W Unruhefeld: Kreis 320 auf 800, 3 s, 35 % Slow, gegnerische Projektile 40 % langsamer. CD 15.
    - E Zurückspulen: nach 0,5 s Teleport an Position von vor 3 s, heilt 15 % des erlittenen Schadens. CD 22/20/18/16/14. Blink.
    - R Stillstand: Kreis 450 auf 900, nach 1 s Stasis 1,2 s, danach 250/400/550 (+80 % AP). CD 120/100/80.
    - Spike 6. Combos: W→Q→Auto, R→W→Q, E (Dodge).
20. **Corvin Pulver** – ADC, Pistolier (AD), Ranged 500. Training: aggressive Kurz-Range-Lane, Nachlade-Fenster.
    - Passiv Trommel: 6 Schuss, dann 1,5 s Nachladen; letzter Schuss +50 %.
    - Q Doppelschuss: zwei Autos in 0,3 s (650), je 60 % AD +20/35/50/65/80, verbraucht 2 Schuss. CD 8.
    - W Pulverfass: Fass (750, 3 s); Auto darauf explodiert: Kreis 300, 70/110/150/190/230 (+70 % AD), 40 % Slow. CD 14/13/12/11/10.
    - E Abrollen: Dash 350, lädt 3 Schuss nach. CD 18/16/14/12/10.
    - R Salve: Kegel 1.200 (25°), 6 Kugeln, je 60/90/120 (+40 % AD), Minions blocken. CD 100/80/60.
    - Spike 2 und erstes Item. Combos: W→Auto→Q, E→Q→Auto, E→R.
21. **Lysa Nadel** – ADC, Hypercarry ohne Mobilität (AD), Ranged 600. Training: Positionierung ohne Escape.
    - Passiv Fadenlauf: pro Auto aufs selbe Ziel +4 % AS (max 8), Reichweite +25 pro 2 Stacks (max +100).
    - Q Nadelsalve: 3 s +30/40/50/60/70 % AS, +20 Reichweite. CD 12.
    - W Fadenpfeil: Linie 1.500, Breite 50, erster Champion, 70/115/160/205/250 (+90 % AD), 30 % Slow 2 s. CD 14.
    - E Stolperdraht: Draht (Linie 500) auf 700, 4 s; Kreuzen = 0,75 s Wurzel. CD 18/17/16/15/14.
    - R Durchschuss: globale Linie (Breite 120), 1 s Verzögerung, 250/400/550 (+120 % AD), −10 % pro durchdrungenem Champion. CD 120/100/80.
    - Spike drittes Item, Level 11. Combos: E→Q→Auto, W→Auto→Auto, R (Finish).
22. **Tobin Sturmkiel** – ADC, Harpunier (AD), Ranged 550. Training: Hook-ähnlicher Skillshot, Kiting mit Slow.
    - Passiv Seemannsbeine: nach Dash/Blink +20 % AS 3 s.
    - Q Harpune: Linie 1.100, Breite 60, 80/120/160/200/240 (+100 % AD), 2,5 s angeleint: über 650 entfernt = 1 s Wurzel. CD 13/12/11/10/9.
    - W Beidrehen: Dash 300, nächster Auto 50 % Slow 1,5 s. CD 16/15/14/13/12.
    - E Netz auswerfen: Kreis 350 auf 700, 0,75 s Verzögerung, 40 % Slow 2 s, enthüllt. CD 14.
    - R Sturmflut: Welle 1.300 lang, Breite 400, 200/300/400 (+90 % AD), schiebt 300 zurück. CD 110/90/70.
    - Spike 6. Combos: Q→E→Auto→W→Auto, R→Q.
23. **Wren Aschenflug** – ADC, Brandpfeil (AD/AP), Ranged 550. Training: Zonen-ADC, DoT-Trades.
    - Passiv Glut: Fähigkeitstreffer brennen 3 s (8–40 +15 % AP /s), Autos auf brennende Ziele +10 %.
    - Q Brandpfeil: nächster Auto +40/60/80/100/120 (+40 % AP), entzündet. CD 6.
    - W Ascheteppich: Linie 900 × 200, brennt 4 s, 25 % Slow. CD 16/15/14/13/12.
    - E Rauchsprung: Hop 300 rückwärts, Rauchwolke 2 s (Radius 250) blockt Sicht. CD 18/17/16/15/14.
    - R Feuersturm: 5 Pfeile auf Bereich (Radius 450, Reichweite 1.400) über 2 s, je 80/120/160 (+40 % AD +30 % AP). CD 100/80/60.
    - Spike 6 und zweites Item. Combos: Q→Auto→W, E→Q→Auto, W→R.
24. **Mutter Hagen** – Support, Tank-Engage mit Glocke, Melee 150. Training: Engage-Supports lesen, Flash-Engage.
    - Passiv Glockenschlag: jede Fähigkeit 1 Schlag; bei 3 betäubt der nächste Auto 0,5 s (CD 10).
    - Q Läuten: Kreis 350 um sich, 50/80/110/140/170 (+5 % Max-HP), 35 % Slow 1,5 s. CD 9.
    - W Schutzglocke: Verbündeter (700) Schild 60/100/140/180/220 (+8 % ihrer Max-HP) 3 s. CD 14.
    - E Glockenstoß: Dash 550 zu Gegner, Hochwurf 0,75 s, 70/110/150/190/230. CD 18/17/16/15/14.
    - R Sturmgeläut: 4 s Aura 500: Gegner −15 % Bewegung pro Sekunde (bis 60 %), Verbündete +20 % Tenacity. CD 120/100/80.
    - Spike 2 und 6. Combos: E→Q→Auto, Flash→E→R, W→E.
25. **Kiran Fadenleser** – Support, Mage-Support (AP), Ranged 575. Training: Poke-Supports, Wurzeln dodgen.
    - Passiv Vorahnung: alle 15 s zeigt ein Faden 1 s die Richtung zum nächsten unsichtbaren Gegner in 1.800.
    - Q Fadenschuss: Linie 1.000, Breite 60, 60/100/140/180/220 (+55 % AP), Wurzel 0,75/0,85/0,95/1,05/1,15 s nur in den letzten 300. CD 10/9,5/9/8,5/8.
    - W Knoten: Kreis 250 auf 700, 1 s Verzögerung, 50/80/110/140/170 (+45 % AP), 40 % Slow 1,5 s. CD 12.
    - E Schicksalsfaden: 3 s Verbindung zu Verbündetem (800): beide +15 % Bewegung, 20 % des Schadens auf den Verbündeten geht auf Kiran. CD 16.
    - R Garnnetz: Kreis 500 auf 900 nach 0,75 s: Wurzel 1,5 s, 150/250/350 (+60 % AP). CD 120/100/80.
    - Spike 1 (Q) und 6. Combos: W→Q, R→Q→W, E (Peel).
26. **Oda Brunnen** – Support, Heiler-Enchanter (AP), Ranged 550. Training: Sustain-Lanes, Heilung timen.
    - Passiv Quellwasser: Verbündete in 800 +1 % Max-HP/5 s.
    - Q Wasserstrahl: Linie 850, Breite 60, erster Gegner 60/95/130/165/200 (+50 % AP) + 25 % Slow 1 s; erster Verbündeter: heilt 40/70/100/130/160 (+30 % AP). CD 7.
    - W Quellkreis: Kreis 300 auf 650, 3 s, Heilung 20/30/40/50/60 (+15 % AP)/s. CD 16/15/14/13/12.
    - E Strömung: Verbündeter (700) +30 % Bewegung 2 s, entfernt Slows; sie +15 %. CD 13.
    - R Flut: Welle 1.000 × 500 in Zielrichtung: Gegner 300 zurückgedrängt, Verbündete heilen 150/250/350 (+50 % AP) und +40 % Bewegung 2 s. CD 110/90/70.
    - Spike 6. Combos: Q (Heal)→W, E→Q, R→W.
27. **Sev Aschenblick** – Mid/Jungle, Trickser-Brandmagier (AP), Ranged 525. Training: Fake-Casts lesen, unlöschbaren Brand managen, Trugbild vom echten Ziel unterscheiden, lange Cooldowns tracken. Volle Spezifikation: `docs/champions/sev.md`.
    - Passiv Nachbild: Fähigkeitstreffer markieren 3 s; Autos auf markierte Gegner +10–30 (+15 % AP) und laufende Schwarzglut +0,5 s.
    - Q Glutblick: Linie 950, Breite 60, 70/110/150/190/230 (+60 % AP). Re-Cast in 0,4 s bricht ab (Fake, 2 s CD, Mana zurück). CD 7.
    - W Schwarzglut: Ziel 650, 4 s 20/32/44/56/68 (+22 % AP)/s, schwere Wunden, unlöschbar, springt beim Tod einmal (300). Auf eigenes Trugbild: 50 % an Gegnern in 250. CD 14/13/12/11/10.
    - E Trugbild: Blink 450, Trugbild mit falscher Lebensleiste 2,5 s an der Startposition. CD 18/17/16/15/14.
    - R Augenbann: Ziel mit Nachbild (700), 0,5 s Blickkontakt, 1,5 s Furcht (enthüllt, Fähigkeiten/Beschwörerzauber gesperrt, 50 % Slow, flieht), am Ende 180/300/420 (+70 % AP), +50 % mit Schwarzglut. CD 110/90/70.
    - Spike 6. Combos: W→Q→Auto, E→Q (Fake)→Q→W, W→R→Q→Auto.

## Rollen (Primär; Sekundär in Klammern)
- Top: Brom, Sister Oleth (Jungle), Old Harrow, Seraphyne (Mid), Isolde, Dagny
- Jungle: Vessa, Nyx, Grimald, Lio, Ottilie, Kaelen (Mid), Sev (Mid)
- Mid: Ilvane, Thessaly, Kaelen, Renn, Aurel, Seraphyne, Sev
- ADC: Mira, Corvin, Lysa, Tobin, Wren
- Support: Ferris, Gorvam, Mutter Hagen, Kiran, Oda

## Welt und Ton (§11)
Handwerker, Deserteure, Gelehrte – kein Pantheon. Ton trocken, leicht ironisch, ohne Pathos. Je Champion 6 Voice-Lines (Pick, Erstes Blut, Kill, Tod, Recall, Taunt) als Text. Silhouette muss auf 64 px erkennbar sein (Renns sieben Klingen, Isoldes Drahtwerk, Mutter Hagens Glocke).
