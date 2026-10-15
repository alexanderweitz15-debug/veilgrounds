// Simulation core: fixed 30 Hz tick, seeded RNG, player-equivalent inputs only.
// Headless; the worker (worker.ts), tests and tools/botSim all drive this same module.

import { addComponent, addEntity, createWorld, removeEntity, query, type World } from 'bitecs';
import { createComponents, type Components } from './ecs';
import { loadMap, type MapData, type Pt } from './map';
import { Rng } from './rng';
import { Kind, Team, type SimConfig, type SimEvent, type TickInput } from './types';
import { systems } from './systems';

export interface Sim {
  world: World;
  c: Components;
  map: MapData;
  rng: Rng;
  config: SimConfig;
  tick: number;
  events: SimEvent[];
  /** Champion eid per player slot. */
  slots: number[];
  /** Champion ids in roster order; Unit.champ indexes this. */
  championIds: string[];
  /** Active path per entity (Move.mode === 1). */
  paths: Map<number, Pt[]>;
  /** Inputs queued for the current tick, applied by the input system. */
  pending: TickInput[];
  /** Entities to remove at end of tick. */
  doomed: number[];
  serialCounter: number;
  /** Free-form per-system state (waves, economy, ...). Each system owns its key. */
  state: Record<string, unknown>;
  flags: { minions: boolean; towersInvulnerable: boolean };
}

export function createSim(config: SimConfig): Sim {
  const c = createComponents();
  const sim: Sim = {
    world: createWorld(),
    c,
    map: loadMap(),
    rng: new Rng(config.seed),
    config,
    tick: 0,
    events: [],
    slots: [],
    championIds: [],
    paths: new Map(),
    pending: [],
    doomed: [],
    serialCounter: 0,
    state: {},
    flags: { minions: config.minionsEnabled ?? true, towersInvulnerable: false },
  };
  for (const s of systems()) s.init?.(sim);
  return sim;
}

/** Advance one tick with the given inputs. */
export function step(sim: Sim, inputs: TickInput[] = []): void {
  sim.events.length = 0;
  sim.pending = inputs;
  const { Pos } = sim.c;
  for (const eid of query(sim.world, [Pos])) {
    Pos.px[eid] = Pos.x[eid]!;
    Pos.py[eid] = Pos.y[eid]!;
  }
  for (const s of systems()) s.update(sim);
  for (const eid of sim.doomed) removeEntity(sim.world, eid);
  sim.doomed.length = 0;
  sim.tick++;
}

export const time = (sim: Sim): number => sim.tick / 30;

/** Create a unit entity with common defaults. Callers fill kind-specific stats afterwards. */
export function spawnUnit(sim: Sim, kind: number, team: number, x: number, y: number, radius: number): number {
  const { Pos, Face, Unit, Hp, Stats, Atk, Move, LastHit, Vision, Mana } = sim.c;
  const eid = addEntity(sim.world);
  for (const comp of [Pos, Face, Unit, Hp, Stats, Atk, Move, LastHit, Vision, Mana]) {
    // bitecs: register membership so queries work; data lives in the SoA arrays
    addComp(sim, comp, eid);
  }
  Pos.x[eid] = Pos.px[eid] = x;
  Pos.y[eid] = Pos.py[eid] = y;
  Face.x[eid] = team === Team.Red ? -0.7071 : 0.7071;
  Face.y[eid] = team === Team.Red ? -0.7071 : 0.7071;
  Unit.kind[eid] = kind;
  Unit.team[eid] = team;
  Unit.lane[eid] = 255;
  Unit.serial[eid] = ++sim.serialCounter;
  Unit.alive[eid] = 1;
  Unit.champ[eid] = -1;
  Unit.slot[eid] = -1;
  Unit.radius[eid] = radius;
  Unit.untargetable[eid] = 0;
  Unit.invulnerable[eid] = 0;
  Unit.variant[eid] = 0;
  Hp.shield[eid] = 0;
  Hp.regen[eid] = 0;
  Mana.cur[eid] = Mana.max[eid] = Mana.regen[eid] = 0;
  for (const k of Object.keys(Stats) as (keyof typeof Stats)[]) Stats[k][eid] = 0;
  Stats.windup[eid] = 0.3;
  Atk.target[eid] = -1;
  Atk.phase[eid] = 0;
  Atk.phaseEnd[eid] = 0;
  Atk.nextReady[eid] = 0;
  Atk.attackMove[eid] = 0;
  Move.mode[eid] = 0;
  LastHit.eid[eid] = -1;
  Vision.r[eid] = 0;
  sim.paths.delete(eid);
  return eid;
}

export function addComp(sim: Sim, comp: object, eid: number): void {
  addComponent(sim.world, eid, comp);
}

export function despawn(sim: Sim, eid: number): void {
  sim.c.Unit.alive[eid] = 0;
  sim.paths.delete(eid);
  sim.doomed.push(eid);
}

/** True if eid currently refers to the same living unit that had `serial`. */
export function isRef(sim: Sim, eid: number, serial: number): boolean {
  return eid >= 0 && sim.c.Unit.serial[eid] === serial && sim.c.Unit.alive[eid] === 1;
}

/** FNV-1a hash over all entity state; used by replay determinism tests. */
export function stateHash(sim: Sim): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    const f = new Float64Array([n]);
    const u = new Uint32Array(f.buffer);
    for (let i = 0; i < 2; i++) {
      h ^= u[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(sim.tick);
  // per-system state (buffs, cooldowns, waves, hook state): Maps/arrays/objects walked in insertion order
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8 || v === null || v === undefined) return mix(-1);
    if (typeof v === 'number') return mix(v);
    if (typeof v === 'boolean') return mix(v ? 1 : 0);
    if (typeof v === 'string') return mix(v.length);
    if (typeof v !== 'object') return;
    if (ArrayBuffer.isView(v)) return mix((v as unknown as ArrayLike<number>).length); // big typed arrays (vision): length only
    if (v instanceof Map) for (const [k, x] of v) (walk(k, depth + 1), walk(x, depth + 1));
    else if (v instanceof Set) for (const x of v) walk(x, depth + 1);
    else for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const [k, v] of Object.entries(sim.state)) if (k !== 'vision') (mix(k.length), walk(v, 0));
  for (const s of sim.rng.state()) mix(s);
  const comps = sim.c as unknown as Record<string, Record<string, ArrayLike<number>>>;
  const ents = [...query(sim.world, [sim.c.Pos])].sort((a, b) => a - b);
  for (const eid of ents) {
    mix(eid);
    for (const comp of Object.values(comps)) for (const arr of Object.values(comp)) mix(arr[eid]!);
  }
  return h.toString(16);
}

export const isChampion = (sim: Sim, eid: number): boolean => sim.c.Unit.kind[eid] === Kind.Champion;
