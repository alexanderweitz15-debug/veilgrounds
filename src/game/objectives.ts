// Public objective state of both teams for the scoreboard and the death-timer bar (C2), derived on the client from
// fog-filtered snapshot events. Everything here is information a LoL player sees on screen: champion respawn timers,
// Leviathan stacks / soul, Schleierwaechter buff, inhibitor respawns. Fields the sim may later put into the snapshot
// (docs/agents/shared-changes.md: ScoreRow.respawnIn, Snapshot.objectives) win over the derived values.
//
// Timing: the events of a snapshot happened in the tick before `snap.tick` (sim.step increments the tick last), so
// a champion that died in that tick respawns at (snap.tick - 1) + deathTimerTicks(level, snap.tick - 1), exactly
// Champ.respawnAt (src/sim/systems/economy.ts championDeath).
import type { ScoreRow, Snapshot } from '../sim/snapshot';
import { Kind, type SimEvent } from '../sim/types';
import { deathTimerTicks } from '../sim/systems/economy';
import { LEVIATHAN_MAX_STACKS, SCHLEIER_BUFF_TICKS } from '../sim/systems/jungle';
import { INHIB_RESPAWN } from '../sim/systems/towers';
import raw from '../data/map.json';

const OBJ = raw.neutral.objectives;
const TICK_HZ = 30;
/** Radius of epic monsters (always announced to both teams, src/sim/snapshot.ts teamEvents). */
const EPIC_R = 130;
const SCHLEIER_R = 150;
/** An inhibitor that respawned stands within this distance of its death point. */
const SAME_SPOT2 = 200 * 200;

type DeathEvent = Extract<SimEvent, { e: 'death' }>;
export type Epic = 'leviathan' | 'schleier' | 'kesselbrut';

/** Optional sim-side objective block (proposal in docs/agents/shared-changes.md); index = team. */
export interface SnapObjectives {
  leviathan?: [number, number];
  kesselbrut?: [number, number];
  /** Seconds left of the Schleierwaechter buff per team (0 = none). */
  schleierLeft?: [number, number];
  /** Destroyed inhibitors with seconds until they respawn. */
  inhibs?: { team: number; left: number }[];
}

/** ScoreRow / Snapshot with the optional fields of the proposal (absent until the sim sends them). */
type RowExt = ScoreRow & { respawnIn?: number };
type SnapExt = Snapshot & { objectives?: SnapObjectives };

export interface TeamObjectives {
  /** Leviathan stacks (0..LEVIATHAN_MAX_STACKS); `soul` once the maximum is reached. */
  leviathan: number;
  soul: boolean;
  /** Kesselbrut stacks; null = unknown (enemy grubs die in the fog until the sim reports both teams). */
  kesselbrut: number | null;
  /** Seconds left of the Schleierwaechter buff (0 = none). */
  schleierLeft: number;
  /** Seconds until each destroyed inhibitor of this team respawns (ascending). */
  inhibRespawn: number[];
}

/**
 * Which epic monster a death event belongs to: by the last seen radius, else by the death position. Grubs (radius 70)
 * only arrive when the team killed them or saw it.
 */
export function epicOf(ev: DeathEvent, radius: number | undefined, variant?: string): Epic | null {
  if (ev.kind !== Kind.Monster) return null;
  if (variant === 'kesselbrut') return 'kesselbrut';
  const near = (p: { x: number; y: number }, r: number): boolean => (ev.x - p.x) ** 2 + (ev.y - p.y) ** 2 < r * r;
  if (radius !== undefined) {
    if (radius >= SCHLEIER_R) return 'schleier';
    if (radius >= EPIC_R) return 'leviathan';
    return near(OBJ.kesselbrut, 700) ? 'kesselbrut' : null;
  }
  if (near(OBJ.leviathan, 1200)) return 'leviathan';
  if (near(OBJ.schleierwaechter, 1200)) return 'schleier';
  return null;
}

interface Unit {
  radius: number;
  variant?: string;
}

export class ObjectiveTracker {
  /** Respawn tick per champion, keyed `team:champ` (ScoreRow has no eid). */
  private readonly respawnAt = new Map<string, number>();
  private readonly leviathan: [number, number] = [0, 0];
  /** Grub kills this view saw (own kills always, enemy kills only in vision). */
  private readonly grubsSeen: [number, number] = [0, 0];
  private readonly schleierUntil: [number, number] = [0, 0];
  /** Champions of the team that got the Schleierwaechter buff and have not died since (the buff ends on death). */
  private readonly schleierHolders: [Set<string>, Set<string>] = [new Set(), new Set()];
  private readonly inhibs: { team: number; x: number; y: number; at: number }[] = [];
  private tick = 0;
  private snap: SnapExt | null = null;

  /** Feed every snapshot (several per frame are possible; events must not be skipped). */
  ingest(s: Snapshot, unit: (eid: number) => Unit | undefined = () => undefined): void {
    this.snap = s as SnapExt;
    this.tick = s.tick;
    const evTick = s.tick - 1;
    for (const ev of s.events) {
      if (ev.e !== 'death') continue;
      if (ev.kind === Kind.Champion && ev.team <= 1 && ev.champ) {
        const key = `${ev.team}:${ev.champ}`;
        const row = s.players.find((p) => p.team === ev.team && p.champ === ev.champ);
        if (row) this.respawnAt.set(key, evTick + deathTimerTicks(row.level, evTick));
        this.schleierHolders[ev.team as 0 | 1]?.delete(key);
      } else if (ev.kind === Kind.Inhibitor && ev.team <= 1) {
        this.inhibs.push({ team: ev.team, x: ev.x, y: ev.y, at: evTick + INHIB_RESPAWN });
      } else if (ev.kind === Kind.Monster) {
        const u = unit(ev.eid);
        const which = epicOf(ev, u?.radius, u?.variant);
        const team = ev.killerTeam;
        // the sim grants objective rewards only to champion kills (jungle.ts onMonsterDeath)
        if (!which || (team !== 0 && team !== 1) || ev.killerKind !== Kind.Champion) continue;
        if (which === 'leviathan') this.leviathan[team] = Math.min(LEVIATHAN_MAX_STACKS, this.leviathan[team] + 1);
        else if (which === 'kesselbrut') this.grubsSeen[team]++;
        else {
          this.schleierUntil[team] = evTick + SCHLEIER_BUFF_TICKS;
          this.schleierHolders[team] = new Set(s.players.filter((p) => p.team === team && !p.dead).map((p) => `${p.team}:${p.champ}`));
        }
      }
    }
    // respawned: the row says alive (also covers sandbox revives and missed events)
    for (const p of s.players) if (!p.dead) this.respawnAt.delete(`${p.team}:${p.champ}`);
    // an inhibitor stands again (structures are always in the snapshot) or its timer ran out
    for (let i = this.inhibs.length - 1; i >= 0; i--) {
      const d = this.inhibs[i]!;
      const back = s.entities.some((e) => e.kind === Kind.Inhibitor && e.alive && (e.x - d.x) ** 2 + (e.y - d.y) ** 2 < SAME_SPOT2);
      if (back || s.tick >= d.at) this.inhibs.splice(i, 1);
    }
  }

  /** Seconds until a dead champion respawns (sim field first); null = alive or unknown. */
  respawnIn(row: ScoreRow): number | null {
    if (!row.dead) return null;
    const sim = (row as RowExt).respawnIn;
    if (sim !== undefined) return sim;
    const at = this.respawnAt.get(`${row.team}:${row.champ}`);
    return at === undefined ? null : Math.max(0, (at - this.tick) / TICK_HZ);
  }

  /** Objective state of one team (sim fields first). */
  team(team: 0 | 1): TeamObjectives {
    const o = this.snap?.objectives;
    const lev = o?.leviathan?.[team] ?? this.leviathan[team];
    const own = this.snap?.team === team;
    // own team: snap.kesselbrut is exact (absent while 0); enemy: only a sim field is exact
    const kessel = o?.kesselbrut?.[team] ?? (own ? (this.snap?.kesselbrut ?? 0) : this.grubsSeen[team] > 0 ? this.grubsSeen[team] : null);
    const schleierDerived = this.schleierHolders[team].size > 0 ? Math.max(0, (this.schleierUntil[team] - this.tick) / TICK_HZ) : 0;
    const inhibRespawn = o?.inhibs
      ? o.inhibs.filter((x) => x.team === team).map((x) => x.left)
      : this.inhibs.filter((x) => x.team === team).map((x) => Math.max(0, (x.at - this.tick) / TICK_HZ));
    return {
      leviathan: lev,
      soul: lev >= LEVIATHAN_MAX_STACKS,
      kesselbrut: kessel,
      schleierLeft: o?.schleierLeft?.[team] ?? schleierDerived,
      inhibRespawn: inhibRespawn.sort((a, b) => a - b),
    };
  }

  /** Dead champions of both teams with seconds left (soonest first): the bar above the minimap. */
  deadList(): { row: ScoreRow; left: number | null }[] {
    const rows = this.snap?.players ?? [];
    return rows
      .filter((r) => r.dead)
      .map((row) => ({ row, left: this.respawnIn(row) }))
      .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || a.row.slot - b.row.slot);
  }
}
