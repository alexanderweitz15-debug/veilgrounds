// ui-polish: buff time left in the snapshot (FEATURE-GAP 1.9 / 1.10), cast-fail messages (1.15), buff chips.
import '../src/sim/sim';
import { describe, expect, it, vi } from 'vitest';
import { step } from '../src/sim/sim';
import { addBuff } from '../src/sim/buffs';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type PlayerSetup } from '../src/sim/types';
import { castFailText } from '../src/ui/castFailText';
import { unitChips } from '../src/ui/targetFrame';
import { CX, CY, makeSim, place } from './combat-helpers';

// targetFrame pulls canvas-only modules (icons -> sprite atlas -> Path2D): stub what the chip logic does not need
vi.mock('../src/ui/icons', () => ({ abilityIcon: () => null, itemIcon: () => null, setIcon: () => {} }));
vi.mock('../src/ui/tooltip', () => ({ setTip: () => {} }));
vi.mock('../src/render/portraits', () => ({ setPortrait: () => {} }));

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

describe('snapshot buff time left', () => {
  const sim = makeSim({ players: [player(0, 'mira'), player(5, 'brom')] });
  const m = sim.slots[0]!;
  const foe = sim.slots[5]!;
  place(sim, m, CX, CY);
  place(sim, foe, CX + 300, CY);
  addBuff(sim, m, { kind: 'stat', id: 'mira_e', stat: 'ad', pct: 10, ticks: sec(5) });
  addBuff(sim, m, { kind: 'mark', id: 'dornenbock', ticks: sec(60) });
  step(sim);

  it('own team sees seconds left of an ability aura and of a jungle buff', () => {
    const e = buildSnapshot(sim, 0, 0).entities.find((s) => s.id === m)!;
    expect(e.auras).toContain('mira_e');
    expect(e.auraLeft!['mira_e']).toBeGreaterThan(4.5);
    expect(e.auraLeft!['mira_e']).toBeLessThanOrEqual(5);
    expect(e.buffs).toEqual([{ id: 'dornenbock', left: expect.any(Number) }]);
    expect(e.buffs![0]!.left).toBeGreaterThan(59);
    expect(e.marks ?? []).toEqual([]); // not drawn as stack pips
  });

  it('the enemy sees them on the target frame while the champion is in view', () => {
    const e = buildSnapshot(sim, 1, 5).entities.find((s) => s.id === m)!;
    expect(e.auraLeft!['mira_e']).toBeGreaterThan(4.5);
    expect(e.buffs![0]!.id).toBe('dornenbock');
  });

  it('nothing for a unit that is out of view', () => {
    place(sim, foe, CX + 9000, CY + 9000);
    step(sim);
    expect(buildSnapshot(sim, 1, 5).entities.find((s) => s.id === m)).toBeUndefined();
  });
});

describe('cast-fail text', () => {
  const tr = (k: string): string => k;
  const hud = { abilities: [{ cdLeft: 3.2, cost: 60 }, { cdLeft: 0, cost: 0 }, { cdLeft: 0, cost: 0 }, { cdLeft: 0, cost: 0 }, { cdLeft: 41, cost: 0 }], itemCds: [{ left: 0 }, { left: 12.4 }] };
  it('adds cooldown seconds and mana owned / needed', () => {
    expect(castFailText({ reason: 'cooldown', slot: 0 }, hud, 100, 'Q', tr)).toBe('Q: castFail.cooldown (4 s)');
    expect(castFailText({ reason: 'mana', slot: 0 }, hud, 41.9, '', tr)).toBe('castFail.mana (41 / 60)');
    expect(castFailText({ reason: 'cooldown', slot: 0, summoner: true }, hud, 0, 'Flash', tr)).toBe('Flash: castFail.cooldown (41 s)');
  });
  it('item fails use the item wording and the item cooldown', () => {
    expect(castFailText({ reason: 'cooldown', slot: 1, item: true }, hud, 0, 'Zeitglas', tr)).toBe('Zeitglas: castFail.item.cooldown (13 s)');
    expect(castFailText({ reason: 'target', slot: 1, item: true }, hud, 0, 'Ward', tr)).toBe('Ward: castFail.item.target');
    expect(castFailText({ reason: 'range', slot: 0 }, hud, 0, '', tr)).toBe('castFail.range');
  });
});

describe('buff chips', () => {
  it('carry the time left and a timed tooltip; jungle buffs and own marks are not doubled', () => {
    const e = { cc: 0, auras: ['mira_e'], auraLeft: { mira_e: 3.2 }, buffs: [{ id: 'dornenbock', left: 40 }] } as never;
    const chips = unitChips(e, 0, [{ id: 'dornenbock', left: 40 }]);
    expect(chips.map((c) => c.key)).toEqual(['aura:mira_e', 'mark:dornenbock']);
    expect(chips[0]!.left).toBe(3.2);
    expect(chips[0]!.tip.startsWith('timed:4:')).toBe(true);
    expect(chips[1]!.tip.startsWith('timed:40:text:')).toBe(true);
  });
});
