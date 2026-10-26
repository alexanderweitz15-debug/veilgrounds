# Agent F handoff

- Branch: `art/f-identity` (from main 250a394), pushed. Nothing uncommitted.
- Done (docs/agents/f.md §3): audit; per-champion gaits + idles (motion.ts) with run cadence from MS; runtime
  squash/stretch/lean springs (spriteDynamics.ts, all three sprite batches); 15 new attack styles; two cast
  families per champion (cast anim 6 frames, slot -> family, onCast takes the slot); missile shapes per motif;
  per-tag drawer for 18 hook ground objects (abilityFx.ts); monsters at champion scale, epic idle/attack frames.
- Not done: camp sites in terrain.ts (lairs); per-champion effect modules beyond Sev (motif-level only); minion
  frame counts unchanged (they get the springs); the cast release pose while moving is agent G's A1.
- Merge with agent G (feel/g-shop, championSprites.ts/anim.ts): my changes there are small and local - `push()`
  spring kicks + run phase carry (`a.runOff`), `draw(..., dyn, now)`, `castFrame(c, ms, n, id)`, `onCast(..., slot)`.
  G's A2 (run rate from MS in the snapshot) should multiply `atlas.rate[id].run` (= cadence at base MS) by
  `ms / MS[id]`, not replace it.
- Tuning knobs: `motion.ts` SPECS (amplitudes per champion), `spriteDynamics.ts` KICKS / K_Y / K_L / MAX_Y,
  `casts.ts` CAST_FAMILIES, `missileStyles.ts` BY_MOTIF, `abilityFx.ts` per tag, `units.ts` EPIC_SCALE.
- Evidence pipeline: dev server 4393 + `node tools/scratch/shotServer.mjs` (from the worktree), in the page
  `await import('http://localhost:4393/tools/scratch/fsheet.js')` then `__sheet(ids, ['run'], 'SE', 88, name, label)`
  for contact sheets; built game via `vite preview --port 4396` + `?bench` + dshot.js (`__dsetup('(Schwester|Sister) Oleth')`
  - the regex runs on the card title). The browser pane must have a size: `resize_window 1280x720` + `dispatchEvent(resize)`,
  otherwise the canvas is 0x0 and `toDataURL` returns `data:,`. Close the tab and stop the servers after every capture.
- Tests: tests/motion.test.ts, casts.test.ts, abilityFx.test.ts (all < 1 s). Full suite 963 passed on 53dbe53.
