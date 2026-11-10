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

import { epicDue } from '../src/ui/announce';

describe('epic respawn schedule', () => {
  it('warns once 30 s ahead, announces the spawn once, then forgets the id', () => {
    const next = new Map([['leviathan', 600]]);
    const seen = new Set<string>();
    expect(epicDue(560, next, seen)).toEqual({ warn: [], spawn: [] });
    expect(epicDue(571, next, seen)).toEqual({ warn: ['leviathan'], spawn: [] });
    expect(epicDue(575, next, seen)).toEqual({ warn: [], spawn: [] }); // once only
    expect(epicDue(601, next, seen)).toEqual({ warn: [], spawn: ['leviathan'] });
    expect(next.size).toBe(0);
    expect(epicDue(602, next, seen)).toEqual({ warn: [], spawn: [] });
  });
  it('a second kill schedules a new respawn that warns again', () => {
    const next = new Map([['leviathan', 900]]);
    const seen = new Set(['wleviathan@600', 'sleviathan@600']);
    expect(epicDue(871, next, seen).warn).toEqual(['leviathan']);
  });
});
