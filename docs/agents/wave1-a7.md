# Welle 1 – A7 Item-Engine (feat/a7-item-engine)

Ziel: Items vollständig datengetrieben (Werte, Passiven, Aktive, Verbrauchsgüter, Einzigartigkeit, Stapel). Ein neues Item
braucht nur JSON, solange es die vorhandenen Bausteine nutzt. Format: **docs/ITEMS-FORMAT.md** (Referenz mit je einem
geprüften Beispiel pro Trigger/Bedingung/Effekt).

## Was gebaut wurde

| Datei | Inhalt |
|---|---|
| `src/sim/items/schema.ts` | Typen: `ItemData` (+ `passive.rules/key/stack/laneMinionGold/quest`, `active`, `use`, `maxOwned`), 11 Trigger, 17 Effekt-Typen, Bedingungen, `Value` |
| `src/sim/items/validate.ts` | Laufzeitprüfung (`validateItemsDocument`, `validateItems`, `ItemFormatError`): unbekannte Trigger/Effekte/Schlüssel/Stats/Tags mit JSON-Pfad und „did you mean“; Trigger-/Effekt-/Bedingungs-Kombinationen; Rezepte, doppelte Ids |
| `src/sim/items/engine.ts` | Kompiliert Regeln einmal zu Closures/`ItemHook`s; Zustand je Champion + Passiv-Schlüssel in `sim.state.items` |
| `src/sim/items/itemHooks.ts` | von 407 auf 157 Zeilen: Hook-Liste je Inventar (einzigartig/gestapelt), Tick, `useItem`, Abfragen (`minionGoldMult`, `questDone`, `stormMantleLeft`, `givingLampQuestDone`) |
| `src/sim/items/inventory.ts` | lädt + prüft `items.json` beim Modulstart; `registerItems` (Tests); `maxOwned`; neue Item-Werte `armorPenPct`/`magicPen`/`tenacityPct` |
| `src/sim/damage.ts` | +5 Zeilen: Event `onShieldBreak` (nur Item-Hooks) |
| `src/data/items.json` | reines Format-Migrieren der 20 Items mit Effekt (kein Balance-/Inhaltswechsel); Ids unverändert; alle `hook`-Felder entfernt |

**Trigger:** `onHit` `onAbilityHit` `onCast` `onKill` `onTakedown` `onDamageTaken` `onShieldBreak` `onTick` + Modifikatoren
`modifyDamage` `modifyHeal` `onComputeStats`.
**Effekte:** `damage` `heal` `shield` `applyBuff` (slow/root/stun/silence/blind/fear/stasis/unstoppable/**grievous**/stat/dot,
Stapel) `cleanse` `restoreMana` `gold` `absorbDamage` `healOverTime` `addStack` `clearStack` `damageMult` `healMult`
`statMult` `statAdd` `stopMovement` `placeSealWard`.
**Bedingungen:** Ziel/Quelle (Art, Team, HP-Schwellen, Buff), Träger (HP, Nah-/Fernkampf, lebt, unter Kontrolle, Buff,
Level), `crit`, `overheal`, `damageType`, `isAuto`, `damageTakenPctMaxHp` (Burst), `inCombatSeconds`, `everyTicks`,
`beforeSeconds`/`afterSeconds`, `castSlot`, `stacksAtLeast`. **Regel-Felder:** `cooldown`, `charges`.
**Aktive:** Ziel `self`/`point`/`allyChampion`/`enemyChampion` (+`range`), `requires: ["canAttack"]`, Abbruch ohne Abklingzeit.
**Regeln:** Passive-Schlüssel (`key`, Standard Item-Id) = „unique passive“, `stack: "stack"` je Kopie, `maxOwned` (legendär
Standard 1), `unique`-Gruppen wie bisher.

## Bausteine für A12 (Proben in `tests/fixtures/itemEngineItems.json`, nicht in der Live-Liste)

Anti-Heal (`fx_wundenklinge` Passive, `fx_wundrauch` Aktive: Flächen-Grievous), Anti-Tank (`fx_titanspalter`: %-Max-HP-Schaden mit
Deckel + 30 % Rüstungsdurchdringung; `fx_leerenstab`: Magiedurchdringung), Anti-Burst (`fx_bollwerk`: Notschild ab 20 % Max-HP
in einem Treffer mit Abklingzeit, Schadensreduktion nach Schildbruch), Anti-CC (`fx_reinigungsamulett`: 35 % Zähigkeit +
Reinigen-Aktives, auch unter Kontrolle nutzbar), Einheitenziel (`fx_fangnetz`, `fx_segensperle`), Stapel/Takedown/Cast
(`fx_ahnenkelch`), Modifikatoren/Selbstbedingungen (`fx_fels`), Einzigartigkeit/Stapeln/`maxOwned` (`fx_einzigartig_a/b`,
`fx_stapelring`, `fx_zweimal`), Verbrauchsgut (`fx_rachetrank`). Details und Rezepte: ITEMS-FORMAT.md §10.

## Wie bestätigt wurde, dass sich nichts geändert hat

1. **Charakterisierung vor dem Umbau** (Commit 15eef99, gegen den alten Code erzeugt): `tests/itemGoldenTrace.ts` fährt ein
   Universalskript (Krit-Autos, Fähigkeitstreffer, Schaden magisch/physisch/groß/wahr, Last-Hits Minion + Monster,
   Hinrichtungsbereich, Heilkraft, Item-Nutzung Slot 0/1/0, Kampf-/Ruhetick) für **jedes** der 47 Items allein (Mira und Gorvam),
   Legendäre doppelt, vier Sets (Tank/ADC/Mage/Mix) sowie die Shop-Regeln (Rezepte, Unique, voll). Aufgezeichnet werden Schaden,
   HP/Schild/Mana/Gold, Buffs (Änderungen tick-genau), Abklingzeiten, HUD. 93 Fälle, `tests/fixtures/itemsGolden.json`.
   `tests/itemEngine.golden.test.ts` verlangt vom neuen Code **bit-genaue** Gleichheit (`toEqual` auf Doubles). Mutationsprobe:
   `mult 1.15 → 1.16` bei Scharfrichterbeil lässt genau dessen Fälle scheitern.
2. **Bot-Spiele (A/B)**: 2 Spiele × 14 min (Seed 1 normal; Seed 2 mit vollen Legendär-Sets für alle 10 Bots), Prüfpunkte alle
   600 Ticks (84), alter Code vs. neuer Code: `stateHash` **ohne** `sim.state.items` an allen 84 Punkten identisch.
   Dieser Test fand einen echten Unterschied (Jägerzahn: das Level wurde im alten Code einmal je Auslösen gelesen, mein erster
   Entwurf las es nach dem Kill neu → +1 Heilung bei Level-up); behoben (`Ctx.level`) und nur durch den A/B-Lauf aufgefallen,
   nicht durch die Einzeltests.
3. **Voller `stateHash` ändert sich** (alle 84 Punkte): nur durch `sim.state.items` – der Zustand liegt jetzt je Passiv-Schlüssel
   statt als zehn feste Zahlen (`potion wind windRate spark mantleUsed …`). Verhalten identisch (Punkt 1 + 2), nur die
   Buchhaltung hat ein anderes Layout. Replay-/Determinismus-Tests vergleichen Läufe desselben Codes miteinander und bleiben grün.
   `sim.state.itemSecondary` unverändert; Durchdringung (neu) liegt nur bei Besitz eines solchen Items in `sim.state.itemPen`.
4. Bestehende Tests unverändert grün: `items.test`, `items.effects.test` (einzige Änderung: Konstante `HUNTER_FANG.monsterMult`
   → Literal 1.8), `inventory.test`, `runes.test`, `economy*.test`, `runePages.test`.

## Neue Tests

`tests/itemEngine.test.ts` (40: Formatprüfung mit 36 Fehlerfällen, Anti-Heal/-Tank/-Burst/-CC, Einheitenziel, Stapel, Takedown,
Cast, Modifikatoren, Verbrauchsgut, Einzigartigkeit/Stapeln/`maxOwned`, Abklingzeit/Ladungen, Determinismus),
`tests/itemEngine.docs.test.ts` (25: jedes JSON-Beispiel in ITEMS-FORMAT.md besteht die Prüfung; jeder Trigger/Effekt ist
dokumentiert), `tests/itemEngine.golden.test.ts` (93).

## Leistung

- Sim-only-Benchmark (10 Champions mit vollen Legendär-Sets, Dauerkampf, keine KI; CPU-µs je Tick, Minimum aus 5 Läufen,
  3 Wiederholungen): alt 261 / 298 / 302, neu 254 / 310 / 285 – gleich im Rauschen. Reine Stat-Items: kein Unterschied.
- Mikro-Benchmark der Hook-Pfade (Minimum aus 25 Chargen): Kosten über der Schleife selbst +0 bis +700 ns je Treffer-Ereignis
  (Autos/Fähigkeitstreffer mit mehreren Hooks), +0 bis +100 ns je Champion und Tick. Behoben nach erstem Messen: Closures je
  Empfänger, `addBuff`-Objektformen, Kontext-Anlage in Ticks ohne bestandenes Tor, Zustandszugriff bei zustandslosen Passiven.
- CPU-Profil eines Bot-Spiels (Gold, 8 min): Item-Schicht (`itemHooks.ts` inkl. Engine) 0,56 % (alt) vs. 0,64 % (neu, `engine.ts`
  allein 0,26 %) der Laufzeit.
- `npm run bot-sim -- --rank=gold --games=1 --minutes=20 --jobs=1` (Seed 1): Ergebnis **identisch** (Laner-CS 225/1009, Kills 4@15
  6@25, erster Turm 16,3 min, Gold/min 196,0). Wandzeit: vor Umbau 85,4 s (ruhige Maschine); unter Last gemessen alt 166,9 s
  (CPU 94,3 s) vs. neu 211,8 s (CPU 100,4 s) – die Last durch andere Agents verfälscht beide Werte stärker als jeder Unterschied;
  belastbar sind die Profil- und Mikro-Zahlen oben.

## Offene Punkte / Risiken

- **Zustandslayout** (`sim.state.items`) hat gewechselt: alte gespeicherte Replays mit Hash-Prüfung stimmen nicht mehr
  (wie bei jeder Sim-Änderung). Kein Test hält Hash-Literale.
- **Golden-Datei** hängt an Mira/Gorvam-Basiswerten und Mini-Bot-Skript; ändern andere Agents deren Basiswerte, muss sie mit
  `UPDATE_GOLDEN=1 npx vitest run tests/itemEngine.golden` neu erzeugt werden (Diff prüfen). Neue Items stören sie nicht.
- **Shop/i18n** (Anfrage R4): neue Item-Werte `armorPenPct`, `magicPen`, `tenacityPct` brauchen `stat.*`-Texte und `PCT`-Eintrag in
  `src/ui/shop.ts`; kein Live-Item nutzt sie bisher.
- Aktive mit Einheitenziel: Wahl über den Cursorpunkt (nächster passender Champion), keine eigene Zielanzeige.
- `absorbDamage` stellt HP sofort wieder her (wie der alte Sturmgewand-Code), kein typisierter Schild/Schildbalken.
- Runen bleiben Code-Hooks (Auftrag: nicht umbauen); `ItemHook` + `startSecondWind` werden weiter aus `itemHooks.ts` exportiert.
- Nicht in Daten ausdrückbar: Dash/Teleport, Beschwörungen, Sicht/Wards außer `placeSealWard`, Schaden jenseits `scale`.
  Neue Bausteine additiv in `engine.ts` + `validate.ts` + Doku.
- Für `docs/DECISIONS.md` (Integrator): Abschnitt „Items + Prägungen“ bleibt gültig, die Hook-Namen dort (`stormbow`, …) sind
  jetzt Item-Ids/Regeln in `items.json`; Zahlen unverändert.
