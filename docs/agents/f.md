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

## 2. Plan (in order of impact)

1. Runtime dynamics layer, 2. per-kit motion data, 3. attack styles split, 4. cast poses per ability,
5. effects (motif-shaped missiles, hook objects per tag), 6. monsters (scale, epic frames, glows), 7. camp sites.
1-6 done, 7 open (see f-handoff.md).

## 3. Done (commits on art/f-identity)

### 3.1 Motion: gaits, idles, cadence, springs (0c618b1)

- `src/render/champions/motion.ts`: GaitSpec + IdleSpec per champion (11 gait styles: stride, sprint, march, stomp,
  shuffle, waddle, stalk, skip, swagger, glide, hover; 11 idle styles: breathe, heave, bounce, rock, scan, poise,
  still, hover, preen, tick, sway). `anim.ts` reads them for every run/idle pose; `atlas.rateOf` carries the run
  cadence and the idle tempo per id (`cadence = MS / (2 x stride x 1.78) x 4`, clamped 9..22 fps: Gorvam 14.5,
  Grimald 15.9, Kaelen 16.2, Brom 17.4, Thessaly 17.1, Lio / Dagny / Hagen / Oda 22 - small bodies take quick
  steps, big ones long slow ones). Before: 14 fps and one sinusoid for all 27.
- `src/render/spriteDynamics.ts`: two damped springs per instance (vertical squash/stretch, volume-preserving, and
  a roll around the view axis), kicked on run start (stretch + lean into the direction), run stop (settle squash),
  melee strike (squash + lean to the target), ranged release (recoil), cast release (pop), hits (squash away from
  the source) and about-faces; clamped to 22 % / 0.3 rad so bars and picking stay put; shadow quad unscaled;
  reduce-motion x0.3; monsters x0.6. The run cycle keeps its phase across stops (`runOff`) instead of restarting
  at the contact frame. Cost: one spring step per drawn instance (< 0.05 ms for 24 champions).
- Evidence: `docs/ist/f-before-run.jpg` vs `f-after-run.jpg` (all 27, SE), `f-after-run-closeup.jpg` (E, 160 px:
  Kaelen's crouched sprint, Lio's skip, Gorvam's stomp, Hagen's waddle, Vessa's stalk, Nyx's glide, Aurel's shuffle,
  Oda's hop), `f-before-idle.jpg` vs `f-after-idle.jpg`, `f-after-strip.jpg` (built game, Oleth run -> stop ->
  wind-up, 75-110 ms apart).

### 3.2 Attack styles (bbfb19c)

- 15 new `AttackStyle`s so the shared pools are gone: hammer (Dagny), sling (Lio), chain (Gorvam), flick (Kiran),
  ladle (Oda), palm (Sev), cane (Aurel), lantern (Ferris), snap (Wren), longbow (Mira), harpoon (Tobin), spear
  (Seraphyne), lance (Thessaly), heave (Grimald), pounce (Vessa). Remaining shared: bow (Ottilie), thrust (Oleth,
  Isolde), slash (Renn), swipe (Kaelen), bash (Harrow), staff (Ilvane), throw (Nyx) - each now the only user of
  its hold + style combination. Smear table extended (hammer, heave, pounce arcs; cane, lance, spear stabs).
- Evidence: `f-before-attack.jpg` vs `f-after-attack.jpg`, `f-after-attack-new.jpg` (the 15 at 120 px).

### 3.3 Cast poses per ability (bbfb19c)

- `src/render/champions/casts.ts`: two cast families per champion, A (gather, release, follow) and B (gather,
  release) + the shared flex = 6 cast frames (was 4, +10 cells per champion). Slot -> family from the ability type
  (skillshots draw / push, ground circles lob, cones sweep, self AoEs stomp, dashes lunge, targeted spells point;
  6 new cast styles). `ChampionSprites.onCast` takes the slot (world.ts), `castFrame` picks the family; self
  abilities play their family's release when it is a self pose, else the flex.
- Evidence: `f-before-cast.jpg` (one pose per champion) vs `f-after-cast.jpg` (A | B | flex).

### 3.4 Effects (53dbe53)

- `src/render/missileStyles.ts`: shape per motif (length, thickness, width, height, halo, spin, tumble) applied in
  `fx.ts`: arrows long and thin, bolts crackle (roll), waves wide and flat near the ground, kegs / bells / hooks
  tumble, blades spin flat, webs and whorls are spinning discs, fire and light fat with a big halo.
- `src/render/abilityFx.ts`: 18 hook tags with their own drawer (Oleth stone slabs standing on the line, Dagny
  kettle wall with a hot seam + steam, Isolde glass cage + copper wire with running sparks, Tobin knotted rope,
  Wren smoke puffs / firestorm columns, Lio spark rain, Hagen bell ripples, Grimald claw aura, Nyx veil wisps +
  shadow seeds, Corvin keg barrel + fuse, Kiran yarn, Aurel backwards clock, Ottilie paw print, Oda ripples).
  Not done: a module per champion like sevFx.ts for the 70+ abilities whose whole visual is telegraph + missile +
  particles; they now differ by missile shape, particle kind, hue, cast pose and cast burst, not by bespoke art.
- Evidence: `f-before-lane.jpg` (Brom Q: disc + motes) vs `f-after-lane.jpg` (Oleth R: standing wall slabs).

### 3.5 Monsters (74fe701)

- `units.ts`: monsters drawn x1.3 like the champions (camps 1.2-1.7x, buffs 2.7x a champion again), Leviathan 1.2,
  Schleierwächter 1.15. Epics: 4 idle frames (sway, breath, jaw) and 4 attack frames (rear up, coil, STRIKE on
  frame 2, recover; the Leviathan's head now drives forward instead of folding down into the coils). Beetle and
  crab glows one gouache step calmer.
- Evidence: `f-before-camp.jpg` / `f-after-camp.jpg` (Glutwächter 1.4x -> 2x Oleth), `f-before-drake.jpg` /
  `f-after-drake.jpg`, `f-after-epics-closeup.jpg`.

### 3.6 Numbers

- Bake (built game, cold, other agents on the CPU): champion atlas 1 champion 1153 ms (before 5259 ms - the before
  number was taken under heavier load; cells per champion 120 -> 130, +8 %), minion atlas 4422 ms (before 7645),
  monster atlases 12665 ms (before 7033: +8 epic cells x 5 dirs at 200 px, and load). Atlas 8192x512 @152 px for one
  champion; ten champions at 152 px = 1300 cells = 8192x4096 (fits on an 8192 GPU; 4096 GPUs drop to 112 px as before).
- Frame time with the springs, 1280x720, sandbox: 4.28 ms/frame (`__vg.frame` x120) -> 60 FPS holds.
- Tests: tests/motion.test.ts (6), casts.test.ts (4), abilityFx.test.ts (3); full suite 963 passed, 82 files.
