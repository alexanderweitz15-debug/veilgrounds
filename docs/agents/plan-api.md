# Plan API and reflex layer (A1, brain rework §3 / §4.1 / §4.2)

Status: interface contract, published before the implementation (16 Oct 2026). A2 and A3 build against this
file. Implementation lands on `brain/a1-reflex` in `src/ai/plan.ts` and `src/ai/reflex/**`. If the code has to
deviate, this file is updated in the same commit and the change is listed at the bottom ("Changes").

## 1. Where it runs

```
BotRunner.tick(sim)                       // every sim tick (30 Hz)
  per bot, in slot order:
    snap = buildSnapshot(sim, team, slot)  // same fog-filtered snapshot as think
    if decision due:
        clearIntent(mem)                   // intents live for exactly one decision
        actions = think(snap, ctx, mem, rng)   // rank cadence 2-8 Hz, unchanged tree
    actions += reflex(snap, ctx, mem, rng, tickEvents)  // every tick, all ranks
```

- `reflex` never forms a new intention. It executes the intent the latest decision set (section 4), runs the
  plan queue, the attack scheduler, the per-tick last-hit planner, the per-tick stand point and the orbwalk move.
  It may interrupt only for survive/dodge (a plan is then dropped with `overridden_by_dodge`).
- Rank differences in execution come only from reaction time, timing error and error injection (profile values),
  never from the tick rate: reflex runs every tick for every rank.
- Determinism: reflex uses the bot's own seeded `Rng` (same stream as think), bots are processed in slot order,
  no `Math.random` / clocks. Perception modules (clouds, gank risk) are still updated only in think.
- Cost target: < 0.05 ms per bot per tick (measured in bot-sim `reflexCostMs`, test 11).

## 2. Plan type (`src/ai/plan.ts`)

```ts
export type PlanKind =
  | 'lastHit'       // auto that kills a minion inside its kill window
  | 'prehit'        // auto before a tower shot so the next auto kills (tower farming, §4.2)
  | 'prepare'       // auto that pulls two overlapping kill windows apart (Platinum+, §4.2)
  | 'spellLastHit'  // damage ability for a minion the auto cannot get
  | 'orbwalkMove';  // move after the hit point (backswing), §4.4

export type CancelReason =
  | 'minion_died'          // target dead or out of sight before the command went out
  | 'prediction_drift'     // re-predicted window no longer contains executeAtTick (+ wind-up + travel)
  | 'out_of_range'         // target cannot be reached by executeAtTick (walk + wind-up + flight)
  | 'overridden_by_dodge'  // survive / dodge / retreat took over (mem.cancelTags 'orb' or 'lh', or a dodge move)
  | 'intent_changed'       // the decision no longer asks for lane farming (trade, recall, roam ...)
  | 'distracted'           // attention window (A3, §9): the plan is not executed, the minion is missed
  | 'expired';             // validUntilTick passed without execution (should be rare; logged as a bug signal)

export interface Plan {
  /** Per-bot increasing id (log / overlay reference). */
  id: number;
  kind: PlanKind;
  /** Entity id of the target (minion / champion / structure); -1 for orbwalkMove. */
  targetId: number;
  /** Tick at which reflex issues the command; the own wind-up starts at executeAtTick + 1 (sim convention). */
  executeAtTick: number;
  /** Drop the plan (reason 'expired') if it was not executed by this tick. */
  validUntilTick: number;
  /** Checked by reflex every tick; any false -> cancel with the mapped reason (section 3). */
  preconditions: Precondition[];
  /** Tags that cancel the plan when a node puts them into mem.cancelTags ('lh' for all farm plans, 'orb'). */
  cancelTags: string[];
  /** Command issued at executeAtTick. */
  cmd: Command;
  /** Tick the plan was created and the timing error rolled at creation (ticks, kept while validating: a human
   *  does not correct his timing error in flight; a re-plan after prediction_drift rolls a new one). */
  createdTick: number;
  biasTicks: number;
  /** Predicted kill window [a, b) in recorded ticks at creation and at the latest validation (lastHit / prehit). */
  window?: { a: number; b: number };
}

export type Precondition = 'targetVisible' | 'targetAlive' | 'inWindow' | 'reachable' | 'notBusy' | 'intentFarm';
```

Plans are plain data (no closures), so they can be logged, shown in F9 and compared in replays.

## 3. Queue behaviour

Per bot one `PlanQueue` in the reflex state (section 5):

- Ordered by `executeAtTick`, ties by `id` (deterministic).
- At most one `lastHit` / `prehit` / `spellLastHit` plan for the next minion, plus at most one `prepare` plan.
  Planning ahead to the rank horizon (Iron 1 s ... Diamond+ 3 s, §4.7) only decides *which* minion is next and
  where to stand; the plan for the following minion is created after the current one executed or was dropped.
- Every tick, before anything is executed, every plan is validated:
  1. target alive and visible, else `minion_died`;
  2. window re-predicted with `lasthit.ts`; if `executeAtTick + windup + flight` (incl. the kept `biasTicks`)
     falls outside the new window -> `prediction_drift`, re-plan at once (same tick, new bias roll);
  3. walk + wind-up + flight from the current position no longer fits before the window end -> `out_of_range`;
  4. `mem.cancelTags` contains one of `cancelTags`, or survive/dodge issued a move -> `overridden_by_dodge`;
  5. the current intent does not allow farming -> `intent_changed`; attention model says distracted ->
     `distracted` (the plan is dropped, not delayed: the minion is lost unless a new window opens).
- Every cancel writes one decision-log entry: `node: 'reflex', chosen: 'lh_cancel', reason: <CancelReason>`,
  inputs `{ plan, kind, target, executeAt, a, b }`.
- A plan whose `executeAtTick <= tick` is executed in that tick: its `cmd` is returned by reflex, the plan moves to
  the "issued" list for the overlay (kept 1 s) and the attack scheduler treats the attack timer as taken.
- The old runner delay queue stays only for the commands of non-lane nodes (reaction delays of trades, dodge,
  kite moves). Lane last hits no longer use `delay` / tag `'lh'` (laneLeaf puts no delayed attacks into it).
  `mem.busyUntil` stays: while busy (own cast wind-up / channel) reflex issues nothing but keeps plans that are
  still valid afterwards.

## 4. Intent hook (what think tells reflex)

```ts
export interface LaneIntent {
  kind: 'laneFarm';
  lane: LaneName;
  /** Wave state of the decision (§4.5): decides the allowed filler targets. */
  wave: 'push' | 'neutral' | 'slowPush' | 'freeze' | 'hold';
  /** Filler permissions resolved by the decision (wave state, gank-risk tier, support without farm). */
  farm: boolean;          // last hits allowed (support next to its ADC: false)
  pushMinions: boolean;   // filler autos on minions allowed
  hitStructures: boolean; // filler autos on towers / inhibitors / nexus allowed
  harass: boolean;        // champion filler allowed (Phase 2, §4.3 budget / aggro checks run in reflex)
  /** Stand-point inputs; reflex recomputes the point every tick from the live wave. */
  behind: number;         // distance behind the wave contact point
  side?: Pt;              // support: offset point next to the ADC instead of the lane stand point
  setTick: number;
}

setIntent(mem, intent: LaneIntent): void      // laneLeaf calls this; other leaves do not
getIntent(mem): LaneIntent | null            // null = reflex only validates/cancels plans, issues nothing new
clearIntent(mem): void                        // runner, before every think()
```

- The runner clears the intent before each decision, so the intent is exactly what the latest decision chose.
  If the tree picks trade / recall / roam / retreat, there is no lane intent and reflex stops filling within the
  same tick (open plans are dropped with `intent_changed`).
- A2 (utility): the Farm intent keeps calling the existing `lane` leaf (laneLeaf), which sets the lane intent.
  Other intents (Trade, Harass-Poke, Push/Plates, Roam ...) do not set it; when A2 needs reflex filling during a
  trade disengage (§6.1), a further `kind` value is added here first (proposal in shared-changes.md).

## 5. Reflex state and what A2 / A3 may read (`src/ai/reflex/state.ts`)

The reflex state is kept outside `BotMemory` (no shared-file change): a `WeakMap<BotMemory, ReflexState>`.

```ts
reflexState(mem): ReflexState   // creates on first use
interface ReflexState {
  intent: LaneIntent | null;
  plans: Plan[];                       // active plans, ordered (section 3)
  issued: { plan: Plan; tick: number }[]; // executed in the last second (overlay)
  /** Attack utilisation window: ring buffer of the last 30 s (900 ticks), one bit per tick
   *  "own wind-up or attack cycle running"; `util30s(state, tick)` = share 0..1. */
  util: Uint8Array; utilIdx: number;
  stand: Pt | null;                    // current stand point (per tick)
  lastCmdTick: number;                 // tick of the latest command (think or reflex) - idle detection
  harass: { autos: number[] };         // ticks of harass autos (Phase 2 budget, last 60 s)
  cost: { reflexMs: number; ticks: number }; // perf accounting (bot-sim)
  attention?: AttentionProbe;          // A3 hook, see below
}
reflexDebug(mem, tick): { intent: string; plans: { kind; targetId; inTicks; reason? }[]; util30s: number; stand: Pt | null }
```

- A3 (F9 overlay): call `reflexDebug(mem, tick)` per bot; plans with countdown = `inTicks`; attack utilisation
  of the last 30 s = `util30s`. Read-only.
- A3 (attention, §9): set `reflexState(mem).attention = (tick) => { distracted: boolean; reason?: string }`
  (pure function of the bot's own attention state; must not consume the bot's rng inside reflex). While
  distracted reflex drops due last-hit plans (`distracted`), pauses the harass filler and keeps the scheduler
  attacking the last target (§9: "er klickt falsch"). Until A3 sets it, nobody is distracted.
- A2 (utility): read `reflexState(mem).util` / `reflexDebug` for "minions in reach being farmed", and the next
  last-hit plan (`plans[0]`) for the Farm value; do not mutate plans. To stop reflex, just do not set the intent.

## 6. Rank parameters reflex reads (proposed additive profile fields, A3 owns the json)

Read through `reflexParams(ctx)` with defaults from §4.7 (interpolated by skill), so reflex works before A3
merges profile data. Proposal entered in docs/agents/shared-changes.md.

| field (RankBehavior) | Iron | Gold | Diamond | Challenger | meaning |
|---|---|---|---|---|---|
| lastHitJitterMs (exists) | 220 | 110 | 60 | 35 | σ of the plan timing error |
| planHorizonS | 1.0 | 2.0 | 3.0 | 3.0 | how far ahead last hits are planned |
| windowPrepPct | 0 | 30 | 80 | 100 | chance to pull two overlapping windows apart |
| standHysteresis | 220 | 150 | 100 | 90 | new move only when stand point moved further |
| orbwalkPct | 20 | 55 | 85 | 97 | orbwalk chance at kiting axis 0 (axis shifts it) |
| harassPerMin | 2 | 6 | 10 | 12 | harass auto budget (aggression axis ±3) |
| harassCsWindowPct | 0 | 0 | 50 | 90 | harass preferably in the enemy's CS window |

## Changes

Answers to the supervisor review (docs/agents/review-2026-10-16.md) and implementation deviations:

1. **Per-tick snapshot (finding 1).** `buildSnapshot` measured 0.76 ms per call (10 bots x 30 Hz would be
   ~230 ms per sim second). The reflex snapshot is built by the runner instead: the same fog rule as buildSnapshot
   (own team, structures, alive units `sees(sim, team, e)`), entity fields only, **once per team and tick** (shared
   by the team's bots), the bot's own HUD from its latest decision snapshot with the live own values patched in
   (stats, level, gold, recall, `abilityHud`), events = exactly this tick's fog-filtered team events
   (`teamEvents`, the same call that fills the think buffer; `b.events` keeps every event since the last decision).
   It goes through `onPerceive` like the think snapshot, so the fog test covers it. Projectiles, objects, audio and
   score rows are empty in it (reflex does not use them). Cost reported separately: `RunnerCost.viewMs/views`
   (view) vs `reflexMs/reflexCalls` (reflex logic). Long-term proposal for agent B: an official
   `buildSnapshot(sim, team, slot, { lite: true })` (shared-changes.md).
2. **Follow-up windows (finding 3).** The per-tick planner computes `predictWindows()` (lasthit.ts) for every enemy
   minion within reach + 700: kill window, hits, walk, lead. The scheduler protects **every** window that opens
   within the rank's planning horizon and is servable now (not only `plans[0]`): a filler is allowed only if each of
   them stays servable with the attack timer taken until `T + 1 + period` (plus 3 ticks slack for the prediction
   error of the closing hit). Rule 2 uses the same table (`windowAfterHit`). Window preparation (`prepare`) checks
   the first two protected windows. Test 3 covers it.
3. **Log volume (finding 5).** One entry per plan lifecycle (`lh_cancel` with the reason; executions are not
   logged), filler/hold decisions as `node: 'reflex'` entries whose chosen+reason repeat (throttled by the 150-tick
   dedup). No positions in reflex inputs (ids and ticks only).
4. **`notBusy`** is a scheduler rule, not a precondition: while `busyUntil` runs the reflex layer issues nothing and
   plans shift (re-aimed every tick); they are dropped only when their window can no longer be served.
5. **`orbwalkMove`** plans carry `cancelTags: ['orb']`; farm plans carry `['lh', 'orb']` (dodge / retreat use
   `cancelOrbwalk`, which sets `'orb'`) and are dropped with `overridden_by_dodge`.
6. **Timing error (minor).** `biasTicks = N(0, lastHitJitterMs) * 30 / 1000`, rolled at plan creation, kept while
   the plan is re-aimed every tick (the plan follows the prediction, the error stays). No constant reaction share:
   the human reaction part of the error is modelled by A3's attention windows (+150 ms while distracted, §9). A new
   roll only on re-creation after a cancel.
7. **New cancel reason `reordered`**: the next plan is replaced when keeping it would lose an earlier-closing
   window that the other order serves (or a bigger-gold minion in a true collision).
8. **Validation re-aims instead of dropping**: a plan's `executeAtTick` follows the per-tick prediction (with the
   kept bias); `prediction_drift` / `out_of_range` only when no landing inside the (believed) window is possible.
10. **Joint window protection** (19 Oct): besides each protected window alone, the protected set served one auto per
    period in earliest-deadline order (`serveCount`) must not lose a window the free timer would serve. Two wide
    windows each servable alone collided after a filler (Challenger lane alone 98 -> 102 on seed 1).
11. **Minion aggro** (19 Oct): enemy minions without an own minion within 700 ("untanked") push the stand point out
    of their reach + 100; fillers only on tanked minions. **Pre-hit filler**: a minion whose next incoming hit jumps
    over the own damage (empty window) gets an auto now if the next auto then lands in the new window (chance per
    minion by skill, the old tower pre-hit rule; also outside the tower).
12. **Reflex is opt-in**: `RunnerOptions.reflex` / `SimConfig` none; bot-sim `--reflex=true`; `reflexState(mem).enabled`
    switches `laneLeaf` between the intent path and `laneLeafLegacy`.
9. **`ReflexDebug`** type lives in `src/ai/plan.ts`; `BotRunner.debugRows()` returns rows with a `reflex` field
   (lead decision b). Profile fields `planHorizonS, windowPrepPct, standHysteresis, orbwalkPct, harassPerMin,
   harassCsWindowPct` are in all ten profile JSONs and `schema.ts` (lead decision a); `reflexParams(ctx)` reads them
   without code defaults. Orbwalk chance = `orbwalkPct / 100 + (knobs.orbwalkChance - 0.5)` (rank base + kiting axis).
