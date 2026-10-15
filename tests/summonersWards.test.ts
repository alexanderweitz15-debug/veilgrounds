import { describe, expect, it } from 'vitest';
import { createSim, step, type Sim } from '../src/sim/sim';
import { Kind, Lane, sec, type Command, type SimConfig } from '../src/sim/types';
import { addBuff, hasBuff, hasStat, strongestSlow } from '../src/sim/buffs';
import { dealDamage } from '../src/sim/damage';
import { abilityHud, champAbil } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { structureAt } from '../src/sim/systems/towers';
import { sees } from '../src/sim/vision';
import { buildSnapshot } from '../src/sim/snapshot';
import { inventory } from '../src/sim/items/inventory';
import { SUMMONERS, TELEPORT_CHANNEL_TICKS, TELEPORT_INTERRUPT_CD, TELEPORT_LATE_TICK, teleporting } from '../src/sim/summoners';
import { SEAL, SWEEP, TRINKET, VEIL, WARD_PLACE_RANGE, trinket, wardStats, wardsOf } from '../src/sim/wards';
import { CX, CY, place, steps } from './combat-helpers';

function sim2(sums0: [string, string], sums1: [string, string] = ['sprung', 'heilen'], extra: Partial<SimConfig> = {}): Sim {
  return createSim({
    seed: 3,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: sums0, isHuman: true },
      { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: sums1, isHuman: true },
    ],
    ...extra,
  });
}

const cmd = (sim: Sim, slot: number, c: Command): void => step(sim, [{ slot, cmd: c }]);

describe('summoner data', () => {
  it('all summoners implemented (no todo flags), Phase 2 numbers', () => {
    expect(SUMMONERS.filter((s) => s.todo)).toEqual([]);
    const by = (id: string) => SUMMONERS.find((s) => s.id === id)!;
    expect(by('erschoepfen').cooldown).toBe(240);
    expect(by('reinigen').cooldown).toBe(210);
    expect(by('teleport').cooldown).toBe(360);
    expect(by('teleport').cooldownLate).toBe(240);
  });
});

describe('Erschöpfen', () => {
  it('target deals 40 % less damage and is slowed 30 % for 2.5 s; 240 s cooldown', () => {
    const sim = sim2(['erschoepfen', 'heilen']);
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, CX, CY);
    place(sim, b, CX + 400, CY);
    step(sim);
    const d = spawnDummy(sim, CX - 2000, CY, 0);
    const before = dealDamage(sim, b, d, 100, 'true');
    cmd(sim, 0, { t: 'spell', slot: 0, x: CX + 400, y: CY, target: b });
    expect(strongestSlow(sim, b)).toBe(30);
    expect(dealDamage(sim, b, d, 100, 'true')).toBeCloseTo(before * 0.6, 6);
    expect(abilityHud(sim, a)[4]!.cdTotal).toBe(240);
    steps(sim, sec(2.5));
    expect(strongestSlow(sim, b)).toBe(0);
    expect(dealDamage(sim, b, d, 100, 'true')).toBeCloseTo(before, 6);
  });
  it('out of range (650) does nothing and costs no cooldown', () => {
    const sim = sim2(['erschoepfen', 'heilen']);
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, CX, CY);
    place(sim, b, CX + 900, CY);
    step(sim);
    cmd(sim, 0, { t: 'spell', slot: 0, x: CX + 900, y: CY, target: b });
    expect(strongestSlow(sim, b)).toBe(0);
    expect(abilityHud(sim, a)[4]!.cdLeft).toBe(0);
  });
});

describe('Reinigen', () => {
  it('castable while stunned: removes stun/root/slow/silence and summoner debuffs, 65 % tenacity 3 s', () => {
    const sim = sim2(['reinigen', 'heilen']);
    const a = sim.slots[0]!;
    place(sim, a, CX, CY);
    step(sim);
    addBuff(sim, a, { kind: 'stun', id: 'x', ticks: sec(2) });
    addBuff(sim, a, { kind: 'slow', id: 'y', pct: 50, ticks: sec(2) });
    addBuff(sim, a, { kind: 'dot', id: 'entflammen', src: sim.slots[5]!, amount: 10, period: 30, ticks: sec(5) });
    cmd(sim, 0, { t: 'spell', slot: 0, x: CX, y: CY });
    expect(hasBuff(sim, a, 'stun')).toBe(false);
    expect(hasBuff(sim, a, 'slow')).toBe(false);
    expect(hasBuff(sim, a, 'dot')).toBe(false);
    expect(sim.c.Stats.tenacity[a]).toBeCloseTo(0.65, 6);
    addBuff(sim, a, { kind: 'stun', id: 'z', ticks: 100 });
    const st = (sim.state.buffs as { ents: Map<number, { list: { kind: string; until: number; start: number }[] }> }).ents.get(a)!.list.find((x) => x.kind === 'stun')!;
    expect(st.until - st.start).toBe(35);
    steps(sim, sec(3));
    expect(sim.c.Stats.tenacity[a]).toBe(0);
  });
  it('does not work while airborne or suppressed', () => {
    for (const kind of ['airborne', 'suppress'] as const) {
      const sim = sim2(['reinigen', 'heilen']);
      const a = sim.slots[0]!;
      step(sim);
      addBuff(sim, a, { kind, id: 'x', ticks: sec(2) });
      cmd(sim, 0, { t: 'spell', slot: 0, x: 0, y: 0 });
      expect(hasBuff(sim, a, kind)).toBe(true);
      expect(abilityHud(sim, a)[4]!.cdLeft).toBe(0);
    }
  });
});

describe('Teleport', () => {
  const outer = (sim: Sim) => structureAt(sim, 0, Kind.Tower, Lane.Top, 0)!;

  it('4 s channel to an own tower; lands beside it; busy meanwhile; 360 s cooldown before 10:00', () => {
    const sim = sim2(['teleport', 'heilen']);
    const a = sim.slots[0]!;
    step(sim);
    const t = outer(sim);
    cmd(sim, 0, { t: 'spell', slot: 0, x: t.x, y: t.y });
    expect(teleporting(sim, a)).toBe(true);
    expect(abilityHud(sim, a)[4]!.cdTotal).toBe(360);
    cmd(sim, 0, { t: 'move', x: 9000, y: 9000 }); // moving does not cancel (LoL: rooted while channelling)
    steps(sim, TELEPORT_CHANNEL_TICKS - 3);
    expect(teleporting(sim, a)).toBe(true);
    steps(sim, 3);
    expect(teleporting(sim, a)).toBe(false);
    const d = Math.hypot(sim.c.Pos.x[a]! - t.x, sim.c.Pos.y[a]! - t.y);
    expect(d).toBeGreaterThan(sim.c.Unit.radius[t.eid]!);
    expect(d).toBeLessThan(400);
  });
  it('before 10:00 minions/champions are no targets; after 10:00 they are, cooldown 240', () => {
    const sim = sim2(['teleport', 'heilen'], ['sprung', 'heilen'], {
      players: [
        { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['teleport', 'heilen'], isHuman: true },
        { slot: 1, team: 0, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true },
      ],
    });
    const [a, ally] = [sim.slots[0]!, sim.slots[1]!];
    place(sim, ally, CX, CY);
    step(sim);
    cmd(sim, 0, { t: 'spell', slot: 0, x: CX, y: CY, target: ally });
    expect(teleporting(sim, a)).toBe(false);
    while (sim.tick < TELEPORT_LATE_TICK) sim.tick++; // jump the clock (no simulation needed for this check)
    cmd(sim, 0, { t: 'spell', slot: 0, x: CX, y: CY, target: ally });
    expect(teleporting(sim, a)).toBe(true);
    expect(abilityHud(sim, a)[4]!.cdTotal).toBe(240);
    steps(sim, TELEPORT_CHANNEL_TICKS + 1);
    expect(Math.hypot(sim.c.Pos.x[a]! - CX, sim.c.Pos.y[a]! - CY)).toBeLessThan(200);
  });
  it('hard CC interrupts (short cooldown), recast cancels', () => {
    const sim = sim2(['teleport', 'heilen']);
    const a = sim.slots[0]!;
    step(sim);
    const t = outer(sim);
    const x0 = sim.c.Pos.x[a]!;
    cmd(sim, 0, { t: 'spell', slot: 0, x: t.x, y: t.y });
    steps(sim, 30);
    addBuff(sim, a, { kind: 'stun', id: 'x', ticks: 10 });
    step(sim);
    expect(teleporting(sim, a)).toBe(false);
    expect(champAbil(sim, a).sumCdUntil[0]! - sim.tick).toBeGreaterThan(TELEPORT_INTERRUPT_CD - 3);
    steps(sim, TELEPORT_CHANNEL_TICKS);
    expect(sim.c.Pos.x[a]).toBe(x0);
    champAbil(sim, a).sumCdUntil[0] = 0;
    steps(sim, 15);
    cmd(sim, 0, { t: 'spell', slot: 0, x: t.x, y: t.y });
    expect(teleporting(sim, a)).toBe(true);
    cmd(sim, 0, { t: 'spell', slot: 0, x: t.x, y: t.y });
    expect(teleporting(sim, a)).toBe(false);
  });
});

describe('wards', () => {
  function setup(): { sim: Sim; a: number; b: number } {
    const sim = sim2(['sprung', 'heilen']);
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, CX, CY);
    place(sim, b, CX + 3000, CY);
    step(sim);
    return { sim, a, b };
  }

  it('trinket: 1 charge at start, max 2, recharge 240 s at level 1; ward lives 90 s with 900 vision', () => {
    const { sim, a } = setup();
    expect(trinket(sim, a).charges).toBe(TRINKET.startCharges);
    cmd(sim, 0, { t: 'ward', x: CX + 300, y: CY });
    expect(wardsOf(sim, 0)).toHaveLength(1);
    expect(trinket(sim, a).charges).toBe(0);
    cmd(sim, 0, { t: 'ward', x: CX + 300, y: CY + 300 });
    expect(wardsOf(sim, 0)).toHaveLength(1); // no charge left
    const w = wardsOf(sim, 0)[0]!.eid;
    expect(sim.c.Vision.r[w]).toBe(900);
    const hud = buildSnapshot(sim, 0, 0).me!.trinket!;
    expect(hud.maxCharges).toBe(2);
    expect(hud.cdTotal).toBe(240);
    steps(sim, VEIL.ticks);
    expect(wardsOf(sim, 0)).toHaveLength(0);
    expect(trinket(sim, a).charges).toBe(0);
    steps(sim, sec(240) - VEIL.ticks + 2);
    expect(trinket(sim, a).charges).toBe(1);
    expect(wardStats(sim, 0).veilPlaced).toBe(1);
    expect(wardStats(sim, 0).wardTicks).toBe(VEIL.ticks);
  });

  it('placement is clamped to 600 range; max 3 Schleierwards per player (oldest goes)', () => {
    const { sim, a } = setup();
    trinket(sim, a).charges = 2;
    cmd(sim, 0, { t: 'ward', x: CX + 2000, y: CY });
    const w = wardsOf(sim, 0)[0]!.eid;
    expect(Math.hypot(sim.c.Pos.x[w]! - CX, sim.c.Pos.y[w]! - CY)).toBeLessThanOrEqual(WARD_PLACE_RANGE + 1);
    for (let i = 0; i < 3; i++) {
      trinket(sim, a).charges = 1;
      cmd(sim, 0, { t: 'ward', x: CX, y: CY + 100 * i });
    }
    const list = wardsOf(sim, 0);
    expect(list).toHaveLength(VEIL.maxPerPlayer);
    expect(list.some((x) => x.eid === w)).toBe(false);
  });

  it('Schleierward is invisible to enemies, gives vision (also in fog), dies to 3 autos, abilities do not hurt it', () => {
    const { sim, a, b } = setup();
    cmd(sim, 0, { t: 'ward', x: CX + 500, y: CY });
    const w = wardsOf(sim, 0)[0]!.eid;
    place(sim, b, CX + 700, CY);
    place(sim, a, CX - 3000, CY);
    step(sim);
    expect(sees(sim, 1, w)).toBe(false);
    expect(sees(sim, 0, b)).toBe(true); // the ward sees brom with mira far away
    expect(buildSnapshot(sim, 1, 5).entities.some((e) => e.id === w)).toBe(false);
    expect(dealDamage(sim, b, w, 500, 'magic')).toBe(0);
    for (let i = 0; i < 3; i++) dealDamage(sim, b, w, 999, 'phys', { isAuto: true });
    step(sim);
    expect(wardsOf(sim, 0)).toHaveLength(0);
    expect(wardStats(sim, 5).wardsKilled).toBe(1);
  });

  it('Siegelward via the item command: visible, permanent, max 1, reveals + disables enemy Schleierwards in range', () => {
    const { sim, a, b } = setup();
    // brom wards, mira has a seal ward in her inventory
    place(sim, b, CX + 900, CY);
    step(sim);
    cmd(sim, 5, { t: 'ward', x: CX + 700, y: CY + 100 });
    const enemyWard = wardsOf(sim, 1)[0]!.eid;
    place(sim, b, CX + 6000, CY); // brom leaves; only the ward watches
    step(sim);
    expect(sees(sim, 1, a)).toBe(true);
    inventory(sim, a)[0] = 'siegelward';
    cmd(sim, 0, { t: 'item', slot: 0, x: CX + 300, y: CY });
    expect(inventory(sim, a)[0]).toBeNull();
    const seal = wardsOf(sim, 0).find((x) => x.type === 'seal')!.eid;
    expect(seal).toBeDefined();
    step(sim);
    expect(hasStat(sim, seal, 'invisible')).toBe(false); // seal wards are visible (normal vision rules)
    expect(sees(sim, 0, enemyWard)).toBe(true); // revealed
    expect(sim.c.Vision.r[enemyWard]).toBe(0); // disabled
    expect(sees(sim, 1, a)).toBe(false); // the disabled ward no longer spots mira
    steps(sim, sec(200));
    expect(wardsOf(sim, 0).some((x) => x.eid === seal)).toBe(true); // permanent
    inventory(sim, a)[0] = 'siegelward';
    cmd(sim, 0, { t: 'item', slot: 0, x: CX, y: CY + 300 });
    expect(wardsOf(sim, 0).filter((x) => x.type === 'seal')).toHaveLength(SEAL.maxPerPlayer);
    expect(wardsOf(sim, 0).some((x) => x.eid === seal)).toBe(false);
  });

  it('Suchfeuer: swap in the fountain from level 9; sweep reveals enemy wards in the area for 6 s', () => {
    const { sim, b } = setup();
    cmd(sim, 5, { t: 'trinket', id: 'suchfeuer' });
    expect(trinket(sim, b).id).toBe('schleierward'); // not in the fountain
    const f = sim.map.sides[1].fountain;
    place(sim, b, f.x, f.y);
    step(sim);
    cmd(sim, 5, { t: 'trinket', id: 'suchfeuer' });
    expect(trinket(sim, b).id).toBe('schleierward'); // level 1
    sim.c.Champ.level[b] = SWEEP.unlockLevel;
    cmd(sim, 5, { t: 'trinket', id: 'suchfeuer' });
    expect(trinket(sim, b).id).toBe('suchfeuer');
    // mira wards, brom sweeps it
    cmd(sim, 0, { t: 'ward', x: CX + 400, y: CY });
    const w = wardsOf(sim, 0)[0]!.eid;
    place(sim, b, CX + 900, CY);
    step(sim);
    expect(sees(sim, 1, w)).toBe(false);
    cmd(sim, 5, { t: 'ward', x: CX + 450, y: CY });
    step(sim);
    expect(sees(sim, 1, w)).toBe(true);
    expect(sim.c.Vision.r[w]).toBe(0);
    expect(buildSnapshot(sim, 1, 5).me!.trinket!.cdLeft).toBeGreaterThan(70); // 90 -> 60 s by level
    steps(sim, SWEEP.ticks);
    expect(sees(sim, 1, w)).toBe(false);
    expect(wardStats(sim, 5).sweeps).toBe(1);
    expect(wardStats(sim, 5).wardsRevealed).toBe(1);
  });

  it('snapshots carry the ward type; own wards also their vision radius', () => {
    const { sim } = setup();
    cmd(sim, 0, { t: 'ward', x: CX + 200, y: CY });
    const e = buildSnapshot(sim, 0, 0).entities.find((x) => x.kind === Kind.Ward && x.ward)!;
    expect(e.ward).toBe('veil');
    expect(e.vision).toBe(900);
  });
});
