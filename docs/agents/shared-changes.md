# Shared-file change proposals

Format: date, agent, file, change, reason, status (proposed / approved / merged + commit).

## A3 (brain/a3-humanize)

| # | Date | File | Change | Reason | Status |
|---|---|---|---|---|---|
| A3-1 | 2026-10-16 | src/ai/profiles/schema.ts | `RankBehavior` + 8 numeric fields: `utilityNoisePct`, `distractionIntervalS`, `distractionDurMedianS`, `distractionDurSigma`, `minimapGlancePlannedPct`, `distractKillFeedPct`, `distractShopPct`, `distractChatPct` (type only, additive; values in the ten profile JSONs) | §5 utility noise, §9 attention rates; tsc strict needs the type. A1 adds its seven §4.7 reflex fields in the same interface (lead decision) - both blocks are appended, rebase is additive | done on brain/a3-humanize (type-only, not in anyone's list) |
| A3-2 | 2026-10-16 | src/ai/contract.ts | `Knob` union + `harassRateShift`, `utilFarm`, `utilTrade`, `utilHarass`, `utilRoam`, `utilPush`, `utilRecall`, `utilObjective`, `utilVision`, `utilGroup`, `utilCatchLane` (definitions in playstyleAxes.json) | §4.3 harass budget ±3 by aggression, §5 "alle Stil-Faktoren in playstyleAxes.json" (factors 0.6-1.6) for A2; botParams test requires Knob union == KNOB_DEFS | done on brain/a3-humanize (additive) |
| A3-3 | 2026-10-16 | src/i18n/de.json, en.json, src/ui/playstyle.css | 4 overlay keys (`botDebug.intent/plans/util/attention`), 2 CSS rules | F9 overlay columns (§3) | done on brain/a3-humanize (additive) |
| A3-4 | 2026-10-16 | src/ai/runner.ts (A1) | Wire the attention model: per decision after `think` `observeAttention(mem, ctx, snap)` with the think snapshot (only there: its eventTicks dedupe events; a per-tick reflex snapshot without eventTicks would double-count), and `reflexState(mem).attention ??= attentionProbe(mem)` (reflex only queries it) and `actions.push(...detectErrors(mem, ctx, snap.tick))`; `debugRows()` adds `reflex: reflexDebug(b.mem, tick)` and `attention: attentionDebug(b.mem, tick)` (both from src/ai/humanize/attention.ts / A1's plan.ts; fields are optional in `BotDebugInfo`) | §9 and §3 overlay; the attention model has its own Rng (personality seed), so wiring it does not shift the bots' Rng streams | proposed |
| A3-5 | 2026-10-16 | src/ai/bot/lasthit.ts (A1) | Remove the per-minion lapse (`LAPSE_SHARE`, `roll.skip`); last-hit plans are cancelled with `distracted` while `isDistracted(mem, tick)` | §9 "nicht mehr pro Minion"; otherwise lapses are counted twice (lapse cache + attention windows) and test 10 clause 3 fails | proposed |
| A3-6 | 2026-10-16 | src/ai/bt/leaves.ts (runTree) | `withTilt(ctx.params, mem.ext.tilt)` -> `withTilt(ctx.params, mem.ext.tilt, 'attention')` in the same commit that wires A3-4 | §9: tilt acts via distraction windows (x tilt x 30 %) + aggression only. Switching earlier would make tilt a no-op for execution | proposed (after A3-4) |
| A3-7 | 2026-10-16 | callers of `sampleReactionMs` (brain.ts dodge, perception) and of `predictiveDodgePct` | add `reactionPenaltyMs(mem, tick)` (+150 ms while distracted); no predictive dodge while `attentionAt(mem, tick).predictiveDodge` is false | §9 effects while distracted | proposed |
| A3-8 | 2026-10-16 | src/sim/types.ts | `PING_KINDS` + `'myBad'` ("Mein Fehler"), render icon/label | §9 detection ping; until then `detectErrors` says it in team chat (`attention.json myBad.text`) | proposed |
| A3-9 | 2026-10-16 | error call sites (brain.ts ignore_minion_aggro, trade.ts chase_third_kill / overcommit_after_kill, macro idle_after_shove, ...) | replace `rollError` + own timers by `rollErrorEpisode(mem, ctx, id, tick, rng)` (same single draw) and keep the wrong behaviour while `errorActive(mem, id, tick)`; durations in errors.json `durS` | §9 error duration + detection | proposed (owners A1/A2 per file) |
| A3-10 | 2026-10-16 | A2 utility logging | keep logging every intent choice with `node: 'utility'` (as on brain/a2-utility ecdd3f3; `INTENT_NODE` in src/ai/log.ts), `chosen` = intent, `scores` = all candidate scores. Rank noise: the profile field `utilityNoisePct` (Iron 40, Gold 20, Challenger 7) can replace `exchangeNoise(skill)`; style factors: knobs `util*` | the F9 overlay reads intent + top-3 candidates from that node; without it the overlay shows the tree node as before | convention matched to A2 |

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
## A2 (brain/a2-utility)

All A2 hooks keep flag-off behaviour bit-identical: every changed line is behind `utilityOn(ctx)`
(src/ai/utility/flag.ts), which returns false unless `BotStatic.utility` or `BOT_UTILITY=1` is set.

| # | Date | File | Change | Reason | Status |
|---|---|---|---|---|---|
| A2-1 | 2026-10-16 | src/data/bots/tree.json, src/ai/bt/leaves.ts | Insert `{ "type": "action", "name": "utilitySelect" }` into the `main` selector directly after `arena` (before `combat`). Registry line in leaves.ts: `utilitySelect: (n) => (utilityOn(n.ctx) ? utilitySelect(n) : 'failure'),` with `import { utilityOn } from '../utility/flag'; import { utilitySelect } from '../utility/select';`. After the merge A2 removes the interim hook (first line of `tradeRun` in trade.ts). | §3/§5: the utility selector replaces the order of combat / objective / recall / idleAfterShove / role / vision; survive, dodge, peel, dead/recallChannel/fountain, housekeeping stay before it. Flag off: the node fails at once (no rng, no log, no memory write), the selector falls through unchanged. Interim until merged: `tradeRun` (first leaf of `combat`, A2's file) calls `utilitySelect` when the flag is on - F9 then shows `combat/tradeRun` as the running branch. | proposed |
| A2-2 | 2026-10-16 | src/sim/types.ts, src/ai/bot/types.ts, src/ai/runner.ts (A1) | `SimConfig.botUtility?: boolean`; `BotStatic.utility?: boolean`; runner: `utility: config.botUtility,` in the BotStatic literal. | Browser/lobby switch for the utility model (the env variable only exists in node). `utilityOn` already reads `ctx.utility` untyped; the harness sets it per bot (tests/utilityHarness.ts). Default switch (§12) only after A1 Phase 2 is on main. | proposed |
| A2-3 | 2026-10-16 | src/ai/bot/brain.ts `retreat` | `const goHome = !utilityOn(ctx) && (v.hpPct < lowHp \|\| (mem.mode === 'retreat' && v.hpPct < 0.4) \|\| mem.mode === 'home');` and `if (mem.mode === 'retreat' \|\| (mem.mode === 'home' && !utilityOn(ctx))) mem.mode = 'lane';` | §4.6 "retreat führt nicht mehr automatisch heim": with the flag the flee part stays (survive), the walk home becomes the recall candidate (`recallValue`: stay-death > 0.3 or an item). Measured (Diamond, 8 min, flag on, seed 1): 29 of 34 laner recalls came from this branch ("recall / low hp"), so test 8 cannot hold until it is gated. | proposed |
| A2-4 | 2026-10-16 | docs/agents/plan-api.md / src/ai/plan.ts (A1) | Second intent kind for reflex filling during a trade disengage (§6.1): `{ kind: 'disengage'; lane: LaneName; from: number /* enemy eid */; back: Pt /* own stand point side */; until: number; harass: boolean }`. Reflex: orbwalk toward `back`, fill free attack periods with autos on minions in reach (or the champion when `harass`), last-hit plans as in laneFarm. A2's trade intent sets it when a trade ends (`endTrade`) for `disengageUntil`. | §6.1 "nach dem Abbruch Disengage per Orbwalk zum Stehpunkt; währenddessen läuft der Angriffs-Scheduler weiter". | proposed (A1 accepted the idea in review-2026-10-16) |
| A2-5 | 2026-10-16 | A3: profiles + playstyleAxes.json | A2 reads `RankBehavior.utilityNoisePct` (A3-1) and the knobs `utilFarm`, `utilHarass`, `utilTrade`, `utilPush`, `utilRoam`, `utilRecall`, `utilObjective`, `utilVision`, `utilGroup`, `utilCatchLane` (A3-2) when present; fallbacks until merged: `exchangeNoise(skill)` (same numbers) and the axis mappings in values.json `style`. Logged under node `intent` (A3-10, `VALUES.selection.logNode`). | No new shared change; listed so the merge order is clear. | info |
## 2026-10-16 · C · src/sim/snapshot.ts · public objective + respawn fields (C2) · merged by B on sim/b-mechanics 2026-10-19 (objectives {leviathan, kesselbrut, schleierLeft, inhibs}, ScoreRow.respawnIn, ScoreRow.summonerCds; visionScore/champDamage NOT done: no sim source yet; tests/objectives.test.ts fixture got the two new required fields)

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

`src/settings.ts` is not in C's file list (AGENTS-PLAN §7 lists src/ui, src/game, src/i18n, src/input). C7 needs new
settings (minimap scale/side, HP-bar style, enemy skillshot outline, quick-cast per key, settings export/import).
Proposal: allow C to add fields to `Settings`/`DEFAULTS` in `src/settings.ts` (additive only, no renames), or move the
file to `src/ui/settings.ts`. Until decided, C7 waits.


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
