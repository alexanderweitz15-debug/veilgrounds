// C5 / FEATURE-GAP 4.3: ban phase replaces banned bot champions by free ones of their role; C7 minimap fit.
import { describe, expect, it } from 'vitest';
import { MAX_BANS, applyBans, toggleBan } from '../src/game/bans';
import { classicConfig } from '../src/ai/runner';
import { CHAMPION_DATA } from '../src/sim/champions';
import { RANKS } from '../src/ai/profiles/schema';
import { defaultRunes } from '../src/sim/items/runes';
import type { PlayerSetup } from '../src/sim/types';

const ALL = Object.keys(CHAMPION_DATA).sort();
const forRole = (role: PlayerSetup['role']): string[] => ALL.filter((id) => (CHAMPION_DATA[id]!.roles as readonly string[]).includes(role));

describe('ban phase', () => {
  it('no banned champion is played by a bot, champions stay unique and fit the role where possible', () => {
    const cfg = classicConfig('mira', 'adc', RANKS[3]!, { seed: 11 });
    const bans = new Set(cfg.players.filter((p) => !p.isHuman).slice(0, 5).map((p) => p.champion));
    const before = cfg.players.map((p) => ({ slot: p.slot, champ: p.champion, name: p.bot?.rank }));
    applyBans(cfg.players, bans, forRole, ALL);
    const champs = cfg.players.map((p) => p.champion);
    expect(champs.filter((c) => bans.has(c))).toEqual([]);
    expect(new Set(champs).size).toBe(champs.length);
    for (const p of cfg.players) {
      const was = before.find((b) => b.slot === p.slot)!;
      if (was.champ !== p.champion) {
        expect(forRole(p.role)).toContain(p.champion);
        expect(p.runes).toEqual(defaultRunes(p.champion));
      }
    }
    expect(cfg.players.find((p) => p.isHuman)!.champion).toBe('mira');
  });

  it('toggleBan: own champion never, at most MAX_BANS', () => {
    const b = new Set<string>();
    toggleBan(b, 'mira', 'mira');
    expect(b.size).toBe(0);
    for (const id of ALL) toggleBan(b, id, 'mira');
    expect(b.size).toBe(MAX_BANS);
    toggleBan(b, [...b][0]!, 'mira');
    expect(b.size).toBe(MAX_BANS - 1);
  });
});

describe('minimap fit (C7)', () => {
  it('caps the minimap so it never reaches the centred bottom panel', async () => {
    const { minimapFitScale } = await import('../src/ui/display');
    // 1280 px, 605 px panel, ui 1: (1280 - 605) / 2 - 6 = 331.5 px free -> 331.5 / 294
    expect(minimapFitScale(1280, 605, 1)).toBeCloseTo(331.5 / 294, 5);
    expect(minimapFitScale(1920, 908, 1.5)).toBeCloseTo((1012 / 2 - 6) / (294 * 1.5), 5);
    expect(minimapFitScale(1280, 0, 1)).toBeNull();
  });
});
