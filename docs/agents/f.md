# Agent F "Champion-Identität" - report

Branch `art/f-identity` (from main 250a394). User feedback: "Die laufen alle gleich, die sehen alle langweilig aus, zu
wenige sind unique, zu wenige Abilities haben richtige Effekte und Animationen." + "Die Animationen fühlen sich und
sehen sehr steif aus ... Die Camps sehen scheiße aus sowie die Drachen etc., die passen nicht rein im Game."

## 1. Audit (before any change)

Evidence: contact sheets rendered with the atlas painter (`drawChampionFrame`, master 240, same code the bake uses),
all 27 champions side by side: `docs/ist/f-before-run.jpg` (run 0-7, SE), `f-before-idle.jpg` (idle 0-3, S),
`f-before-attack.jpg` (attack 0-4, SE), `f-before-cast.jpg` (cast gather/release/follow/flex, S),
`f-before-monsters.jpg` (epics, camps, plants, minions). In-game 1280x720 from the built game: `f-before-lane.jpg`,
`f-before-camp.jpg`, `f-before-drake.jpg`.

### 1.1 Why "they all walk the same" is literally true (code facts)

- `src/render/champions/anim.ts poseFor('run')`: one sinusoid for all 27. The only per-kit inputs are `kit.gait`
  (4 buckets: heavy x8, light x5, prowl x2, normal x12 -> stride 13/20/17, lift 8/13/11, lean 0.12/0.26/0.2) and
  `kit.hold` (where the arms are). Bob, hip sway, roll, head motion, twist, cloth sway are identical constants.
- `atlas.ts rateOf()` returns the same `CHAMP_FPS` for every champion: every run cycle plays at 14 fps whatever the
  champion's MS (340 Brom vs 350+ Kaelen) or body (Gorvam 210 world units vs Lio 112 px body). Cadence is not tied
  to movement (feet slide; A2 in docs/IDEAS-FEEL-SHOP.md, agent G).
- Idle: breath + 1.6 px weight shift + 0.03 rad roll for everybody; `guard`/`fists` holds get a 1.6 px bounce. No
  fidgets, no per-body idles (a hovering wraith, a tiny spark-folk, an old man on a cane and an ogre breathe the same).
- Attack: 11 styles for 27 champions, shared: `thrust` x4 (Thessaly, Oleth, Seraphyne, Isolde), `throw` x5 (Nyx,
  Lio, Gorvam, Kiran, Oda - identical overhand throw for a sling, a chain hook, a spindle and a water jug), `staff`
  x4 (Ilvane, Aurel, Ferris, Sev - Sev has no staff), `bow` x3, `rifle` x2, `bash` x2 (Dagny has a smith hammer),
  `slash` x2, `swipe` x2. Anticipation / follow-through exist (5 keys, smear on the hit frame) but no squash,
  stretch or settle: every frame switch is a hard cut and the figure never leaves its rest proportions.
- Cast: ONE cast style per kit for all four abilities (`forward` x11, `raise` x8, `slam` x4, `spin` x3, `ring` x1):
  Q/W/E/R of a champion are the same body motion; only `castKindOf` (directed / self / dash) picks which of the 4
  frames is shown. 19 of 27 champions share two poses.
- Runtime: `championSprites.ts` switches anims by resetting `t0` (run always restarts at the contact frame), no
  blend, no squash/stretch, no lean into the run direction; the hit flinch is a 9-unit offset only.
- Effects: `fx.ts missileStyle()` = one icosahedron blob (size/length by source kind, colour by motif hue) for every
  ability missile; cast = pulse ring + particle burst of the motif's particle kind; zones = flat disc + rim in team
  colour + ambient particles. Hook ground objects (walls, domes, tethers, smoke, storm, rain, peal, keg, rewind,
  seeds, traps, thread) fall through to 8 generic shapes in `groundObjects.ts`; only Sev has a per-ability module.

### 1.2 Champion table (1 = generic, 5 = unmistakable)

Walk / idle / attack judged from the sheets; "weak effects" = abilities whose whole visual is the generic
telegraph + hue + motif particles (no hook object or a hook object drawn by a generic shape).

| Champion | Body | gait / hold / attack / cast | Walk | Idle | Attack | Weak / generic effects |
|---|---|---|---|---|---|---|
| Ilvane | spider-folk, 4 back legs | normal / pole / staff / raise | 2 | 2 | 2 | Q thread bolt = blob, W web = disc, E dash, R cone: all generic |
| Thessaly | tall slender human | normal / port / thrust / forward | 2 | 2 | 3 | Q targeted (no missile look), W self, E cone light = generic sector, R execute |
| Kaelen | wiry human, crouched | light / guard / swipe / spin | 3 | 2 | 3 | Q bolt blob, W dash, E self ring, R targeted: generic |
| Renn | human, blade fan | normal / blade / slash / spin | 2 | 2 | 3 | blades = box on the ground (ok), Q/W/E/R generic |
| Aurel | old, hunched, belly | heavy / cane / staff / raise | 3 | 2 | 2 | Q bolt blob, W zone disc, E rewind = pin, R circle: generic |
| Seraphyne | athletic human | normal / overhead / thrust / raise | 2 | 2 | 3 | Q lightning = blob, W storm zone = disc, E blink, R strike = disc |
| Brom | treant, boughs | heavy / shoulder / chop / slam | 2 | 2 | 4 | Q whirl = disc, W self, E cone = sector, R targeted |
| Oleth | stone statue, banner | heavy / pole / thrust / slam | 2 | 2 | 3 | R walls = generic wall strip, W self disc, E dash line, Q targeted |
| Harrow | ram-folk, hooves, shield | heavy / shield / bash / slam | 2 | 2 | 3 | Q/W/E generic, R summon (banner) no object look |
| Isolde | human, glass arm | normal / blade / thrust / forward | 2 | 2 | 3 | dome = generic dome ring, wire = generic line, Q/W generic |
| Dagny | dwarf, kettle shield | heavy / shield / bash / forward | 2 | 2 | 2 (hammer unused) | E wall = generic wall, Q/W/R generic |
| Vessa | wolf-folk, digitigrade, tail | prowl / guard / swipe / spin | 3 | 2 | 3 | all four generic (Q pounce, W, E stalk aura ring, R dash) |
| Nyx | wraith, floats | prowl / guard / throw / raise | 3 | 2 | 2 | Q dagger = blob, W self, E dash, R veil = huge generic ring; seeds = disc |
| Grimald | bear-folk, giant | heavy / hook / slash / forward | 2 | 2 | 3 | traps = cross (ok), Q/W generic, E net = disc, R aura = ring |
| Lio | yordle-like, tiny | light / fists / throw / raise | 2 | 2 | 2 | Q spark bolt blob, W dash, E circle disc, R rain = generic circle |
| Ottilie | human + wolf Hark | normal / bow / bow / forward | 2 | 2 | 3 | Q arrow blob, W scout = pin, E dash, R self; Hark leap = pin |
| Mira | slim human, long bow | light / bow / bow / forward | 2 | 2 | 3 | Q self, W arrow blob, E dash, R volley = disc |
| Corvin | human, hat, pistols | normal / pistols / pistols / forward | 2 | 2 | 4 | keg = generic ring, Q targeted, E dash, R cone sector |
| Lysa | slim human, needle rifle | normal / rifle / rifle / forward | 2 | 2 | 3 | W thread shot blob, E tripwire = generic line zone, R blob |
| Tobin | sailor, harpoon gun | normal / rifle / rifle / forward | 2 | 2 | 3 | Q tether = generic line + ring, W dash, E circle, R wave = fat blob |
| Wren | raven-folk, talons, wings | normal / bow / bow / forward | 2 | 2 | 3 | W ash carpet = line zone, E smoke = disc, R storm = circle: generic |
| Ferris | thin human, lantern pole | normal / pole / staff / raise | 2 | 2 | 2 | Q light bolt blob, W/E targeted (nothing visible), R self circle |
| Gorvam | ogre, chain hook | heavy / hook / throw / slam | 2 | 2 | 2 (throw = Lio's) | Q hook = blob + strip, W self, E circle, R self circle |
| Hagen | old round human, yoke | heavy / yoke / ring / ring | 3 | 2 | 4 | Q bell = circle, W targeted, E dash, R peal = generic ring |
| Kiran | bald blindfolded human | normal / spindle / throw / raise | 2 | 2 | 2 | thread/link = generic line, Q blob, W disc, R circle |
| Oda | frog-folk, round, jug | light / jug / throw / raise | 2 | 2 | 2 | spring = generic ring, Q water bolt = blob, W zone disc, R wave = fat blob |
| Sev | pale, cloak, crows | light / palm / staff / forward | 2 | 2 | 2 | per-ability module exists (sevFx.ts); cast pose still generic |

Averages: walk 2.2, idle 2.0, attack 2.8. 96 of 108 abilities have no look of their own beyond hue + particle kind.

### 1.3 Monsters, camps, minions

| Sprite | Role | Frames (idle/run/attack/death @ fps) | Finding |
|---|---|---|---|
| Dornenbock / Glutwächter | buff golems | 3 / 4 / 3 / 3 @ 5/11/12/7 | read well, but attack = a 3-frame nod; no anticipation |
| Flussleviathan | drake | 3 / 4 / 3 / 3 | attack frames 1-2 shrink the body to ~40 % (lunge drawn down the cell) - looks broken; idle only sways |
| Schleierwächter | baron | 3 / 4 / 3 / 3 | imposing silhouette, stiff: 3 idle frames of a slow wobble |
| Sumpfunke, Hohlkäfer, Schattenkrabbe, Nebelschleicher, Kesselbrut, Mooswolf | camps | 3 / 4 / 3 / 3 | saturated glows (beetle `#8ee8d0`, crystal `#9a7ae0`) against research rule 3; idle = 3 nearly identical frames |
| plants | 2 / 0 / 0 / 2 | fine |
| minions | 4 / 6 / 4 / 3 @ 5/11/12/7 | same hard cuts, run restarts on every stop |
| scale | - | `CHAMPION_SCALE` 1.3 applies to champions only; `MONSTER_BATCH.scaleFor` 1 (camp members 0.56-0.6), minions 1.2 | the ratios in monsters.ts ("camps ~1.2x, drake 3.6x, baron 4.9x a champion") predate 1.3x: camps are now ~0.9x a champion, the drake ~2.8x |
| lighting | - | all three batches use `gouacheSprite` (same `ChampionSprites` class) | consistent; not the problem |

### 1.4 Baseline numbers (built game, vite preview, other agents on the CPU)

- Cold bake: champion atlas 1 champion 8192x512 @152 px 5259 ms; minion atlas 7645 ms; monster atlases 7033 ms.
- In-game: `docs/ist/f-before-lane.jpg` (Brom autos a dummy, Q whirl = blue disc + motes), `f-before-camp.jpg`
  (Glutwächter: ~1.4x Brom's height, not the 2x the drawer comments assume; the camp circle is a flat ring),
  `f-before-drake.jpg` (Leviathan ~2.3x Brom; serpent reads, pit is a bare ring on the water).

## 2. Plan (in order of impact; see f-handoff.md for the state)

1. Runtime dynamics layer (`src/render/spriteDynamics.ts`, pure): squash/stretch + lean per instance on anim
   changes, hit, attack strike, cast release; run phase carried over instead of restarting. Hits champions, minions
   and monsters at once.
2. Per-kit motion data (`src/render/champions/motion.ts`, canvas-free): gait + idle spec per champion, run cadence
   per champion (`atlas.rate`).
3. Attack styles split (hammer, sling, chain, spindle, ladle, palm, cane, lantern, snap-bow, hip-harpoon).
4. Cast poses per ability: 2 families per kit (6 cast frames), slot -> family.
5. Effects: motif-shaped missiles, hook ground objects drawn per tag (`abilityFx.ts`).
6. Monsters: scale factor, epic attack/idle frames, camp glow palette; camp sites.
