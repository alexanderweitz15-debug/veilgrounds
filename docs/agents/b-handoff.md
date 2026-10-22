# Agent B handoff

- Branch: `sim/b-mechanics` (pushed, merged with origin/main at 3d48b5a). B1-B6 done, see b.md.
- Half-done: nothing in code.
- Next steps: (1) final full suite + bot-sim done (b.md); (2) B7 moved to agent D; (3) ranged hitbox 65 done; (4) answer C/D/A requests in
  shared-changes.md as they come.
- Waiting on others: C (minimap stealth symbol, TP slot F2/T + announcement, attack-move cursor setting, enemy items
  display, announce.ts for public grub kills), D (dash/air arcs, `flash` flag, atkStart/atkEnd, facing smoothing,
  ward render look), A1 (busyUntil for movesWhileCasting, `snapshotEntities`), A2 (top TP use, `epic`).
- Agent E adds the decoy entity, CC "Furcht" and `uncleansable` in sim (buffs/cc/snapshot): expect them on merge.
- Traps: Windows heredocs eat backslashes (use Write/Edit or a .py in the scratchpad); never `git checkout <file>`
  for mutation tests (reverted uncommitted edits once); tsc type-checks tests (no `process`); telegraph.test.ts and
  brainReflex cost test are wall-clock sensitive under load; many JSONs are CRLF; snapshots must stay read-only
  (memory like seenItems belongs in a system, never in buildSnapshot); worktree node_modules is a junction - delete
  with `(Get-Item path).Delete()`, and if a plain `node_modules/.vite` dir appears instead, remove only that.
