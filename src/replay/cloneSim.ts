// Deep copy of a running Sim (replay checkpoints). The sim is plain data (typed arrays, Maps, Sets, arrays, objects,
// one Rng instance) plus the bitecs world, whose hidden context holds closure-based sparse sets and observables:
// those are rebuilt from their dense/sparse arrays, so query iteration order (part of determinism) is preserved.
// map and config are immutable after createSim and shared by reference.
import type { Sim } from '../sim/sim';
import { MAX_ENT } from '../sim/ecs';

type SparseLike = { add: unknown; remove: unknown; has: unknown; reset: unknown; sort: unknown; dense: number[]; sparse: number[] };

const isFn = (v: unknown): boolean => typeof v === 'function';
const SET_KEYS = new Set<PropertyKey>(['add', 'remove', 'has', 'reset', 'sort', 'dense', 'sparse']);

/** bitecs 0.4.0 createSparseSet (core/utils/SparseSet.ts), rebuilt around the given arrays. */
function makeSparseSet(dense: number[], sparse: number[]): SparseLike {
  const has = (val: number): boolean => dense[sparse[val]!] === val;
  const add = (val: number): void => {
    if (has(val)) return;
    sparse[val] = dense.push(val) - 1;
  };
  const remove = (val: number): void => {
    if (!has(val)) return;
    const index = sparse[val]!;
    const swapped = dense.pop()!;
    if (swapped !== val) {
      dense[index] = swapped;
      sparse[swapped] = index;
    }
  };
  const reset = (): void => {
    dense.length = 0;
    sparse.length = 0;
  };
  const sort = (compareFn?: (a: number, b: number) => number): void => {
    dense.sort(compareFn);
    for (let i = 0; i < dense.length; i++) sparse[dense[i]!] = i;
  };
  return { add, remove, has, sparse, dense, reset, sort };
}

/** bitecs 0.4.0 createObservable (core/utils/Observer.ts). The sim never subscribes, so the copy starts empty. */
function makeObservable(): { subscribe: unknown; notify: unknown } {
  const observers = new Set<(entity: number, ...args: unknown[]) => unknown>();
  const subscribe = (observer: (entity: number, ...args: unknown[]) => unknown): (() => void) => {
    observers.add(observer);
    return () => void observers.delete(observer);
  };
  const notify = (entity: number, ...args: unknown[]): object =>
    Array.from(observers).reduce<object>((acc, listener) => {
      const result = listener(entity, ...args);
      return result && typeof result === 'object' ? { ...acc, ...result } : acc;
    }, {});
  return { subscribe, notify };
}

function copyHoley<T>(a: readonly T[], clone: (v: T) => T): T[] {
  const out = new Array<T>(a.length);
  for (const k in a) {
    const i = Number(k);
    if (Number.isInteger(i)) out[i] = clone(a[i]!);
  }
  return out;
}

function isSparseSet(o: object): o is SparseLike {
  const r = o as Record<string, unknown>;
  return isFn(r.add) && isFn(r.remove) && isFn(r.has) && isFn(r.reset) && isFn(r.sort) && Array.isArray(r.dense) && Array.isArray(r.sparse);
}

/** A component array cut to its used prefix (checkpoints keep a few hundred entities, not MAX_ENT). */
export class Trimmed {
  constructor(readonly ctor: unknown, readonly data: unknown) {}
}

/** Deep clone with identity preservation (an object reachable twice stays one object in the copy). */
export function deepClone<T>(root: T, shared: ReadonlySet<unknown> = new Set(), trimTo = 0): T {
  const memo = new Map<unknown, unknown>();
  const go = (v: unknown): unknown => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
    if (shared.has(v)) return v;
    const hit = memo.get(v);
    if (hit !== undefined) return hit;
    if (typeof v === 'function') return v; // plain functions without state (anything with closure state is handled below)
    const o = v as object;
    if (o instanceof Trimmed) {
      // thaw: back to a full-size array
      const c = new (o.ctor as new (n: number) => { set(a: ArrayLike<number>): void })(MAX_ENT);
      c.set(o.data as unknown as ArrayLike<number>);
      memo.set(v, c);
      return c;
    }
    if (ArrayBuffer.isView(o)) {
      const a = o as unknown as { length: number; slice(from?: number, to?: number): unknown; constructor: unknown };
      // freeze: component arrays are MAX_ENT long but only the first maxId + 1 entities were ever used
      const c = trimTo > 0 && a.length === MAX_ENT ? new Trimmed(a.constructor, a.slice(0, trimTo)) : a.slice();
      memo.set(v, c);
      return c;
    }
    if (o instanceof Map) {
      const c = new Map();
      memo.set(v, c);
      for (const [k, x] of o) c.set(go(k), go(x));
      return c;
    }
    if (o instanceof Set) {
      const c = new Set();
      memo.set(v, c);
      for (const x of o) c.add(go(x));
      return c;
    }
    if (Array.isArray(o)) {
      const c = copyHoley(o, go);
      memo.set(v, c);
      return c;
    }
    const keys = Reflect.ownKeys(o);
    const sparseSet = isSparseSet(o);
    if (!sparseSet && keys.length === 2 && isFn((o as Record<string, unknown>).subscribe) && isFn((o as Record<string, unknown>).notify)) {
      const c = makeObservable();
      memo.set(v, c);
      return c;
    }
    let c: Record<PropertyKey, unknown>;
    if (sparseSet) {
      // a bitecs query is a sparse set with extra fields: rebuild the set part, copy the fields
      const dense: number[] = [];
      const sparse: number[] = [];
      c = makeSparseSet(dense, sparse) as unknown as Record<PropertyKey, unknown>;
      memo.set(v, c);
      for (const x of o.dense) dense.push(x);
      for (const k in o.sparse) sparse[Number(k)] = o.sparse[Number(k)]!;
      sparse.length = o.sparse.length;
    } else {
      c = Object.create(Object.getPrototypeOf(o)) as Record<PropertyKey, unknown>;
      memo.set(v, c);
    }
    for (const k of keys) {
      if (sparseSet && SET_KEYS.has(k)) continue;
      const d = Object.getOwnPropertyDescriptor(o, k)!;
      if (!('value' in d)) throw new Error(`cloneSim: accessor property ${String(k)} cannot be copied`);
      d.value = go(d.value);
      Object.defineProperty(c, k, d);
    }
    return c;
  };
  return go(root) as T;
}

const sharedOf = (sim: Sim): Set<unknown> => new Set<unknown>([sim.map, sim.config]);

/** Independent copy of the whole sim; stepping the copy never touches the original (and vice versa). */
export function cloneSim(sim: Sim): Sim {
  return deepClone(sim, sharedOf(sim));
}

/** Highest entity id ever allocated + 1 (bitecs entity index). */
function usedEntities(sim: Sim): number {
  const ctx = (sim.world as unknown as Record<symbol, { entityIndex: { maxId: number } }>)[Symbol.for('bitecs_internal')];
  return Math.min(MAX_ENT, (ctx?.entityIndex.maxId ?? MAX_ENT) + 1);
}

/** Compact checkpoint of a sim (component arrays cut to the used entities). Restore with thawSim; may be thawed repeatedly. */
export type FrozenSim = { readonly __frozen: Sim; readonly tick: number };
export function freezeSim(sim: Sim): FrozenSim {
  return { __frozen: deepClone(sim, sharedOf(sim), usedEntities(sim)), tick: sim.tick };
}

/** A fresh, independent, full-size sim from a checkpoint. */
export function thawSim(f: FrozenSim): Sim {
  return deepClone(f.__frozen, sharedOf(f.__frozen));
}
