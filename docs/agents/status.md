# Agent status (both prompts: docs/BRAIN-REWORK.md, docs/AGENTS-PLAN.md)

Updated 2026-10-16 by S (supervisor). main = 0bbc3d0. Measured means measured by S; everything else is what the
branch shows. Nothing is merged yet; no gate has been measured yet.

| Agent | Branch | Phase / package | Gate | Pushed commits | Key numbers | Blockers | Next |
|---|---|---|---|---|---|---|---|
| A1 Reflex & Laning | brain/a1-reflex | 0 (measurement base) + plan API | not measured | 1 (98c13c7: docs/agents/plan-api.md + profile-field proposal) | none yet; before-numbers from DECISIONS "Spieltempo": Gold CS/min@15 2.83, kills ~34, first tower 18.1 | none | Phase 0 metrics + `--report`, lane-alone scenario per rank; answer review findings 1-3, 5 |
| A2 Utility & Macro & Combat | brain/a2-utility | 3 prep behind `BOT_UTILITY=1` | - | 0 (branch not on origin, worktree clean at cc3eecc) | - | switches on only after A1 Phase 2 is on main | values.json, utility scaffold, intent subtrees; propose trade-disengage intent kind in shared-changes.md |
| A3 Humanize & Rank | brain/a3-humanize | 5 prep (attention model, overlay) | - | 0 (branch not on origin, worktree clean at cc3eecc) | - | tuning (Phase 6) waits for A2 Phase 4; overlay row type needs A1 (review finding 6) | attention.ts, overlay extension, add the seven reflex profile fields if the lead assigns them to A3 |
| B Sim & Mechanics | sim/b-mechanics | B1 ward stealth, B2 cast audit, B3 snapshot fields (hard deps for A1 Phase 2) | - | 0 (branch local only) | - | B1: sim already hides enemy Schleierwards in tests - must reproduce the user-visible leak first | B1 -> B2 -> B3, each with tests; shared-changes entry for snapshot type changes before merge |
| C UI & Features | ui/c-features | C1 FEATURE-GAP audit, then C2 scoreboard / death timers | - | 0 (branch local only) | docs/FEATURE-GAP.md does not exist yet | C2 style scales / post-game error list wait for A3 log format | C1 audit (full start list), C2 |
| D Visuals & Trainer | art/d-visuals | not started (waits for a free slot) | - | - | - | slot | C collects D items in FEATURE-GAP |
| S Supervisor | - | checklist, plan-api review | - | docs only (lead commits) | - | - | measure Phase 0 baseline when A1's `--report` commit is pushed |

## Today

- Written: docs/agents/review-checklist.md (per-gate checklist, both prompts), docs/agents/review-2026-10-16.md
  (plan-api review: usable, 6 findings, 2 need the lead), this file.
- Not done on purpose: no full `npm test`, no bot-sim (CPU shared with five agents); no gate measured because no
  candidate exists.

## Decisions needed from the lead / user

1. Who adds the seven §4.7 reflex fields to the ten profile JSONs + schema.ts: A1 in the Phase 1 branch (S recommends,
   avoids code defaults) or A3.
2. Overlay plumbing A1/A3 (review finding 6): fix the `BotDebugRow` extension now via shared-changes.md.
3. Static fog guards and `L_NODES` do not cover `src/ai/reflex`, `plan.ts`, `utility`, `humanize`: S extends them as
   a supervisor fix (< 30 lines) before the first brain merge, unless the lead prefers A1.
4. A1 must deliver a rank-parametrised lane-alone scenario (real brain) in Phase 0/1, otherwise the Phase 1 gate
   (Iron >= 70 / Gold >= 88 / Challenger >= 100) cannot be measured.
5. Browser check after C/D merges: no Playwright in the repo. S can use the built-in browser pane on `vite preview`;
   adding Playwright would be a package.json change (supervisor-owned) - choose one.
6. A2, A3, B, C have not pushed; `origin/<branch>` resolves only after `git push -u origin <branch>`. Confirm the
   agents are running.
7. Phase-1 acceptance threshold: main's tests/phase1.test.ts says scripted last-hitter >= 60, AGENTS-PLAN B8 says 73.
   Which one is binding for B merges?

## Questions for the user (collected, asked once a day)

- none yet

## Lead decisions (16 Oct, on S review-2026-10-16)

1. The seven §4.7 reflex profile fields: A1 adds them to the ten profile JSONs + schema in Phase 1 (additive, approved). A3 adds its attention fields to the same files later; rebase is additive.
2. Debug row: A1 owns the `ReflexDebug` type in src/ai/plan.ts and fills it in runner debug rows; A3 adds an optional `reflex?` field to `BotDebugRow` (log.ts) with a structural type matching docs/agents/plan-api.md and renders it in botDebug.ts. No cross-branch imports before merge.
3. S extends the static fog guards and `L_NODES` to src/ai/reflex, plan.ts, utility, humanize as a supervisor fix before the first brain merge.
4. A1 delivers a rank-parametrised lane-alone scenario that runs the real brain (Iron/Gold/Challenger) for the Phase 1 gate.
5. Browser check after C/D merges: built-in browser pane on `vite preview` for now; no Playwright dependency yet.
6. A2/A3/B/C were spawned minutes before the check (reading phase); verify pushes at the next status pass.
7. tests/phase1.test.ts keeps 60 as the hard floor; B's report must show the measured value (>= 73, AGENTS-PLAN B8).
