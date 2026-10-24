// Bake worker: renders sprite atlas cells (procedural paper-doll champions) off the main thread.
import { isTopJob, renderCell, topRow, type BakeRequest, type BakeResult } from './champions';

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const { master, cell, jobs } = ev.data;
  for (const job of jobs) {
    try {
      const c = renderCell(job, master, cell) as OffscreenCanvas;
      const top = isTopJob(job) ? topRow(c, cell) : undefined;
      const bmp = c.transferToImageBitmap();
      const res: BakeResult = { cell: job.cell, bmp, top };
      (self as unknown as Worker).postMessage(res, [bmp]);
    } catch (e) {
      // one broken painter must not stall the pool (the main thread would wait for this cell forever): report it
      const res: BakeResult = { cell: job.cell, error: e instanceof Error ? e.message : String(e) };
      (self as unknown as Worker).postMessage(res);
    }
  }
};
