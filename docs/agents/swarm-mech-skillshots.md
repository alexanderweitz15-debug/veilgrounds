# swarm: mech-skillshots

Branch `swarm/mech-skillshots`. Wrapped up early on coordinator order.

## Finding

Audit of `src/sim/systems/projectiles.ts` + `src/render/telegraph.ts`: the core already does what the task asks.

- Line skillshot = swept segment (prev -> new pos) vs unit circle of radius `unit.radius + width/2` (edge-to-edge, no tolerance). No tunnelling at any speed.
- Hits sorted by sweep parameter t (ties lower eid): first unit along the path, not nearest to caster.
- Minions only block with flag `blocked_by_minions` / `pierce`; otherwise ignored (champions + dummies only).
- Last step is clipped to max range; segment end counts, so a target edge touching max range hits.
- Telegraph (`telegraph.ts`) draws a strip of full `width` from A to B; sim uses `width/2 + radius`, same shape (telegraph shows projectile width, hit area additionally grows by target radius, like LoL).

No sim change made, so determinism is untouched. No shared-file edits (nothing to log in shared-changes.md).

## Added

`tests/skillshotHits.test.ts` (9 tests, pass, ~33 s wall): grazing hit/miss at exactly r, high-speed no-tunnel (pure sweep and in sim), edge hit by width offset, max range edge in/out, minion in front vs behind a champion, minions ignored without the flag.

## Open / not done

- Projectile speed/size vs LoL reference table not reviewed (no data changes).
- A unit overlapping the spawn point behind the caster is hit at t=0 (sweep start inside circle). Same as LoL for point-blank, left as is.
- Homing hit uses `d - radius <= step` (center-to-edge), fine.
- Per-champion width/speed tuning is a balance question, not touched.
