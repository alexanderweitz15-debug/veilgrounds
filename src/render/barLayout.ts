// D2: health-bar overlap resolution for the 2D overlay (src/ui/overlay.ts, agent C wires it in, see
// docs/agents/shared-changes.md). Pure: champions / structures keep their place; minion and monster bars that would
// overlap an already placed bar move up in small steps (LoL keeps every bar readable in a wave clash).

export interface BarRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fixed bars (champions, structures, the hovered unit) never move and are placed first. */
  fixed: boolean;
}

/** Max steps a bar is lifted; beyond that it keeps the last tried slot (overlap accepted). */
export const BAR_MAX_STEPS = 3;
/** Gap between stacked bars (px). */
export const BAR_GAP = 2;

const hits = (a: BarRect, ay: number, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && ay < b.y + b.h && b.y < ay + a.h;

/** Vertical offset (px, <= 0 = up) per bar id. Deterministic: input order breaks ties. */
export function stackBars(bars: readonly BarRect[]): Map<number, number> {
  const out = new Map<number, number>();
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const order = [...bars].sort((a, b) => Number(b.fixed) - Number(a.fixed));
  for (const b of order) {
    let dy = 0;
    if (!b.fixed) {
      for (let step = 0; step <= BAR_MAX_STEPS; step++) {
        dy = step === 0 ? 0 : -step * (b.h + BAR_GAP);
        if (!placed.some((p) => hits(b, b.y + dy, p))) break;
      }
    }
    placed.push({ x: b.x, y: b.y + dy, w: b.w, h: b.h });
    out.set(b.id, dy);
  }
  return out;
}
