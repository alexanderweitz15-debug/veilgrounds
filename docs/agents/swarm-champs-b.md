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

## 2. Dorrak Sandschlund, "der Dünenwühler" (id `dorrak`, jungle, non-human worm)
- Data `dorrak.json` + `dorrak.values.json`, hooks `src/sim/champions/dorrak.ts`, custom painted drawer `src/render/champions/worm.ts`
  (16 ringed ochre segments rearing on a curve, ring-of-teeth maw, bony back plates, sand mound; registered as DRAWER + kit stub; made
  by a helper agent, one contact-sheet check: idle SE / attack E / cast S looked right, run/death not inspected).
- Engine change (shared, tiny): new buff kind `disarm` (`src/sim/buffs.ts` type) checked in `src/sim/systems/attack.ts` `able`
  (not in canAttack: summoners/items use that). Not a CC, cleanses leave it alone.
- W Burrow (self, recast flag, 4-6 s): hook keeps `until`; onTick re-applies `untargetable`, ms +35 %, `disarm` (2 ticks each), heals
  3 % max HP/s (passive Sandgut), pushes dust-trail points; snapshot objects `dorrak_trail` (discs, NOT hidden: the enemy sees them
  where it has vision). Recast / timer / Q / E / R surface him. Q cone: damage + armor -15 % 3 s (hook, data forbids negative pct).
  E self AoE 330 delay 0.45: knock-up 0.75 s; from underground x1.3 damage and +0.25 s knock-up (hook prep/finish). R circle 380 at 750,
  1.25 s knock-up.
- Bot: `src/ai/bot/burrow.ts` (called from `utilitySpells`): burrow when the last move target is > 1800 away and no enemy champion within
  1200; combat.ts `castSlot` never casts `dorrak_w` in fights (disarmed underground). E/Q/R surface him on arrival.
- Items: `wuehlerzahn` Burrower's Tooth (component 1100, +20 AD +150 HP), `sandpanzer` Sand Carapace (legendary 3000, +40 AD +500 HP;
  Duststeel: ability hit on a champion gives +25 armor and MR for 2.5 s, 8 s icd; item-engine data). In his builds (jg_bruiser).
- Motion hover/heave, casts stomp + slam, motifs fang/claw/spiral/wave, trainer JG pool.
- Tests: tests/dorrak.test.ts (9: burrow flags, regen, trail visible to enemy, no attack, recast, Q shred, E + underground bonus,
  R, item, bot rule), tests/dorrakKit.test.ts. Not done: jungle clear-time comparison against vessa/grimald.

## 3. Tilda Saitenwind, "die Notensammlerin" (id `tilda`, support)
- Data `tilda.json` + `tilda.values.json`, hooks `src/sim/champions/tilda.ts`, props `src/render/champions/tilda.ts` (red hat plume, lute on the
  back, three circling notes in the song colours), kit in kits.ts (teal coat, wide hat, braid).
- Passive Note Gleaning: every 6 s a note (green heal / blue speed / red stun) spawns 450-1000 from her (sim rng, 16-direction table because
  sin/cos are banned in sim code, walkable snap), max 4 on the map, 25 s, snapshot objects `tilda_note` flagged `hidden` (only her team sees
  them). Walking within 110 collects (3 per colour). Q Heillied (self heal 650) green +25 %/note; W Eilmarsch (allies ms) blue +8 %/note;
  E Schrillakkord (circle, damage + slow) red: stun 0.4 s + 0.2 s/note; R Schlussakkord (heal + ms + stun, uses all notes).
- Bot: `src/ai/bot/notes.ts` (from `utilitySpells`): walk to the nearest note within 750 when no enemy champion/tower is near and the bot does
  not fight; `mem.holdUntil` keeps the lane leaf from overriding the walk.
- Items: `taktstock` Conductor's Baton (component 1100: +30 AP +10 haste), `liederbuch` Songbook (legendary 2800, + Warden Lamp: +55 AP,
  +20 haste, +8 % heal/shield power; Refrain: each cast heals allies in 600 for 12 + 2/level + 6 % AP, 4 s icd; item-engine data).
- Tests: tests/tilda.test.ts (11: notes spawn/fog/pickup/determinism, Q/W/E/R empowerment, item, bot rule, kit).

## Not done / decisions
- No clear-time comparison for Dorrak against vessa/grimald (numbers set from the same-role table: 670 HP, 62 AD, 36 armor).
- Visual check: one champion-lab contact sheet (tools/scratch/champLab.html, idle SE, game-size row) with all three on a vite server from this worktree; tab and server closed. Rovena: thorn crown reads like antlers plus orbs; Tilda: plumed hat, teal coat; Dorrak: worm barrel on a sand mound. No in-match sandbox shot (the lobby has no champion URL switch).
