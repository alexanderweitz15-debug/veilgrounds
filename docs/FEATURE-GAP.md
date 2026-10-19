# Feature-Gap gegen League of Legends

Stand: 16.10.2026, Agent C (Audit des Codes auf `main` @ `0bbc3d0`). Quelle der Wahrheit für Funktionslücken
(AGENTS-PLAN §2/§5). Der Aufsichts-Agent pflegt die Status-Spalte nach jedem Merge.

**Regeln dieser Tabelle**

- **Stand:** `da` nur, wenn die Funktion im Code vollständig vorhanden ist und von Agent C im gebauten Spiel gesehen
  wurde oder ein Test sie abdeckt; `teilweise` = Teile fehlen oder nicht geprüft (Grund in „Beleg / Lücke“);
  `fehlt` = nichts vorhanden. Abnahme (AGENTS-PLAN §5): jede `da`-Zeile braucht Screenshot und Test.
- **Trainingsnutzen** 1–5 (5 = hilft dem Spieler direkt, besser zu werden). **Aufwand** S (< ½ Tag), M (1–2 Tage),
  L (> 2 Tage). **Agent** B = Sim, C = UI, D = Darstellung/Trainer, A3 = Bot-Gehirn (Daten), S = Aufsicht.
- Sortierung innerhalb der Abschnitte nach Trainingsnutzen, dann Aufwand.

## 1. Im Spiel: Scoreboard, HUD, Timer

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 1.1 | Todestimer über der Minimap | Tote Verbündete und Gegner mit Porträt + Restzeit über der Minimap | da | 5 | S | C | C2 `feb41a2`: `src/ui/deathBar.ts` + `src/game/objectives.ts`; Test tests/objectives.test.ts (Timer = Sim-Wert); Screenshot docs/ist/c2-minimap-after.jpg. |
| 1.2 | Tab-Scoreboard: Objective-Leiste | Drachen-Elemente, Seele, Grubs, Baron-Buff-Restzeit, Türme, Inhibitoren mit Respawn | da | 5 | M | C (+B) | C2: Türme, Inhibitoren mit Respawn, Leviathan-Stapel/Seele, Kesselbrut beider Teams (Snapshot.kesselbrutTeams von B), Schleier-Buff-Restzeit; docs/ist/c2-scoreboard-objectives.jpg; Test tests/objectives.test.ts. |
| 1.3 | Tab-Scoreboard: Todestimer pro Spieler | Graues Porträt + Sekunden | da | 5 | S | C | C2: graues Porträt + Sekunden; Screenshot docs/ist/c2-scoreboard-after.jpg; Test tests/objectives.test.ts. |
| 1.4 | Tab-Scoreboard: Beschwörerzauber + Gegner-Klick-Timer | Eigene Zauber mit Abklingzeit; Klick auf Gegner-Zauber startet Timer, Chat-Zeile | teilweise | 5 | M | C (+B für eigene CDs) | C2: eigene Abklingzeiten live, Gegner per Klick-Timer (Basis-CD, Teleport spät) + Chatzeile (docs/ist/c2-scoreboard-after.jpg, Test). Abklingzeiten der Verbündeten fehlen im Snapshot (Vorschlag ScoreRow.summonerCds). |
| 1.5 | Tab-Scoreboard: Grunddaten | Porträt, Level, K/D/A, CS, Gold/Item-Wert, Items | da | 4 | – | C | `scoreboard.ts`; Screenshot `docs/ist/11-scoreboard.jpg`. Kein Test (nur DOM). |
| 1.6 | Tab-Scoreboard: Trinket, Vision-Score, Schaden an Champions | Trinket-Icon, Vision-Score, Schaden (Post-Game) | teilweise | 4 | M | C + B | Gegner-Items: Nutzer-Entscheidung 19.10. (B liefert zuletzt gesehene Items, Scoreboard zeigt sie ohne weitere Änderung). Vision-Score und Schaden an Champions fehlen im Snapshot (Vorschlag in shared-changes.md). |
| 1.7 | Tab-Scoreboard: Rang-Icon + 10 Spielstil-Mini-Skalen der Bots | (Veilgrounds-eigen) | teilweise | 4 | M | C (Daten A3) | Rang als Text, Spielstil nur als `title`-Tooltip (`styleTitle`). Wartet auf A3-Kalibrierung. |
| 1.8 | Objective-Timer oben Mitte | Drache/Baron/Herald-Timer, Buff-Restzeit | da | 5 | M | C | C3 `4bdc78b`: Leviathan/Kesselbrut/Schleierwächter-Countdown bzw. „da“ unter der Top-Leiste (Classic); Test „epic timers“; docs/ist/c3-hud-objectives.jpg. Buff-Monster-Timer fehlen (Lager-Tode im Nebel). |
| 1.9 | Zielrahmen über dem HUD | Porträt, HP/Mana, Werte, Buffs, Items des angeklickten Ziels | teilweise | 4 | M | C | C3: Linksklick auf Einheit → Porträt, Stufe, HP/Schild/Mana, K/D/A, CS, Items, CC/Buffs (docs/ist/c2-minimap-after.jpg). Gegner-Items erscheinen, sobald B sie liefert (Nutzer-Entscheidung 19.10., UI liest jedes `items`-Feld); Werte (AD/Rüstung) fehlen im Snapshot. |
| 1.10 | Eigene Buff-/Debuff-Leiste | Icons mit Restzeit-Ring und Tooltip | teilweise | 4 | M | C | C3: CC mit Restzeit, Fähigkeits-Buffs (Icon, ohne Restzeit: Snapshot liefert nur IDs), Jungle-/Objective-Buffs mit Restzeit. |
| 1.11 | Kamera nach dem Tod | Kamera bleibt frei, Hinweis, letzte Position statt Nebel | teilweise | 3 | S | C | C3: Hinweis „Kamera frei … Leertaste = zum Champion“ im Todes-Overlay (docs/ist/c3-dead-after.jpg). Kamera selbst unverändert. |
| 1.12 | Minimap: letzte bekannte Gegnerposition | Geist-Icon / „?“ wo der Gegner verschwand | da | 4 | S | C | C3: gegnerische Champions 45 s an der letzten gesehenen Position (gestrichelter Ring + „?“); Test „minimap last-seen ghosts“; docs/ist/c3-hud-objectives.jpg. |
| 1.13 | Todes-Zusammenfassung | „Getötet von“, Schadensaufteilung | da | 4 | – | C | `deathRecap.ts`; Screenshot `docs/ist/08-todesbildschirm.jpg`. Kein Test. |
| 1.14 | Death-Recap-Vergleich mit Challenger-Schatten | (Veilgrounds-eigen) | fehlt | 4 | M | C | Challenger-Geist nur im Post-Game (`ghostReview.ts`), nicht im Death-Recap. |
| 1.15 | Fehlzauber-Meldungen | „Nicht genug Mana“, „Außer Reichweite“ | teilweise | 3 | S | C | Für Fähigkeiten da (`castFail`), für Item-Aktive nicht. → C3 |
| 1.16 | Kill-Feed, Ansagen, Multikills, Ace | Ansager + Feed | da | 2 | – | C | `announce.ts`, `hud.ts` Kill-Feed. Kein Test. |
| 1.17 | Pause / Fortsetzen mit Ansage | „Spiel pausiert von X“ | teilweise | 1 | S | C | F10 pausiert (Overlay `hud.paused`), keine Ansage, keine Bot-Reaktion. |
| 1.18 | Teleport für Top nach 1.500 Minion-Gold | (Veilgrounds-eigen nach LoL 14) | fehlt | 3 | M | B (Sim), C (Slot/Ansage) | AGENTS-PLAN B4; HUD-Slot F2 + Ansage durch C, sobald `tpUnlocked` existiert. |

## 2. Pings und Chat

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 2.1 | Ping-Rad | Gefahr, Achtung, Auf dem Weg, Zurück, Vermisst, Vision erbeten, Hilfe, Sammeln | teilweise | 3 | S | C | `pingWheel.ts` WHEEL: danger, onMyWay, help, vision, missing, back, group, ok + alert in der Mitte. `focus`, `objective`, `question` existieren als PingKind, sind aber nur per Alt+Klick (`objective`/`focus`) bzw. gar nicht erreichbar. |
| 2.2 | Objective-Ping mit Timer | „Drache in 1:20“ als Chat-Zeile | da | 4 | S | C | C4 `28c5ab5`: Klick auf Objective-Timer → Teamchat „Flussleviathan in 1:20 (6:40)“ / „ist da!“. |
| 2.3 | Gegenstands-Ping aus dem Inventar | Alt+Klick auf Item: „X hat Y fertig“ / „Y: 2 Teile fehlen“ | teilweise | 2 | S | C | C4: Alt+Klick auf Inventar-Item → „Ich habe X.“; im Shop und „fehlende Teile“ fehlt. |
| 2.4 | Minimap-Pings | Alt+Klick auf Minimap / Ping-Rad auf Minimap, Türme/Objectives anpingbar | teilweise | 3 | S | C | C4: Alt+Klick auf die Minimap rastet auf gegnerische Gebäude (Fokus), eigene (Gefahr), Objective-Gruben (Objective) ein; Test tests/chatPings.test.ts. Kein Ping-Rad auf der Minimap. |
| 2.5 | Beschwörerzauber-Ping | Klick auf Gegner-Zauber im Scoreboard schreibt „Flash 4:32“ in den Chat | da | 4 | S | C | C2/C4: Klick auf gegnerischen Zauber im Scoreboard startet den Timer und schreibt „Wren Sprung bis 12:34“ ins Team; Test (Timer). |
| 2.6 | Team-Chat | Enter, Teamzeilen | da | 1 | – | C | `chat.ts`; Bot-Zeilen kommen aus der Sim. |
| 2.7 | Chat-Befehle | /mute, /surrender, /ff, /all, /help | teilweise | 1 | S | C | C4: /help, /mute, /unmute funktionieren; /ff, /surrender, /all antworten „noch nicht verfügbar“ (Sim/Bots nötig). Test tests/chatPings.test.ts. |
| 2.8 | Allchat-Umschalter | Shift+Enter bzw. /all | fehlt | 1 | S | C (+B für Gegner-Zustellung) | Chat-Events gehen nur an das eigene Team (`teamEvents` `case 'chat'`). |
| 2.9 | Stummschalten einzelner Spieler / Pings | /mute, Klick im Scoreboard | da | 1 | S | C | C4: /mute Name oder alle blendet Chatzeilen und Pings des Spielers lokal aus; Test (Parser). |
| 2.10 | Surrender-Abstimmung mit Bot-Stimmen | /ff ab 15:00, Stimmen der Mitspieler | fehlt | 1 | M | C + A (Stimmen) | Kein Code. Bot-Stimmen = Gehirn-Team. |

## 3. Eingabe, Kamera, Einstellungen

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 3.1 | Keybind-Editor | Jede Taste änderbar | teilweise | 3 | – | C | `settingsPanel.ts` + `keybinds.ts` (25 Aktionen, speichert in IndexedDB). Teleport-Slot (F2) und Ping-Arten fehlen als eigene Aktionen. |
| 3.2 | Quick-Cast / Quick-Cast mit Anzeige / Normal-Cast pro Taste | Pro Fähigkeit einstellbar | da | 3 | M | C | C7 `fce34a6`: pro Q/W/E/R Schnell / Mit Anzeige / Normal (Anzeige, Linksklick wirkt, Rechtsklick/Esc bricht ab); im gebauten Spiel geprüft (Q-Abklingzeit 0 nach Loslassen, 5 s nach Klick), docs/ist/c7-castmode-*.jpg; Test tests/settingsIO.test.ts (castModeFor). |
| 3.3 | Self-Cast | Alt + Taste | da | 2 | – | C | `controller.ts` (`e.altKey` → self-cast). Kein Test. |
| 3.4 | Level-up-Modifier | Ctrl + Taste | da | 2 | – | C | `controller.ts` `levelMod` = Ctrl oder Shift. Kein Test. |
| 3.5 | Kamera-Sperre mit Taste | Y | da | 2 | – | C | `toggleCameraLock` (KeyY), Einstellung `cameraLocked`. |
| 3.6 | Kamera-Geschwindigkeit | Regler | da | 2 | – | C | `settings.cameraSpeed`, Regler in `settingsPanel.ts`. |
| 3.7 | Minimap-Skalierung und -Seite | Regler + „Minimap links“ | da | 2 | S | C | C7 `003c3a8`: Minimap-Größe 80–150 % und „Minimap links“ (Chat rückt hoch, Todesleiste folgt); docs/ist/c7-minimap-left-after.jpg. Links ab ~115 % berührt die Minimap den Rand der unteren Leiste. |
| 3.8 | HUD-Skalierung | Regler | da | 2 | – | C | `uiScale` / `uiScaleAuto` (`display.ts`). |
| 3.9 | Schadenszahlen an/aus | Einstellung | da | 1 | – | C | `settings.damageNumbers`. |
| 3.10 | HP-Leisten-Stil | Segmentierung, Farben, Rahmen | fehlt | 2 | S | C (+D Render) | HP-Balken im Overlay ohne Optionen. |
| 3.11 | Gegner-Skillshot-Hervorhebung | Umrisse gegnerischer Skillshots (Einstellung) | fehlt | 3 | S | C (+D) | Telegraphs existieren, keine Einstellung. |
| 3.12 | Angriffsbewegung „Ziel am Cursor“ | Player Attack Move Click | teilweise | 3 | S | B + C | `attackMoveOnCursor` existiert (A sofort an den Cursor). B5 prüft „Ziel am Cursor“. |
| 3.13 | Einstellungen Export/Import (JSON) | (Veilgrounds-eigen) | da | 1 | S | C | C7: Export (Datei veilgrounds-settings.json mit Einstellungen + Tasten) und Import mit Prüfung von Schlüsseln, Typen, Enum-Werten und Reglerbereichen; docs/ist/c7-settings-io-after.jpg; Test tests/settingsIO.test.ts. |
| 3.14 | Sprache DE/EN vollständig | – | da | 2 | S | C | Test tests/i18n.test.ts (gleiche Schlüssel, gleiche Platzhalter, keine leeren Texte); t() ersetzt jedes Vorkommen eines Platzhalters. |
| 3.15 | Farbenblind-Modi, reduzierte Bewegung, hoher Kontrast, Untertitel | Farbenblind-Modus | da | 2 | – | C | `settingsPanel.ts` a11y-Abschnitt, `cues.ts`. |

## 4. Lobby, Champion-Auswahl, Menüs

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 4.1 | Lobby-Bot-Konfiguration pro Slot | (Veilgrounds-eigen) Rang, Archetyp, Achsen, Varianz | teilweise | 4 | S | C | `classicLobby.ts` „Erweitert“: Rang pro Bot, Varianz, Archetyp-Preset, 10-Achsen-Editor. Ungeprüft: Rolle/Champion der Bots wählbar. → C5 |
| 4.2 | Prägungen-Editor mit speicherbaren Seiten | Eigene Seiten anlegen, benennen, speichern | da | 3 | M | C | C5 `e627710`: „Eigene Seite“ pro Champion (Schlüsselprägung + 3 verschiedene kleine), in IndexedDB gespeichert, wählbar wie ein Preset; docs/ist/c5-runes-after.jpg; Test tests/runePages.test.ts. Nur eine Seite pro Champion, nur in der Classic-Lobby. |
| 4.3 | Champion-Auswahl mit Bann-Phase | 3+3 bzw. 5+5 Banns | fehlt | 2 | M | C | Treffer für „ban“ sind nur der Beschwörerzauber „Bannen“. → C5 (optional) |
| 4.4 | Rollentausch | Tausch mit Mitspieler in der Auswahl | fehlt | 2 | S | C | Rolle frei wählbar, Bots werden passend aufgefüllt; Tausch mit einem Bot-Slot fehlt. → C5 |
| 4.5 | Porträt-Ausschnitte | Kopf im Kachelausschnitt | teilweise | 1 | S | C (+D Sprites) | IST-ZUSTAND §2: Ilvane/Seraphyne angeschnitten. → C5 |
| 4.6 | Ladebildschirm-Tipps / Lore | Tipps unter den Karten | da | 2 | S | C (Texte D6) | C7 `d8bddf9`: 12 Trainings-Tipps (de/en), wechseln alle 7 s; docs/ist/c7-loading-after.jpg; Test (Tipp-Schlüssel lückenlos). Lore-Texte fehlen (D6). |
| 4.7 | Spielende-Bildschirm mit Statistik und „Nochmal“ | Sieg/Niederlage → Statistik → Nochmal | teilweise | 3 | S | C | Overlay nur Titel + Beenden; Post-Game automatisch nach Classic ≥ 60 s; „Nochmal“ nur für Trainer (`main.ts afterGame`). |
| 4.8 | Profil mit Verlauf | Match-Historie, Statistik pro Champion | fehlt | 3 | M | C (+D Verlauf) | Treffer für „profile“ sind nur Bot-Profile. D5 baut den Verlauf (IndexedDB); C die Ansicht. |
| 4.9 | Enzyklopädie | (Collection) | da | 2 | – | C | `encyclopedia.ts`; Screenshot `docs/ist/12-enzyklopaedie.jpg`. |
| 4.10 | Hauptmenü erster Frame | Kein dunkler Frame | teilweise | 1 | S | B (B7) | IST-ZUSTAND §1. |

## 5. Shop

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 5.1 | Item-Sets / Empfehlungen pro Champion | Empfohlene Items nach Spielphase | teilweise | 3 | S | C | Stern „empfohlen“ aus Bot-Builds (`shop.ts` recList); keine eigenen Item-Sets, keine Phasen-Seite. |
| 5.2 | Shop-Rückgängig | Letzten Kauf/Verkauf im Brunnen zurücknehmen | fehlt | 2 | M | C + B | Braucht Sim-Befehl `undo` (Kauf-Historie). |
| 5.3 | Gold-Effizienz-Anzeige | (Wiki-Wert, Veilgrounds-eigen) | da | 3 | S | C | C7: Gold-Effizienz der Werte in der Detailansicht (Gold pro Wert aus den Einzelwert-Basisitems, Rest src/ui/goldValues.json); docs/ist/c7-shop-after.jpg; Test tests/goldEfficiency.test.ts. |
| 5.4 | Kategorien, Suche, Bau-Baum, reduzierter Preis | – | da | 2 | – | C | IST-ZUSTAND §10, `docs/ist/10-shop.jpg`. |

## 6. Post-Game und Replays

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 6.1 | Graphen Gold/XP/Schaden/Vision über Zeit | Gold/XP-Vorsprung, Schaden | teilweise | 5 | S | C | C6 `17f1a41`: + XP-Kurve, Item-Wert-Vorsprung des Teams, aktive Team-Wards (Ersatz für den fehlenden Vision-Score); Objective-Fähnchen auf allen Graphen (docs/ist/c6-postgame-after-charts.jpg). |
| 6.2 | Zeitleiste mit Kill-/Objective-Markern, Klick öffnet Replay-Moment | – | teilweise | 4 | L | C | C6: Zeitleiste der Objectives unter den Graphen + Fähnchen; Klick → Replay-Moment fehlt (kein Replay-Viewer). |
| 6.3 | Fehlerliste aus dem Bot-Log-Format | (Veilgrounds-eigen) | fehlt | 5 | M | C (Daten A3) | Wartet auf A3 Log-Format (`docs/agents/a3.md`). → C6 |
| 6.4 | Rang-Kalibrierung pro Kategorie | (Veilgrounds-eigen) | fehlt | 5 | M | C (Daten A3) | Wartet auf A3 `stats/rankCalibration`. → C6 |
| 6.5 | „Was ein Challenger getan hätte“ | (Veilgrounds-eigen) | da | 5 | – | C | `ghostReview.ts`, bis zu 10 Momente; Test `tests/ghost.test.ts`. |
| 6.6 | Replay-Browser mit Zeitleiste | Replays herunterladen und abspielen | fehlt | 3 | L | C | `src/replay/replay.ts` zeichnet auf und spielt headless ab; keine Liste, kein Viewer. |

## 7. Trainer und Darstellung (Agent D, aus AGENTS-PLAN §6)

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 7.1 | Trainingsplan aus den letzten 10 Partien | (Veilgrounds-eigen) | fehlt | 5 | M | D (Daten A3) | ROADMAP Phase 5 offen. D5 |
| 7.2 | Verlauf über mehrere Matches (IndexedDB, Diagramme, Streaks) | – | fehlt | 4 | M | D | D5 |
| 7.3 | Szenario-Trainer: Welle unter Turm fangen, Baron-Call, Shove-and-Recall | (Veilgrounds-eigen) | teilweise | 5 | M | D | Szenario-Trainer existiert, diese Momente fehlen. D5 |
| 7.4 | Dodge-Trainer-Messwerte (Latenz pro Projektil, Panik-Dodges, Replay der letzten 10 Treffer) | – | teilweise | 4 | M | D | D5 |
| 7.5 | Fähigkeiten-Anzeige für die 23 ungeprüften Champions | Jede Fähigkeit mit lesbarem Zustand | teilweise | 4 | L | D | ROADMAP „Fähigkeiten-Anzeige“. D1 |
| 7.6 | CC-Symbole über HP-Balken für alle CC-Typen | Stun-/Root-/Slow-Symbole | teilweise | 4 | S | D | D2 |
| 7.7 | Projektile nach Herkunft (Turmstrahl, Pfeile, Bolzen) | – | teilweise | 3 | M | D | IST-ZUSTAND §6/§7. D2 |
| 7.8 | HP-Balken-Überlappung lösen | – | fehlt | 3 | S | D | IST-ZUSTAND §6. D2 |
| 7.9 | Dash-/Knock-up-Flugbogen, Blickrichtung geglättet | – | fehlt | 3 | M | D (+B5 Flags) | D2 |
| 7.10 | Maßstab: Minions, Lane-Breite, Klippen, Camps | – | teilweise | 2 | L | D | IST-ZUSTAND §5/§6/§9. D3 |
| 7.11 | Sprite-Revision, unterscheidbare Fähigkeits-Icons | 4 Motive pro Champion | teilweise | 2 | L | D | IST-ZUSTAND §2. D4 |
| 7.12 | Fähigkeits-Beschreibungen LoL-artig, Voice-Lines als Text, Ladebildschirm-Tipps (Texte) | – | teilweise | 2 | M | D | IST-ZUSTAND §3. D6 (C zeigt die Tipps an, 4.6) |

## Reihenfolge für Agent C (Trainingsnutzen zuerst)

1. C2: 1.1, 1.2, 1.3, 1.4, 2.5 (Scoreboard + Todestimer, Nutzer-Meldung).
2. C3: 1.8, 1.12, 1.9, 1.10, 1.11, 1.15.
3. C4: 2.2, 2.4, 2.1, 2.3, 2.7–2.9.
4. C6 (ohne A3-Teile): 6.1; danach 6.3/6.4 mit A3-Daten.
5. C5: 4.1, 4.2, 4.4, 4.5, 4.3.
6. C7: 3.7, 3.11, 3.10, 3.13, 3.14, 4.6, 4.7, 5.3.
