// B7 (agent D): layout of the persistent per-id atlas strips (pure, no canvas; used by champions/atlas.ts + sheets.ts).

/** Cells per strip row. */
export const STRIP_COLS = 16;

/** Cache key of one id's strip: master resolution, requested cell size and mirroring are part of it. */
export const stripKey = (id: string, master: number, frame: number, mirror: boolean): string => `${id}@${master}-${frame}${mirror ? '' : '-m8'}`;

/** Pixel position of the k-th cell of an id inside its strip. */
export const stripPos = (k: number, frame: number): { x: number; y: number } => ({ x: (k % STRIP_COLS) * frame, y: Math.floor(k / STRIP_COLS) * frame });
