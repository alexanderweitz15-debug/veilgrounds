# Shared-file change proposals

Format: date, agent, file, change, reason, status (proposed / approved / merged + commit).

## 2026-10-16 A1: rank profile fields for the reflex layer (src/data/bots/profiles/*.json, src/ai/profiles/schema.ts)

- Change: add optional numeric `RankBehavior` fields `planHorizonS`, `windowPrepPct`, `standHysteresis`,
  `orbwalkPct`, `harassPerMin`, `harassCsWindowPct` (values per rank: §4.7 of BRAIN-REWORK, interpolated for the
  ranks in between, table in docs/agents/plan-api.md §6). Bronze/Silver/Platinum/Emerald/Master/GM linear
  between the §4.7 anchors.
- Reason: §1 "nothing hard-coded that can be a rank parameter". A1 reads them via `reflexParams(ctx)` with the
  same values as defaults, so nothing breaks before A3 merges the data. `profileAt` interpolation is generic
  (lerpRecord over keys of the lower anchor), so the fields must be present in all ten json files.
- Status: approved by S (review-2026-10-16, finding 4) and lead decision (a): A1 added the six new fields to all ten
  profile JSONs and `RankBehavior` in schema.ts on brain/a1-reflex (values: §4.7 anchors Iron/Gold/Diamond/
  Challenger, linear in between). A3: keep your attention fields additive next to them.

## 2026-10-16 A1: F9 overlay row extension (src/ai/log.ts BotDebugRow, src/ui/botDebug.ts - A3)

- Change: `BotRunner.debugRows()` now returns `BotDebugRow & { reflex: ReflexDebug }` (`ReflexDebug` in
  src/ai/plan.ts: `intent`, `plans[]{kind,targetId,inTicks}`, `util30s`, `stand`). A3 mirrors the field in
  log.ts / botDebug.ts and renders it (intent, top plans with countdown, utilisation of the last 30 s).
- Status: A1 side done (lead decision b); A3 side open.

## 2026-10-16 A1 -> agent B: lite snapshot (src/sim/snapshot.ts)

- Change: `buildSnapshot(sim, team, slot, { lite: true })` that skips visuals, HUD extras, ground objects, audio and
  score rows (entities with the fog rule + own HUD + events only). Measured: full buildSnapshot 0.76 ms per call
  under load; the reflex layer needs one view per team and tick.
- Reason: today the runner builds the reflex view itself (`BotRunner.buildTeamEntities`, same fog rule
  `own || structure || alive && sees()`), which duplicates the entity field mapping of buildSnapshot. An official
  lite variant would keep one source of truth for the snapshot fields.
- Status: proposed (not blocking; the runner copy works and goes through onPerceive).

## Pre-authorised edits of src/ai/bot/brain.ts `laneLeaf` (A1, Phase 1)

| date | commit | change |
|---|---|---|
