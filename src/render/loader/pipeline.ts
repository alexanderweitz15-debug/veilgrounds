// Generic load pipeline: sequential steps with a combined progress value, a no-progress watchdog and a hard time limit
// per step, a fallback value when a step fails or times out, and late delivery of the real value after a timeout.
// Pure (no DOM, no sprite code): see tests/loaderPipeline.test.ts. src/render/loader/preloader.ts wires the sprite
// atlases into it.

export interface StepDef<T> {
  /** identity: a step with the same key is started once per session and shared by every caller */
  key: string;
  /** shown in warnings */
  label: string;
  /** share of the combined progress bar (relative to the other steps) */
  weight: number;
  /** the step is given up when its progress does not increase for this long (ms) */
  stallMs: number;
  /** ... or when it has not finished after this long (ms) */
  hardMs: number;
  /** starts the work; `report(k)` with k in 0..1 (only increases count) */
  start(report: (k: number) => void): Promise<T>;
  /** stand-in value used when the step fails or times out */
  fallback(): T;
}

export interface StepOutcome<T> {
  value: T;
  /** true = `value` is the fallback */
  degraded: boolean;
  reason?: string;
}

interface Handle<T> {
  promise: Promise<StepOutcome<T>>;
  progress: number;
  listeners: Set<(k: number) => void>;
  /** callbacks for the real value if it arrives after the step was given up */
  late: Set<(v: T) => void>;
  lateValue?: { v: T };
}

export class StepRunner {
  private readonly handles = new Map<string, Handle<unknown>>();

  /**
   * Runs (or joins) a step. `onProgress` gets 0..1 of this step; `onLate` the real value if the step is given up first
   * and still finishes later. Never rejects: failures become a degraded outcome.
   */
  run<T>(def: StepDef<T>, onProgress?: (k: number) => void, onLate?: (v: T) => void): Promise<StepOutcome<T>> {
    let h = this.handles.get(def.key) as Handle<T> | undefined;
    if (!h) {
      h = this.begin(def, onProgress); // the first listener is attached before start() can report
      this.handles.set(def.key, h as Handle<unknown>);
    } else if (onProgress) {
      h.listeners.add(onProgress);
      onProgress(h.progress);
    }
    if (onLate) {
      if (h.lateValue) onLate(h.lateValue.v);
      else h.late.add(onLate);
    }
    return h.promise;
  }

  /** Forgets finished steps (tests, or a new session). */
  clear(): void {
    this.handles.clear();
  }

  private begin<T>(def: StepDef<T>, first?: (k: number) => void): Handle<T> {
    const h: Handle<T> = { promise: undefined as unknown as Promise<StepOutcome<T>>, progress: 0, listeners: new Set(), late: new Set() };
    if (first) {
      h.listeners.add(first);
      first(0);
    }
    h.promise = new Promise<StepOutcome<T>>((resolve) => {
      let settled = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (): void => {
        clearTimeout(hardTimer);
        clearTimeout(stallTimer);
      };
      const finish = (o: StepOutcome<T>): void => {
        if (settled) return;
        settled = true;
        stop();
        resolve(o);
      };
      const degrade = (reason: string, retryable: boolean): void => {
        if (settled) return;
        console.warn(`[loader] ${def.label}: ${reason}; continuing with placeholder sprites`);
        // a failed step is run again by the next caller; a timed-out one is still running and joined by it
        if (retryable) this.handles.delete(def.key);
        finish({ value: def.fallback(), degraded: true, reason });
      };
      const armStall = (): void => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => degrade(`no progress for ${def.stallMs} ms`, false), def.stallMs);
      };
      hardTimer = setTimeout(() => degrade(`not finished after ${def.hardMs} ms`, false), def.hardMs);
      armStall();
      const report = (k: number): void => {
        if (settled || !(k > h.progress)) return;
        h.progress = Math.min(1, k);
        armStall();
        for (const l of h.listeners) l(h.progress);
      };
      let work: Promise<T>;
      try {
        work = def.start(report);
      } catch (e) {
        work = Promise.reject(e);
      }
      work.then(
        (v) => {
          if (settled) {
            // given up earlier: later callers get the real value at once, waiting ones are told
            h.lateValue = { v };
            h.promise = Promise.resolve({ value: v, degraded: false });
            for (const cb of h.late) cb(v);
            h.late.clear();
            console.info(`[loader] ${def.label}: finished after the time limit, swapping in the real sprites`);
          } else {
            h.progress = 1;
            for (const l of h.listeners) l(1);
            finish({ value: v, degraded: false });
          }
        },
        (e: unknown) => {
          if (settled) this.handles.delete(def.key);
          else degrade(`failed (${e instanceof Error ? e.message : String(e)})`, true);
        },
      );
    });
    return h;
  }
}

export interface PipelineResult<T extends unknown[]> {
  outcomes: { [K in keyof T]: StepOutcome<T[K]> };
  /** labels of the steps that fell back */
  degraded: string[];
}

/**
 * Runs the steps one after another (they compete for the same CPU/worker pool) and reports the combined progress
 * 0..1, weighted by `weight`. Resolves when every step has a value, real or fallback.
 */
export async function runSteps<T extends unknown[]>(
  runner: StepRunner,
  defs: { [K in keyof T]: StepDef<T[K]> },
  onProgress?: (k: number) => void,
  onLate?: (index: number, value: unknown) => void,
): Promise<PipelineResult<T>> {
  const list = defs as unknown as StepDef<unknown>[];
  const total = list.reduce((s, d) => s + d.weight, 0) || 1;
  const part = list.map(() => 0);
  let last = -1;
  const emit = (): void => {
    const k = Math.min(1, part.reduce((s, v, i) => s + v * list[i]!.weight, 0) / total);
    if (k > last) {
      last = k;
      onProgress?.(k);
    }
  };
  emit();
  const outcomes: StepOutcome<unknown>[] = [];
  for (let i = 0; i < list.length; i++) {
    const o = await runner.run(
      list[i]!,
      (k) => {
        part[i] = k;
        emit();
      },
      onLate ? (v) => onLate(i, v) : undefined,
    );
    part[i] = 1;
    emit();
    outcomes.push(o);
  }
  return { outcomes: outcomes as PipelineResult<T>['outcomes'], degraded: list.filter((_, i) => outcomes[i]!.degraded).map((d) => d.label) };
}
