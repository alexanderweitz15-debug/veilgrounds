# Orchestration of the brain rework (docs/BRAIN-REWORK.md)

Deviation from §12, forced by the tooling: sub-agents cannot spawn or restart other agents and do not share the
main checkout. Therefore:

- The lead session (main Claude Code session) spawns A1/A2/A3 (Opus 5.5, each in its own git worktree on
  `brain/a1-reflex`, `brain/a2-utility`, `brain/a3-humanize`) and the supervisor S (Fable 5.1).
- S reviews branches, measures gates (in its own clean worktree), writes review files, DECISIONS entries,
  status.md and handoff files. S does not merge; it writes a merge recommendation into status.md.
- The lead merges to `main`, pushes (Pages deploy), and restarts stopped agents from their handoff file.
- Shared files (src/ai/bot/types.ts, src/ai/bot/brain.ts, src/data/bots/tree.json, src/ai/bt/**, snapshot types in
  src/sim/**): proposals go to shared-changes.md. Pre-authorised exception for Phase 1: A1 may edit `laneLeaf`
  (and only the lane-farming code path) in src/ai/bot/brain.ts, because §11 Phase 1 requires laneLeaf to use the
  scheduler. Every such edit is listed in shared-changes.md with commit hash.
- Agents push their branch after every commit (agents died at the usage limit before; pushed work survives).

## Annex §13 pre-check (lead, 16 Oct 2026)

- Ward fog: the sim already hides enemy Schleierwards (`invisible` stat buff on spawn, `sees()` skips invisible
  units, `buildSnapshot` only emits visible entities). Covered by tests/summonersWards.test.ts
  "Schleierward is invisible to enemies". Not a brain blocker; if the user still sees enemy wards in game it is
  a render/spectator issue, tracked separately.
- Snapshot fields already public and present for every visible entity: `atkPhase`, `atkTarget` (= minion and
  tower target choice), `atkStart`/`atkEnd`. Plate count is derivable from tower HP (fixed public break
  thresholds in src/sim/systems/towers.ts). No sim change needed now.
- Minion death events carry `killer`, `killerKind`, `killerTeam`, x/y (src/sim/damage.ts) - enough for
  csLossByCause in the headless bot-sim (which has full sim access; the brain itself must not).

## Second prompt: docs/AGENTS-PLAN.md (agents B, C, D)

- Running now: A1, A2, A3, B (sim/b-mechanics), C (ui/c-features) + supervisor S (same instance for both prompts).
  D (art/d-visuals) starts when a worker slot frees (AGENTS-PLAN §1/§8). CPU on this machine is the real limit.
- Scoreboard / death timers / TP: the lead had started reading for them; they now belong to C (C2) and B (B4).
- B1 note: the sim already hides enemy Schleierwards (see annex pre-check above). B must reproduce what the
  user sees (render, minimap, ward events, spectator/bot snapshots, buff expiry) before changing the filter, and
  unify traps/seeds/wire under one stealth flag as asked.
- Tests live in tests/ (there is no tests/sim/ yet; B may create it).
