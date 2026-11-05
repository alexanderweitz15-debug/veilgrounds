// Henrike Federwerk kit: passive Mainspring (autos wind, full tension overwinds the next ability), Q bolt, W clockwork turret,
// E spring hop, R hour strike, the item Hemmwerk and the sprite kit.
import { CX, CY, collect, makeSim, place, steps } from './combat-helpers';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { rect(): void {} };
});
import { step, type Sim } from '../src/sim/sim';
import { hasBuff } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { cooldownLeft, levelAbility } from '../src/sim/systems/abilities';
import { championData, missingHooks } from '../src/sim/champions';
import { henrikeFull, henrikeTension, henrikeTurret } from '../src/sim/champions/henrike';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { championKit, framesOf } from '../src/render/champions';
import { itemById } from '../src/sim/items/inventory';
import { goldEfficiency } from '../src/ui/goldEfficiency';
import { autos, duel } from './itemHelpers';

const player: PlayerSetup = { slot: 0, team: 0, champion: 'henrike', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true };
const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number): Command => ({ t: 'cast', slot, x, y });

function setup(): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = 9;
  sim.c.Champ.skillPoints[m] = 30;
  for (const slot of [0, 1, 2, 3]) levelAbility(sim, m, slot);
  step(sim);
  return { sim, m };
}
/** Auto-attack `d` until the spring is full (max 600 ticks). */
function windUp(sim: Sim, m: number, d: number): void {
  step(sim, [{ slot: 0, cmd: { t: 'attack', target: d } }]);
  for (let i = 0; i < 900 && !henrikeFull(sim, m); i++) step(sim);
}
/** Cancels the standing attack order so only casts act. */
const stop = (sim: Sim): void => step(sim, [{ slot: 0, cmd: { t: 'stop' } as Command }]);

describe('Henrike data', () => {
  it('hooks exist, ADC with a ranged auto', () => {
    expect(missingHooks('henrike')).toEqual([]);
    const d = championData('henrike');
    expect(d.roles).toEqual(['adc']);
    expect(d.attackType).toBe('ranged');
  });
  it('is tuned like the other marksmen (HP / AD / range within 10 % of Mira)', () => {
    const t = championData('henrike').base;
    const o = championData('mira').base;
    expect(t.hp / o.hp).toBeGreaterThan(0.9);
    expect(t.hp / o.hp).toBeLessThan(1.1);
    expect(t.ad / o.ad).toBeGreaterThan(0.9);
    expect(t.ad / o.ad).toBeLessThan(1.1);
    expect(t.range).toBeLessThanOrEqual(o.range + 25);
  });
});

describe('Passive Mainspring', () => {
  it('each auto winds the spring (+3 % attack speed per wind) up to 5; it decays after 4 s', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    const as0 = sim.c.Stats.as[m]!;
    windUp(sim, m, d);
    expect(henrikeTension(sim, m)).toBe(5);
    step(sim);
    expect(sim.c.Stats.as[m]! / as0).toBeCloseTo(1.15, 2);
    expect(buildSnapshot(sim, 0, 0).me?.passive).toMatchObject({ stacks: 5, max: 5, ready: true });
    stop(sim);
    steps(sim, sec(4.5));
    expect(henrikeTension(sim, m)).toBe(0);
  });

  it('full tension overwinds the next ability: +40 % damage, 30 % of the cooldown back, spring unwinds', () => {
    const plain = setup();
    const d0 = spawnDummy(plain.sim, CX + 400, CY, 1);
    step(plain.sim);
    const base = collect(plain.sim, 40, plain.m, cast(0, CX + 400, CY)).find((h) => h.dst === d0)!;
    const cdPlain = cooldownLeft(plain.sim, plain.m, 0);

    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    windUp(sim, m, d);
    stop(sim);
    const hits = collect(sim, 40, m, cast(0, CX + 400, CY)).filter((h) => h.dst === d);
    const over = hits[hits.length - 1]!;
    expect(over.amount / base.amount).toBeCloseTo(1.4, 1);
    expect(henrikeTension(sim, m)).toBe(0);
    expect(cooldownLeft(sim, m, 0)).toBeLessThan(cdPlain * 0.85); // 30 % refunded, same ticks elapsed
  });
});

describe('Q Spring Bolt', () => {
  it('hits for damage and slows 25 %', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const hits = collect(sim, 40, m, cast(0, CX + 500, CY));
    expect(hits.some((h) => h.dst === d)).toBe(true);
    expect(hasBuff(sim, d, 'slow')).toBe(true);
  });
});

describe('W Clockwork Turret', () => {
  it('deploys 700 ahead and shoots the nearest champion for 6 s without her attacking', () => {
    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 700, CY + 100, 1);
    step(sim);
    const hits = collect(sim, sec(3), m, cast(1, CX + 700, CY));
    expect(henrikeTurret(sim, m)).not.toBeNull();
    expect(hits.filter((h) => h.dst === d).length).toBeGreaterThanOrEqual(3);
    steps(sim, sec(4));
    expect(henrikeTurret(sim, m)).toBeNull();
  });

  it('shows the turret as a snapshot object while it stands', () => {
    const { sim, m } = setup();
    step(sim, [{ slot: 0, cmd: cast(1, CX + 600, CY) }]);
    steps(sim, 10);
    expect(henrikeTurret(sim, m)).not.toBeNull();
    const obj = buildSnapshot(sim, 0, 0).objects.find((o) => o.tag === 'henrike_w_turret');
    expect(obj).toBeDefined();
  });

  it('a second W replaces the first turret (one at a time)', () => {
    const { sim, m } = setup();
    step(sim, [{ slot: 0, cmd: cast(1, CX + 300, CY) }]);
    steps(sim, 10);
    const first = henrikeTurret(sim, m)!.x;
    steps(sim, sec(19));
    step(sim, [{ slot: 0, cmd: cast(1, CX - 300, CY) }]);
    steps(sim, 10);
    expect(henrikeTurret(sim, m)!.x).toBeLessThan(first);
  });

  it('an overwound deploy shoots 40 % harder', () => {
    const plain = setup();
    const d0 = spawnDummy(plain.sim, CX + 700, CY, 1);
    step(plain.sim);
    const a = collect(plain.sim, sec(1.5), plain.m, cast(1, CX + 700, CY)).find((h) => h.dst === d0)!;

    const { sim, m } = setup();
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    windUp(sim, m, d);
    stop(sim);
    const b = collect(sim, sec(1.5), m, cast(1, CX + 700, CY)).find((h) => h.dst === d)!;
    expect(b.amount / a.amount).toBeCloseTo(1.4, 1);
  });
});

describe('E Spring Hop', () => {
  it('hops 300 toward the cursor and speeds her up', () => {
    const { sim, m } = setup();
    const ms0 = sim.c.Stats.ms[m]!;
    step(sim, [{ slot: 0, cmd: cast(2, CX + 500, CY) }]);
    steps(sim, 20);
    expect(sim.c.Pos.x[m]! - CX).toBeGreaterThan(250);
    expect(sim.c.Pos.x[m]! - CX).toBeLessThan(330);
    expect(sim.c.Stats.ms[m]!).toBeGreaterThan(ms0 * 1.15);
  });
});

describe('R Hour Strike', () => {
  it('lands after 0.9 s: damage and a 50 % slow in radius 280', () => {
    const { sim, m } = setup();
    const near = spawnDummy(sim, CX + 900, CY, 1);
    const far = spawnDummy(sim, CX + 900, CY + 500, 1);
    step(sim);
    const hits = collect(sim, sec(1.6), m, cast(3, CX + 900, CY));
    expect(hits.some((h) => h.dst === near)).toBe(true);
    expect(hits.some((h) => h.dst === far)).toBe(false);
    expect(hasBuff(sim, near, 'slow')).toBe(true);
  });
});

describe('Hemmwerk', () => {
  it('is a legendary with a fair gold efficiency and a unique recipe', () => {
    const it = itemById('hemmwerk')!;
    expect(it.tier).toBe('legendary');
    expect(it.from).toEqual(['eiferschwert', 'kaltstahl']);
    const e = goldEfficiency(it)!;
    expect(e.pct).toBeGreaterThan(85);
    expect(e.pct).toBeLessThan(115);
  });

  it('every 3rd basic attack hit deals bonus magic damage', () => {
    const { sim, me, foe } = duel({ champ: 'mira', items: ['hemmwerk'] });
    const ev = autos(sim, me, foe, 3);
    expect(ev.filter((e) => e.type === 'magic')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'phys').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Henrike sprite kit', () => {
  it('has its own clockwork kit with three props and every animation', () => {
    const k = championKit('henrike')!;
    expect(k.name).toBe('Henrike Federwerk');
    expect(k.props.length).toBe(3);
    expect(k.look).toContain('winding key');
    for (const a of ['idle', 'run', 'attack', 'cast', 'death'] as const) expect(framesOf('henrike', a)).toBeGreaterThan(0);
    expect(championKit('aurel')!.look).not.toBe(k.look);
  });
});
