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
| 1.1 | Todestimer über der Minimap | Tote Verbündete und Gegner mit Porträt + Restzeit über der Minimap | fehlt | 5 | S | C | Nur der eigene Respawn-Timer (`hud.ts` `.respawn`). Andere Spieler: nur `ScoreRow.dead` ohne Zeit. → C2 |
| 1.2 | Tab-Scoreboard: Objective-Leiste | Drachen-Elemente, Seele, Grubs, Baron-Buff-Restzeit, Türme, Inhibitoren mit Respawn | fehlt | 5 | M | C (+B) | `scoreboard.ts` hat nur Titel + zwei Tabellen. Leviathan-Stacks existieren nur in der Sim (`jungle.ts leviathanStacks`). → C2 |
| 1.3 | Tab-Scoreboard: Todestimer pro Spieler | Graues Porträt + Sekunden | teilweise | 5 | S | C | Zeile wird bei Tod ausgegraut (`tr.dead`), aber ohne Restzeit. → C2 |
| 1.4 | Tab-Scoreboard: Beschwörerzauber + Gegner-Klick-Timer | Eigene Zauber mit Abklingzeit; Klick auf Gegner-Zauber startet Timer, Chat-Zeile | fehlt | 5 | M | C (+B für eigene CDs) | Keine Zauber-Spalte. Gegnerische Zauber sind aus `PlayerSetup.summoners` bekannt (öffentlich), Abklingzeiten der Verbündeten fehlen im Snapshot. → C2 |
| 1.5 | Tab-Scoreboard: Grunddaten | Porträt, Level, K/D/A, CS, Gold/Item-Wert, Items | da | 4 | – | C | `scoreboard.ts`; Screenshot `docs/ist/11-scoreboard.jpg`. Kein Test (nur DOM). |
| 1.6 | Tab-Scoreboard: Trinket, Vision-Score, Schaden an Champions | Trinket-Icon, Vision-Score, Schaden (Post-Game) | fehlt | 4 | M | C + B | Snapshot hat weder Vision-Score noch Schaden pro Spieler. Trinket nur für das eigene Team über `items`. |
| 1.7 | Tab-Scoreboard: Rang-Icon + 10 Spielstil-Mini-Skalen der Bots | (Veilgrounds-eigen) | teilweise | 4 | M | C (Daten A3) | Rang als Text, Spielstil nur als `title`-Tooltip (`styleTitle`). Wartet auf A3-Kalibrierung. |
| 1.8 | Objective-Timer oben Mitte | Drache/Baron/Herald-Timer, Buff-Restzeit | fehlt | 5 | M | C | Oben nur Kills, Türme, eigene Kesselbrut-Stacks, CS, Uhr (`hud.ts` top bar). → C3 |
| 1.9 | Zielrahmen über dem HUD | Porträt, HP/Mana, Werte, Buffs, Items des angeklickten Ziels | fehlt | 4 | M | C | Kein Code. → C3 |
| 1.10 | Eigene Buff-/Debuff-Leiste | Icons mit Restzeit-Ring und Tooltip | teilweise | 4 | M | C | `.buff-marks` zeigt nur Jungle-/Objective-Buffs als Text; Fähigkeits-Buffs, CC, Debuffs fehlen. → C3 |
| 1.11 | Kamera nach dem Tod | Kamera bleibt frei, Hinweis, letzte Position statt Nebel | fehlt | 3 | S | C | IST-ZUSTAND §8: Kamera zeigt Nebel, kein Hinweis. → C3 |
| 1.12 | Minimap: letzte bekannte Gegnerposition | Geist-Icon / „?“ wo der Gegner verschwand | fehlt | 4 | S | C | `minimap.ts` zeichnet nur sichtbare Einheiten. → C3 |
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
| 2.2 | Objective-Ping mit Timer | „Drache in 1:20“ als Chat-Zeile | fehlt | 4 | S | C | → C4 |
| 2.3 | Gegenstands-Ping aus dem Inventar | Alt+Klick auf Item: „X hat Y fertig“ / „Y: 2 Teile fehlen“ | fehlt | 2 | S | C | → C4 |
| 2.4 | Minimap-Pings | Alt+Klick auf Minimap / Ping-Rad auf Minimap, Türme/Objectives anpingbar | teilweise | 3 | S | C | `minimap.ts`: Alt+Klick = immer „Gefahr“, kein Rad, keine Ziel-Erkennung. → C4 |
| 2.5 | Beschwörerzauber-Ping | Klick auf Gegner-Zauber im Scoreboard schreibt „Flash 4:32“ in den Chat | fehlt | 4 | S | C | Zusammen mit 1.4. → C2/C4 |
| 2.6 | Team-Chat | Enter, Teamzeilen | da | 1 | – | C | `chat.ts`; Bot-Zeilen kommen aus der Sim. |
| 2.7 | Chat-Befehle | /mute, /surrender, /ff, /all, /help | fehlt | 1 | S | C | `chat.ts` sendet jeden Text roh. → C4 |
| 2.8 | Allchat-Umschalter | Shift+Enter bzw. /all | fehlt | 1 | S | C (+B für Gegner-Zustellung) | Chat-Events gehen nur an das eigene Team (`teamEvents` `case 'chat'`). |
| 2.9 | Stummschalten einzelner Spieler / Pings | /mute, Klick im Scoreboard | fehlt | 1 | S | C | – |
| 2.10 | Surrender-Abstimmung mit Bot-Stimmen | /ff ab 15:00, Stimmen der Mitspieler | fehlt | 1 | M | C + A (Stimmen) | Kein Code. Bot-Stimmen = Gehirn-Team. |

## 3. Eingabe, Kamera, Einstellungen

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 3.1 | Keybind-Editor | Jede Taste änderbar | teilweise | 3 | – | C | `settingsPanel.ts` + `keybinds.ts` (25 Aktionen, speichert in IndexedDB). Teleport-Slot (F2) und Ping-Arten fehlen als eigene Aktionen. |
| 3.2 | Quick-Cast / Quick-Cast mit Anzeige / Normal-Cast pro Taste | Pro Fähigkeit einstellbar | teilweise | 3 | M | C | Nur global (`settings.castIndicator`: halten = Anzeige, loslassen = wirken). Kein Normal-Cast (Taste + Klick), keine Einstellung pro Taste. |
| 3.3 | Self-Cast | Alt + Taste | da | 2 | – | C | `controller.ts` (`e.altKey` → self-cast). Kein Test. |
| 3.4 | Level-up-Modifier | Ctrl + Taste | da | 2 | – | C | `controller.ts` `levelMod` = Ctrl oder Shift. Kein Test. |
| 3.5 | Kamera-Sperre mit Taste | Y | da | 2 | – | C | `toggleCameraLock` (KeyY), Einstellung `cameraLocked`. |
| 3.6 | Kamera-Geschwindigkeit | Regler | da | 2 | – | C | `settings.cameraSpeed`, Regler in `settingsPanel.ts`. |
| 3.7 | Minimap-Skalierung und -Seite | Regler + „Minimap links“ | fehlt | 2 | S | C | `.minimap` fest 280 px rechts. → C7 |
| 3.8 | HUD-Skalierung | Regler | da | 2 | – | C | `uiScale` / `uiScaleAuto` (`display.ts`). |
| 3.9 | Schadenszahlen an/aus | Einstellung | da | 1 | – | C | `settings.damageNumbers`. |
| 3.10 | HP-Leisten-Stil | Segmentierung, Farben, Rahmen | fehlt | 2 | S | C (+D Render) | HP-Balken im Overlay ohne Optionen. |
| 3.11 | Gegner-Skillshot-Hervorhebung | Umrisse gegnerischer Skillshots (Einstellung) | fehlt | 3 | S | C (+D) | Telegraphs existieren, keine Einstellung. |
| 3.12 | Angriffsbewegung „Ziel am Cursor“ | Player Attack Move Click | teilweise | 3 | S | B + C | `attackMoveOnCursor` existiert (A sofort an den Cursor). B5 prüft „Ziel am Cursor“. |
| 3.13 | Einstellungen Export/Import (JSON) | (Veilgrounds-eigen) | fehlt | 1 | S | C | → C7. `src/settings.ts` liegt außerhalb von C (Vorschlag über shared-changes nötig, falls Felder fehlen). |
| 3.14 | Sprache DE/EN vollständig | – | teilweise | 2 | S | C | `de.json`/`en.json` je 543 Zeilen; bisher kein Test auf Schlüsselgleichheit (kommt mit C2). |
| 3.15 | Farbenblind-Modi, reduzierte Bewegung, hoher Kontrast, Untertitel | Farbenblind-Modus | da | 2 | – | C | `settingsPanel.ts` a11y-Abschnitt, `cues.ts`. |

## 4. Lobby, Champion-Auswahl, Menüs

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 4.1 | Lobby-Bot-Konfiguration pro Slot | (Veilgrounds-eigen) Rang, Archetyp, Achsen, Varianz | teilweise | 4 | S | C | `classicLobby.ts` „Erweitert“: Rang pro Bot, Varianz, Archetyp-Preset, 10-Achsen-Editor. Ungeprüft: Rolle/Champion der Bots wählbar. → C5 |
| 4.2 | Prägungen-Editor mit speicherbaren Seiten | Eigene Seiten anlegen, benennen, speichern | teilweise | 3 | M | C | Nur feste Presets pro Champion (`runePresets`), Wahl wird gemerkt (`settings.runePresets`). Kein Editor. → C5 |
| 4.3 | Champion-Auswahl mit Bann-Phase | 3+3 bzw. 5+5 Banns | fehlt | 2 | M | C | Treffer für „ban“ sind nur der Beschwörerzauber „Bannen“. → C5 (optional) |
| 4.4 | Rollentausch | Tausch mit Mitspieler in der Auswahl | fehlt | 2 | S | C | Rolle frei wählbar, Bots werden passend aufgefüllt; Tausch mit einem Bot-Slot fehlt. → C5 |
| 4.5 | Porträt-Ausschnitte | Kopf im Kachelausschnitt | teilweise | 1 | S | C (+D Sprites) | IST-ZUSTAND §2: Ilvane/Seraphyne angeschnitten. → C5 |
| 4.6 | Ladebildschirm-Tipps / Lore | Tipps unter den Karten | fehlt | 2 | S | C (Texte D6) | `renderLoading` zeigt 10 Spieler + Fortschritt, keine Tipps. |
| 4.7 | Spielende-Bildschirm mit Statistik und „Nochmal“ | Sieg/Niederlage → Statistik → Nochmal | teilweise | 3 | S | C | Overlay nur Titel + Beenden; Post-Game automatisch nach Classic ≥ 60 s; „Nochmal“ nur für Trainer (`main.ts afterGame`). |
| 4.8 | Profil mit Verlauf | Match-Historie, Statistik pro Champion | fehlt | 3 | M | C (+D Verlauf) | Treffer für „profile“ sind nur Bot-Profile. D5 baut den Verlauf (IndexedDB); C die Ansicht. |
| 4.9 | Enzyklopädie | (Collection) | da | 2 | – | C | `encyclopedia.ts`; Screenshot `docs/ist/12-enzyklopaedie.jpg`. |
| 4.10 | Hauptmenü erster Frame | Kein dunkler Frame | teilweise | 1 | S | B (B7) | IST-ZUSTAND §1. |

## 5. Shop

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 5.1 | Item-Sets / Empfehlungen pro Champion | Empfohlene Items nach Spielphase | teilweise | 3 | S | C | Stern „empfohlen“ aus Bot-Builds (`shop.ts` recList); keine eigenen Item-Sets, keine Phasen-Seite. |
| 5.2 | Shop-Rückgängig | Letzten Kauf/Verkauf im Brunnen zurücknehmen | fehlt | 2 | M | C + B | Braucht Sim-Befehl `undo` (Kauf-Historie). |
| 5.3 | Gold-Effizienz-Anzeige | (Wiki-Wert, Veilgrounds-eigen) | fehlt | 3 | S | C | Werte stehen in `items.json`; reine UI-Rechnung. |
| 5.4 | Kategorien, Suche, Bau-Baum, reduzierter Preis | – | da | 2 | – | C | IST-ZUSTAND §10, `docs/ist/10-shop.jpg`. |

## 6. Post-Game und Replays

| # | Funktion | LoL-Verhalten | Stand | Nutzen | Aufwand | Agent | Beleg / Lücke |
|---|---|---|---|---|---|---|---|
| 6.1 | Graphen Gold/XP/Schaden/Vision über Zeit | Gold/XP-Vorsprung, Schaden | teilweise | 5 | S | C | `postGame.ts`: CS-, Gold-, Schaden-Graph mit Tod-/Kill-Markern. XP und Vision fehlen (MatchSummary hat keine Felder). → C6 |
| 6.2 | Zeitleiste mit Kill-/Objective-Markern, Klick öffnet Replay-Moment | – | fehlt | 4 | L | C | Kein Replay-Viewer im Client. → C6 |
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
