// Jungle tracker (client only, training value: tracking camps like a good LoL player). Fog-safe by construction: it
// reads nothing but the team snapshot. The snapshot already hides what the team did not see (snapshot.teamEvents:
// camp kills in the fog are dropped, only kills in vision or by an own champion arrive; monsters outside vision are
// not in `entities`), so a timer can only ever start from something this team really observed:
//   cleared   a camp's monsters died in vision -> exact respawn time (death tick + CAMPS[id].respawn)
//   empty     the camp centre is in own vision, no monster there, but no kill was seen -> the kill happened at some
//             unknown time: only an upper bound (now + respawn) is known, shown as "~m:ss"
//   up        monsters of the camp were seen alive (last known state, with the age of the sighting)
//   unknown   no observation (or the timer ran out unseen) -> "?"
//   pending   before the first spawn: the public game schedule (CAMPS[id].first), like the match clock
//   estimate  OPTIONAL, off by default: the enemy jungler was last seen near a camp that is out of vision. Marked as
//             an estimate everywhere ("~" and "?"), never overrides an observation.
// Spawn timings come from the shared sim data (src/sim/systems/jungle.ts CAMPS); the sim itself is not touched.
// Epic objectives (Leviathan, Kesselbrut, Schleierwaechter) stay with ObjectiveTracker (public by design).
import type { Snapshot, SnapEntity } from '../sim/snapshot';
import { Kind, type SimEvent } from '../sim/types';
import { CAMPS, type CampId } from '../sim/systems/jungle';
import { visionRadius } from '../render/coords';
import raw from '../data/map.json';

const TICK_HZ = 30;
/** Camp centre counts as "in vision" when this much inside the vision circle (monsters stand up to ~250 off centre). */
const VISION_MARGIN = 300;
/** A monster belongs to the nearest camp of its type within this distance (leash 900 + spread); scuttlers flee. */
const MONSTER_R = 1400;
const FLEE_R = 3000;
/** Death without a known type: nearest camp within this distance. */
const DEATH_R = 1100;
/** A death this recent (ticks) with the camp centre in vision and no monster left reads as "camp cleared". */
const CLEAR_GRACE = 3 * TICK_HZ;
/** Respawn needs a few ticks to show up in a snapshot; "empty" is not judged inside this window. */
const SPAWN_SLACK = 3;
/** Estimate: enemy jungler seen this close to an unseen camp... */
export const ESTIMATE_R = 1500;
/** ...is assumed to need this long to clear it before the respawn timer starts. */
export const ESTIMATE_CLEAR_S = 25;

export type CampState = 'pending' | 'up' | 'cleared' | 'empty' | 'estimate' | 'unknown';

export interface CampSite {
  /** Unique: `0:dornenbock`, `1:dornenbock`, `river:0`. */
  key: string;
  id: CampId;
  /** Map side the camp belongs to (0 / 1), 2 = river. */
  side: 0 | 1 | 2;
  x: number;
  y: number;
}

export interface CampView extends CampSite {
  state: CampState;
  /** Seconds to the (expected) respawn / first spawn; null when no countdown applies. */
  left: number | null;
  /** The countdown is a bound or a guess, not an exact value (empty, estimate). */
  approx: boolean;
  /** Camp centre is in the own team's vision right now. */
  visible: boolean;
  /** Seconds since monsters of this camp were last seen alive; null = never. */
  seenAgo: number | null;
}

/** All tracked camps: 6 per side from map.json (red side is the point mirror of blue) plus the two river scuttlers. */
export function campSites(): CampSite[] {
  const S = raw.size;
  const out: CampSite[] = [];
  for (const side of [0, 1] as const) {
    for (const c of raw.blue.camps) {
      if (!(c.id in CAMPS) || CAMPS[c.id as CampId].epic) continue;
      out.push({ key: `${side}:${c.id}`, id: c.id as CampId, side, x: side === 0 ? c.x : S - c.x, y: side === 0 ? c.y : S - c.y });
    }
  }
  raw.neutral.objectives.nebelschleicher.forEach((p, i) => out.push({ key: `river:${i}`, id: 'nebelschleicher', side: 2, x: p.x, y: p.y }));
  return out;
}

/** Camp id by monster type (mooswolf / mooswelpe -> moosrudel, ...). Epic monsters are not tracked here. */
const CAMP_OF_TYPE = new Map<string, CampId>();
for (const id of Object.keys(CAMPS) as CampId[]) if (!CAMPS[id].epic) for (const m of CAMPS[id].monsters) CAMP_OF_TYPE.set(m.type, id);

interface Rec {
  site: CampSite;
  /** Tick monsters of the camp were last seen alive (-1 = never). */
  lastUp: number;
  /** Observed clear: tick of the last kill and the exact respawn tick (-1 = none). */
  clearedAt: number;
  respawnAt: number;
  /** Seen empty without a kill: upper bound of the respawn tick (-1 = none). */
  emptyHi: number;
  /** Monsters (eids) seen dying in the current wave, and the tick of the latest one. */
  deaths: Set<number>;
  lastDeath: number;
  /** Tick the enemy jungler was last seen near this camp while it was out of vision (-1 = never). */
  estimateAt: number;
  visible: boolean;
}

export interface UnitInfo {
  variant?: string;
  kind?: number;
}

export class JungleTracker {
  /** Option: show "probably taken" estimates from enemy jungler sightings (always recorded, only shown when on). */
  estimate = false;
  /** Set false by the HUD in modes without a jungle (everything UI-side stays hidden). */
  enabled = true;
  private tick = 0;
  private team = 0;
  private junglers = new Set<number>();
  private readonly recs: Rec[] = campSites().map((site) => ({
    site, lastUp: -1, clearedAt: -1, respawnAt: -1, emptyHi: -1, deaths: new Set<number>(), lastDeath: -1, estimateAt: -1, visible: false,
  }));

  /** Slots of the enemy junglers (PlayerSetup.role === 'jungle'); only they feed the estimate. */
  setJunglers(slots: Iterable<number>): void {
    this.junglers = new Set(slots);
  }

  get now(): number {
    return this.tick;
  }

  /** Feed every snapshot in order (events must not be skipped). `unit` looks up a unit seen earlier (state.known). */
  ingest(s: Snapshot, unit: (eid: number) => UnitInfo | undefined = () => undefined): void {
    this.tick = s.tick;
    this.team = s.team;
    const evTick = s.tick - 1; // events of a snapshot happened in the tick before snap.tick
    const own = s.entities.filter((e) => e.team === s.team && e.alive);
    for (const r of this.recs) r.visible = inVision(own, r.site.x, r.site.y);

    // 1) kills seen in this snapshot
    for (const ev of s.events) {
      if (ev.e !== 'death' || ev.kind !== Kind.Monster || ev.epic) continue;
      const r = this.recOfDeath(ev, unit(ev.eid));
      if (!r) continue;
      r.deaths.add(ev.eid);
      r.lastDeath = evTick;
    }

    // 2) monsters alive in this snapshot: the camp is up (last known state)
    const upNow = new Set<Rec>();
    for (const e of s.entities) {
      if (e.kind !== Kind.Monster || !e.alive || !e.variant) continue;
      const r = this.recOfMonster(e);
      if (r) upNow.add(r);
    }
    for (const r of upNow) {
      r.lastUp = s.tick;
      r.clearedAt = r.respawnAt = r.emptyHi = r.estimateAt = -1;
      // keep the wave's death count while members live: the camp is only cleared when the last one is down
    }

    for (const r of this.recs) {
      const def = CAMPS[r.site.id];
      const R = def.respawn * TICK_HZ;
      const firstAt = def.first * TICK_HZ;
      if (upNow.has(r)) continue;
      // 3) kills seen, nobody left: cleared. All members seen dying, or the camp centre is in vision (a member chased
      // out of sight does not hide a clear - decision: read it as a LoL player would).
      if (r.deaths.size > 0 && (r.respawnAt < 0 || s.tick - 1 >= r.respawnAt)) {
        const all = r.deaths.size >= def.monsters.length;
        if (all || (r.visible && s.tick - 1 - r.lastDeath <= CLEAR_GRACE)) {
          r.clearedAt = r.lastDeath;
          r.respawnAt = r.lastDeath + R;
          r.emptyHi = r.estimateAt = -1;
          r.deaths.clear();
          continue;
        }
      }
      // 4) camp centre in vision, empty, no kill seen: taken at an unknown time -> upper bound only
      const pastTimer = r.respawnAt < 0 || s.tick >= r.respawnAt + SPAWN_SLACK;
      if (r.visible && s.tick >= firstAt + SPAWN_SLACK && pastTimer && (r.emptyHi < 0 || s.tick >= r.emptyHi)) {
        r.emptyHi = s.tick + R;
        r.respawnAt = r.clearedAt = r.estimateAt = -1;
        r.deaths.clear();
      }
    }

    // 5) estimate: enemy jungler seen near a camp the team cannot see
    for (const e of s.entities) {
      if (e.kind !== Kind.Champion || !e.alive || e.team === s.team || e.team > 1 || !this.junglers.has(e.slot)) continue;
      for (const r of this.recs) {
        if (r.visible || (e.x - r.site.x) ** 2 + (e.y - r.site.y) ** 2 > ESTIMATE_R * ESTIMATE_R) continue;
        if (this.baseState(r, s.tick) === 'up' || this.baseState(r, s.tick) === 'unknown') r.estimateAt = s.tick;
      }
    }
  }

  private recOfDeath(ev: Extract<SimEvent, { e: 'death' }>, u: UnitInfo | undefined): Rec | undefined {
    const variant = u && (u.kind === undefined || u.kind === Kind.Monster) ? u.variant : undefined;
    const id = variant ? CAMP_OF_TYPE.get(variant) : undefined;
    return nearest(this.recs, ev.x, ev.y, id, id === 'nebelschleicher' ? FLEE_R : id ? MONSTER_R : DEATH_R);
  }

  private recOfMonster(e: SnapEntity): Rec | undefined {
    const id = CAMP_OF_TYPE.get(e.variant!);
    return id ? nearest(this.recs, e.x, e.y, id, id === 'nebelschleicher' ? FLEE_R : MONSTER_R) : undefined;
  }

  /** State from observations alone (no estimate). */
  private baseState(r: Rec, tick: number): CampState {
    const def = CAMPS[r.site.id];
    if (tick < def.first * TICK_HZ) return 'pending';
    if (r.respawnAt >= 0 && tick < r.respawnAt) return 'cleared';
    if (r.emptyHi >= 0 && tick < r.emptyHi) return 'empty';
    return r.lastUp >= 0 && r.lastUp >= Math.max(r.respawnAt, r.emptyHi) ? 'up' : 'unknown';
  }

  /** Camps in map order (own side first when `myTeam` is given). */
  camps(): CampView[] {
    const tick = this.tick;
    return this.recs.map((r) => {
      const def = CAMPS[r.site.id];
      let state = this.baseState(r, tick);
      let left: number | null = null;
      let approx = false;
      if (state === 'pending') left = (def.first * TICK_HZ - tick) / TICK_HZ;
      else if (state === 'cleared') left = (r.respawnAt - tick) / TICK_HZ;
      else if (state === 'empty') {
        left = (r.emptyHi - tick) / TICK_HZ;
        approx = true;
      } else if (this.estimate && r.estimateAt >= 0 && (state === 'up' || state === 'unknown')) {
        const at = r.estimateAt + (ESTIMATE_CLEAR_S + def.respawn) * TICK_HZ;
        if (tick < at) {
          state = 'estimate';
          left = (at - tick) / TICK_HZ;
          approx = true;
        }
      }
      return { ...r.site, state, left, approx, visible: r.visible, seenAgo: r.lastUp >= 0 ? (tick - r.lastUp) / TICK_HZ : null };
    });
  }

  /** Camps of the own side, the enemy side and the river, for the panel. */
  grouped(): { own: CampView[]; enemy: CampView[]; river: CampView[] } {
    const all = this.camps();
    return { own: all.filter((c) => c.side === this.team), enemy: all.filter((c) => c.side <= 1 && c.side !== this.team), river: all.filter((c) => c.side === 2) };
  }
}

function nearest(recs: Rec[], x: number, y: number, id: CampId | undefined, maxD: number): Rec | undefined {
  let best: Rec | undefined;
  let bd = maxD * maxD;
  for (const r of recs) {
    if (id && r.site.id !== id) continue;
    const d = (r.site.x - x) ** 2 + (r.site.y - y) ** 2;
    if (d <= bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

/** Is the point inside the own team's vision (conservative: VISION_MARGIN inside the circle)? Same radii as render/fog.ts. */
export function inVision(own: readonly SnapEntity[], x: number, y: number): boolean {
  for (const e of own) {
    const r = (e.vision ?? e.sight ?? visionRadius(e.kind)) - VISION_MARGIN;
    if (r > 0 && (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r) return true;
  }
  return false;
}

/** Short label for the minimap / world: "1:42", "~1:42", "~1:42?" (estimate), "?" (unknown), "" (nothing to say). */
export function campLabel(v: CampView): string {
  const t = v.left === null ? 0 : Math.max(0, Math.ceil(v.left));
  const mmss = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  switch (v.state) {
    case 'pending':
    case 'cleared':
      return mmss;
    case 'empty':
      return `~${mmss}`;
    case 'estimate':
      return `~${mmss}?`;
    case 'unknown':
      return '?';
    default:
      return '';
  }
}
