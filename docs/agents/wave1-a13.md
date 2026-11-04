# Welle 1 · A13 „Gehirn: Kampf & Mikro“

Branch `feat/a13-brain-combat` (Basis `claude/veilgrounds-next-level-f6na23` = `22f59f4`). Ziel: Mikro-Ausführung des
Beta-Gehirns (`--brain=new`, Einstellung „Neues Bot-Gehirn“): Trading, Kiten, Abstand, Skillshot-Zielen mit Vorhalt,
Ausweichen, Teamfight-Fokus, Kombos aus Daten. Das Standard-Gehirn bleibt bit-identisch.

## Was gebaut wurde

| Teil | Dateien | Kern |
|---|---|---|
| Champion-Hints (Daten) | `src/data/bots/hints/*.json` (29), `schema.ts`, `derive.ts`, `validate.ts`, `index.ts`, `registry.ts` (generiert) | je Champion: Fähigkeits-Rollen (poke/burst/engage/cc/escape/disengage/peel/…), Nutzreichweiten, Kombos (Daten-Kombos + abgeleitete Poke-/Peel-Kombos), Schlüsselreichweiten (auto/trade/engage/poke/threat/peel), Kampfrolle, Gefahrenstufe je Fähigkeit |
| Generator | `tools/botHints/generate.ts` | schreibt aus `src/data/champions/*.json` (Typ, Reichweite, Breite, Tempo, Delay, Effekte, Kombos, Scores) per `deriveHints` – nichts von Hand. `--check` prüft Veraltung. Einträge mit `"status": "curated"` fasst das Tool nicht an (A27) |
| Lader + Validierung | `src/data/bots/hints/index.ts` (`hintsOf`) | statischer Import, Validierung gegen Champion-Daten, Fallback `deriveHints` für fehlende/ungültige Einträge |
| Schalter | `src/ai/combat/flag.ts` | `microOn(ctx, part?)` = Nutzenmodell-Flag (Beta). Messhaken: `BOT_MICRO=0`, `BOT_MICRO_SKIP=dodge,combo,…`, `setMicroOverride` |
| Zielen | `src/ai/combat/aim.ts`, `cast.ts`; Einhängung in `src/ai/bot/combat.ts` `castSlot` | Abfangpunkt iteriert (Flugzeit zur Zielposition, nicht zur aktuellen), nur beobachtete Geschwindigkeit (Vortick → jetzt), Trefferzuversicht (seitliche Geschwindigkeit bei Linien, jede Geschwindigkeit bei verzögerten Kreisen), Minion-Blockade, Rang nur über `aimErrorDeg` (Winkelrauschen + Rauschen auf den Vorhalt) |
| Ausweichen | `src/ai/combat/dodge.ts`; Aufruf in `src/ai/reflex/reflex.ts` (jeden Tick) | Linien-Skillshots aus sichtbaren `cast`-Events (+ Fähigkeitsdaten), Bodentelegrafen aus `zone`-Events; Reaktionszeit des Profils (+ Aufmerksamkeitsstrafe), `predictiveDodgePct` liest den Wind-up; Ausweichpunkt: 12 Richtungen, kürzester erreichbarer Ausgang, begehbar, nicht in Turm/Gegner/andere Gefahr; eigenen Auto-Wind-up erst beenden, wenn es reicht; danach kurze Befehlssperre (`busyUntil`) |
| Kombos | `src/ai/combat/combo.ts`; `trade.ts` `chooseCombo`, `reflex.ts` | Wahl aus den Hint-Kombos nach Bereitschaft (eigene Cooldowns/Mana bekannt), Reichweite, Art (Trade ohne Ult, All-in mit); `situationalAbilityPct` = Anteil, der die beste statt der Standard-Kombo nimmt; Ausführung **jeden Tick** im Reflex (nächste Fähigkeit, sobald der Wind-up vorbei ist + Eingabelücke aus `apmCap`) statt erst im nächsten Entscheidungstakt |
| Abstand | `src/ai/combat/spacing.ts`; `kite.ts` `spacing` | Fernkämpfer halten sich aus der Reichweite bereiter Gap-Closer/Hooks des Gegners (Hints `engage`), nur bei **gesehenen** Casts gilt „Cooldown läuft“ (Profil `cooldownTracking`); ist jede Angriffsfähigkeit des Gegners als „unten“ bekannt, wird nachgesetzt |
| Fokus/Rolle | `src/ai/combat/focus.ts`; `kite.ts` `focusScore`/`fightRole` | Kill-Chance (HP relativ zu den anderen Gegnern), Gefahr aus Hints, Zugang (Frontliner dazwischen schützt vor Nicht-Assassinen), Vergeltung (Ziel schlägt Carry/Schwachen), Ping-Bonus; Kampfrolle aus Hints statt Archetyp-Regex |
| Peel | `src/ai/combat/peel.ts`; `teamfight.ts` | CC/Disengage (Hints-Rollen) wird gehalten, bis ein Gegner den Carry oder einen Schwachen erreicht (≤ 450), dann auf diesen Angreifer |
| Poke-Disziplin | `combat.ts` `castSlot(…, mode)` | Modus `'poke'` hält Fähigkeiten mit `holdFor ≠ none` (Engage, Ult, Peel-CC) zurück. Der Aufrufer `uPoke` (A14) muss `'poke'` übergeben – Anfrage unten |
| Messwerkzeug | `tools/botHints/{combatBench,duelBench,arenaBench,metrics}.ts` | Trefferquote Skillshots, Ausweichquote (Linie/Zone), Trade-Bilanz, Teamfight-Tode, Kills, CS@10, Idle; A/B-Modus: ein Team mit Mikro, das andere ohne, gleiche Partie, Seiten getauscht |

Tunables stehen in `src/data/bots/micro.json` (kein Wert im Code); Rang wirkt nur über Reaktionszeit
(`reactionMedianMs/SigmaMs`), `predictiveDodgePct`, Zielrauschen (`aimErrorDeg`), Aufmerksamkeit (§9), `situationalAbilityPct`,
`apmCap` (Eingabelücke zwischen zwei Kombo-Tasten) und `cooldownTracking`. Kein `if (champ === 'x')` im Gehirn
(Test `tests/a13Hints.test.ts` prüft alle meine Dateien auf zitierte Champion-IDs).

## Fairness (Fog)

| Eingabe | Quelle | Warum fair |
|---|---|---|
| Gegnerische Linien-Skillshots | `cast`-Event (nur wenn der Werfer im Team-Sichtfeld, `teamEvents`) + statische Fähigkeitsdaten | ein Spieler sieht die Wurfanimation und die Richtung |
| Bodentelegrafen | `zone`-Event (nur wenn der Punkt sichtbar ist) | ein Spieler sieht den Kreis |
| Reaktion | `sampleReactionMs(profile) + reactionPenaltyMs` je Gefahr, erst ab dem Zeitpunkt, an dem das Geschoss existiert (Lesen des Wind-ups nur mit `predictiveDodgePct`, nie bei Ablenkung) | Rang = Reaktionszeit |
| Vorhalt | beobachtete Geschwindigkeit des Ziels (`px/py` → `x/y` eines Ticks) | kein Wissen über Pfad/Absicht |
| Gegner-Cooldowns | nur `TrackMem.abilityReadyAt` (gesehener Cast + Cooldown-Tracking des Rangs), sonst „bereit“ | kein Cooldown ohne gesehenen Cast |
| Hints | statische Champion-Daten (Championauswahl ist öffentlich) | wie ein Blick auf die Champion-Seite |

Tests: `tests/a13Micro.test.ts` (Abfangpunkt, Zuversicht, Rauschen je Rang, Blockade, Ausweichen nur nach Reaktionszeit,
unsichtbarer Werfer = kein Ausweichen, verfehlende Geschosse ignoriert, Minion-Block, Bodenkreis, eigene Zone, Abstand, Fokus),
`tests/a13Combo.test.ts`, `tests/a13Game.test.ts` (Determinismus, Dodge-Logs ohne Koordinaten, Standard-Gehirn ohne Mikro),
`tests/a13Hints.test.ts` (Daten, Validator, Generator-Aktualität, keine Champion-Zweige, Fog-Guard für `src/ai/combat`).

## Geteilte Dateien (shared edits)

* `src/ai/bot/brain.ts` – `import { microOn }` und **eine** Zeile am Anfang von `dodge()`: `if (microOn(n.ctx, 'dodge')) return 'failure';`
  (das Beta-Gehirn weicht im Reflex jeden Tick aus; das alte Blatt bleibt für das Standard-Gehirn unverändert).
* Keine Änderung an `runner.ts`, `perception/**`, `humanize/**`, `contract.ts`, Profilen, `tree.json`.
* Meine Dateien mit Hooks: `combat.ts`, `kite.ts`, `trade.ts`, `teamfight.ts`, `reflex/reflex.ts` (alles unter `microOn`).
