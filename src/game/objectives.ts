// Public objective state of both teams for the scoreboard, the death-timer bar and the top-bar timers (C2/C3).
// The sim sends the public values in the snapshot (B, 19 Oct: ScoreRow.respawnIn, Snapshot.objectives); this module
// only adds what the snapshot does not carry: the (re)spawn countdowns of the epic monsters, derived from the public
// epic death events (`ev.epic`, B6) and the camp schedule.
//
// Timing: the events of a snapshot happened in the tick before `snap.tick` (sim.step increments the tick last).
import type { ScoreRow, Snapshot } from '../sim/snapshot';
import { Kind, type SimEvent } from '../sim/types';
import { CAMPS, LEVIATHAN_MAX_STACKS } from '../sim/systems/jungle';
import raw from '../data/map.json';

const OBJ = raw.neutral.objectives;
const TICK_HZ = 30;
const SCHLEIER_R = 150;

type DeathEvent = Extract<SimEvent, { e: 'death' }>;
export type Epic = 'leviathan' | 'schleier' | 'kesselbrut';

export interface TeamObjectives {
  /** Leviathan stacks (0..LEVIATHAN_MAX_STACKS); `soul` once the maximum is reached. */
  leviathan: number;
  soul: boolean;
  /** Kesselbrut stacks (public for both teams). */
  kesselbrut: number;
  /** Seconds left of the Schleierwaechter buff (0 = none). */
  schleierLeft: number;
  /** Seconds until each destroyed inhibitor of this team respawns (ascending). */
  inhibRespawn: number[];
}

/**
 * Which epic monster a death event belongs to (epic deaths carry `epic: true` and reach both teams, B6): by the last
 * seen type / radius, else by the death position and time (the pit holds the Kesselbrut until the Schleierwaechter's
 * first spawn). Non-epic monsters -> null.
 */
export function epicOf(ev: DeathEvent, radius: number | undefined, variant?: string, time?: number): Epic | null {
  if (ev.kind !== Kind.Monster || !ev.epic) return null;
  if (variant === 'kesselbrut') return 'kesselbrut';
  if (variant === 'leviathan') return 'leviathan';
  if (variant === 'schleierwaechter') return 'schleier';
  const near = (p: { x: number; y: number }): boolean => (ev.x - p.x) ** 2 + (ev.y - p.y) ** 2 < 1200 * 1200;
  if (near(OBJ.leviathan)) return 'leviathan';
  if (radius !== undefined) return radius >= SCHLEIER_R ? 'schleier' : 'kesselbrut';
  return time !== undefined && time < CAMPS.schleierwaechter.first ? 'kesselbrut' : 'schleier';
}

interface Unit {
  radius: number;
  variant?: string;
}

export class ObjectiveTracker {
  private tick = 0;
  private snap: Snapshot | null = null;
  /** Last death tick of Leviathan / Schleierwaechter (any killer: the camp timer starts either way); -1 = never. */
  private readonly epicKill = { leviathan: -1, schleier: -1 };
  /** Grub deaths in the current Kesselbrut wave and the tick the next wave spawns (-1 = none pending). */
  private grubDeaths = 0;
  private grubRespawnAt = -1;

  private noteEpicDeath(which: Epic, tick: number): void {
    if (which !== 'kesselbrut') {
      this.epicKill[which] = tick;
      return;
    }
    if (this.grubRespawnAt >= 0 && tick >= this.grubRespawnAt) this.grubRespawnAt = -1;
    if (++this.grubDeaths < CAMPS.kesselbrut.monsters.length) return;
    // last grub down: the pit refills after `respawn`, unless that is past `lastSpawn` (jungle.ts onMonsterDeath)
    const def = CAMPS.kesselbrut;
    const at = tick + def.respawn * TICK_HZ;
    this.grubRespawnAt = def.lastSpawn !== undefined && at > def.lastSpawn * TICK_HZ ? Infinity : at;
    this.grubDeaths = 0;
  }

  /**
   * Epic monster timers for the top bar (classic schedule, public like LoL): seconds until (re)spawn, or null while
   * it is up. Kesselbrut drops out once it left the pit or its last wave closed.
   */
  epicTimers(): { kind: Epic; left: number | null }[] {
    const out: { kind: Epic; left: number | null }[] = [];
    const add = (kind: Epic, at: number): void => {
      out.push({ kind, left: this.tick >= at ? null : (at - this.tick) / TICK_HZ });
    };
    const lev = CAMPS.leviathan;
    add('leviathan', this.epicKill.leviathan >= 0 ? this.epicKill.leviathan + lev.respawn * TICK_HZ : lev.first * TICK_HZ);
    const kb = CAMPS.kesselbrut;
    if (this.tick < (kb.until ?? Infinity) * TICK_HZ && this.grubRespawnAt !== Infinity) add('kesselbrut', this.grubRespawnAt >= 0 ? this.grubRespawnAt : kb.first * TICK_HZ);
    const sw = CAMPS.schleierwaechter;
    add('schleier', this.epicKill.schleier >= 0 ? this.epicKill.schleier + sw.respawn * TICK_HZ : sw.first * TICK_HZ);
    return out;
  }

  /** Replay seek: rebuild the epic respawn clocks from the last Leviathan / Schleierwaechter kill ticks before the new position. */
  restoreEpicKills(k: { leviathan?: number; schleier?: number }): void {
    this.epicKill.leviathan = k.leviathan ?? -1;
    this.epicKill.schleier = k.schleier ?? -1;
    this.grubDeaths = 0;
    this.grubRespawnAt = -1; // ponytail: Kesselbrut wave state is not restored after a seek (timer shows the first spawn)
  }

  /** Feed every snapshot (several per frame are possible; events must not be skipped). */
  ingest(s: Snapshot, unit: (eid: number) => Unit | undefined = () => undefined): void {
    this.snap = s;
    this.tick = s.tick;
    const evTick = s.tick - 1;
    for (const ev of s.events) {
      if (ev.e !== 'death' || ev.kind !== Kind.Monster) continue;
      const u = unit(ev.eid);
      const which = epicOf(ev, u?.radius, u?.variant, evTick / TICK_HZ);
      if (which) this.noteEpicDeath(which, evTick);
    }
  }

  /** Seconds until a dead champion respawns (ScoreRow.respawnIn, public); null = alive or unknown. */
  respawnIn(row: ScoreRow): number | null {
    return row.dead ? (row.respawnIn ?? null) : null;
  }

  /** Objective state of one team (Snapshot.objectives; zeros before the first snapshot / for spectators). */
  team(team: 0 | 1): TeamObjectives {
    const o = this.snap?.objectives;
    const lev = o?.leviathan[team] ?? 0;
    return {
      leviathan: lev,
      soul: lev >= LEVIATHAN_MAX_STACKS,
      kesselbrut: o?.kesselbrut[team] ?? 0,
      schleierLeft: o?.schleierLeft[team] ?? 0,
      inhibRespawn: (o?.inhibs ?? []).filter((x) => x.team === team).map((x) => x.left).sort((a, b) => a - b),
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
