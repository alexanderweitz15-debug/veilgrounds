# art-f-identity (continuation of agent F, branch art/f-identity-2)

Stopped early on the lead's wrap-up order. Done and NOT done are listed plainly.

## Done
- Branch = art/f-identity + merge of origin/main (atlas.ts stand-in kit fallback kept; CHAMP_MASTER 240, CHAMP_FRAME 152).
- The "WIP" last commit of art/f-identity was docs/screenshots only; F's code commits were already tested (963 passed on 53dbe53).
- Compile fix: src/render/champions3d/anim.ts ATTACKS / CASTS were `Record<AttackStyle|CastStyle>` and broke on F's 15 new
  attack styles and 6 new cast styles; now `Partial<Record<..>>` with fallback (thrust / forward). The 3D rig is unused by the 2D atlas.
- New champions on main (Fenna, Vargrim) had no motion spec and no cast family, which made tests/motion.test.ts and
  tests/casts.test.ts fail: added specs (motion.ts: fenna hover/flutter, vargrim gallop with hand-set cadence 10.7 fps) and
  cast families (casts.ts). Tests: gallop styles skip the cadence formula.
- motion.ts: GaitSpec got `drag`, `asym`, `impact` (defaults 0.35 / 0 / 1; not read by anim.ts yet), GaitStyle `gallop`;
  cadence is only computed when a spec does not set it.
- Checks: `npx tsc --noEmit` clean; motion / casts / abilityFx / spriteTiming tests: 4 files, 19 passed.
- Bake baseline (per-frame render at master 240, SE, 11 ids, shared CPU, noisy): 275 frames, 8803 ms, 32 ms/frame.
  Worker-pool bake of 10 champions: 104 s on the loaded machine (8192x4096 @152). No "after" measure: no atlas changes landed.

## Not done (open)
- anim.ts does not read drag / asym / impact yet (run cycles keep F's 11 gait styles; no new secondary motion).
- Idle 4 -> 6 frames, quadruped gallop for Vargrim (cavalry.ts poseOf) and Hark / Mooswolf (wolf.ts), Hark rate 14 fps.
  Plan: rotary gallop, footfall offsets HL 0, HR .10, FL .42, FR .52, stance fraction .34, suspension at t ~ .9.
- Camps / dragons in the gouache world: planned a baked-free ground blob (extra InstancedMesh with radial gradient in
  ChampionSprites, option on MONSTER_BATCH; sprite alpha test 0.5 rules out a baked soft shadow). Not started.
- No contact sheet screenshot this round (browser tab and lab server closed).

## Round 3 (branch art/f-identity-3, from main 70602b6)
Task 1 merge of art/f-identity-2: conflicts in championSprites.ts / groundObjects.ts resolved. Kept G's `castPoseActive`, distance-paced `runPh` (runRate), `intent` facing (intentFace) before `turnToward`, wind-up from atkStart/atkEnd, flinch 13; kept F's `dyn` springs; `runOff` dropped (redundant). groundObjects keeps both `drawFennaObject` and `drawAbilityObject` paths.

Task 2 (distinct, less stiff run cycles):
- anim.ts run now reads `drag` (shoulders/arms/head/cloth lag the legs by that phase), `asym` (right stride x(1+a), left x(1-a), plus a pelvis roll toward the short side) and `impact` (bounce = |sin|^impact: <1 light sharp landings, >1 flat heavy plants; head nod follows). Stride, lift, bob, lean, hipSway, roll, twist, arm swing, headBob, crouch, hop, sway were already read.
- motion.ts: every champion has its own (drag, asym, impact) triple (stompers .1-.2 / 1.4-1.9, sprinters .25-.5 / .7, floaters .6-.72 / .4-.55, aurel limps asym .22, tobin -.1, hagen -.12...). tests/motion.test.ts: triples unique, impact > 0, |asym| < .3.
- Gallop: `gallopFoot` / `gallopBody` in wolf.ts (rotary footfalls HL 0, HR .10, FL .42, FR .52, stance .34, airborne suspension around t .9, nose-up on the hind push, head dips over the front stance). Used by Vargrim (cavalry.ts, cadence 10.7 kept) and Hark / Mooswolf (drawWolf; run 6 -> 8 frames, rate 14).
- Idle 4 -> 6 frames (champions incl. Vargrim; weight settles in two beats via a second harmonic, Vargrim barrel rocks and haunches shift). Idle rate x1.25 so the breath loop is 1.5 s instead of 1.9 s (4 frames at the old rate was 1.25 s). Frame 0 stays the neutral pose (portraits, head anchor, bar height unchanged).
- Atlas cost: champion jobs 26 -> 28 frames per direction (+7.7 %), Hark 17 -> 19; ~+8 % per match atlas, inside the +20 % budget. 11 ids x 28 x 5 dirs = 1540 cells: fits 8192 / 152 (53^2 = 2809) without shrinking the cell. No wall-clock A/B taken (shared machine, 8 % job delta); the strip cache keys on the renderer-source hash (ART_VER), so stale 4-frame strips are not reused.
- Camps and epics (Leviathan, Schleierwaechter): soft contact-shadow blob (`groundBlob`: radial violet-black gradient, ground quad per sprite, depth of the feet a hair behind the sprite quad so it never paints over the legs). Not visually checked in a running game (no game tab, per the no-idle-tabs rule); contact sheet only.
- Contact sheet: docs/ist/f-run-sheet.jpg (E direction, idle 6 + run 8 for Kaelen, Brom, Aurel, Tobin, Lio, Vessa, Fenna, Vargrim, Hark).
- Checks: tsc clean; motion, casts, abilityFx, spriteTiming, readability, fennaKit, interp: 7 files / 36 tests green.
- Open: blob needs one look in a real game; attack / cast keys unchanged.
