# swarm/champs-b: Rovena (blood mage), Dorrak (sand worm), Tilda (musician)

Branch `swarm/champs-b` from main 2f72f4f. One commit per champion.

## 1. Rovena Aderlass, "die Aderlasserin" (id `rovena`, mid)
- Data `src/data/champions/rovena.json` (+ `rovena.values.json` tunables), hooks `src/sim/champions/rovena.ts`, kit props
  `src/render/champions/rovena.ts` (bone thorn crown, three blood orbs, drips; tattered cape/robe from the outfit), kit in kits.ts.
- Resource none, all of Q/W/E cost HP (`costType: hp`, plus 3 % max HP through `modifyCast`), R free. Passive Bloodtithe: ability
  damage heals 25 % (champions) / 10 % (others) of the estimated damage dealt (`modifyDamage`, pre-mitigation x mitigation; ponytail
  comment), Bloodrush below 35 % HP: +20 % ability damage, +50 % heal. Q marks (`rovena_blood`), E consumes the mark (+40 %, root
  0.75 s), R `self` + delay hits all enemies in 650 and doubles the heal-back (`drainTick`).
- Bot: `ready()` in src/ai/bot/combat.ts refuses HP-cost casts below 25 % HP (bots do not bleed out); HP margin rule already existed.
- Motion `stalk` / idle `sway`, casts point + raise (abab), motifs dagger/drop/chain/heart.
- Items: `aderglas` Veinglass (component 1000: +30 AP, +175 HP), `blutkelch` Bloodchalice (legendary 2900, from Veinglass +
  Apprentice Rod: +80 AP, +300 HP; Last Sip: ability hits on champions heal 4 % missing HP + 15 (0.5 s icd), below 40 % HP +10 % AP;
  pure item-engine data). In Rovena's standard/vsAD/vsAP builds.
- Tests: tests/rovena.test.ts (8), tests/rovenaKit.test.ts (4: kit, item price + passive, bot rule). Shared test change:
  tests/items.test.ts component count `>=14`.
- Shared registries touched (additive): champions index (data + sim), builds.ts, bot hints (generated), runePresets, voiceLines,
  abilityMotifs, kits/motion/casts, trainer MID pool, items.json, itemIcons.json, combat.ts `ready`.
