// Sprite bake worker pool: a worker that never answers, answers garbage or dies must not leave the loading screen stuck
// (root cause: bakeInWorkers waited for `left === 0` with no timeout and no messageerror handler), and one painter that
// throws must not take every other champion down with it (renderMaster threw for ids without a kit, e.g. 'fenna').
import './loaderEnv';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChampionAtlasAsync, resetBakePool, type AtlasCellCache, type BakeRequest, type BakeResult } from '../src/render/champions/atlas';

// a canvas that accepts the atlas builder's calls but cannot paint a sprite: renderMaster() throws on it, which stands
// in for a painter bug
const fakeCtx = { imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillStyle: '', fillRect() {}, clearRect() {}, drawImage() {} };
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => fakeCtx });

type Behaviour = (w: FakeWorker, req: BakeRequest) => void;
let behaviour: Behaviour = () => undefined;
let made: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((ev: MessageEvent<BakeResult>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    made.push(this);
  }
  postMessage(req: BakeRequest): void {
    behaviour(this, req);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(r: BakeResult): void {
    this.onmessage?.({ data: r } as MessageEvent<BakeResult>);
  }
}
const bmp = (): ImageBitmap => ({ close() {} }) as unknown as ImageBitmap;
const opts = { frame: 64, maxSize: 4096, autoHark: false, worker: () => new FakeWorker() as unknown as Worker };

beforeAll(() => {
  vi.stubGlobal('document', { createElement: fakeCanvas });
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('Worker', FakeWorker);
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  made = [];
  resetBakePool();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('bake worker pool robustness', () => {
  it('healthy workers: every cell arrives, progress ends at total, no placeholders', async () => {
    behaviour = (w, req) => req.jobs.forEach((j) => queueMicrotask(() => w.reply({ cell: j.cell, bmp: bmp(), top: j.anim === 'idle' && j.dir === 'S' && j.frame === 0 ? 0.25 : undefined })));
    const seen: number[] = [];
    const a = await buildChampionAtlasAsync(['mira'], { ...opts, onProgress: (d, n) => seen.push(d / n) });
    expect(a.placeholders).toEqual([]);
    expect(a.frames.mira!.idle.S).toHaveLength(4);
    expect(a.top.mira).toBe(0.25);
    expect(seen.at(-1)).toBe(1);
    expect(made.every((w) => w.terminated)).toBe(true);
  });

  it('a worker that never answers is given up after stallMs: the atlas still resolves (main-thread bake)', async () => {
    behaviour = () => undefined; // silence
    const t0 = Date.now();
    const a = await buildChampionAtlasAsync(['mira'], { ...opts, stallMs: 60 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(console.warn).toHaveBeenCalledWith('sprite bake workers failed, baking on the main thread', expect.objectContaining({ message: expect.stringContaining('silent for 60 ms') }));
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((w) => w.terminated)).toBe(true); // no worker is left running
    // the fake canvas cannot paint, so mira ends up as the checkerboard rather than breaking the atlas
    expect(a.placeholders).toEqual(['mira']);
  });

  it('after a failed pool the next atlas of the session does not wait for workers again', async () => {
    behaviour = () => undefined;
    await buildChampionAtlasAsync(['mira'], { ...opts, stallMs: 30 });
    const before = made.length;
    const t0 = Date.now();
    await buildChampionAtlasAsync(['renn'], { ...opts, stallMs: 5000 });
    expect(made.length).toBe(before); // no new worker was started
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a messageerror from a worker is a failure, not an endless wait', async () => {
    behaviour = (w) => queueMicrotask(() => w.onmessageerror?.());
    const a = await buildChampionAtlasAsync(['mira'], { ...opts, stallMs: 5000 });
    expect(console.warn).toHaveBeenCalledWith('sprite bake workers failed, baking on the main thread', expect.objectContaining({ message: expect.stringContaining('could not be deserialized') }));
    expect(a.frames.mira).toBeDefined();
  });

  it('a worker error event (e.g. the module failed to load) falls back too', async () => {
    behaviour = (w) => queueMicrotask(() => w.onerror?.(new Error('script load failed')));
    await buildChampionAtlasAsync(['mira'], { ...opts, stallMs: 5000 });
    expect(console.warn).toHaveBeenCalledWith('sprite bake workers failed, baking on the main thread', expect.any(Error));
  });

  it('a painter that throws for one champion only turns that champion into a checkerboard', async () => {
    behaviour = (w, req) =>
      req.jobs.forEach((j) => queueMicrotask(() => (j.id === 'brom' ? w.reply({ cell: j.cell, error: 'painter bug' }) : w.reply({ cell: j.cell, bmp: bmp() }))));
    const put = vi.fn();
    const cache: AtlasCellCache = { get: async () => null, put };
    const a = await buildChampionAtlasAsync(['mira', 'brom'], { ...opts, cache });
    expect(a.placeholders).toEqual(['brom']);
    expect(a.frames.brom!.run.E.length).toBeGreaterThan(0); // still has frames: all of them the checkerboard rect
    const rect = a.frames.brom!.idle.S[0]!;
    expect(a.frames.brom!.attack.NE[0]).toEqual(rect);
    expect(a.frames.mira!.idle.S[0]).not.toEqual(rect); // mira is a real cell
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("sprite 'brom' failed to paint in the bake worker"));
    await new Promise((r) => setTimeout(r, 20)); // strips are stored in a later task
    // a broken sprite must not be persisted in the cache
    expect(put.mock.calls.map((c) => String(c[0]).split('@')[0])).toEqual(['mira']);
    // the pool itself was fine: no main-thread fallback
    expect(console.warn).not.toHaveBeenCalledWith('sprite bake workers failed, baking on the main thread', expect.anything());
  });

  it('an id without a painter (fenna) does not break the atlas of the others', async () => {
    behaviour = (w, req) => req.jobs.forEach((j) => queueMicrotask(() => w.reply({ cell: j.cell, bmp: bmp() })));
    const a = await buildChampionAtlasAsync(['mira', 'fenna'], opts);
    expect(a.placeholders).toEqual(['fenna']);
    expect(a.frames.fenna!.idle.S.length).toBeGreaterThan(0);
    expect(a.frames.mira!.idle.S).toHaveLength(4);
    expect(a.check.x).toBeGreaterThan(0);
  });
});
