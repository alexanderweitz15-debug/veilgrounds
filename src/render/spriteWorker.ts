// Bake worker: renders sprite atlas cells (procedural paper-doll champions) off the main thread.
import { isTopJob, renderCell, topRow, type BakeRequest, type BakeResult } from './champions';

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const { master, cell, jobs } = ev.data;
  for (const job of jobs) {
    const c = renderCell(job, master, cell) as OffscreenCanvas;
    const top = isTopJob(job) ? topRow(c, cell) : undefined;
    const bmp = c.transferToImageBitmap();
    const res: BakeResult = { cell: job.cell, bmp, top };
    (self as unknown as Worker).postMessage(res, [bmp]);
  }
};
