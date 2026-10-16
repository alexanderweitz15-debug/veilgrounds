# Agent B handoff

- Branch: `sim/b-mechanics` (pushed). Last code commit 09e8860 (b3), followed by a docs commit.
- Half-done: nothing in code. Verification open: full `npx vitest run` after B3, branch bot-sim
  (`npm run bot-sim -- --rank=gold --games=4 --minutes=20`, ~20 min under load) to compare with the base numbers in
  b.md. Base run is reproducible from `git archive 0bbc3d0` with a node_modules junction.
- Next steps in order: (1) run the two verifications above; (2) B4 Teleport for top: per-champion lane-minion gold
  counter (economy.ts gold on minion kill), unlock at 1500 for the lobby top laner, third summoner slot with
  Teleport cooldown 360->240, `tpUnlocked` event; UI slot/keybind request to C in shared-changes.md, bot use as
  issue for the brain team; (3) B5 items (dashing/airborne snapshot flags, Dagny Q castTime 0 + timer reset, hitFlash
  throttle, facing smoothing decision), (4) B6 Kesselbrut `epic` flag / radius, (5) B7 baked atlases (render is D's,
  coordinate), (6) B8.
- Traps: Windows shell heredocs eat backslashes (use Write/Edit or a .py file in the scratchpad); never
  `git checkout <file>` for mutation tests (it reverted uncommitted edits once); `tsc` type-checks tests too
  (no node types: no `process`); telegraph.test.ts times out under load only; many JSONs are CRLF.
- Agent E is adding champion "Sev" (decoy, CC "Furcht", `uncleansable`) - not B's work.
