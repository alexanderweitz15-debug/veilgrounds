# auto/champions: running log (champions, items, runes)

Branch `auto/champions` (from origin/main). One commit + push per finished champion/item batch; the lead merges.

## Idea list

Roster archetypes already there: marksmen (mira, corvin, tobin, lysa hypercarry, wren, svea, henrike), enchanters (ferris, oda, tilda), engage/tank supports (hagen, gorvam, fenna, kiran), assassins (kaelen, renn, nyx, kerrin), tanks/bruisers (brom, dagny, oleth, vessa, isolde duelist, harrow splitpusher, gneis, knarr), junglers (grimald, lio, ottilie pets, dorrak, vargrim), mages (ilvane, aurel, thessaly, sev, truda, rovena, seraphyne battlemage).

Gaps (ordered, picked top-down):

| # | Idea | Status |
|---|---|---|
| 1 | Item batch: AD anti-heal, spell shield, lifeline, boots upgrades | shipped |
| 2 | Artillery poke mage (mid): **Marga Kartaune** | shipped |
| 3 | Berserker with undying ult (top): **Torben Wutmähne** | shipped |
| 4 | Generic bot hint `botManual` (Knarr stance toggle) | shipped |
| 5 | Guardian enchanter with an ally ultimate (support): **Lumi Sternenwiege** | shipped |
| 5c | Parry duelist (top): **Ysmay Degenfeld** | shipped |
| 5d | Henrike turret as a real pet unit with HP | shipped |
| 5b | Shapeshifter (two forms, jungle): **Hedda Fellwechsel** | shipped |
| 5e | Summoner with killable pets (jungle): **Gerwin Totenglocke** | shipped |
| 5f | Runes Flinkfuß, Phasenlauf, Erstschlag | shipped |
| 5g | Items Stichblatt (Ysmay), Gruftkrone (Gerwin) | shipped |
| 6 | Summoner with killable pets (support/jungle) | idea |
| 7 | Henrike turret killable (needs pet unit) | idea, not cheap |
| 8 | Rune options from docs/IDEAS-FEEL-SHOP.md: Eroberer, Komet + 4 stat minors | shipped (Flinkfuß and the rest still open) |
| 9 | Support quest item (Spenderlampe upgrade) | idea |

## Shipped

- **Items (batch 1)**: Sensenschwert (legendary, +60 AD +10 % lifesteal, Wundbrand 40 % anti-heal on auto + ability hits), Bannmantel (legendary, +75 AP +50 MR, Zauberschild absorbs 150 + 10/level ability damage, 35 s), Notanker (legendary, +40 AD +450 HP +30 armor, Letzte Rettung: below 30 % HP shield 200 + 15/level and +20 % MS, 90 s), Zauberbrecherstiefel (boots, +15 magic pen), Zähe Stiefel (boots, +20 tenacity). Wired into builds of thessaly, isolde, vessa, kaelen. Test `tests/autoItems.test.ts`.
- **Marga Kartaune** (`marga`, mid artillery): Fernschuss passive (ability damage +4 % per 100 beyond 500, max +24 %), Q Mörserwurf, W Splitterhagel zone, E Rückstoß (backward hop + shove), R Belagerungsschlag (3000 range). Painted kit (mortar tube on the back, ramrod, soot puffs), item **Langrohr** (+90 AP, +10 haste, +100 attack range). Test `tests/marga.test.ts`.
- **Torben Wutmähne** (`torben`, top berserker): Rage 0-100 passive, Q cone, W War Cry, E Blood Leap, R Undying Roar (HP floor 1 for 5 s then heal). Painted kit (two hand axes, skull belt, rage haze), item **Raserbeil** (+50 AD +350 HP, below 50 % HP +30 % AS +10 % MS). Test `tests/torben.test.ts`.
- **botManual**: `AbilityData.botManual`, checked in `ready()` of `src/ai/bot/combat.ts`; Knarr W uses it, so bots stay in Fortress.

- **Runes**: keystones Eroberer (+2 adaptive per champion hit, 8 stacks, heal at full) and Komet (ability hit proc 30-100, CD 12 s) in `src/sim/items/runeHooks.ts`; minors Durchdringung (+6 magic pen), Letalität (+5), Heilkraft (+6 % heal/shield power), Standhaft (+8 % tenacity). Icons in itemIcons.json. Marga defaults to Komet, Torben to Eroberer. Test `tests/autoRunes.test.ts`; `tests/items.test.ts` rune counts are now `>=`.
- **Lumi Sternenwiege** (`lumi`, support guardian enchanter): Wish Dust passive, Q star shot, W shield bond, E heal + speed swirl, R Last Wish (ally untargetable + projectile immune + shield + cleanse). Painted kit (floating crescent moon, star staff, twinkles), item **Sterndiadem** (+50 AP, +12 % heal/shield power, +15 haste, Star Spark shield after a cast). Test `tests/lumi.test.ts`.
- **Ysmay Degenfeld** (`ysmay`, top parry duelist): W Parry gives all damage back for 0.8 s and stuns the attacker, passive refunds half the parry cooldown, Q lunge stops at the first enemy, E whirl, R Challenge. Painted kit (plume, rapier, parrying dagger). Test `tests/ysmay.test.ts`. Uses existing items (no new item yet).
- **Henrike turret**: now a `spawnPet` unit (tag `henrike_turret`, HP 140-300 by rank, armor/MR 20) that enemies can kill; shots stop when it dies. Test in `tests/henrike.test.ts`.
- **Sprite check** (own vite on port 5199, closed): Torben and Lumi read well; Lumi crescent enlarged, Marga mortar tube enlarged (still mostly behind the body).
- **Gerwin Totenglocke** (`gerwin`, jungle summoner): skeletons are `spawnPet` units (HP, killable, max 4); Q raise, W burst the nearest, E command, R three reinforced. Kit: bell on a pole, key ring, ghost lights. Item **Gruftkrone** (+55 AP +300 HP +10 haste, takedown heal + mana). Test `tests/gerwin.test.ts`.
- **Runes**: Flinkfuß, Phasenlauf, Erstschlag keystones (tests in `tests/autoRunes.test.ts`). **Stichblatt** (+45 AD +20 % AS +5 % MS, +15 % damage dealt 2 s after being auto-hit) for Ysmay.
- **Hedda Fellwechsel** (`hedda`, jungle shapeshifter): human (range 550, E heals) and panther (range 175, +12 % MS, +15 % AD, +50 % ability damage on hunted targets, E swipes); W toggles (botManual), R leaps and shifts. Kit: cat ears, ringed tail, hunting spear, claw necklace. Test `tests/hedda.test.ts`. Uses existing items.
- **Sprites**: Marga mortar redrawn in front of the body in bright brass (clearly visible now); Gerwin bell checked on champLab (visible).
- **Zinna Funkenlauf** (`zinna`, ADC arc marksman): every 3rd auto arcs to the nearest other enemy (70 % magic), Q piercing shot, W Overcharge (AS + next auto arcs), E backward hop + slow, R Storm Wall (1500 line, stun). Kit: coil rifle, back antennae with an arc (checked on champLab). Item **Blitzfeder** (+40 AD +30 % AS +20 % crit, +20 magic on hit). Hedda got **Jagdfell** (+60 AP +250 HP +10 haste, +20 % MS 2 s after an ability hit). Test `tests/zinna.test.ts`.
- **Balance sanity (base stats vs same-role average of the older roster)**: all ten newest champions are within about 6 % on HP, AD, armor, MS and AS. Ranged junglers (Gerwin, Hedda) have 550 range vs melee average, with 590-610 HP (5 % below). Role counts now: top 11, jungle 13, mid 10, adc 8, support 8 (adc and support are the thinnest; mid has no bruiser-mage left).

## Open

- Bots do not use Torben's R tactically (generic self-cast logic only).
