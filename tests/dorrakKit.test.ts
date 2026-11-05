import { describe, expect, it, vi } from 'vitest';

// the kit registry module builds a Path2D at load time (browser only)
vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { CHAMPION_IDS, championKit, framesOf, worldSizeOf } from '../src/render/champions';
import { rendererOf } from '../src/render/champions/atlas';

describe('dorrak sprite kit', () => {
  it('has a kit, is a champion id and is painted by a custom drawer with all five animations', () => {
    const k = championKit('dorrak')!;
    expect(k.name).toBe('Dorrak Sandschlund');
    expect(CHAMPION_IDS.includes('dorrak')).toBe(true);
    expect(rendererOf('dorrak')).toBe('drawer');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('dorrak', a)).toBeGreaterThan(0);
    expect(worldSizeOf('dorrak')).toBeGreaterThan(150);
  });
});
