// Wards and trinkets (spec §2 Sicht). Player wards are Kind.Ward units (team vision source, 1 HP per basic
// attack, nothing else damages them: damage.ts). Jungle river vision (jungle.ts) also uses Kind.Ward but is not a
// player ward: only entities in this registry are.
// - Schleierward (trinket, free): 2 charges, recharge 240 -> 120 s by champion level, 90 s lifetime, max 3 per player,
//   invisible to enemies unless revealed.
// - Siegelward (75 gold consumable, item command -> placeSealWard): permanent, visible, max 1 per player; reveals and
//   disables enemy Schleierwards within its radius.
// - Suchfeuer (trinket swap from level 9): sweeps an area for a few seconds, revealing and disabling enemy wards.
// Vision Score inputs per player slot live in sim.state.wards.stats (post-game, later).
// All state in sim.state.wards; ward records keyed by eid + serial.

import type { Sim } from './sim';
import type { System } from './systems/index';
import { despawn, isRef, spawnUnit } from './sim';
import { Kind, enemyOf, sec } from './types';
import { addBuff, canAttack, reveal } from './buffs';
import { dist2 } from './vec';
import { nearestWalkable, walkable } from './map';
import { champions } from './systems/economy';
import { canShop } from './items/inventory';

export type WardType = 'veil' | 'seal';
export type TrinketId = 'schleierward' | 'suchfeuer';

export const WARD_RADIUS = 25;
export const WARD_PLACE_RANGE = 600;
export const WARD_VISION = 900;
export const VEIL = { hp: 3, ticks: sec(90), maxPerPlayer: 3 };
export const SEAL = { hp: 4, maxPerPlayer: 1, revealR: 900 };
export const TRINKET = { maxCharges: 2, startCharges: 1, rechargeS: [240, 120] as [number, number] };
export const SWEEP = { unlockLevel: 9, range: 600, r: 450, ticks: sec(6), cooldownS: [90, 60] as [number, number] };

interface WardRec {
  eid: number;
  serial: number;
  type: WardType;
  owner: number;
  slot: number;
  team: number;
  placed: number;
  /** Expiry tick, -1 = permanent. */
  until: number;
}

export interface TrinketState {
  id: TrinketId;
  charges: number;
  /** Tick the next charge arrives (0 = full / not recharging). */
  nextCharge: number;
  rechargeTotal: number;
  cdUntil: number;
  cdTotal: number;
}

interface Sweep {
  team: number;
  slot: number;
  x: number;
  y: number;
  r: number;
  until: number;
}

/** Vision Score inputs per player slot. */
export interface WardStats {
  veilPlaced: number;
  sealPlaced: number;
  sweeps: number;
  /** Enemy player wards destroyed. */
  wardsKilled: number;
  /** Enemy player wards revealed by own seal wards / sweeps (counted once per ward). */
  wardsRevealed: number;
  /** Summed alive time of own wards in ticks. */
  wardTicks: number;
}

interface WardState {
  list: WardRec[];
  trinkets: Map<number, TrinketState>;
  sweeps: Sweep[];
  stats: Map<number, WardStats>;
  /** Ward serials already counted as revealed. */
  revealed: Set<number>;
}

function wardState(sim: Sim): WardState {
  let s = sim.state.wards as WardState | undefined;
  if (!s) sim.state.wards = s = { list: [], trinkets: new Map(), sweeps: [], stats: new Map(), revealed: new Set() };
  return s;
}

/** Linear by champion level 1..18. */
const byLevel = (sim: Sim, eid: number, [lo, hi]: [number, number]): number => lo + ((hi - lo) * (Math.max(1, sim.c.Champ.level[eid]!) - 1)) / 17;

export function wardStats(sim: Sim, slot: number): WardStats {
  const s = wardState(sim);
  let w = s.stats.get(slot);
  if (!w) s.stats.set(slot, (w = { veilPlaced: 0, sealPlaced: 0, sweeps: 0, wardsKilled: 0, wardsRevealed: 0, wardTicks: 0 }));
  return w;
}

/** Trinket of a champion (created on first use: Schleierward with one charge, recharging the second). */
export function trinket(sim: Sim, eid: number): TrinketState {
  const s = wardState(sim);
  let t = s.trinkets.get(eid);
  if (!t) s.trinkets.set(eid, (t = { id: 'schleierward', charges: TRINKET.startCharges, nextCharge: 0, rechargeTotal: 0, cdUntil: 0, cdTotal: 0 }));
  return t;
}

/** Player ward (not jungle river vision). */
export function isPlayerWard(sim: Sim, eid: number): boolean {
  return wardState(sim).list.some((w) => w.eid === eid && w.serial === sim.c.Unit.serial[eid]);
}

/** Player ward type of an entity, or null. */
export function wardTypeOf(sim: Sim, eid: number): WardType | null {
  const s = sim.state.wards as WardState | undefined;
  const w = s?.list.find((r) => r.eid === eid && r.serial === sim.c.Unit.serial[eid]);
  return w ? w.type : null;
}

/** Alive player wards of a team (tests, bots via snapshot). */
export function wardsOf(sim: Sim, team: number): { eid: number; type: WardType; owner: number }[] {
  return wardState(sim).list.filter((w) => w.team === team && isRef(sim, w.eid, w.serial)).map((w) => ({ eid: w.eid, type: w.type, owner: w.owner }));
}

/** Clamp a placement to range and onto walkable ground. */
function placePoint(sim: Sim, eid: number, x: number, y: number, range: number): { x: number; y: number } {
  const { Pos } = sim.c;
  const ox = Pos.x[eid]!;
  const oy = Pos.y[eid]!;
  const d = Math.sqrt(dist2(x, y, ox, oy));
  if (d > range) {
    x = ox + ((x - ox) * range) / d;
    y = oy + ((y - oy) * range) / d;
  }
  return walkable(sim.map.nav, x, y) ? { x, y } : nearestWalkable(sim.map.nav, x, y);
}

function canUse(sim: Sim, eid: number): boolean {
  const { Unit } = sim.c;
  return !!Unit.alive[eid] && Unit.kind[eid] === Kind.Champion && canAttack(sim, eid);
}

function spawnWard(sim: Sim, eid: number, type: WardType, x: number, y: number): number {
  const { Unit, Hp, Vision } = sim.c;
  const s = wardState(sim);
  const team = Unit.team[eid]!;
  // per-player cap: the oldest ward of this type goes
  const max = type === 'veil' ? VEIL.maxPerPlayer : SEAL.maxPerPlayer;
  const mine = s.list.filter((w) => w.owner === eid && w.type === type && isRef(sim, w.eid, w.serial));
  if (mine.length >= max) removeWard(sim, mine[0]!);
  const w = spawnUnit(sim, Kind.Ward, team, x, y, WARD_RADIUS);
  const hp = type === 'veil' ? VEIL.hp : SEAL.hp;
  Hp.max[w] = Hp.cur[w] = hp;
  Vision.r[w] = WARD_VISION;
  const until = type === 'veil' ? sim.tick + VEIL.ticks : -1;
  if (type === 'veil') addBuff(sim, w, { kind: 'stat', stat: 'invisible', id: 'schleierward', src: eid, ticks: VEIL.ticks + 1 });
  s.list.push({ eid: w, serial: Unit.serial[w]!, type, owner: eid, slot: Unit.slot[eid]!, team, placed: sim.tick, until });
  return w;
}

function removeWard(sim: Sim, w: WardRec): void {
  const s = wardState(sim);
  wardStats(sim, w.slot).wardTicks += sim.tick - w.placed;
  s.list = s.list.filter((r) => r !== w);
  if (isRef(sim, w.eid, w.serial)) despawn(sim, w.eid);
}

/** Trinket use (command 'ward'): Schleierward places a ward, Suchfeuer sweeps. Returns true if something happened. */
export function useTrinket(sim: Sim, eid: number, x: number, y: number): boolean {
  if (!canUse(sim, eid)) return false;
  const t = trinket(sim, eid);
  if (t.id === 'suchfeuer') return sweep(sim, eid, t, x, y);
  if (t.charges <= 0) return false;
  const p = placePoint(sim, eid, x, y, WARD_PLACE_RANGE);
  spawnWard(sim, eid, 'veil', p.x, p.y);
  t.charges--;
  wardStats(sim, sim.c.Unit.slot[eid]!).veilPlaced++;
  return true;
}

function sweep(sim: Sim, eid: number, t: TrinketState, x: number, y: number): boolean {
  if (sim.tick < t.cdUntil) return false;
  const p = placePoint(sim, eid, x, y, SWEEP.range);
  wardState(sim).sweeps.push({ team: sim.c.Unit.team[eid]!, slot: sim.c.Unit.slot[eid]!, x: p.x, y: p.y, r: SWEEP.r, until: sim.tick + SWEEP.ticks });
  t.cdTotal = sec(byLevel(sim, eid, SWEEP.cooldownS));
  t.cdUntil = sim.tick + t.cdTotal;
  wardStats(sim, sim.c.Unit.slot[eid]!).sweeps++;
  // telegraph: the swept area (own team; enemies see it where they have vision)
  sim.events.push({ e: 'zone', src: eid, team: sim.c.Unit.team[eid]!, x: p.x, y: p.y, r: SWEEP.r, start: sim.tick, at: sim.tick, until: sim.tick + SWEEP.ticks });
  return true;
}

/** Seal ward from the 'siegelward' consumable (items/itemHooks.ts consumes the item on success). */
export function placeSealWard(sim: Sim, eid: number, x: number, y: number): boolean {
  if (!canUse(sim, eid)) return false;
  const p = placePoint(sim, eid, x, y, WARD_PLACE_RANGE);
  spawnWard(sim, eid, 'seal', p.x, p.y);
  wardStats(sim, sim.c.Unit.slot[eid]!).sealPlaced++;
  return true;
}

/** Can the champion swap to this trinket now (shop access; Suchfeuer from level 9)? */
export function canSwapTrinket(sim: Sim, eid: number, id: TrinketId): boolean {
  if (sim.c.Unit.kind[eid] !== Kind.Champion || !canShop(sim, eid)) return false;
  if (trinket(sim, eid).id === id) return false;
  return id === 'schleierward' || sim.c.Champ.level[eid]! >= SWEEP.unlockLevel;
}

/**
 * Trinket swap (command 'trinket'). Back to Schleierward starts empty (no free charges from swapping); the Suchfeuer
 * cooldown keeps running across swaps (swapping away and back must not reset it).
 */
export function swapTrinket(sim: Sim, eid: number, id: TrinketId): boolean {
  if (!canSwapTrinket(sim, eid, id)) return false;
  const t = trinket(sim, eid);
  t.id = id;
  t.charges = 0;
  t.nextCharge = 0;
  return true;
}

/** HUD view of the trinket. */
export function trinketHud(sim: Sim, eid: number): { id: TrinketId; charges: number; maxCharges: number; cdLeft: number; cdTotal: number; canSwap: TrinketId | null } {
  const t = trinket(sim, eid);
  const other: TrinketId = t.id === 'schleierward' ? 'suchfeuer' : 'schleierward';
  const veil = t.id === 'schleierward';
  const cdLeft = veil ? (t.charges < TRINKET.maxCharges && t.nextCharge > 0 ? t.nextCharge - sim.tick : 0) : Math.max(0, t.cdUntil - sim.tick);
  return {
    id: t.id,
    charges: veil ? t.charges : sim.tick >= t.cdUntil ? 1 : 0,
    maxCharges: veil ? TRINKET.maxCharges : 1,
    cdLeft: Math.max(0, cdLeft) / 30,
    cdTotal: (veil ? t.rechargeTotal : t.cdTotal) / 30,
    canSwap: canSwapTrinket(sim, eid, other) ? other : null,
  };
}

function rechargeTrinkets(sim: Sim): void {
  for (const eid of champions(sim)) {
    const t = trinket(sim, eid);
    if (t.id !== 'schleierward') continue;
    if (t.charges >= TRINKET.maxCharges) {
      t.nextCharge = 0;
      continue;
    }
    if (t.nextCharge === 0) {
      t.rechargeTotal = sec(byLevel(sim, eid, TRINKET.rechargeS));
      t.nextCharge = sim.tick + t.rechargeTotal;
    } else if (sim.tick >= t.nextCharge) {
      t.charges++;
      t.nextCharge = 0;
    }
  }
}

export const wardsSystem: System = {
  name: 'wards',
  init(sim) {
    // trinket records for every champion up front (champion order): HUD/snapshot reads must not create state
    for (const eid of champions(sim)) trinket(sim, eid);
  },
  update(sim) {
    const s = wardState(sim);
    const { Unit, Pos, Vision, LastHit } = sim.c;
    for (const w of [...s.list]) {
      if (Unit.serial[w.eid] === w.serial && !Unit.alive[w.eid]) {
        // killed (damage.kill despawns it this tick): Vision Score input for the last hitter
        const k = LastHit.eid[w.eid]!;
        if (k >= 0 && LastHit.serial[w.eid] === Unit.serial[k] && Unit.kind[k] === Kind.Champion && Unit.team[k] !== w.team) wardStats(sim, Unit.slot[k]!).wardsKilled++;
        removeWard(sim, w);
      } else if (!isRef(sim, w.eid, w.serial) || (w.until >= 0 && sim.tick >= w.until)) removeWard(sim, w); // expired / gone
    }
    s.sweeps = s.sweeps.filter((sw) => sim.tick < sw.until);
    // seal wards and sweeps reveal enemy wards; a revealed Schleierward is also disabled (no vision)
    const seals = s.list.filter((w) => w.type === 'seal');
    for (const w of s.list) {
      const x = Pos.x[w.eid]!;
      const y = Pos.y[w.eid]!;
      const enemy = enemyOf(w.team);
      const seal = w.type === 'veil' ? seals.find((o) => o.team === enemy && dist2(Pos.x[o.eid]!, Pos.y[o.eid]!, x, y) <= SEAL.revealR * SEAL.revealR) : undefined;
      const sw = s.sweeps.find((q) => q.team === enemy && dist2(q.x, q.y, x, y) <= (q.r + WARD_RADIUS) * (q.r + WARD_RADIUS));
      const found = !!seal || !!sw;
      if (found) {
        reveal(sim, enemy, w.eid, 2);
        if (!s.revealed.has(w.serial)) {
          s.revealed.add(w.serial); // Vision Score input: counted once per ward, for the first revealer
          wardStats(sim, seal ? seal.slot : sw!.slot).wardsRevealed++;
        }
      }
      Vision.r[w.eid] = w.type === 'veil' && found ? 0 : WARD_VISION;
    }
    if (s.revealed.size > 256) {
      const alive = new Set(s.list.map((w) => w.serial));
      for (const k of [...s.revealed]) if (!alive.has(k)) s.revealed.delete(k);
    }
    rechargeTrinkets(sim);
  },
};
