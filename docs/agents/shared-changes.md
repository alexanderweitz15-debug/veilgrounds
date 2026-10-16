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
- Status: proposed (A3 owns the json files).

## Pre-authorised edits of src/ai/bot/brain.ts `laneLeaf` (A1, Phase 1)

| date | commit | change |
|---|---|---|
