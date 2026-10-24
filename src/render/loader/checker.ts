// The missing-asset checkerboard: classic pink/black squares. Dependency-free so both the atlas builder
// (champions/atlas.ts reserves one cell for it) and loader/placeholder.ts can use it.

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const CHECKER_PINK = '#ff00ff';
export const CHECKER_BLACK = '#000000';
/** squares per edge */
export const CHECKER_SQUARES = 8;

/** Fills the size x size square at (x, y) with the checkerboard. */
export function paintChecker(ctx: Ctx2d, x: number, y: number, size: number): void {
  const q = size / CHECKER_SQUARES;
  for (let j = 0; j < CHECKER_SQUARES; j++)
    for (let i = 0; i < CHECKER_SQUARES; i++) {
      ctx.fillStyle = (i + j) % 2 ? CHECKER_BLACK : CHECKER_PINK;
      ctx.fillRect(x + i * q, y + j * q, Math.ceil(q), Math.ceil(q));
    }
}
