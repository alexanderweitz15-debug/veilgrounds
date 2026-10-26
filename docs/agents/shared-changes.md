# Shared-file change proposals

Format: date, agent, file, change, reason, status (proposed / approved / merged + commit).

## A3 (brain/a3-humanize)

| # | Date | File | Change | Reason | Status |
|---|---|---|---|---|---|
| A3-1 | 2026-10-16 | src/ai/profiles/schema.ts | `RankBehavior` + 8 numeric fields: `utilityNoisePct`, `distractionIntervalS`, `distractionDurMedianS`, `distractionDurSigma`, `minimapGlancePlannedPct`, `distractKillFeedPct`, `distractShopPct`, `distractChatPct` (type only, additive; values in the ten profile JSONs) | §5 utility noise, §9 attention rates; tsc strict needs the type. A1 adds its seven §4.7 reflex fields in the same interface (lead decision) - both blocks are appended, rebase is additive | done on brain/a3-humanize (type-only, not in anyone's list) |
| A3-2 | 2026-10-16 | src/ai/contract.ts | `Knob` union + `harassRateShift`, `utilFarm`, `utilTrade`, `utilHarass`, `utilRoam`, `utilPush`, `utilRecall`, `utilObjective`, `utilVision`, `utilGroup`, `utilCatchLane` (definitions in playstyleAxes.json) | §4.3 harass budget ±3 by aggression, §5 "alle Stil-Faktoren in playstyleAxes.json" (factors 0.6-1.6) for A2; botParams test requires Knob union == KNOB_DEFS | done on brain/a3-humanize (additive) |
| A3-3 | 2026-10-16 | src/i18n/de.json, en.json, src/ui/playstyle.css | 4 overlay keys (`botDebug.intent/plans/util/attention`), 2 CSS rules | F9 overlay columns (§3) | done on brain/a3-humanize (additive) |
| A3-4 | 2026-10-16 | src/ai/runner.ts (A1) | Wire the attention model: per decision after `think` `observeAttention(mem, ctx, snap)` with the think snapshot (only there: its eventTicks dedupe events; a per-tick reflex snapshot without eventTicks would double-count), and `reflexState(mem).attention ??= attentionProbe(mem)` (reflex only queries it) and `actions.push(...detectErrors(mem, ctx, snap.tick))`; `debugRows()` adds `reflex: reflexDebug(b.mem, tick)` and `attention: attentionDebug(b.mem, tick)` (both from src/ai/humanize/attention.ts / A1's plan.ts; fields are optional in `BotDebugInfo`) | §9 and §3 overlay; the attention model has its own Rng (personality seed), so wiring it does not shift the bots' Rng streams | applied by A3 on brain/a3-wiring (lead approval 22 Oct): runner creates the attention state + reflex probe at construction when `reflex` or `utilityOn(ctx)`, calls observeAttention + detectErrors after each think, debugRows adds `attention` |
| A3-5 | 2026-10-16 | src/ai/bot/lasthit.ts (A1) | Remove the per-minion lapse (`LAPSE_SHARE`, `roll.skip`); last-hit plans are cancelled with `distracted` while `isDistracted(mem, tick)` | §9 "nicht mehr pro Minion"; otherwise lapses are counted twice (lapse cache + attention windows) and test 10 clause 3 fails | applied by A3 on brain/a3-wiring: reflex already cancelled/skipped with `distracted`; harass filler now pauses while distracted (reflex.ts chooseFiller); legacy planLastHit gets `human` (lapse draw kept, effect dropped; skips all minions while distracted) |
| A3-6 | 2026-10-16 | src/ai/bt/leaves.ts (runTree) | `withTilt(ctx.params, mem.ext.tilt)` -> `withTilt(ctx.params, mem.ext.tilt, 'attention')` in the same commit that wires A3-4 | §9: tilt acts via distraction windows (x tilt x 30 %) + aggression only. Switching earlier would make tilt a no-op for execution | applied by A3 on brain/a3-wiring: runTree (bt/leaves.ts) uses `attentionOn(mem) ? 'attention' : 'legacy'` |
| A3-7 | 2026-10-16 | callers of `sampleReactionMs` (brain.ts dodge, perception) and of `predictiveDodgePct` | add `reactionPenaltyMs(mem, tick)` (+150 ms while distracted); no predictive dodge while `attentionAt(mem, tick).predictiveDodge` is false | §9 effects while distracted | applied by A3 on brain/a3-wiring: brain.ts dodge, bot/perception.ts awareness, bt/runtime.ts readyAt, ganks/escape.ts flash (predictive gated after the draw). also (687942e) perception/perceive.ts notice (optional `mem` 6th parameter of `perceive`, passed by runTree only with the model) and bot/spells.ts cleanseStep (`penaltyMs` parameter, brain.ts passes it) |
| A3-8 | 2026-10-16 | src/sim/types.ts | `PING_KINDS` + `'myBad'` ("Mein Fehler"), render icon/label | §9 detection ping; until then `detectErrors` says it in team chat (`attention.json myBad.text`) | applied by A3 on brain/a3-wiring: `myBad` appended to PING_KINDS + icon (render/pings.ts), colour (ui/pingWheel.ts), i18n `ping.myBad`; detectErrors pings at the own position (chat when dead) |
| A3-9 | 2026-10-16 | error call sites (brain.ts ignore_minion_aggro, trade.ts chase_third_kill / overcommit_after_kill, macro idle_after_shove, ...) | replace `rollError` + own timers by `rollErrorEpisode(mem, ctx, id, tick, rng)` (same single draw) and keep the wrong behaviour while `errorActive(mem, id, tick)`; durations in errors.json `durS` | §9 error duration + detection | applied by A3 on brain/a3-wiring via `rollErrorUntil` (errors.ts, one draw like rollError; episode only with the attention model, else the old fixed timer): brain.ts ignore_minion_aggro x2, reflex.ts harass ignore_minion_aggro (mem passed to chooseFiller/harassTarget), macro.ts idle_after_shove, trade.ts fight_in_enemy_wave / trade_on_cooldown / chase_third_kill / overcommit_after_kill / flash_in_dive, teamfight.ts carry_too_far (ends after the episode), roam.ts roam_from_push. also (687942e) escape.ts flash_wrong_direction / flash_into_wall, perceive.ts no_flash_tracking (draw kept inside the cdTracking guard). Not converted: macro.ts late_recall (logged only, no roll) |
| A3-10 | 2026-10-16 | A2 utility logging | keep logging every intent choice with `node: 'utility'` (as on brain/a2-utility ecdd3f3; `INTENT_NODE` in src/ai/log.ts), `chosen` = intent, `scores` = all candidate scores. Rank noise: the profile field `utilityNoisePct` (Iron 40, Gold 20, Challenger 7) can replace `exchangeNoise(skill)`; style factors: knobs `util*` | the F9 overlay reads intent + top-3 candidates from that node; without it the overlay shows the tree node as before | log.ts INTENT_NODE now reads values.json selection.logNode (`intent`), was hard-coded `utility` |
| A3-11 | 2026-10-22 | src/ai/runner.ts (A1) | `RunnerOptions.trainer` (harness runLaneAlone already passes `trainer: true` through HarnessOptions): no attention model in the last-hit trainer | brainReflex test 2 (Iron lane alone >= 70) fell 79 -> 54 with the model on (Iron 35 % distracted); the trainer measures execution only. Question to S in a3.md | applied on brain/a3-wiring 3a341d7 |

All A3 hooks are no-ops unless the runner created the attention state (`attentionOn(mem)`: reflex or utility on, not the trainer); every hook keeps the bot's Rng draws (count and order) of the pre-rework brain.

## 2026-10-16 · Agent B · B1 ward stealth (snapshot types, additive)

Status: proposed (on branch sim/b-mechanics). Affects: brain team (A1-A3, reads Snapshot), C (minimap), D (render).

1. `src/sim/snapshot.ts` (B, additive):
   - `SnapEntity.stealth?: true` on stealthed units (today: Schleierwards). Own team: hidden from the enemy unless
     revealed. Enemy team: the entity is in the view only because it is revealed (enemy Siegelward within 450,
     Suchfeuer, 3 s after Spaehfrucht / Nyx R) - attackable (3 autos), should get its own minimap symbol.
   - `SnapObject.stealth?: true` on stealthed ground objects (Nyx seeds, Grimald traps). Enemy objects now appear
     when revealed (before: never); the hard-coded tag list `HIDDEN_OBJECT_TAGS` is gone.
   - `SimEvent` zone: `stealth?: true` (ability flag `stealth`, today Lysa E wire). Enemies get the zone event only
     under true sight (enemy Siegelward 450 / Suchfeuer) at placement, no longer by plain point vision.
   - Ability data: new flag value `stealth` in `AbilityData.flags` (schema.ts, validate.ts).
   - Siegelward reveal radius 900 -> 450 (AGENTS-PLAN B1 (a)); values moved to `src/data/wards.json` (new file).
   Brain impact: none required. Enemy Schleierwards were already absent from bot snapshots (verified: 4595 samples in
   a 20-min 10-bot game, the only 2 hits were legit Siegelward reveals). Bots that clear wards can key on
   `e.stealth && e.team !== me.team` for "revealed enemy ward".

2. Request for C, `src/ui/minimap.ts` (ward block, ~line 133): own symbol for revealed enemy Schleierwards.
   ```diff
              } else if (e.kind === Kind.Ward) {
                // player wards as small diamonds; jungle river vision (no e.ward) is not drawn
                if (!e.alive || !e.ward) continue;
   +            // revealed enemy Schleierward (stealth + enemy team): hollow diamond with an eye dot, enemy colour
   +            const revealed = e.stealth && e.team !== state.myTeam;
                const r = (e.ward === 'seal' ? 3.2 : 2.6) * d;
                ctx.fillStyle = e.ward === 'seal' ? (e.team === state.myTeam ? '#f2d36b' : '#ff8a5a') : col;
                ctx.beginPath();
                ctx.moveTo(x, y - r);
                ctx.lineTo(x + r, y);
                ctx.lineTo(x, y + r);
                ctx.lineTo(x - r, y);
                ctx.closePath();
   -            ctx.fill();
   +            if (revealed) {
   +              ctx.strokeStyle = col;
   +              ctx.lineWidth = 1.6 * d;
   +              ctx.stroke();
   +              ctx.beginPath();
   +              ctx.arc(x, y, 0.9 * d, 0, Math.PI * 2);
   +              ctx.fill();
   +              continue;
   +            }
   +            ctx.fill();
                ctx.lineWidth = 1 * d;
                ctx.stroke();
   ```
3. Request for D, `src/render/wards.ts`: own stealthed wards (`e.stealth && own`) drawn semi-transparent (LoL look:
   your stealth ward is translucent), revealed enemy ones with a reveal ring. Suggested: in `update`, after the
   `disabled` line: `const ghost = own && e.stealth; m.gemMat.opacity = disabled ? 0.35 : ghost ? 0.6 : 0.95;` and for
   `e.stealth && !own` set `m.ringMat.opacity = 0.9`. Same idea for `SnapObject.stealth` in render/groundObjects.ts.

## 2026-10-16 · Agent B · B2 movesWhileCasting (champion data, additive)

Status: proposed (sim/b-mechanics). Affects: brain team (A1: busyUntil), C (none), D (none).

1. Data (B): every ability in `src/data/champions/*.json` has `"movesWhileCasting": true|false` (validator requires
   it); `src/data/summoners.json` has `castTime` (0) and `movesWhileCasting` (false only for Teleport). Type:
   `AbilityData.movesWhileCasting` (schema.ts), `SummonerDef.castTime/movesWhileCasting` (summoners.ts).
   Sim: `movementLocked()` (abilities.ts) replaces `isBusy()` for the walking speed (stats.ts): during the wind-up of a
   movesWhileCasting ability the champion keeps following its path; autos stay blocked as before. Move commands never
   cancelled a wind-up, they now also take effect during a moving wind-up. Table: docs/ability-cast-audit.md.
2. Request for the brain team, `src/ai/bot/brain.ts` `think()` (shared file), so busyUntil no longer freezes bots
   for casts that do not stop them:
   ```diff
        const ab = ctx.champ.abilities[a.cmd.slot];
   +    // B2: wind-ups of movesWhileCasting abilities do not stop the champion: the bot may keep moving/deciding
   +    if (ab.movesWhileCasting && !ab.flags?.includes('channel')) continue;
        const rank = snap.me?.abilities[a.cmd.slot]?.rank ?? 1;
   ```
   (During such a wind-up a move takes effect at once; an attack order chases, the auto itself starts after the wind-up.)

## 2026-10-16 · Agent B · B3 snapshot additions for bots (additive, public info only)

Status: proposed (sim/b-mechanics). Affects: brain team (reads them), C (scoreboard can use kesselbrutTeams).

- `SnapEntity.plates?: number` on outer towers (both teams; 5 -> 0, all fall at 14:00).
- `SnapEntity.revealed?: true` on enemy units under a reveal of the viewing team; `SnapEntity.exposed?: true` on own
  units currently revealed to the enemy (Nyx seed, Mira W, own ward under enemy Siegelward/Suchfeuer).
- (superseded 2026-10-19: `kesselbrutTeams` replaced by C's `Snapshot.objectives`, see the C2 entry: merged.)
- `Snapshot.reveals?: SnapReveal[]` own true-sight areas `{ kind: 'seal' | 'sweep', x, y, r, until? }`.
- Behaviour change: `SnapEntity.atkTarget` is now masked to -1 when the target is not in the same view (no eid
  leak, e.g. an enemy champion hitting a camp in the fog). atkPhase/atkStart/atkEnd/atkTarget were already there for
  every visible unit (minion and tower target choice included).
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
- B 2026-10-19: done differently: `snapshotEntities(sim, team)` exported from src/sim/snapshot.ts (fog rule, all entity
  fields incl. stealth/plates/revealed/exposed, hidden atkTarget masked; no visuals/marks/auras). buildSnapshot uses it.
  A1 can replace `BotRunner.buildTeamEntities` with it (runner.ts is A1's file; not edited by B).

## Pre-authorised edits of src/ai/bot/brain.ts `laneLeaf` (A1, Phase 1)

| date | commit | change |
|---|---|---|
| 2026-10-16 | 227ab5b (lead's WIP commit of A1's tree) | `laneLeaf`: with `reflexState(mem).enabled` it only computes wave state / stand distance / support side point and sets the lane intent (no last-hit timing, no holdTimer, no move/stop to free the timer, no 6-s stand hysteresis); otherwise `laneLeafLegacy` = the unchanged pre-rework code. Imports `reflexState/setIntent`. |
| 2026-10-19 | 796bcb0 | `laneLeaf` (reflex path): `intent.harass` = no ward walk and gank risk < 0.6 (§4.3); constant HARASS_MAX_GANK_RISK. |
| 2026-10-19 | 43b455d | `think()`: casts of `movesWhileCasting` abilities (not channels) no longer set `busyUntil` (agent B's B2 request; lead decision 2). Affects both reflex on and off. |

## A2 (brain/a2-utility)

All A2 hooks keep flag-off behaviour bit-identical: every changed line is behind `utilityOn(ctx)`
(src/ai/utility/flag.ts), which returns false unless `BotStatic.utility` or `BOT_UTILITY=1` is set.

| # | Date | File | Change | Reason | Status |
|---|---|---|---|---|---|
| A2-1 | 2026-10-16 | src/data/bots/tree.json, src/ai/bt/leaves.ts | Insert `{ "type": "action", "name": "utilitySelect" }` into the `main` selector directly after `arena` (before `combat`). Registry line in leaves.ts: `utilitySelect: (n) => (utilityOn(n.ctx) ? utilitySelect(n) : 'failure'),` with `import { utilityOn } from '../utility/flag'; import { utilitySelect } from '../utility/select';`. After the merge A2 removes the interim hook (first line of `tradeRun` in trade.ts). | §3/§5: the utility selector replaces the order of combat / objective / recall / idleAfterShove / role / vision; survive, dodge, peel, dead/recallChannel/fountain, housekeeping stay before it. Flag off: the node fails at once (no rng, no log, no memory write), the selector falls through unchanged. Interim until merged: `tradeRun` (first leaf of `combat`, A2's file) calls `utilitySelect` when the flag is on - F9 then shows `combat/tradeRun` as the running branch. | approved by the lead 19 Oct, applied on brain/a2-utility (flag-off hash seed 1 / 4 min a5913c9c = main 7afff90) |
| A2-2 | 2026-10-16 | src/sim/types.ts, src/ai/bot/types.ts, src/ai/runner.ts (A1) | `SimConfig.botUtility?: boolean`; `BotStatic.utility?: boolean`; runner: `utility: config.botUtility,` in the BotStatic literal. | Browser/lobby switch for the utility model (the env variable only exists in node). `utilityOn` already reads `ctx.utility` untyped; the harness sets it per bot (tests/utilityHarness.ts). Default switch (§12) only after A1 Phase 2 is on main. | approved by the lead 19 Oct, applied on brain/a2-utility (flag-off hash seed 1 / 4 min a5913c9c = main 7afff90) |
| A2-3 | 2026-10-16 | src/ai/bot/brain.ts `retreat` | `const goHome = !utilityOn(ctx) && (v.hpPct < lowHp \|\| (mem.mode === 'retreat' && v.hpPct < 0.4) \|\| mem.mode === 'home');` and `if (mem.mode === 'retreat' \|\| (mem.mode === 'home' && !utilityOn(ctx))) mem.mode = 'lane';` | §4.6 "retreat führt nicht mehr automatisch heim": with the flag the flee part stays (survive), the walk home becomes the recall candidate (`recallValue`: stay-death > 0.3 or an item). Measured (Diamond, 8 min, flag on, seed 1): 29 of 34 laner recalls came from this branch ("recall / low hp"), so test 8 cannot hold until it is gated. | approved by the lead 19 Oct, applied on brain/a2-utility (flag-off hash seed 1 / 4 min a5913c9c = main 7afff90) |
| A2-4 | 2026-10-16 | docs/agents/plan-api.md / src/ai/plan.ts (A1) | Second intent kind for reflex filling during a trade disengage (§6.1): `{ kind: 'disengage'; lane: LaneName; from: number /* enemy eid */; back: Pt /* own stand point side */; until: number; harass: boolean }`. Reflex: orbwalk toward `back`, fill free attack periods with autos on minions in reach (or the champion when `harass`), last-hit plans as in laneFarm. A2's trade intent sets it when a trade ends (`endTrade`) for `disengageUntil`. | §6.1 "nach dem Abbruch Disengage per Orbwalk zum Stehpunkt; währenddessen läuft der Angriffs-Scheduler weiter". | proposed (A1 accepted the idea in review-2026-10-16) |
| A2-5 | 2026-10-16 | A3: profiles + playstyleAxes.json | A2 reads `RankBehavior.utilityNoisePct` (A3-1) and the knobs `utilFarm`, `utilHarass`, `utilTrade`, `utilPush`, `utilRoam`, `utilRecall`, `utilObjective`, `utilVision`, `utilGroup`, `utilCatchLane` (A3-2) when present; fallbacks until merged: `exchangeNoise(skill)` (same numbers) and the axis mappings in values.json `style`. Logged under node `intent` (A3-10, `VALUES.selection.logNode`). | No new shared change; listed so the merge order is clear. | info |
## 2026-10-16 · C · src/sim/snapshot.ts · public objective + respawn fields (C2) · merged by B on sim/b-mechanics 2026-10-19 (objectives {leviathan, kesselbrut, schleierLeft, inhibs}, ScoreRow.respawnIn, ScoreRow.summonerCds; visionScore (both teams, approximation: ward-minutes + kills + 0.5 x reveals) and champDamage (own team) added 2026-10-19; tests/objectives.test.ts fixture got the two new required fields)

Affected: B (owner, B3/B6 add the same kind of data — please use these names or tell C yours), A1–A3 (bots may read
the same public fields; nothing hidden is added). **Nothing blocks:** C2 already works without these fields through a
client adapter (`src/game/objectives.ts`, derived from public death events + exported sim constants) and reads each
field below first (`row.respawnIn ?? derived`), so merging them only makes values exact where the client cannot know
them (enemy Kesselbrut stacks; ally summoner cooldowns; vision score; damage).

Reason: AGENTS-PLAN §5 C2 (scoreboard objectives, death timers, summoner timers), user report 16.10. All values are
on-screen information in LoL (respawn timers of all champions, drake/grub counts of both teams, baron timer,
inhibitor timers, own team's summoner cooldowns).

```diff
 export interface Snapshot {
   ...
   /** Kesselbrut stacks of the viewing team (0-6, HUD indicator); absent while 0 and for spectators. */
   kesselbrut?: number;
+  /** Public objective state of both teams (index = team). */
+  objectives?: {
+    leviathan: [number, number];
+    kesselbrut: [number, number];
+    /** Seconds left of the Schleierwaechter buff (max over the team's alive holders; 0 = none). */
+    schleierLeft: [number, number];
+    /** Destroyed inhibitors: seconds until respawn. */
+    inhibs: { team: number; lane: LaneId; left: number }[];
+  };
 }

 export interface ScoreRow {
   ...
   itemValue: number;
+  /** Dead champions (both teams): seconds until respawn (Champ.respawnAt - tick) / 30. */
+  respawnIn?: number;
+  /** Own team only: summoner spell cooldowns, same order as PlayerSetup.summoners. */
+  summonerCds?: { left: number; total: number }[];
+  /** Both teams (public in LoL's scoreboard): vision score and damage dealt to champions. */
+  visionScore?: number;
+  champDamage?: number;
 }
```

In `scoreRows(sim, team)`:

```diff
       dead: Unit.alive[e] !== 1,
+      ...(Unit.alive[e] !== 1 && Champ.respawnAt[e]! > 0 ? { respawnIn: Math.max(0, (Champ.respawnAt[e]! - sim.tick) / 30) } : {}),
       ...(own ? { gold: ..., items: ..., summonerCds: summonerCdHud(sim, e) } : {}),
```

In `buildSnapshot`: `objectives: { leviathan: [leviathanStacks(sim, 0), leviathanStacks(sim, 1)], kesselbrut:
[kesselbrutStacks(sim, 0), kesselbrutStacks(sim, 1)], schleierLeft: [...], inhibs: [...] }` from
`jungleState`/`towers.ts` records. Test proposal: tests/objectives.test.ts already compares the client timer with
`Champ.respawnAt`; the same test can assert `row.respawnIn` once it exists.

Also related (B6): if Kesselbrut becomes `epic: true` / radius 130, its death events reach both teams and the
client counts enemy grubs without the `objectives` field. `src/ui/announce.ts` currently assumes grub deaths stay in
the fog (banner from the own stack count) — C adapts it when B6 lands.

## 2026-10-16 · C · src/settings.ts · settings outside C's area (C7 heads-up) · approved (lead, 19 Oct: additive changes, log here)

Log of C's additive changes to `src/settings.ts`:
- 2026-10-19 (`c7: minimap size/side, settings export/import`): `Settings.minimapScale` (80..150, default 100),
  `Settings.minimapLeft` (default false), `export const DEFAULT_SETTINGS` (read-only alias of DEFAULTS for the import
  validator in src/game/settingsIO.ts). No rename, no removal.
- 2026-10-19 (`c7: per-key cast modes`): `Settings.castModes` (per Q/W/E/R: quick / indicator / normal; default `{}`
  = follow `castIndicator`).
- 2026-10-20 (`c7: hp bar style, enemy skillshot outline setting`): `Settings.hpBarStyle` ('segmented' | 'thousands' |
  'plain', default 'segmented'; used by src/ui/overlay.ts), `Settings.enemySkillshotOutline` (boolean, default false).
- 2026-10-20 (`c: B requests`): `Settings.attackMoveTargetCursor` (boolean, default false; input sends B5's `cursor: true`).

## 2026-10-20 · C → D · src/render/telegraph.ts · read `settings.enemySkillshotOutline` · proposed

Affected: D only. The setting exists (settings panel row, import/export). Request: when it is on, enemy skillshot
telegraphs (line / zone / cone of `e.team !== myTeam`) get a stronger outline (e.g. 2 px `REL.enemy` stroke at 0.9
alpha, fill unchanged). No change for own/ally telegraphs. The settings row says "Darstellung folgt durch Agent D"
until this lands; remove that suffix in de/en.json (`set.enemySkillshotOutline`) with the change.

`src/settings.ts` is not in C's file list (AGENTS-PLAN §7 lists src/ui, src/game, src/i18n, src/input). C7 needs new
settings (minimap scale/side, HP-bar style, enemy skillshot outline, quick-cast per key, settings export/import).
Proposal: allow C to add fields to `Settings`/`DEFAULTS` in `src/settings.ts` (additive only, no renames), or move the
file to `src/ui/settings.ts`. Until decided, C7 waits.

## 2026-10-19 · E · Sev Aschenblick: shared-file edits (one-time pass from the lead for the sim extensions) · merged on champ/e-sev

All additive; no existing behaviour changes for champions other than the new CC type and the cleanse guard.

| File | Owner | Change | Commit |
|---|---|---|---|
| src/sim/buffs.ts | B | CC kind `fear` (in CC + HARD_CC, tenacity applies, blocks attack/cast/channel, ccLevel 3.5, CC_BIT 256); `isFeared`, `fearSource`; optional `Buff.uncleansable` flag | 068d755 |
| src/sim/systems/movement.ts | B | pre-pass: feared units walk 300 ahead straight away from the fear source (overrides orders of that tick) | 068d755 |
| src/sim/summoners.ts | B | Reinigen skips `uncleansable` buffs and fails while feared; fear interrupts Teleport | 068d755 |
| src/sim/systems/abilities.ts | B | `castSummoner`: feared -> 'cc' for every summoner; `pickTarget` consults new `ChampionHooks.targetOk` | 068d755 |
| src/sim/champions/hooks.ts | B | new optional `ChampionHooks.targetOk`, `PassiveHook.onPetDamaged` | 068d755 |
| src/sim/damage.ts | B | pet damaged -> owner's `onPetDamaged` passives | 068d755 |
| src/sim/summons.ts | B | `petOwner`, `petTag`, `extendPet` helpers | 068d755 |
| src/sim/snapshot.ts | B | `SnapEntity.look` (+ level) for decoy pets (tag `*_decoy`) | 4f29a96 |
| src/data/champions/index.ts, src/sim/champions/index.ts | B | one registry line each | 068d755 |
| src/data/runePresets.json, src/render/abilityMotifs.json | B / D | `sev` presets (copy of thessaly), motif row eye/flame/cloak/spiral | 068d755 |
| src/i18n/de.json, en.json | C | `cc.fear` | 068d755 |
| src/ui/overlay.ts | C | CC_ORDER fear entry; decoys (`look`) get the champion bar + owner's name | 068d755, 4f29a96 |
| src/render/championSprites.ts | D | decoy pet with `look` uses that champion's sprite | 4f29a96 |
| src/render/champions/types.ts, anim.ts, kits.ts | D | Hold `palm` (+ its pose), Sev kit entry | bfa425b |
| tests/championData, abilityMotifs, botParams, items, telegraph | all | roster count 26 -> 27 / roster list | 068d755 |
| tests/combos.test.ts | B | harness: a repeated token on a recast-flag skillshot with wind-up = fake (press during wind-up) | 068d755 |
| tools/botSim.ts | A1 | `--champion=<id>` puts that champion into blue mid; registers `BUILDS.sev` at runtime until builds.ts has the line | bfa425b |
## 2026-10-19 · D · src/ui/overlay.ts (C) · CC symbols + HP-bar stacking (D2, FEATURE-GAP 7.6 / 7.8) · done by C on ui/c-picking `d2739f3` (picker follows the bar lifts; the hovered bar is NOT pinned - pinning it would move a hovered lifted bar away from the cursor and make the hover flicker)

Affects: C only (render-free UI file). Helpers are on art/d-visuals, pure and tested (tests/readability.test.ts):
`src/render/ccGlyphs.ts` (`drawCcGlyph(ctx, key, x, y, size, color, tMs)`, one shape per CC type) and
`src/render/barLayout.ts` (`stackBars(rects)` -> y offset per id; champions/structures/hovered fixed, minion and
monster bars lifted up to 3 steps when they overlap).

1. CC chip with symbol (in `drawCc`, after the chip background):
   ```diff
   +import { drawCcGlyph } from '../render/ccGlyphs';
   ...
   -    const w = ctx.measureText(text).width + 10;
   +    const icon = champ ? 14 : 10;
   +    const w = ctx.measureText(text).width + 10 + icon + 2;
        const cy = champ ? y - 32 : y - 14;
        ctx.fillStyle = 'rgba(12,10,8,0.85)';
        ctx.fillRect(x + bw / 2 - w / 2, cy - 8, w, 16);
        ctx.fillStyle = color;
        ctx.fillRect(x + bw / 2 - w / 2, cy + 6, w, 2);
   +    drawCcGlyph(ctx, key, x + bw / 2 - w / 2 + 5 + icon / 2, cy - 1, icon, color, performance.now());
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
   -    ctx.fillText(text, x + bw / 2, cy);
   +    ctx.fillText(text, x + bw / 2 + (icon + 2) / 2, cy);
   ```
2. HP-bar stacking (in `draw`, two passes): first collect `{ id: e.id, x, y, w: bw, h: bh, fixed: champ || structure
   || dummy || e.id === hoverId }` for every bar, `const off = stackBars(rects)`, then draw with `y + (off.get(e.id) ?? 0)`
   (CC chip and marks use the same shifted y). Minion bars could also go 5 -> 4 px high if the stack still looks busy.

## 2026-10-19 · D · training plan + history wiring (D5, FEATURE-GAP 7.1 / 7.2) · parts 2+3 done by C on ui/c-picking; part 1 + `onPickWith` in src/main.ts open for the lead (see note at the end of this entry)

Affects: C (src/ui/trainerMenu.ts, src/i18n), whoever owns src/main.ts (lead). D's side is on art/d-visuals:
`src/stats/{rankCalibration,history,trainingPlan}.ts` (pure, tests/trainingPlan.test.ts), view
`src/modes/trainingPlanView.ts` (`renderTrainingPlan(parent, history, onStart)`), dev render
`docs/ist/d5-training-plan-dev.jpg`. `rankCalibration.ts` is a LOCAL ADAPTER until A3 defines the real API.

1. Record every finished game / trainer run (src/main.ts `afterGame`, before the post-game screen):
   ```diff
    function afterGame(config: SimConfig | null, r?: SessionResult): void {
      if (!config || !r) return mainMenu();
   +  // D5: match history for the training plan (IndexedDB, no-op when unavailable)
   +  if (!r.retry && r.summary.duration >= 60) void import('./stats/history').then((h) => h.saveRecord(h.recordFromSummary(r.summary, Date.now())));
   ```
2. Show the plan on the trainer hub (src/ui/trainerMenu.ts `renderTrainerMenu`, after the title):
   ```diff
   +  const planBox = el('div', '', panel);
   +  void Promise.all([import('../stats/history'), import('../modes/trainingPlanView')]).then(async ([h, v]) => {
   +    if (planBox.isConnected) v.renderTrainingPlan(planBox, await h.loadHistory(), (it) => onPickWith(it.mode, it.opts));
   +  });
   ```
   `onPickWith(mode, opts)`: same as `onPick(mode)` but starts the trainer lobby with `opts` merged into
   `defaultSetup(mode).opts` (main.ts `trainerSetups`).
3. i18n: add the keys of `src/modes/planStrings.json` (de + en, 26 keys `plan.*`) to src/i18n/de.json / en.json; the
   view falls back to that file while a key is missing.
4. A3: when `stats/rankCalibration` exists, D maps `calibrateMatch` onto it (types `RankCalibration`,
   `CategoryCalibration` in src/stats/rankCalibration.ts are the contract D consumes).

**C, 2026-10-22:** `renderTrainerMenu(root, onBack, onPick, onPickWith?)` mounts the plan (part 2); the 24 `plan.*`
keys are in de/en.json (part 3). Until main.ts passes `onPickWith` the plan's "Starten" opens the trainer lobby with
the mode's current options (options not merged). **Lead (src/main.ts):** part 1 (`afterGame` -> `saveRecord`) and
`renderTrainerMenu(s, mainMenu, (m) => void trainerLobby(m), (m, opts) => { const d = trainerSetups.get(m) ??
defaultSetup(m); trainerSetups.set(m, { ...d, opts: { ...d.opts, ...opts } }); void trainerLobby(m); })`.


## 2026-10-19 · Agent B · user decisions 19.10. (snapshot, additive) -> C please read

1. Lysa E wire is visible again (lysa.json without the `stealth` flag): enemies get its zone event by normal point
   vision. Seeds/traps/Schleierwards stay stealthed. The `stealth` ability flag still works (no ability uses it).
2. Enemy items like LoL: `ScoreRow.items` now also for enemies = inventory as last seen while that champion was
   visible (new system `src/sim/seenItems.ts` right after vision, per team; nothing updates from the fog), plus
   `ScoreRow.itemsSeen` = tick of that sighting. Absent if the champion was never seen. Own team: live as before.
   **For C:** scoreboard and target frame can show `row.items` for enemies (optionally dimmed / "seen x s ago" from
   `itemsSeen`). A targeted enemy is visible, so its row is current that tick. Brain team unaffected (may read it).

## 2026-10-19 · Agent B · B4 Teleport for top (additive) -> C: HUD slot, brain: bot use

- Sim: `src/sim/topTeleport.ts`. Lobby role `top` counts gold from lane-minion kills; at 1500
  (`summoners.json teleport.topUnlockGold`) Teleport becomes summoner slot 2 (unless the champion already took it).
  Cooldown as Teleport (360, 240 from 10:00). `ChampAbil.sums` is now `string[]` (2 or 3 entries).
- Command: `{ t: 'spell', slot: 2, ... }` (type `slot: 0 | 1 | 2`). HUD: `PlayerHud.abilities[6]` exists only after
  the unlock; `ScoreRow.summonerCds` gets a third entry. Event `{ e: 'tpUnlocked', eid, team, slot }`, own team only.
- **For C:** HUD slot F2 (default key T, rebindable) shown when `me.abilities[6]` exists, announcement on
  `tpUnlocked` ("Teleport freigeschaltet" / "Teleport unlocked"), scoreboard third summoner. Not done by B.
- **For the brain team:** issue in docs/agents/issues.md (bots ignore abilities[6]).

## 2026-10-19 · Agent B · B5 mechanic feel, sim side (additive) -> D: render

- `SnapEntity.dash?: number` 0..1 progress of a dash / knockback / pull (own dashes and displacements);
  `SnapEntity.air?: number` 0..1 of the longest airborne CC (knock-up arc). **D:** flight arc from these; the dash
  animation should end when `dash` disappears.
- Damage events carry `flash?: true`: champion hits always, all other hits (DoT ticks, minions, towers, monsters) at
  most every 8 ticks (4/s) per target. **D:** `render/world.ts onEvent` should call `units.flash` only when
  `ev.flash` (today: every damage event).
- `atkStart` / `atkEnd` were already in the snapshot (since before B3): **D** can drive the wind-up animation exactly.
- Facing: decision B = the sim keeps the exact facing (cast direction and bot prediction depend on it); the 180 deg
  turn smoothing (~80 ms) belongs to the render (D2 "Blickrichtung geglättet").
- Dagny Q: castTime 0.2 -> 0; auto resets (flag `auto_reset`) now also end a running backswing, so the next auto starts
  the same tick.

## 2026-10-19 · Agent B · B6 Kesselbrut as epic objective (additive) -> C: announce.ts, A2: team AI

- `CampDef.epic` for Leviathan, Kesselbrut, Schleierwaechter (jungle.ts); `isEpicMonster(sim, eid)`.
- Death events of epic monsters carry `epic: true` and reach both teams (teamEvents rule was `radius >= 130`, so
  Kesselbrut kills now become public; Leviathan/Schleierwaechter unchanged). `SnapEntity.epic?: true` on those monsters.
  Radius stays 70 (no gameplay change). Stacks of both teams: `Snapshot.objectives.kesselbrut` (C2 entry).
- **For C:** `src/ui/announce.ts` assumed grub deaths stay in the fog; enemy grub kills now arrive as events.
- **For A2:** objective logic can key on `e.epic` / `ev.epic` instead of radius.

## 2026-10-19 · Agent B · B5 attack-move "target at cursor" (additive) -> C: setting + input

- Command `{ t: 'attackMove', x, y, cursor?: true }`: the first target of that attack-move is the valid enemy in
  range nearest to the click instead of nearest to the champion (LoL "Player Attack Move Click"). Later
  re-acquisitions (target died) use the champion again.
- **For C:** settings toggle ("Angriffsbewegung: Ziel am Cursor" / "Attack move: target nearest to cursor"),
  `src/input` sends `cursor: true` when it is on. Bots are unaffected (they never set it).

## 2026-10-19 · Agent B · B7 load time: proposal for D (src/render) + lead (build), not implemented by B

AGENTS-PLAN B7 is listed under B, but every file it touches is D's (src/render/sheets.ts, champions/atlas.ts,
spriteWorker.ts) or the lead's (build scripts / package.json). B did not edit them. Proposal (meets "< 5 s with a
warm cache" without a Node canvas dependency):
1. Persistent cell cache in the browser: after a cell is baked (spriteWorker result `bmp`), store it as PNG blob in
   Cache Storage (`caches.open('vg-atlas-v<ATLAS_VERSION>')`, key `/<id>/<master>/<frame>/<cell>`), done in the worker
   via `OffscreenCanvas.convertToBlob`. `buildChampionAtlasAsync` first asks the cache per champion; hits are decoded
   with `createImageBitmap(blob)` (worker, parallel) and blitted, misses are baked as today. Cache per champion,
   not per match id set (sheets.ts caches only the last id set in memory today).
2. `ATLAS_VERSION` = hash of src/render/champions/** at build time (Vite `define`), so art changes invalidate.
3. Optional later: a `tools/bakeSprites.ts` Playwright step that loads the dev build, bakes all 26 + minions +
   monsters and writes PNGs to `public/atlas/` (true pre-baked atlases, cold cache fast too). Needs the lead (CI).
4. Main menu first frame: a static CSS gradient background on the menu root until menuScene's first render.
Measure: console lines `champion atlas: ... in N ms` (sheets.ts) cold vs warm, 10 runs, under the usual load.

## 2026-10-22 · Agent C · src/render/world.ts `pick()` (D's file, one-time pass granted by the lead) · C8 picking

- `World.pick()` body replaced: it now builds a two-line camera adapter (`PickView`: `rig.project` with the canvas
  size, `barAnchor`) and delegates to `pickUnit()` in the new C file `src/input/picking.ts`. Plus one import line.
  Signature unchanged; nothing else in src/render touched. Reason: user report "Minion-Hitboxen fühlen sich nicht
  clean an" (sprite-rect pick, champions scored x0.5 so a nearby champion stole minion clicks).
- **For D:** picking reads `barAnchor()` / `unitHeight()` (sprite heights) as before. If the HP-bar position
  changes, `src/ui/hpBarGeom.ts` (shared by overlay drawing and picking) is the single place for bar geometry.
  The hover ring in units.ts is untouched; the overlay additionally draws a front arc + bar frame on the hovered unit.

## 2026-10-22 · E · Sev Fassung 3 (R choice, rework): shared-file edits · on champ/e-sev

| File | Owner | Change | Commit |
|---|---|---|---|
| src/sim/champions/schema.ts, src/data/champions/validate.ts | B | optional `ultChoices` (3 abilities, rank arrays of 3) + `botUltChoice` weights; flag `root_ok`; hookIds include ultChoices | d089dc0 |
| src/sim/systems/abilities.ts | B | `ChampAbil.ult`, `chooseUlt`, `ultChoiceOf`, `botUltPick` (seed+slot hash, no shared RNG), R uncastable before the choice, bots that learn R get the data pick, `abilityOf` returns the chosen ult, `AbilityHud.ultChoice`, `root_ok` skips the root check for movers | d089dc0 |
| src/sim/systems/input.ts, src/sim/types.ts | B | command `ultChoice` (also while dead), event `ultChoice` | d089dc0 |
| src/sim/champions/index.ts | B | `slotAbility(id, slot, ult)` | d089dc0 |
| src/sim/snapshot.ts | B | `SnapEntity.ult` | d089dc0 |
| src/data/champions/index.ts | B | `abilityForSlot` (virtual slots 4..6 = R choices), `ultDisplaySlot` | d089dc0 |
| src/render/abilityTheme.ts, fx.ts, world.ts, src/audio/eventSounds.ts | D | ability lookups via `abilityForSlot` (chosen R for telegraphs, sounds, aim) | d089dc0 |
| src/ui/icons.ts, names.ts, tooltip.ts, hud.ts | C | same lookups; R slot shows the chosen ult; HUD hosts the choice cards and the Tsukuyomi tint class | d089dc0, f71b883 |
| src/ui/ultChoice.ts + .css (new), src/game/game.ts | C | choice cards above the ability bar (keys 1/2/3), hook `ultChoice` -> command | d089dc0 |
| src/render/groundObjects.ts + src/render/sevFx.ts (new) | D | `sev_*` object tags drawn by sevFx (fire field + flame ring, crow storm, gaze line, black flames, Susanoo ribcage, thrust, red moon) | f71b883, e93f32c |
| src/render/abilityMotifs.json | D | sev row with 7 motifs (Q W E R + the three ults) | d089dc0 |
| src/i18n/de.json, en.json | C | `ultChoice.title` | d089dc0 |
| tests/combos.test.ts, tests/sim/castMovement.test.ts | B | champions with an R choice pick the first ult; castMovement reads `slotAbility` | d089dc0 |
## 2026-10-22 · A1 · src/ai/utility/value.ts + src/data/bots/values.json (A2's area, lead-approved for poke/trade weights)

- `tradeValue`: benefit x opportunity, opportunity = 1 + tradeCsWindowBonus x harassCsWindowPct/100 when the enemy
  winds up on an own minion (CS window) + tradePunishBonus x skill/100 when it cast an ability in the last
  tradePunishS seconds (on cooldown). New triggers `cs_window` / `punish` in the log; term `opportunity`.
- values.json weights: `tradeCsWindowBonus` 1.0, `tradePunishBonus` 0.8, `tradePunishS` 3.
- Reason: user feedback "trade when the enemy misses a cast or last-hits"; only active with the utility flag.

## 2026-10-23 · S1 · all chat + surrender vote: shared-file edits · on ui/s1-features

| File | Owner | Change | Row |
|---|---|---|---|
| src/sim/types.ts | B | `Command` chat gets `all?: boolean`; `SimEvent` chat gets `all?: boolean` (additive) | 2.8 |
| src/sim/systems/input.ts | B | `chat()` copies `all` onto the event | 2.8 |
| src/sim/snapshot.ts | B | event filter `case 'chat'`: `ev.team === team \|\| !!ev.all` | 2.8 |
| src/ai/bot/social.ts | A3 | `allChatReply(n)` called from `socialTick` (additive): an enemy bot may answer the human's all-chat line; uses the 45 s chat throttle, no new BotExt field | 2.8 |
| src/data/bots/chat.json | A3 | 9 new lines, `cat: "allReply"` (low/mid/high, 2 toxic) | 2.8 |
| src/data/bots/allchat.json (new) | A3 | reply chance per band, reaction delay | 2.8 |

## 2026-10-23 · A1 -> A2 Phase 3 (shove-and-recall coordination; no shared-file edit)

Measured with the beta brain (reflex + utility), Gold, 4 x 14 min, seeds 1-4, main e55cbbd + A1 55d4395 (harness
attribution fixed, see a1.md "csLossByCause attribution fixes"). Lane minions to 15:00: last-hit 28.5 %,
absent_recall 21.7 %, absent_heal 12.5 %, absent_dead 9.2 %, in-lane losses (in_range + timing + collision) 15 %,
distracted 7.2 %. Absence (44 %) is the CS/min 5.0 blocker; the reflex side is 15 %.

For A2 (@A2, owner of recallValue / intents):
1. Recall count: 8.4-8.8 recalls per laner by 14:00 at Gold (201 / 24 laners in 4 games, 423 / 48 in 8 games). Diamond
   (test-8 game, seeds 2/3): of the laner recall commands 16-30 are HP-driven (`t_hp` > 0), 3-8 item recalls. The HP
   term (stayDeathProb > recallStayDeathThreshold) fires far more often than the item term - check
   `stayDeath.hpBase` / threshold.
2. absent_heal includes the uRecall walk-off (mode `home`, "enemy minions near: walk off before recalling") because
   the harness maps mode `home` to a heal trip; it is recall cost in practice.
3. The reflex wave state does not read `mem.ext.wave = crash` (your crashWave). Honouring it was measured and gave no
   gain (a1.md "Phase 3"); the reflex keeps its own push rules. If you want push intents to force the push state,
   tell me and I will wire it behind a values.json switch.
4. tests/utilityRecall.test.ts (test 8) runs the utility model with the legacy lane leaf (`runUtilityGame` does not
   pass `{ reflex: true }`). The beta brain passes the same bound (item recalls 0.2-0.4 enemy minions near, n small).
## 2026-10-23 · Agent G (feel/g-shop) · render feel fixes in F's area (src/render/**), kept small, pushed first

| File | Owner | Change | Reason |
|---|---|---|---|
| src/render/spriteTiming.ts | D/F | + `castPoseActive`, `runRate`, `windupMsOf` (pure, tested in tests/spriteTiming.test.ts) | docs/IDEAS-FEEL-SHOP.md A1/A2/A6 |
| src/render/championSprites.ts | F | `push()`: cast pose ends one AFTER_MS after the release while walking (A1); run cycle phase accumulator `runPh` paced by the walked distance `x-px` per tick (A2); wind-up frames from the snapshot's `atkStart/atkEnd` (A6); champion flinch 13 u (A7); `intentFace(eid, dx, dy, now)` + `AnimState.intent` (A3). No change to frames, atlas, draw() | A1/A2/A3/A6/A7 |
| src/render/readability.json | D | `hitFlash.minGapMs` 250 -> 120 (tests/readability.test.ts reads the value) | A7 |
| src/render/world.ts | D | + `intentFace()` forwarding to units.champs | A3 |
| src/input/controller.ts | C | right click / attack-move call `world.intentFace` toward the ordered point | A3 |
| src/game/state.ts | lead | `EXTRAPOLATE_TICKS 0.5`: late snapshots extrapolate instead of freezing (tests/interp.test.ts) | A4 |
| src/game/game.ts | lead | minion/monster atlas bakes start 2.5 s after the clock | A4 |

If art/f-identity rewrites `push()`: the three hooks to keep are `castPoseActive(...)` in the cast branch, the `runPh` block for `anim === 'run'`, and the `intent` facing override before `turnToward`.

## 2026-10-23 · Agent G · src/ui/icons.ts (C) · icon rework (lead-assigned)

- `ITEM_GLYPHS` table + `badgeGlyph()`; `itemIcon` / `runeIcon` read `src/data/itemIcons.json` (`src/ui/iconTable.ts`).
  Ability / summoner / passive / stat / objective icons untouched. New items need a row in itemIcons.json
  (tests/itemIcons.test.ts fails otherwise).

## ui-polish

- `src/sim/snapshot.ts` (additive): `SnapEntity.auraLeft?: Record<string, number>` (seconds left per aura id) and
  `SnapEntity.buffs?: SnapMark[]` (jungle / objective mark buffs without champion prefix, champions only). `auras`,
  `marks` unchanged.
- `src/ui/tooltip.ts`: new spec `timed:<s>:<inner spec>` (inner tooltip + footer "Noch s s"); spec `text:` now splits
  at newlines (first line title, rest body).
- `src/i18n/de.json`, `en.json`: new keys `buff.left`, `castFail.item.*`, `hud.you`, `hud.pausedBy`, `hud.deadCam.*`,
  `ann.paused/pausedBy/resumed`, `chat.paused/resumed`; values changed: `hud.pausedHint` (now takes `{key}`),
  `hud.deadCamHint` (Space = death spot).
- `src/ui/menu.css`, `src/ui/style.css`: small additive rules (menu placeholder gradient + canvas fade, pause "by" line,
  respawn camera buttons, failed item flash).
- `HudHooks.focusCamera?` added (game.ts implements it). `Announcer.push` is public now.

## gfx-settings (partial, 2026-10-23)

- src/settings.ts: additive fields (gfx*, renderScale, fpsCap, showFps, gfxAutoDetected), `GraphicsQuality` widened (+veryLow, veryHigh, custom).
- src/game/settingsIO.ts: graphics enum = GRAPHICS_QUALITIES (2 lines).
- src/render/world.ts: quality applied via resolveQuality (3 lines).

## gfx-settings-2 (2026-10-26)

- src/input/keybinds.ts: new Action `fpsOverlay` (F3) + i18n `act.fpsOverlay`.
- src/game/game.ts: frame limiter in `loop`, fps overlay element + F3 listener, first-start benchmark (about 35 lines).
- src/game/settingsIO.ts: RANGES for renderScale, fpsCap, gfxParticles, gfxPixelRatio, gfxShadowMap.
- src/ui/settingsPanel.ts: video section; slider key union + `renderScale`.
- src/i18n: `set.gfx.*`, `set.renderScale`, `set.fpsCap*`, `set.showFps`, `set.autoDetect*`, `gfx.benchmark`, `act.fpsOverlay`.
- src/render/particles.ts: `density` field.

## summoners (swarm/summoners, 2026-10-23)

- src/ai/bot/brain.ts `utilitySpells`: +2 lines `push(n, barrierStep(...))`, `push(n, ghostStep(...))`; import extended. Steps live in src/ai/bot/spells.ts (additive); `exhaustStep` now prefers the enemy whose `atkTarget` is the protected unit (score -300). No new BotMemory fields, rng drawn only when Barrier fires (same pattern as cleanseStep).
- src/data/summoners.json: +`barriere` (no i18n json keys; names live in the json, tooltip text in src/ui/tooltip.ts SUMMONER_DESC).

## voice-lines (swarm/voice-lines)

Additive only: src/settings.ts (`voiceLines` + default), src/i18n/de.json + en.json (`set.voiceLines`), src/ui/settingsPanel.ts (1 row),
src/ui/overlay.ts (VoiceBubbles field, onEvent call, draw call), src/ui/classicLobby.ts + practiceLobby.ts (import + `renderPickLine` after `renderShowcase`).

## dodge-metrics (FEATURE-GAP 7.4)

- `src/sim/systems/projectiles.ts`: `hit()` passes `payload, x, y` to `trainerShotHit` (one line; the dodge trainer needs the shot id and impact point).
- `src/sim/trainer/common.ts`: `TrainerStat.fmt` gets `'ms'`; `TrainerHud` gets optional `dodge?: DodgeReport`.
- `src/i18n/de.json` + `en.json`: 32 new keys each, `trainer.stat.{reaction,panic,unnecessary,hitRate}` and `trainer.dodge.*` (appended at the end, same keys in both).
- `src/stats/history.ts`: `MatchRecord.trainer.metrics?` (optional, old records stay valid), new `trainerMetrics`, `trainerSeries`, `trainerTrend`, `withoutRun`.
- `src/ui/trainer.css`: `.dg-*` classes appended.

## 2026-10-26 · S1 · surrender vote + death recap hint: further shared-file edits · on ui/s1-features-2

| File | Owner | Change | Row |
|---|---|---|---|
| src/sim/types.ts | B | `Command` `ff` / `ffVote`; `SimEvent` `ff` (additive) | 2.10 |
| src/sim/systems/index.ts | B | `surrenderSystem` appended (no-op without a vote) | 2.10 |
| src/sim/systems/input.ts | B | `ff` / `ffVote` dispatch (also while dead) | 2.10 |
| src/sim/snapshot.ts | B | `case 'ff'`: team-private | 2.10 |
| src/ai/bot/social.ts | A3 | `surrenderVote` / `surrenderScore` / `votesYes`, called from `socialTick` | 2.10 |
| src/data/bots/chat.json | A3 | `surrender_yes` / `surrender_no` lines | 2.10 |
| src/ui/chat.ts, src/game/game.ts | C | `/ff` starts the vote; `SurrenderPanel` mounted | 2.10 |
| src/ui/deathRecap.ts, style.css | C | hint line `.dr-hint` | 1.14 |
| src/i18n/de.json, en.json | - | `ff.*`, `recap.hint.*`; removed `chat.ffNo` | 2.10, 1.14 |

## swarm/pings

| P-1 | 2026-10-26 | src/ai/bot/social.ts (`pingsIn`, `pingRetreat`) | Additive: a "back" ping (Zurueck ziehen) is heard up to 4000 units away (danger 2500), lasts 8 s, is never counter-pinged "ok", and makes `pingRetreat` walk towards the own fountain wherever the ping is. Danger behaviour unchanged. | Bots must back off on "Zurueck"/"Gefahr" (task swarm/pings). | applied on swarm/pings-2 |
| P-2 | 2026-10-26 | src/sim/types.ts, src/sim/systems/input.ts | Additive: optional `label?: string` on the `ping` command and `ping` event; label cleaned by `cleanPingLabel` (src/sim/pingRules.ts); PING_WINDOW/PING_MAX moved to pingRules.ts (same values 4 s / 6). | Context pings carry text. | applied |
| P-3 | 2026-10-26 | src/i18n/de.json, en.json | Added keys `pingctx.*` (+ ping texts), same keys in both. | Context ping texts. | applied |

## jungle-timers
- src/game/state.ts: `readonly jungle = new JungleTracker()` + `this.jungle.ingest(s, known)` next to the objectives tracker (3 lines).
- src/ui/overlay.ts: `drawJungleLabels` (world-space timers) + one call at the end of `draw`.
- src/ui/minimap.ts: `drawJungle` timer layer + one call after `drawGhosts`.
- src/ui/hud.ts: creates `JungleTrackerPanel` (toggle button + panel above the minimap), one-time setup in `update` (enabled only for mode 'classic', enemy jungler slots from `PlayerSetup.role`).
- src/i18n de/en: `jungle.*` keys (appended at the end).
- No settings.ts / controller.ts change: panel open state and the estimate option live in localStorage (`vg.jungle.open`, `vg.jungle.estimate`). No hotkey.

## scoreboard-bots (FEATURE-GAP 1.7)

- src/settings.ts: new `scoreBotInfo: boolean` (default false) in `Settings` + `DEFAULTS` (Tab scoreboard Bot-Info column).
- src/i18n/de.json, en.json: `score.botInfo`, `score.botInfoToggleTip`, `score.botInfoAxis`, `score.rankTip`, and 50 keys
  `tend.<axis>.<-2..2>` (tendency sentences per playstyle axis).
- src/ui/icons.ts: new exported `rankIcon(rank)` appended at the end (additive).

## keybinds

- src/settings.ts: `castModes` type widened to all CastKey; new `selfCastMod`, `levelUpMod` (+ DEFAULTS).
- src/game/settingsIO.ts: ENUMS for the two modifiers, castModes validation uses CAST_KEYS / CAST_MODES.
- src/i18n de/en: set.bind*, set.mod.*, set.selfCastMod, set.levelUpMod, set.presetLol*, set.castModeCol, set.modConflict.
- src/ui/menu.css, style.css: `.binds` grid 4 columns.
