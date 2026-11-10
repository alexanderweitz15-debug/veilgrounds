import { describe, expect, it } from 'vitest';
import { BUILDS } from '../src/ai/bot/builds';
import { missingCore } from '../src/ui/buildReview';

describe('build review', () => {
  it('lists boots and core items that are not owned, in buy order', () => {
    const b = BUILDS.mira!.standard;
    expect(missingCore('mira', [])).toEqual([b.boots, ...b.core]);
    expect(missingCore('mira', [b.boots, b.core[0]!])).toEqual(b.core.slice(1));
    expect(missingCore('nobody', [])).toEqual([]);
  });
});
