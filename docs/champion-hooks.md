# Champion hooks (engine TODO)

Champion-specific logic that the generic effects in `src/sim/champions/schema.ts` cannot express.
Every id below is referenced from `src/data/champions/<id>.json` (`passive.hooks` or an ability effect
`{ "kind": "hook", "id": ... }`) and should be exported under that id from `src/sim/champions/<champ>.ts`.
Per the contract in `src/sim/champions/hooks.ts`: ids from `passive.hooks` go into `hooks.passive` (PassiveHook
event handlers), ability hook ids into `hooks.effects` (EffectHook called per resolution with EffectCtx).
Mira Quell (Agent B) is not listed here. This file was generated together with the JSON; keep both in sync when
editing either. The engine side (timing phases, `ownsHits`, `onTick`, next-auto handling, summons, terrain, cooldown /
recast / channel helpers) is documented at the top of `src/sim/champions/hooks.ts`.

## Data conventions used by the champion JSON

- **Units**: `Scaling` ratios (`ad`, `bonusAd`, `ap`, `maxHp`, `targetMissingHp`, ...) are fractions (0.6 = 60 %).
  `pct` on `slow`/`buff` is a percentage (40 = 40 %). Durations and delays in seconds, distances in map units.
- **Rank values**: arrays have 5 entries for Q/W/E and 3 for R; a single number applies to every rank.
- **Effect targets**: `hit` (default) = enemy units hit by the ability (projectile hit, units in the area,
  or the targeted enemy). `self` = caster. `ally` = the targeted ally (`ally_target` abilities) or the first
  ally hit. `allies` = allied champions inside the ability's area (caster included); for `self`-type abilities
  the area is `radius` around the caster. `enemies` is not used by these files.
- **`self`-type abilities with `radius`** are AoEs centred on the caster (`range` = 0).
- **Zones** (`type: "zone"`): damage/heal effects are per second while a unit is inside; slows inside zones use a
  short duration (0.5 s) and are refreshed every tick. Zone geometry is a circle of `radius`, unless a hook
  says it is a line/wall (then `radius` = half the line length, `width` = thickness).
- **Hooks run in addition to the generic effects** of the same ability, in list order, at the same moment.
  Two hook families change *when* generic effects resolve:
  - **`*_next_auto` hooks**: on cast the ability arms the caster's next basic attack (within `duration`, default
    4 s if absent). Effects with target `hit`/default resolve on that empowered attack's target instead of on
    cast; `self` effects resolve on cast.
  - **Hit-producer hooks** (multi-strike, bouncing, returning projectiles, barrels, channels): the hook produces
    hit instances; each hit instance applies the ability's generic effects once.
- **Conditional effects** (only if marked / only in the sweet spot / only below x % HP) are *not* listed as generic
  effects; the hook owns them and its numbers are given below.
- **Backward hops** (`*_backstep`, `*_retreat_shot`, `*_smoke_hop`): the dash goes away from the cursor.
- Passive numbers live only in `passive.desc` and here (the schema has no `passive.effects`).
- **Line zones** use the ability field `line: "perpendicular" | "forward"` (Oleth R uses it; Oleth R has no
  `duration`, so the stun resolves once and the hook keeps the wall for 4 s).

## Ilvane (`ilvane`)

| Hook | Slot | Behaviour |
|---|---|---|
| `ilvane_thread_mark` | Passive | Marks are applied by the `mark` effect `ilvane_thread` (4 s). Her basic attack on a marked target consumes it: bonus magic damage byLevel 10→40 (+0.2 AP) and +20 % move speed for 1 s. |
| `ilvane_e_backstep` | E | Dash direction is away from the cursor (350). For 0.4 s after the hop starts, enemy projectiles do not hit her (pass through). |
| `ilvane_r_root_marked` | R | Evaluate before this cast applies its own mark: every hit target that already carries `ilvane_thread` is rooted for 1.2 s (mark is consumed). |

## Thessaly Vorn (`thessaly`)

| Hook | Slot | Behaviour |
|---|---|---|
| `thessaly_free_cast` | Passive | Internal 12 s timer: when ready, her next ability costs no mana; the timer restarts on that cast. |
| `thessaly_w_reflect` | W | While the W shield holds, 25 % of each absorbed amount is dealt back to the damage source as magic damage. |
| `thessaly_r_execute_bonus` | R | If the target is below 30 % HP when R lands, R damage is multiplied by 1.5. |

## Kaelen Rasch (`kaelen`)

| Hook | Slot | Behaviour |
|---|---|---|
| `kaelen_follow_through` | Passive | After any Kaelen dash ends, his next basic attack within 2 s deals bonus phys damage byLevel 30→120 (+0.4 bonus AD). |
| `kaelen_w_dash_to_mark` | W | If the W target point is on/near an enemy carrying `kaelen_mark` within 900, W dashes to that enemy (range 900) instead of 450 toward the point; consumes the mark. |
| `kaelen_e_w_refund` | E | If E hits at least one enemy champion, W's remaining cooldown is reduced by 2 s (once per cast). |
| `kaelen_r_vanish` | R | If R kills the target, Kaelen gains `invisible` for 10 s as soon as he is out of combat (no damage dealt/taken for 1 s, window 5 s); attacking or casting breaks it. |

## Brom Eisenwurz (`brom`)

| Hook | Slot | Behaviour |
|---|---|---|
| `brom_bleed` | Passive | Every Brom ability hit on an enemy adds 1 bleed stack (max 5, each stack 8 phys damage/s for 5 s, refresh on new stack). While a target has 5 stacks, each bleed tick heals Brom for 2 % max HP per stack (10 %/tick at 5). |
| `brom_q_outer_ring` | Q | Targets between 250 and 400 from Brom take +50 % Q damage and receive +1 extra bleed stack. |
| `brom_w_next_auto` | W | Next-auto hook (4 s): the empowered attack deals +30 % damage; the listed 60 % slow (1 s) applies to its target. |
| `brom_e_armor_pen` | E | Passive while E is learned: Brom ignores 25 % of the target's armor on all physical damage. |
| `brom_r_stack_bonus` | R | R damage is multiplied by (1 + 0.2 × bleed stacks on the target) before mitigation (true damage, so 5 stacks = +100 %). |
| `brom_r_reset` | R | If R kills a champion, its cooldown is reset. |

## Sister Oleth (`oleth`)

| Hook | Slot | Behaviour |
|---|---|---|
| `oleth_faith_wall` | Passive | If damage taken within a rolling 2 s window reaches 15 % max HP, gain a shield of 8 % max HP for 3 s. Cooldown 10 s. |
| `oleth_q_dash_stun` | Q | If Oleth ended a dash (her E or any displacement she cast) in the last 2 s, Q also stuns the target for 0.5 s. |
| `oleth_e_stop_on_enemy` | E | The dash stops at the first enemy unit its 100-wide path touches; the generic airborne applies to that unit only. No enemy touched: full 600 and no effects. |
| `oleth_r_wall` | R | Line geometry: a wall of length 800 (2 × radius) and thickness 100, perpendicular to the cast direction, centred 350 in front of Oleth, appears after 0.7 s. Enemies on the line take the generic stun; the wall is impassable terrain for 4 s (units on it are pushed to the nearer side). |

## Ferris Lampenhand (`ferris`)

| Hook | Slot | Behaviour |
|---|---|---|
| `ferris_companion` | Passive | While at least one allied champion is within 800 of Ferris, all heals and shields Ferris applies are increased by 10 %. |
| `ferris_e_cleanse_slows` | E | Removes all active slows from the targeted ally and from Ferris. |

## Gorvam Kettenmund (`gorvam`)

| Hook | Slot | Behaviour |
|---|---|---|
| `gorvam_heavy_chains` | Passive | Count basic attacks per Gorvam; every 4th attack applies a 40 % slow for 1 s to its target. |
| `gorvam_q_drag` | Q | The projectile stops at the first enemy unit; that unit is dragged to Gorvam's position over 1.5 s (cannot move, attack or cast while dragged; counts as a pull for tenacity/cleanse). |
| `gorvam_q_fake_cancel` | Q | Recast during the 0.5 s wind-up cancels the cast: no projectile, Q goes on a 2 s cooldown and the mana cost is refunded. |
| `gorvam_w_next_auto` | W | Next-auto hook (4 s): the empowered attack applies the listed 0.5 s airborne to its target. |
| `gorvam_r_reel_in` | R | All enemies within 500 at cast are pulled toward Gorvam over 1.5 s (end position just outside his hitbox); the generic 60 % slow covers the same 1.5 s. |

## Vessa Wildherz (`vessa`)

| Hook | Slot | Behaviour |
|---|---|---|
| `vessa_trail` | Passive | Each monster kill grants 1 permanent stack (max 10): +1 % attack speed and +1 flat move speed per stack. |
| `vessa_q_monster_bonus` | Q | Q deals +30 % damage to jungle monsters. |
| `vessa_w_next_auto` | W | Next-auto hook (4 s): the empowered attack heals Vessa for 30/45/60/75/90 + 10 % of her own missing HP (computed at hit time). No generic effects. |
| `vessa_e_stalk` | E | For 3 s Vessa gets +30 % move speed while inside brush or the jungle (not on lanes/river). Her next basic attack started from brush or while not visible to the target's team (fog) slows the target by 50 % for 2 s. |
| `vessa_r_ally_frenzy` | R | On landing, allied champions within 500 of Vessa (including her) gain +20 % attack speed for 4 s. |

## Nyx Hohlschatten (`nyx`)

| Hook | Slot | Behaviour |
|---|---|---|
| `nyx_dark_seed` | Passive | When Nyx kills the last monster of a jungle camp, place an invisible seed there for 90 s. An enemy champion stepping on it (radius 100) is revealed to Nyx's team for 3 s; the seed is consumed. |
| `nyx_q_return` | Q | Hit-producer: at max range the dagger flies back to Nyx's current position; each target can be hit once outbound and once on return (each hit applies the damage). |
| `nyx_w_ambush_root` | W | The first basic attack that starts while Nyx is invisible (W) roots its target for 0.75 s; attacking ends the invisibility. |
| `nyx_r_lonely_prey` | R | For the 6 s duration, enemies within 1200 of Nyx are visible to her team (continuous, not only at cast). Nyx deals +15 % damage to enemy champions that no other ally (champion, ward, tower, minion) currently sees. |

## Old Harrow (`harrow`)

| Hook | Slot | Behaviour |
|---|---|---|
| `harrow_besieger` | Passive | +25 % damage to towers. Track waves near Harrow: every 4th wave on which his team kills every minion with Harrow present (within 1200) grants him +40 gold. |
| `harrow_q_minion_splash` | Q | If the Q target is a minion (or monster), all enemy minions within 200 of it also take the Q damage. |
| `harrow_w_next_auto` | W | Next-auto hook (3 s, the W duration): the empowered attack applies the listed 0.5 s stun. The damage reduction resolves on cast. |
| `harrow_e_march` | E | For 4 s, +40 % move speed while Harrow's movement direction is within 60° of the direction to the nearest enemy tower (re-evaluated each tick). |
| `harrow_r_siege_minions` | R | Spawns 3 allied siege minions next to Harrow on his team's side of the nearest lane, lasting 12 s; their target priority is towers > minions > champions. |

## Seraphyne Sturm (`seraphyne`)

| Hook | Slot | Behaviour |
|---|---|---|
| `seraphyne_electrified` | Passive | onCast: +15 % MS for 3 s (single buff id `seraphyne_p_electrified`, refreshed by every cast, no stacking). HUD badge glows while it runs. |
| `seraphyne_r_three_strikes` | R | Hit-producer: 3 strikes at the target circle at 0, 0.8 and 1.6 s after cast; each applies the generic damage; the third also stuns for 1 s. |

## Renn Sieben (`renn`)

| Hook | Slot | Behaviour |
|---|---|---|
| `renn_blade_pickup` | Passive | Thrown blades (Q landing, W drop) lie for 4 s. When Renn touches one (or E-jumps to it), it is picked up: spin slash radius 320 dealing magic damage byLevel 50→200 (+0.6 bonus AD +0.4 AP) to enemies; sets E remaining cooldown to 1.5 s. |
| `renn_takedown_reset` | Passive | On a champion takedown (kill or assist within 3 s), reduce Q, W and E remaining cooldowns by 12 s. |
| `renn_q_bounce` | Q | Hit-producer: the blade hits the target, then bounces to up to 2 further enemies (nearest not yet hit, within 400), each hit applying the damage. It then lands 350 behind the last target (direction from previous to last) as a blade. |
| `renn_w_blade_drop` | W | A blade lands at Renn's cast position after 1.25 s (pickupable per `renn_blade_pickup`). The generic +50 % move speed decays linearly to 0 over 1.25 s. |
| `renn_e_blade_jump` | E | Target: a blade, enemy or ally within 725 (blink). Blinks next to it; jumping onto a blade picks it up immediately (triggers the spin slash and the 1.5 s E cooldown). |
| `renn_r_blade_storm` | R | Hit-producer, channel 2.5 s: every 0.15 s throw a blade at each of the up to 3 nearest enemy champions within 550 (one hit instance per blade, applies the damage) and apply grievous wounds (40 % healing reduction, 3 s). Any hard CC on Renn ends the channel. |

## Isolde Glasmacherin (`isolde`)

| Hook | Slot | Behaviour |
|---|---|---|
| `isolde_tempered_glass` | Passive | After 2 s without taking damage, the next enemy hit gives Isolde a shield of 20 % max HP that only absorbs that hit's damage type, for 2 s. Cooldown 16 s at level 1 down to 8 s at level 18 (linear). |
| `isolde_q_cut_break` | Q | Next-auto style (3.5 s window), no generic effects. Cast: next basic attack deals +20/40/60/80/100 % AD bonus phys damage. Recast possible 1.5-3.5 s after cast: the next attack instead deals that bonus × 1.4, of which a level-scaled share (40 % at level 1 → 100 % at 18) is true damage, and slows by 25 % for 1 s. |
| `isolde_w_outer_half` | W | Targets in the outer half of the cone (distance 325-650) are slowed by 80 % for 1 s, and Isolde heals for 50 % of the W damage dealt to champions in that half. |
| `isolde_e_wire` | E | First cast: fire a wire up to 800; if it hits terrain, Isolde is pulled to the hit point (no terrain hit: no movement, half cooldown). Recast within 1 s of arriving: dash 400 toward the cursor. Timing exception: the generic stun applies to the first enemy champion the recast dash touches and the attack-speed buff applies on that hit, not on the first cast. |
| `isolde_r_glass_dome` | R | Leap onto the target champion (range 400, untargetable mid-leap; not a `dash` ability so she keeps one hard dash), then a dome of radius 450 for 3.5 s centred there. Units outside cannot enter; enemy projectiles from outside are destroyed on the dome edge. Isolde's basic attacks inside deal +4 % of the target's current HP as true damage. |

## Dagny Kessel (`dagny`)

| Hook | Slot | Behaviour |
|---|---|---|
| `dagny_glowing_shield` | Passive | Every 3rd basic attack deals 4 % of Dagny's max HP as magic damage to all enemies within 200 of the attack target (target included). |
| `dagny_q_next_auto` | Q | Next-auto hook (4 s, auto reset): the empowered attack applies the listed damage; the damage reduction resolves on cast. |
| `dagny_w_armor_shred` | W | Enemies hit lose 10 % armor for 4 s (debuff; does not stack). |
| `dagny_e_shield_wall` | E | For 2 s enemy projectiles hitting Dagny from her front 180° are destroyed without effect, and she gets +30 % move speed while moving within 45° of her facing at cast. |
| `dagny_r_center_stun` | R | Enemies within 150 of the landing point are also stunned for 1 s (the generic slow applies to everyone in the 400 circle). |

## Grimald Fell (`grimald`)

| Hook | Slot | Behaviour |
|---|---|---|
| `grimald_traps` | Passive | Each monster kill places an invisible trap at that spot for 60 s (max 3 active, oldest removed). An enemy champion stepping on it (radius 75) is rooted for 0.5 s; the trap is consumed. |
| `grimald_w_monster_regen` | W | During W, while Grimald has damaged a jungle monster in the last 1 s, he heals 2 % max HP per second. |
| `grimald_r_aura` | R | After landing, a 3 s aura (radius 300 around Grimald, moves with him) reduces enemy attack speed by 20 %. |

## Lio Funkenkind (`lio`)

| Hook | Slot | Behaviour |
|---|---|---|
| `lio_spark_load` | Passive | Each Lio ability hit adds a spark to the target (expires after 4 s). On the 3rd spark: explosion on that target for magic damage byLevel 40→180 (+0.3 AP), +50 % against monsters; sparks reset. |
| `lio_q_end_burst` | Q | Hit-producer: the stone explodes at the first enemy hit or at max range; all enemies within 200 (ability `radius`) of the explosion take the damage. |
| `lio_w_next_auto` | W | Next-auto hook (3 s): the empowered attack applies the listed damage (40 + 0.3 AP magic). |
| `lio_w_reset` | W | If an enemy champion dies within 3 s of taking damage from Lio, W's cooldown is reset. |
| `lio_r_spark_rain` | R | Hit-producer: 5 stones hit the whole 400 circle at 0, 0.25, 0.5, 0.75 and 1.0 s; each applies the damage to enemies inside at that moment. An enemy hit for the 3rd time by the same cast is stunned for 1 s (once per cast). |

## Ottilie Wolfsrufer (`ottilie`)

| Hook | Slot | Behaviour |
|---|---|---|
| `ottilie_pack_hark` | Passive | Spawns the wolf Hark (pet) with Ottilie. HP = 300 + 60 per Ottilie level, damage = 50 % of her AD, attack speed 1.0, follows her and attacks her target. Dead Hark respawns after 30 s. Monster kills by Ottilie heal Hark for 15 % of its max HP. |
| `ottilie_q_hark_leap` | Q | On hit, Hark leaps (300 range from his position) onto the marked target and slows it by 50 % for 0.75 s; if Hark is farther than 300 he runs there first. Hark prioritises `ottilie_hunt` targets for 4 s. |
| `ottilie_w_scout` | W | Hark runs to the target point (up to 2000) and stays there for up to 6 s, granting vision (radius 800); he ignores enemies while scouting and returns afterwards. |
| `ottilie_e_retreat_shot` | E | Dash 300 away from the cursor; at the start fires a basic attack at the nearest enemy champion (else unit) in front within her attack range, dealing 130 % of a normal attack (applies on-hit). |
| `ottilie_r_hunting_call` | R | For 8 s Hark is enlarged: +100 % damage, +300 max and current HP, and his attacks slow by 30 % for 1 s. If Hark is dead, he respawns immediately. |

## Aurel Stundenwerk (`aurel`)

| Hook | Slot | Behaviour |
|---|---|---|
| `aurel_balance_wheel` | Passive | Internal 8 s timer: when ready, his next ability's castTime (and delay) is multiplied by 0.7; timer restarts on that cast. |
| `aurel_q_two_champions` | Q | The projectile passes through minions (they take damage) and stops after hitting its 2nd enemy champion. |
| `aurel_w_projectile_drag` | W | Enemy projectiles (autos and skillshots) inside the zone move 40 % slower. |
| `aurel_e_rewind` | E | Record Aurel's position each tick for 3 s. After the 0.5 s delay, teleport to the position from 3 s before the cast (if not walkable, nearest walkable) and heal 15 % of the damage taken during those 3 s. |
| `aurel_r_damage_after_stasis` | R | Timing exception: the generic damage is deferred until the 1.2 s stasis ends (stasis makes targets untargetable/invulnerable). |

## Corvin Pulver (`corvin`)

| Hook | Slot | Behaviour |
|---|---|---|
| `corvin_drum` | Passive | Ammo counter 6. Each basic attack uses 1 shot; the 6th shot deals +50 % damage; at 0 shots he reloads for 1.5 s (cannot attack). Reload refills to 6. |
| `corvin_q_double_shot` | Q | Hit-producer: two attack projectiles at the target 0.3 s apart; each applies the listed damage and on-hit effects and consumes 1 shot (if only 1 shot is left, the second is skipped). |
| `corvin_w_powder_keg` | W | Places a keg (targetable only by Corvin, 1 HP) at the target point for 3 s. When Corvin's basic attack hits it, it explodes: enemies within 300 receive the listed damage and slow (hit-producer). |
| `corvin_e_reload` | E | Adds 3 shots to the drum (max 6) and cancels an ongoing reload. |
| `corvin_r_volley` | R | Hit-producer: 6 bullets (speed 2400, width 50) spread evenly across the 25° cone, range 1200; each stops at the first unit hit (minions block) and applies the damage. |

## Lysa Nadel (`lysa`)

| Hook | Slot | Behaviour |
|---|---|---|
| `lysa_thread_run` | Passive | Consecutive basic attacks on the same target add a stack (max 8): +4 % attack speed each and +25 attack range per 2 stacks (max +100). Switching target resets the stacks. |
| `lysa_q_range` | Q | During Q (3 s) +20 attack range. |
| `lysa_w_first_champion` | W | The arrow passes through minions and monsters without effect and stops at the first enemy champion. |
| `lysa_e_tripwire` | E | Line geometry: a wire of length 500 (2 × radius) centred at the target point, perpendicular to the direction from Lysa, for 4 s. The first enemy champion crossing it receives the generic root; the wire then disappears. |
| `lysa_r_falloff` | R | After the 1 s delay the shot travels across the map (range 25000 = global). Each champion hit after the first takes 10 % less per champion already pierced (multiplicative, floor 50 %). |

## Tobin Sturmkiel (`tobin`)

| Hook | Slot | Behaviour |
|---|---|---|
| `tobin_sea_legs` | Passive | After a Tobin dash or blink ends (W, Flash), +20 % attack speed for 3 s. |
| `tobin_q_tether` | Q | The first enemy hit is tethered to Tobin for 2.5 s. If at the end of the tether it is more than 650 away from Tobin, it is rooted for 1 s. The tether breaks if Tobin dies. |
| `tobin_w_next_auto` | W | Next-auto hook (4 s): the empowered attack applies the listed 50 % slow for 1.5 s. |

## Wren Aschenflug (`wren`)

| Hook | Slot | Behaviour |
|---|---|---|
| `wren_embers` | Passive | Every Wren ability hit ignites the target for 3 s: magic damage per second byLevel 8→40 (+0.15 AP); refresh on re-application. Her basic attacks on burning targets deal +10 % damage. |
| `wren_q_next_auto` | Q | Next-auto hook (4 s): the empowered attack applies the listed magic damage and ignites (counts as an ability hit for `wren_embers`). |
| `wren_w_ash_carpet` | W | Line geometry: a 900 long (2 × radius), 200 wide strip from Wren in the cast direction for 4 s. Enemies inside get the zone slow and are ignited (`wren_embers`) once per second. |
| `wren_e_smoke_hop` | E | Dash 300 away from the cursor. Leaves a smoke cloud (radius 250) at the start position for 2 s that blocks vision into and through it for both teams. |
| `wren_r_firestorm` | R | Hit-producer: 5 arrows land on the whole 450 circle at 0, 0.5, 1.0, 1.5 and 2.0 s; each applies the damage to enemies inside and ignites them. |

## Mutter Hagen (`hagen`)

| Hook | Slot | Behaviour |
|---|---|---|
| `hagen_bell_toll` | Passive | Each Hagen ability cast adds a toll (max 3). At 3 tolls her next basic attack stuns its target for 0.5 s and clears the tolls; internal cooldown 10 s. |
| `hagen_r_storm_peal` | R | Aura radius 500 around Hagen for 4 s: enemies inside are slowed by 15 % per full second spent inside (15/30/45/60 %, refreshes while inside, 0.5 s linger). Allied champions inside get the listed tenacity (re-applied while inside). |

## Kiran Fadenleser (`kiran`)

| Hook | Slot | Behaviour |
|---|---|---|
| `kiran_foresight` | Passive | Every 15 s, if an invisible enemy champion is within 1800, show Kiran's team a thread pointing in its direction for 1 s (direction only, no reveal). |
| `kiran_q_sweetspot_root` | Q | If the hit point is more than 700 from the cast origin (last 300 of 1000), the target is rooted for 0.75/0.85/0.95/1.05/1.15 s (by rank). |
| `kiran_e_fate_link` | E | For 3 s while the ally stays within 1000: 20 % of all damage the ally would take is redirected to Kiran (after the ally's mitigation, Kiran's own resistances ignored). |

## Oda Brunnen (`oda`)

| Hook | Slot | Behaviour |
|---|---|---|
| `oda_spring_water` | Passive | Allied champions within 800 of Oda (including her) regenerate an extra 1 % max HP per 5 s. |
| `oda_q_ally_collision` | Q | The projectile also collides with allied champions (not Oda). If the first unit hit is an enemy, only the damage and slow apply; if it is an ally, only the `ally` heal applies. |
| `oda_e_cleanse_slows` | E | Removes all active slows from the targeted ally. |

## Sev Aschenblick (`sev`)

Spec: `docs/champions/sev.md` (Fassung 3). Module hooks: `onTick` (Gaze expiry, burning grounds, clone timer/autos,
Amaterasu jump, Tsukuyomi end, Susanoo slow immunity + recast close), `targetOk` (Tsukuyomi only on champions/dummies),
`ownsHits: ['sev_q', 'sev_w', 'sev_e', 'sev_r1', 'sev_r2', 'sev_r3']`. R is chosen once per match
(`ChampionData.ultChoices`, command `ultChoice`, bots: `botUltChoice` weights); `abilities[3]` is the placeholder.

| Hook | Slot | Behaviour |
|---|---|---|
| `sev_rabenblick` | Passive | Ability hits on champions/dummies add a Gaze stack (max 3, 6 s); at 3 a 0.75 s stun (`sev_genjutsu`), per-target cooldown 12 s (stacks stay capped meanwhile). Also: the W clone bursts when it takes any damage (`onPetDamaged`); during Susanoo autos sweep all enemies within 300 of the target (2nd damage effect of `sev_r2`). |
| `sev_q_fireball` | Q | Owned hits: on the first unit hit or at max range (phase `expire`) the fireball explodes (radius 300, 1st damage effect, Gaze) and leaves burning ground for 2 s (2nd damage effect per second, ticks every 0.5 s). |
| `sev_q_fake_cancel` | Q | Recast during the 0.4 s wind-up cancels (refund, 2 s cooldown). |
| `sev_w_crow_clone` | W | Blink 400 (flag `root_ok`: castable while rooted, not while stunned). Spawns the clone pet `sev_decoy` at the start position (Sev's HP/mana, snapshot `look`), retargets enemy homing projectiles flying at Sev to it. The clone bursts after 1.5 s or when hit: radius 350 damage + slow + Gaze. |
| `sev_e_bannblick` | E | Owned hits: after the 0.4 s eye contact, stun (data `stun`) if the target faces Sev (facing · direction to Sev > 0), else slow (data `slow`); Gaze. Visual gaze line during the wind-up. |
| `sev_r1_amaterasu` | R1 | Uncleansable dot (`sev_r1`, damage effect per second, ×1.4 vs champions) + grievous 40 % for 5 s; if the target dies burning the flames jump once (radius 400) with the remaining time; burning-ground visual. |
| `sev_r2_susanoo` | R2 | Self: generic shield; 6 s slow immunity and sword sweeps; recast window opens: instant sword thrust 1000 × 120 (1st damage effect) on every enemy in the line, once. |
| `sev_r3_tsukuyomi` | R3 | Suppress the target 1.5 s (+ mark `sev_r3_moon` = red-black tint on its HUD), root Sev as long; at the end damage incl. 25 % of the target's missing health. |

---
Total: 110 hook ids across 26 champions.
