# Shared-file change proposals

Format: date, agent, file, change, reason, status (proposed / approved / merged + commit).

## 2026-10-16 · C · src/sim/snapshot.ts · public objective + respawn fields (C2) · proposed

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

## 2026-10-16 · C · src/settings.ts · settings outside C's area (C7 heads-up) · proposed

`src/settings.ts` is not in C's file list (AGENTS-PLAN §7 lists src/ui, src/game, src/i18n, src/input). C7 needs new
settings (minimap scale/side, HP-bar style, enemy skillshot outline, quick-cast per key, settings export/import).
Proposal: allow C to add fields to `Settings`/`DEFAULTS` in `src/settings.ts` (additive only, no renames), or move the
file to `src/ui/settings.ts`. Until decided, C7 waits.

