# Item-Format (`src/data/items.json`)

Stand: Welle 1, Agent A7. Items sind **vollständig datengetrieben**: Werte, Passiven, Aktive, Verbrauchsgüter und
Einzigartigkeits-Regeln stehen in JSON. Ein neues Item braucht **keinen Engine-Code**, solange es mit den hier
beschriebenen Bausteinen auskommt. Die Engine liegt in `src/sim/items/` (`schema.ts` Typen, `validate.ts` Prüfung,
`engine.ts` Ausführung, `itemHooks.ts` Anbindung an die Sim, `inventory.ts` Laden, Shop-Regeln, Werte).
Prägungen (Runen, `runes.json`) laufen weiter über Code-Hooks (`runeHooks.ts`) und sind nicht Teil dieses Formats.

Alle Code-Beispiele unten mit `<!-- check: … -->` werden von `tests/itemEngine.docs.test.ts` gegen die Validierung
geprüft. Lauffähige Beispiel-Items stehen in `tests/fixtures/itemEngineItems.json` (nicht im Spiel).

## 1. Konventionen

| Thema | Regel |
|---|---|
| Prozent | `…Pct`-Felder und Buff-`pct` sind **Prozentpunkte** (`40` = 40 %). |
| Faktoren | `scale`-Koeffizienten, `mult` und `Value`-Anteile sind **Brüche** (`0.2` = 20 % des Werts, `1.15` = +15 %). |
| Zeit | `seconds` (Sekunden) oder genau `ticks` (30 Hz, exakt). Nie beides. Abklingzeiten (`cooldown`) in Sekunden. |
| Level | `perLevel` zählt ab Level 1: Wert = `base + perLevel × (Level − 1)`. Das Level wird beim Auslösen festgehalten. |
| Namen | Ids sind stabil (Bot-Builds in `src/data/builds/*.json` und der Shop referenzieren sie). `name`/`desc` brauchen `de` und `en`. |
| Fehler | Unbekannte Schlüssel, Trigger, Effekte, Stats, Tags sind **Ladefehler** (siehe 9). |

## 2. Aufbau eines Items

<!-- check: item -->
```json
{
  "id": "beispielklinge",
  "name": { "de": "Beispielklinge", "en": "Example Blade" },
  "tier": "legendary",
  "cost": 3000,
  "from": ["langschwert", "wetzdolch"],
  "stats": { "ad": 45, "asPct": 20 },
  "tags": ["ad", "onhit"],
  "passive": {
    "name": { "de": "Zerreißen", "en": "Rend" },
    "desc": { "de": "Treffer auf Champions verlangsamen um 20 % (1 s).", "en": "Hits on champions slow by 20 % (1 s)." },
    "rules": [
      {
        "on": "onHit",
        "if": { "target": { "kind": ["champion"], "team": "enemy" } },
        "do": [{ "type": "applyBuff", "to": "target", "kind": "slow", "id": "beispiel_slow", "pct": 20, "seconds": 1 }]
      }
    ]
  }
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `id`, `name`, `tier`, `cost`, `from`, `stats`, `tags` | ja | `tier`: `starter` `basic` `component` `legendary` `boots` `consumable`. `cost` = Gesamtpreis, Rezept = `cost` − Summe der Komponenten (`from`). `tags` sind Baunotizen für Bots/Shop. |
| `stats` | ja (`{}` erlaubt) | Reine Werte, summieren sich immer: `ad ap hp mana armor mr asPct critPct lifestealPct haste msPct msFlat lethality hpRegenPct manaRegenPct healShieldPowerPct armorPenPct magicPen tenacityPct`. |
| `passive` | nein | Anzeigetext (`name`, `desc`) plus optional `rules`, `key`, `stack`, `laneMinionGold`, `quest` (Abschnitt 3). |
| `active` | nein | Aktive Fähigkeit mit Abklingzeit (Abschnitt 7). |
| `use` | nur `consumable` | Verbrauchsgut: wird bei Erfolg verbraucht (Abschnitt 7). |
| `unique` | nein | Gruppe, von der man nur ein Item haben darf (`starter`, `boots`). |
| `maxOwned` | nein | Höchstzahl gleicher Kopien im Inventar. Standard: 1 bei `legendary`, sonst unbegrenzt. |

Neue Item-Werte seit dem Umbau: `armorPenPct` (30 = 30 % der Gegnerrüstung ignorieren), `magicPen` (flach),
`tenacityPct` (30 = Kontrolleffekte 30 % kürzer). Sie wirken wie die übrigen `stats` (kein Aufschaukeln über Ticks).

## 3. Passive: Regeln aus Trigger, Bedingung und Effekten

`passive.rules` ist eine Liste. Jede **Regel** reagiert auf einen oder mehrere **Trigger** (`on`), prüft optionale
**Bedingungen** (`if`), optional **Abklingzeit/Ladungen**, und führt dann die **Effekte** (`do`) in Reihenfolge aus.

<!-- check: rule -->
```json
{
  "on": ["onHit", "onAbilityHit"],
  "if": { "target": { "kind": ["champion"], "team": "enemy" } },
  "cooldown": 1,
  "charges": { "max": 3, "regenSeconds": 10 },
  "do": [{ "type": "gold", "to": "self", "amount": 15 }]
}
```

- `cooldown` (Sekunden): interne Abklingzeit, geteilt von allen Triggern **dieser** Regel.
- `charges`: jedes Auslösen verbraucht eine Ladung; alle `regenSeconds` kommt eine zurück, der Timer startet beim ersten
  Verbrauch. Start: volle Ladungen.
- Bedingungen werden **vor** Abklingzeit/Ladungen geprüft (eine verfehlte Bedingung verbraucht nichts).
- Mehrere Regeln eines Items laufen unabhängig, in Datenreihenfolge.

### Passiv-Felder

| Feld | Bedeutung |
|---|---|
| `key` | Schlüssel der „einzigartigen Passive“ (Abschnitt 8). Standard: die Item-Id. |
| `stack` | `"unique"` (Standard) oder `"stack"` (jede Kopie wirkt einzeln). |
| `laneMinionGold` | `{ "mult": 0.5, "untilSeconds": 840 }`: Lane-Minion-Gold des Trägers × `mult` bis zur Spielzeit (Jägerzahn). |
| `quest` | `{ "counter": "lampGold", "goal": 500 }`: erledigt, sobald der Zähler (von `gold`-Effekten mit `counter` gespeist) `goal` erreicht. Abfrage: `questDone(sim, eid, item)`. |

## 4. Trigger

| Trigger | Wann | `target` | `source` | Erlaubte Effekte / Hinweise |
|---|---|---|---|---|
| `onHit` | eigener Auto-Angriff hat getroffen (Nahkampf sofort, Fernkampf beim Einschlag) | getroffene Einheit | – | alle außer Modifikatoren. Kontext: `crit`, `overheal`, `damage` |
| `onAbilityHit` | eine Fähigkeit des Trägers trifft eine Einheit (nach den Standard-Effekten) | getroffene Einheit | – | wie `onHit`; `castSlot` verfügbar |
| `onCast` | eine Fähigkeit (Slot 0–3) wurde gewirkt | – | – | `castSlot` |
| `onKill` | der Träger tötet eine Einheit (Position des Opfers noch gültig) | Opfer | – | |
| `onTakedown` | Kill **oder** Assist (3-s-Fenster) an einem gegnerischen Champion | Opfer | – | |
| `onDamageTaken` | der Träger hat Schaden genommen (nach Schilden, vor einem möglichen Tod; nur oberste Schadensebene) | – | Angreifer (fehlt bei Umwelt) | `absorbDamage` nur hier. Kontext: `damage` (nach Rüstung/MR, Schildanteil inbegriffen), `damageType`, `isAuto` |
| `onShieldBreak` | ein Treffer hat den Schild des Trägers geleert | – | Angreifer | wie `onDamageTaken` |
| `onTick` | jeden Sim-Tick, solange das Item im Inventar ist (auch tot) | – | – | für Auren und Regeneration; mit `self.alive` einschränken |
| `modifyDamage` | ausgehender Schaden **vor** Rüstung/MR (Autos, Fähigkeiten, DoTs; nur oberste Schadensebene) | Ziel | – | nur `damageMult`; keine `cooldown`/`charges` |
| `modifyHeal` | ausgehende Fähigkeits-Heilung/-Schild | Empfänger | – | nur `healMult`; keine `cooldown`/`charges` |
| `onComputeStats` | am Ende der Stat-Berechnung, jeden Tick (Stats werden jeden Tick neu aufgebaut: kein Aufschaukeln) | – | – | nur `statMult`, `statAdd`; Reihenfolge = Inventar |

Modifikator-Trigger (`modifyDamage`, `modifyHeal`, `onComputeStats`) dürfen nicht mit anderen Triggern in einer Regel
kombiniert werden und laufen sehr oft: Bedingungen billig halten.

## 5. Bedingungen (`if`)

Alle angegebenen Schlüssel müssen gelten. Ein Schlüssel, der für den Trigger der Regel keinen Sinn hat, ist ein Ladefehler.

| Schlüssel | Bedeutung | Beispiel |
|---|---|---|
| `target` / `source` | Prüfung der Einheit: `kind` (Liste: `champion minion monster structure ward pet plant dummy`), `notKind`, `team` (`enemy`/`ally`), `hpBelowPct`, `hpAbovePct` (Prozent der Max-HP, strikt), `hasBuff` (Buff-Id oder -Art) | `{ "target": { "kind": ["champion"], "team": "enemy", "hpBelowPct": 40 } }` |
| `self` | Träger: `hpBelowPct`, `hpAbovePct`, `attack` (`melee`/`ranged`), `alive`, `crowdControlled`, `hasBuff`, `levelAtLeast` | `{ "self": { "alive": true, "attack": "melee" } }` |
| `crit` | nur `onHit`: der Treffer war ein Krit | `{ "crit": true }` |
| `overheal` | nur `onHit`: Lebensraub-Heilung ging an voller HP verloren | `{ "overheal": true }` |
| `damageType` | `onDamageTaken`/`modifyDamage`: Liste aus `phys magic true` | `{ "damageType": ["magic"] }` |
| `isAuto` | `onDamageTaken`/`modifyDamage`: Schaden ist ein Auto-Angriff | `{ "isAuto": true }` |
| `damageTakenPctMaxHp` | `onDamageTaken`/`onShieldBreak`: Schaden ≥ dieser Anteil der Max-HP (Prozentpunkte) – Burst-Erkennung | `{ "damageTakenPctMaxHp": 20 }` |
| `inCombatSeconds` | der Träger hat in den letzten N s Schaden ausgeteilt oder erhalten | `{ "inCombatSeconds": 5 }` |
| `everyTicks` | `sim.tick` ist ein Vielfaches von N | `{ "everyTicks": 10 }` |
| `beforeSeconds` / `afterSeconds` | Spielzeit vor / nach N Sekunden | `{ "afterSeconds": 600 }` |
| `castSlot` | `onCast`/`onAbilityHit`: Fähigkeits-Slot 0–3 | `{ "castSlot": [3] }` |
| `stacksAtLeast` | Stapelzähler der Passive haben mindestens diese Werte | `{ "stacksAtLeast": { "souls": 5 } }` |

<!-- check: cond@onDamageTaken -->
```json
{ "damageTakenPctMaxHp": 20, "damageType": ["magic", "true"], "self": { "hpBelowPct": 60 }, "source": { "kind": ["champion"] } }
```

## 6. Werte und Effekte

### Werte (`Value`)

Überall, wo eine Zahl steht, darf auch ein Wertausdruck stehen: `base + perLevel × (Level − 1) + Σ Koeffizient × Größe`,
danach auf `[min, max]` begrenzt.

<!-- check: value -->
```json
{ "base": 30, "perLevel": 3, "scale": { "ap": 0.12, "maxHp": 0.01, "targetMaxHp": 0.03, "stacks": { "souls": 2 } }, "min": 10, "max": 120 }
```

Größen für `scale` (Koeffizienten sind Brüche): Träger `ap ad bonusAd armor mr maxHp curHp missingHp`; Ziel
`targetMaxHp targetCurHp targetMissingHp` (die Einheit des Triggers); Empfänger `recipientMaxHp recipientCurHp
recipientMissingHp` (die Einheit, auf die der Effekt gerade wirkt – bei Flächeneffekten jede für sich); `damage`
(Schaden des Triggers), `overheal`, `stacks` (Stapelzähler: `{ "name": Koeffizient }`).
Der Wert wird beim Ausführen des Effekts ausgewertet, das **Level** beim Auslösen der Regel.

### Empfänger (`to`)

`self` (Träger) · `target` (Einheit des Triggers / gewähltes Ziel des Aktiven) · `source` (Angreifer, nur
`onDamageTaken`/`onShieldBreak`) · `nearestAlly` (nächster verbündeter Champion, braucht `range`) · `alliesInRadius`
(verbündete Champions inkl. Träger, braucht `radius`) · `enemiesInRadius` (Gegner außer Gebäuden, braucht `radius`).
Flächen zentrieren auf den Träger; `"around": "target"` zentriert auf die Zieleinheit.
`to: "target"` ist nur in Triggern mit Ziel erlaubt, `to: "source"` nur in `onDamageTaken`/`onShieldBreak`.

### Effekte

Jeder Effekt hat ein `type`. Alle Typen:

**`damage`** – Schaden an die Empfänger (läuft durch die normale Schadens-Pipeline: Rüstung, Schilde, Kill-Credit; als
verschachtelter Schaden löst er weder `modifyDamage` noch `onDamageTaken` aus, ein Kill dadurch aber `onKill`).
<!-- check: effect@onHit -->
```json
{ "type": "damage", "to": "target", "dmgType": "magic", "value": { "scale": { "targetMaxHp": 0.03 }, "max": 80 } }
```

**`heal`** – Heilung (Heilungsverringerung/Grievous Wounds des Empfängers gilt). `perSeconds`: der Wert gilt pro N s und wird
gleichmäßig je Tick angewendet.
<!-- check: effect@onTick -->
```json
{ "type": "heal", "to": "self", "value": { "scale": { "maxHp": 0.015 } }, "perSeconds": 5 }
```

**`shield`** – Schild mit `id` und Dauer. `healPower: true` wendet Heil-/Schildkraft des Trägers an (`healShieldPowerPct`,
`modifyHeal`-Passiven). `accumulate: true` addiert zum bestehenden Schild gleicher `id`, begrenzt durch `cap`; kein Schild,
wenn nichts dazukäme.
<!-- check: effect@onHit -->
```json
{ "type": "shield", "to": "self", "id": "mein_schild", "value": { "scale": { "overheal": 1 } }, "accumulate": true, "cap": { "base": 65, "perLevel": 15 }, "seconds": 25 }
```

**`applyBuff`** – Buff/Debuff/Kontrolleffekt. `kind`: `slow blind root silence fear stun stasis unstoppable grievous stat dot`.
`slow`/`grievous` brauchen `pct` (Grievous = Heilungsverringerung); `stat` braucht `stat`
(`as ms ad ap armor mr dmgReduction tenacity range armorPen dmgDealt`) und `pct` und/oder `flat` (negativ = Debuff);
`dot` braucht `damage` (Gesamtschaden über die Dauer als Wert), `dmgType`, `period` (Sekunden zwischen Ticks).
`stacks: { "max": 5 }` (nur `stat` mit `pct`): wiederholtes Anwenden stapelt, `pct` wird mit der Stapelzahl multipliziert.
`uncleansable: true`: Reinigung entfernt den Buff nicht. Kontrolleffekte unterliegen Zähigkeit und Immunitäten
(Stasis, Unaufhaltsam). Schlägt der Buff bei einem einzelnen Empfänger fehl (immun), bricht ein Aktives ab.
<!-- check: effect@onHit -->
```json
{ "type": "applyBuff", "to": "target", "kind": "stat", "stat": "armor", "id": "mein_stapel", "pct": -6, "stacks": { "max": 5 }, "seconds": 6 }
```
<!-- check: effect@onAbilityHit -->
```json
{ "type": "applyBuff", "to": "target", "kind": "dot", "id": "mein_brand", "dmgType": "magic", "period": 1, "seconds": 3, "damage": { "base": 30, "scale": { "ap": 0.12 } } }
```
<!-- check: effect@onHit -->
```json
{ "type": "applyBuff", "to": "target", "kind": "grievous", "id": "mein_grievous", "pct": 40, "seconds": 3 }
```

**`cleanse`** – entfernt Kontrolleffekte (`kinds`, Standard `slow blind root silence stun`; zusätzlich `fear`, `grievous`)
und Buffs mit den `ids`. Nicht entfernbar: Luftstoß (airborne), Unterdrückung, Stasis, `uncleansable`-Buffs.
<!-- check: effect@onTick -->
```json
{ "type": "cleanse", "to": "self", "kinds": ["stun", "root", "slow"], "ids": ["entflammen"] }
```

**`restoreMana`** – Mana des Trägers (bis Maximum).
<!-- check: effect@onKill -->
```json
{ "type": "restoreMana", "value": 6 }
```

**`gold`** – Gold an die Empfänger. `counter`: addiert zusätzlich auf einen Zähler der Passive (für `quest`).
<!-- check: effect@onHit -->
```json
{ "type": "gold", "to": "nearestAlly", "range": 1000, "amount": 15, "counter": "geteilt" }
```

**`absorbDamage`** – nur `onDamageTaken`: der Träger bekommt den HP-Anteil des Schadens (Bedingung z. B. `damageType`) sofort
zurück, bis der Pool (`value`) leer ist; `rechargeSeconds` nach der ersten Absorption füllt er sich wieder (kein Schildbalken).
<!-- check: effect@onDamageTaken -->
```json
{ "type": "absorbDamage", "value": { "base": 192, "perLevel": 12 }, "rechargeSeconds": 40 }
```

**`healOverTime`** – Heilung über Zeit in einem Pool des Trägers (`pool`, Standard Item-Id). Ein zweiter Einsatz reiht sich hinten
an (gleiche Rate). Der Pool überlebt das verbrauchte Item und endet beim Tod.
<!-- check: effect@onHit -->
```json
{ "type": "healOverTime", "value": 120, "seconds": 15 }
```

**`addStack`** / **`clearStack`** – Stapelzähler der Passive (`name`, `max`; `amount` Standard 1). Mit `seconds`/`ticks` verfallen
alle Stapel so lange nach dem letzten Zugewinn. Lesen: `scale.stacks`, Bedingung `stacksAtLeast`.
<!-- check: effect@onKill -->
```json
{ "type": "addStack", "name": "souls", "max": 10, "seconds": 20 }
```
<!-- check: effect@onTakedown -->
```json
{ "type": "clearStack", "name": "souls" }
```

**`damageMult`** (nur `modifyDamage`) / **`healMult`** (nur `modifyHeal`) – Faktor auf den ausgehenden Schaden bzw. die Heilung.
<!-- check: effect@modifyDamage -->
```json
{ "type": "damageMult", "mult": 1.15 }
```

**`statMult`** / **`statAdd`** (nur `onComputeStats`) – `statMult` multipliziert `ad ap armor mr as ms`; `statAdd` addiert auf
`ad ap armor mr as ms range tenacity` (Zähigkeit in Prozentpunkten) einen Wert.
<!-- check: effect@onComputeStats -->
```json
{ "type": "statMult", "stat": "ap", "mult": 1.35 }
```
<!-- check: effect@onComputeStats -->
```json
{ "type": "statAdd", "stat": "armor", "value": { "base": 10, "scale": { "stacks": { "souls": 2 } } } }
```

**`stopMovement`** – bricht die Bewegung des Trägers ab (Zeitglas). **`placeSealWard`** – setzt einen Siegelward am Zielpunkt
(Siegelward-Item; schlägt bei Wardlimit fehl).
<!-- check: effect@onHit -->
```json
{ "type": "stopMovement" }
```

## 7. Aktive und Verbrauchsgüter

<!-- check: item -->
```json
{
  "id": "beispielnebel",
  "name": { "de": "Beispielnebel", "en": "Example Mist" },
  "tier": "legendary",
  "cost": 2800,
  "from": ["verstaerkerbuch", "rubinsplitter"],
  "stats": { "ap": 60, "hp": 200 },
  "tags": ["ap"],
  "active": {
    "name": { "de": "Giftnebel", "en": "Toxic Cloud" },
    "desc": { "de": "Gegner im Umkreis 600 verlieren 50 % Heilung für 4 s.", "en": "Enemies within 600 lose 50 % healing for 4 s." },
    "cooldown": 60,
    "target": "self",
    "requires": ["canAttack"],
    "effects": [{ "type": "applyBuff", "to": "enemiesInRadius", "radius": 600, "kind": "grievous", "id": "beispiel_nebel", "pct": 50, "seconds": 4 }]
  }
}
```

- `target`: `self` (kein Ziel), `point` (Zielpunkt der Befehls-Koordinaten `x,y`, Standard eigene Position),
  `allyChampion` / `enemyChampion` (der **nächste** passende Champion zum Zielpunkt, höchstens `range` vom Träger entfernt;
  Gegner müssen sichtbar sein; kein Ziel = Abbruch). Das gewählte Ziel ist in den Effekten `to: "target"`.
- `requires: ["canAttack"]`: nicht nutzbar unter Betäubung, Furcht, Luftstoß, Unterdrückung, Stasis. **Ohne** `requires`
  ist das Aktive auch unter Kontrolle nutzbar (Anti-CC-Items).
- `effects` laufen der Reihe nach. Kann ein Effekt nicht wirken (Ziel immun, Wardlimit), bricht die Nutzung ab, ohne
  Abklingzeit (HUD-Meldung wie bei Fähigkeiten). Abklingzeit gilt je Item-Id (folgt dem Item, nicht dem Slot).
- Verbrauchsgut: `tier: "consumable"` mit `use` (wie `active`, ohne `name`/`desc`/`cooldown`), `passive` trägt nur den Anzeigetext.
  Bei Erfolg wird das Item verbraucht; kein Stapeln pro Slot.

<!-- check: use -->
```json
{ "target": "self", "effects": [{ "type": "healOverTime", "value": 120, "seconds": 15 }] }
```

## 8. Einzigartigkeit und Stapeln

| Regel | Wirkung |
|---|---|
| Werte (`stats`) | stapeln immer. |
| Passive, Standard (`stack: "unique"`) | Mehrere Kopien **mit gleichem Schlüssel** wirken nur einmal (die erste im Inventar). Der Schlüssel ist `passive.key`, sonst die Item-Id. Zwei verschiedene Items mit gleichem `key` teilen sich also eine „einzigartige Passive“ (LoL: „Unique Passive“). |
| gleicher Passiv-Name | Passiven mit gleichem Namen (de oder en) sind **eine** einzigartige Passive: die Prüfung beim Laden verlangt dann denselben `key` (oder verschiedene Namen), damit der Name nie still ein Item abschaltet. |
| `stack: "stack"` | Jede Kopie wirkt einzeln, mit eigenen Abklingzeiten, Ladungen und Stapeln. |
| Legendäre Items | höchstens eine Kopie (`maxOwned` Standard 1). `maxOwned: N` erlaubt N Kopien jedes Items. |
| `unique` (Gruppe) | höchstens ein Item der Gruppe (`starter`, `boots`). |
| Zustand | Abklingzeiten, Ladungen, Stapel, Zähler, Absorb-Pools liegen in `sim.state.items` je Champion und Passiv-Schlüssel. Sie überleben Verkauf und Neukauf (wie bisher). Alles deterministisch, im `stateHash`. |

## 9. Prüfung beim Laden

`validateItemsDocument` (in `inventory.ts` beim Modulstart) wirft einen `ItemFormatError` mit **allen** Fehlern, JSON-Pfad
und Vorschlag:

```
items.json: 3 errors
  items[sturmbogen].passive.rules[0].on: unknown trigger "onHti" (did you mean "onHit"?)
  items[sturmbogen].passive.rules[0].do[0].type: unknown effect "damge" (did you mean "damage"?)
  items[sturmbogen].stats.armr: unknown stat (did you mean "armor"?)
```

Geprüft werden außerdem: Pflichtfelder, Dauer (`seconds` **oder** `ticks`), Empfänger-Pflichtfelder (`radius`, `range`),
Trigger/Effekt-Kombinationen (z. B. `damageMult` nur in `modifyDamage`, `absorbDamage` nur in `onDamageTaken`),
Bedingungen, die zum Trigger passen müssen, Verbrauchsgüter ohne `use`, `quest` ohne speisenden `gold`-Effekt, doppelte
Ids und unbekannte Rezept-Komponenten. Dieselbe Prüfung läuft in `tests/itemEngine.test.ts`.
`registerItems(rohItems)` (`inventory.ts`) fügt geprüfte Zusatz-Items hinzu und gibt eine Rückgängig-Funktion zurück (Tests).

## 10. Rezepte für die geplanten Items (Beispiele in `tests/fixtures/itemEngineItems.json`)

| Ziel | Bausteine | Beispiel-Item |
|---|---|---|
| Anti-Heal | `applyBuff` `kind: "grievous"` in `onHit`/`onAbilityHit` oder als Aktives auf `enemiesInRadius` | `fx_wundenklinge`, `fx_wundrauch` |
| Anti-Tank | `damage` mit `scale.targetMaxHp` (+ `max` als Deckel); `stats.armorPenPct`, `stats.magicPen` | `fx_titanspalter`, `fx_leerenstab` |
| Anti-Burst | `onDamageTaken` mit `damageTakenPctMaxHp` + `shield` + `cooldown`; `onShieldBreak` + `applyBuff` `dmgReduction`; `absorbDamage` | `fx_bollwerk` |
| Anti-CC | `stats.tenacityPct`; Aktives mit `cleanse` + `applyBuff` `tenacity` (ohne `requires`) | `fx_reinigungsamulett` |
| Unit-Ziel | `target: "enemyChampion"` + `range` | `fx_fangnetz`, `fx_segensperle` |
| Stapel | `addStack`, `scale.stacks`, `stacksAtLeast`, `onComputeStats` | `fx_ahnenkelch` |

Nicht in Daten ausdrückbar (dafür bräuchte es neue Bausteine in `engine.ts`): neue Schadensformen jenseits von `scale`,
Teleport/Dash, Beschwörungen, Karten-Objekte, Sicht. Neue Bausteine werden additiv ergänzt (Typ in `schema.ts`, Prüfung in
`validate.ts`, Ausführung in `engine.ts`, Test, dieser Abschnitt).

## 11. Migration der alten Code-Hooks (Referenz)

Bis Welle 1 lagen die Wirkungen der 20 Items mit Effekt als Code in `itemHooks.ts` (`passive.hook` / `active.hook`). Sie sind
1:1 in dieses Format übersetzt; `tests/itemEngine.golden.test.ts` prüft Zahlen, Auslöser und Abklingzeiten jedes Items bit-genau
gegen eine vor dem Umbau aufgezeichnete Spur (`tests/fixtures/itemsGolden.json`, ~90 Szenarien).
Das Level wird – wie im alten Code – beim Auslösen festgehalten (Jägerzahn: Heilung nutzt das Level vor einem Level-up durch
den Kill). Nach bewusster Balance-Änderung an einem Item: `UPDATE_GOLDEN=1 npx vitest run tests/itemEngine.golden` und die
geänderten Zahlen im Diff prüfen. Später hinzugefügte Items sind nicht in der Datei und stören sie nicht.
