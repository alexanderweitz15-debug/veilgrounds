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
