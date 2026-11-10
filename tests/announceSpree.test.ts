import { describe, expect, it } from 'vitest';
import { SHUTDOWN_AT, spreeKey } from '../src/ui/announce';

describe('announcer sprees', () => {
  it('names a spree from 3 kills and caps at 8', () => {
    expect(spreeKey(2)).toBeNull();
    expect(spreeKey(3)).toBe('ann.spree3');
    expect(spreeKey(12)).toBe('ann.spree8');
    expect(SHUTDOWN_AT).toBe(3);
  });
});
