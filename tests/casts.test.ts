// Agent F: per-ability cast families (src/render/champions/casts.ts), canvas-free.
import { describe, expect, it } from 'vitest';
import { CAST_FAMILIES, castFamily, castSelfPose, castStylesOf } from '../src/render/champions/casts';
import { champions } from '../src/data/champions';

describe('cast families', () => {
  it('every roster champion has two different cast styles and uses both', () => {
    for (const id of Object.keys(champions)) {
      const f = CAST_FAMILIES[id];
      expect([id, !!f]).toEqual([id, true]);
      expect([id, f!.a === f!.b]).toEqual([id, false]);
      expect([id, new Set(f!.slots).size]).toEqual([id, 2]);
      expect(castStylesOf(id, 'forward')).toEqual([f!.a, f!.b]);
    }
  });

  it('family lookup clamps extra slots (Sev R choices) to R and falls back to A for unknown ids', () => {
    expect(castFamily('sev', 5)).toBe(castFamily('sev', 3));
    expect(castFamily('melee0', 2)).toBe(0);
    expect(castSelfPose('melee0', 0)).toBe(false);
  });

  it('self abilities play a self pose: stomp / raise / ring / spin / slam families, never a thrown one', () => {
    for (const id of Object.keys(champions)) {
      champions[id]!.abilities.forEach((ab, slot) => {
        if (ab.type !== 'self') return;
        const f = CAST_FAMILIES[id]!;
        const style = f.slots[slot as 0 | 1 | 2 | 3] ? f.b : f.a;
        expect([id, slot, style, castSelfPose(id, slot)]).toEqual([id, slot, style, ['stomp', 'raise', 'ring', 'spin', 'slam'].includes(style)]);
        expect([id, slot, ['lob', 'draw', 'point', 'lunge'].includes(style)]).toEqual([id, slot, false]);
      });
    }
  });

  it('at least 6 distinct cast styles are used across the roster', () => {
    const styles = new Set<string>();
    for (const f of Object.values(CAST_FAMILIES)) styles.add(f.a).add(f.b);
    expect(styles.size).toBeGreaterThanOrEqual(8);
  });
});
