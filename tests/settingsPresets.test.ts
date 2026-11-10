import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { PRESETS } from '../src/ui/settingsPresets';

describe('settings presets', () => {
  it('only set known keys with values of the right type', () => {
    for (const patch of Object.values(PRESETS)) {
      for (const [k, v] of Object.entries(patch)) {
        expect(Object.keys(DEFAULT_SETTINGS)).toContain(k);
        expect(typeof v).toBe(typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]);
      }
    }
  });
});
