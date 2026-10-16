// Mechanics feel vs LoL (docs/ROADMAP.md "Mechanik-Feeling"): snapshot run flag, wind-up, attack timing fields,
// unit collision, CC state, walk-into-range casts, castFail, input buffer, idle auto-attack, projectile source.
import { describe, expect, it } from 'vitest';
import { spawnUnit, step, type Sim } from '../src/sim/sim';
import { Kind, type SimEvent } from '../src/sim/types';
import { addBuff } from '../src/sim/buffs';
import { buildSnapshot } from '../src/sim/snapshot';
import { champAbil, levelAbility } from '../src/sim/systems/abilities';
import { windupTicks } from '../src/sim/systems/attack';
import { spawnDummy } from '../src/sim/systems/champions';
import { BODY_OVERLAP } from '../src/sim/systems/movement';
import { CX, CY, NO_RUNES, cmd, collect, makeSim, place, steps } from './combat-helpers';

function solo(champion: string, sums: [string, string] = ['sprung', 'heilen'], autoAttack?: boolean): { sim: Sim; a: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion, role: 'mid', summoners: sums, isHuman: true, ...(autoAttack !== undefined ? { autoAttack } : {}) }] });
  const a = sim.slots[0]!;
  place(sim, a, CX, CY);
  step(sim);
  return { sim, a };
}

function learn(sim: Sim, eid: number, slot: number): void {
  sim.c.Champ.skillPoints[eid] = sim.c.Champ.skillPoints[eid]! + 1;
  if (slot === 3) sim.c.Champ.level[eid] = Math.max(6, sim.c.Champ.level[eid]!);
  levelAbility(sim, eid, slot);
}

function minion(sim: Sim, x: number, y: number, team = 1): number {
  const m = spawnUnit(sim, Kind.MinionMelee, team, x, y, 48);
  sim.c.Hp.max[m] = sim.c.Hp.cur[m] = 5000;
  return m;
}

const snapOf = (sim: Sim, eid: number) => buildSnapshot(sim, 0, 0).entities.find((e) => e.id === eid)!;
const fails = (sim: Sim): Extract<SimEvent, { e: 'castFail' }>[] => sim.events.filter((e): e is Extract<SimEvent, { e: 'castFail' }> => e.e === 'castFail');

describe('snapshot moving = actually walked this tick', () => {
  it('false while attacking in range (Move mode 2), true while walking or chasing', () => {
    const { sim, a } = solo('mira');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    for (let i = 0; i < 60; i++) {
      step(sim);
      expect(sim.c.Move.mode[a]).toBe(2);
      expect(snapOf(sim, a).moving).toBe(false);
    }
    cmd(sim, { t: 'move', x: CX - 600, y: CY });
    expect(snapOf(sim, a).moving).toBe(true);
    // chase: target out of range -> walking in mode 2
    place(sim, d, CX + 1500, CY);
    cmd(sim, { t: 'attack', target: d });
    expect(snapOf(sim, a).moving).toBe(true);
  });

  it('a minion standing and hitting its target does not report moving', () => {
    const { sim } = solo('mira');
    const m = minion(sim, CX + 200, CY + 300, 1);
    const own = minion(sim, CX + 200, CY + 450, 0);
    sim.c.Atk.target[m] = own;
    sim.c.Atk.targetSerial[m] = sim.c.Unit.serial[own]!;
    sim.c.Move.mode[m] = 2;
    let moving = 0;
    for (let i = 0; i < 60; i++) {
      step(sim);
      if (snapOf(sim, m).moving) moving++;
    }
    expect(moving).toBe(0);
  });
});

describe('auto-attack wind-up (LoL-like fractions) and snapshot timing fields', () => {
  it('Mira (marksman 0.18) winds up 8 ticks at level 1, wind-up scales linearly with AS (LoL default)', () => {
    const { sim, a } = solo('mira');
    expect(sim.c.Stats.windup[a]).toBe(0.18);
    expect(windupTicks(sim, a)).toBe(Math.round((30 * 0.18) / sim.c.Stats.as[a]!));
    expect(windupTicks(sim, a)).toBe(8);
    sim.c.Stats.as[a] = sim.c.Stats.as[a]! * 2;
    expect(windupTicks(sim, a)).toBe(4);
  });

  it('every champion: ranged 0.17-0.22, melee 0.2-0.3 of the attack time', () => {
    for (const id of ['mira', 'wren', 'tobin', 'lysa', 'corvin', 'aurel', 'nyx', 'brom', 'isolde', 'gorvam', 'renn']) {
      const { sim, a } = solo(id);
      const w = sim.c.Stats.windup[a]!;
      if (sim.c.Stats.range[a]! >= 400) expect(w >= 0.17 && w <= 0.22, id).toBe(true);
      else expect(w >= 0.2 && w <= 0.3, id).toBe(true);
    }
  });

  it('atkStart/atkEnd follow item/buff attack speed', () => {
    const { sim, a } = solo('mira');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    addBuff(sim, a, { kind: 'stat', stat: 'as', id: 'test_as', src: a, pct: 100, ticks: 600 });
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    const e = snapOf(sim, a);
    expect(e.atkPhase).toBe(1);
    expect(e.atkEnd! - e.atkStart!).toBe(windupTicks(sim, a));
    expect(windupTicks(sim, a)).toBe(4); // 2x AS: half of 8
    while (sim.c.Atk.phase[a] !== 2) step(sim);
    const b = snapOf(sim, a);
    expect(b.atkEnd).toBe(sim.c.Atk.nextReady[a]);
    steps(sim, 40);
    cmd(sim, { t: 'stop' });
    expect(snapOf(sim, a).atkEnd).toBeUndefined();
  });
});

describe('unit collision (champions vs minions / champions)', () => {
  it('a champion walking through a minion line never stands deep inside one and still arrives', () => {
    const { sim, a } = solo('mira');
    const ms = [-100, 0, 100].map((dy) => minion(sim, CX + 400, CY + dy, 1));
    step(sim);
    cmd(sim, { t: 'move', x: CX + 900, y: CY });
    let deep = 0;
    for (let i = 0; i < 90; i++) {
      step(sim);
      for (const m of ms) {
        const dx = sim.c.Pos.x[m]! - sim.c.Pos.x[a]!;
        const dy = sim.c.Pos.y[m]! - sim.c.Pos.y[a]!;
        const half = (sim.c.Unit.radius[m]! + sim.c.Unit.radius[a]!) * 0.5;
        if (dx * dx + dy * dy < half * half) deep++;
      }
    }
    expect(deep).toBe(0);
    expect(sim.c.Pos.x[a]).toBeCloseTo(CX + 900, 0);
  });

  it('two champions on one spot separate to the body distance; stacked minions spread', () => {
    const sim = makeSim({ players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
      { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
    ] });
    const [a, b] = [sim.slots[0]!, sim.slots[5]!];
    place(sim, a, CX, CY);
    place(sim, b, CX + 1, CY);
    const m1 = minion(sim, CX, CY + 500);
    const m2 = minion(sim, CX, CY + 500);
    steps(sim, 30);
    const d = Math.abs(sim.c.Pos.x[b]! - sim.c.Pos.x[a]!);
    expect(d).toBeGreaterThan((sim.c.Unit.radius[a]! + sim.c.Unit.radius[b]!) * BODY_OVERLAP - 1);
    expect(Math.hypot(sim.c.Pos.x[m1]! - sim.c.Pos.x[m2]!, sim.c.Pos.y[m1]! - sim.c.Pos.y[m2]!)).toBeGreaterThan(80);
  });

  it('a champion walking straight at a standing ally slides around it and arrives', () => {
    const sim = makeSim({ players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
      { slot: 1, team: 0, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
    ] });
    const [a, b] = [sim.slots[0]!, sim.slots[1]!];
    place(sim, a, CX, CY);
    place(sim, b, CX + 300, CY); // exactly on a's line of travel
    step(sim);
    cmd(sim, { t: 'move', x: CX + 900, y: CY });
    steps(sim, 90); // 900 at 340 ms is 80 ticks straight; the detour may cost 10
    expect(Math.hypot(sim.c.Pos.x[a]! - (CX + 900), sim.c.Pos.y[a]! - CY)).toBeLessThan(5);
    // the standing ally is nudged, not shoved along the walker's path
    expect(Math.hypot(sim.c.Pos.x[b]! - (CX + 300), sim.c.Pos.y[b]! - CY)).toBeLessThan(60);
  });

  it('dashes pass through units (no push during the dash), Ghost walks through minions', () => {
    const { sim, a } = solo('mira', ['geist', 'heilen']);
    learn(sim, a, 2); // E: 300 dash
    const m = minion(sim, CX + 150, CY);
    const mx = sim.c.Pos.x[m]!;
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    steps(sim, 3);
    expect(sim.c.Pos.x[a]).toBeGreaterThan(CX + 150); // dashed past the minion's centre
    expect(sim.c.Pos.x[m]).toBe(mx);
    // Ghost: no push on the minion while walking through it
    place(sim, a, CX, CY + 400);
    const g = minion(sim, CX + 200, CY + 400);
    const gx = sim.c.Pos.x[g]!;
    cmd(sim, { t: 'spell', slot: 0, x: CX, y: CY });
    cmd(sim, { t: 'move', x: CX + 400, y: CY + 400 });
    steps(sim, 30);
    expect(sim.c.Pos.x[a]).toBeCloseTo(CX + 400, 0);
    expect(sim.c.Pos.x[g]).toBe(gx);
  });
});

describe('CC state in the snapshot', () => {
  it('bitmask, slow % and end tick; unstoppable hides all but suppress/stasis', () => {
    const { sim, a } = solo('mira');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    expect(snapOf(sim, d).cc).toBeUndefined();
    addBuff(sim, d, { kind: 'stun', id: 't', src: a, ticks: 30 });
    addBuff(sim, d, { kind: 'slow', id: 't', src: a, pct: 35, ticks: 60 });
    step(sim);
    const e = snapOf(sim, d);
    expect(e.cc).toBe(1 | 4);
    expect(e.slow).toBe(35);
    expect(e.ccEnd).toBe(sim.tick - 1 + 60);
    addBuff(sim, d, { kind: 'unstoppable', id: 'u', src: d, ticks: 30 });
    step(sim);
    expect(snapOf(sim, d).cc).toBeUndefined();
    // the enemy view sees it too (visible unit), nothing for unseen units
    expect(buildSnapshot(sim, 1, 5).entities.find((x) => x.id === a)?.cc).toBeUndefined();
  });
});

describe('targeted casts walk into range; castFail', () => {
  it('Grimald Q on a far target walks, casts in range and hits; a move order cancels the walk', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    const d = spawnDummy(sim, CX + 900, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 900, y: CY, target: d });
    expect(fails(sim)).toEqual([]);
    expect(champAbil(sim, a).walk).not.toBeNull();
    const hits = collect(sim, 90, a);
    expect(hits.some((h) => h.dst === d)).toBe(true);
    expect(sim.c.Pos.x[a]!).toBeGreaterThan(CX + 300);
    expect(sim.c.Move.mode[a]).toBe(0); // stopped to cast, no stale walk afterwards
    // cancel: new walk, then a move order
    const s2 = solo('grimald');
    learn(s2.sim, s2.a, 0);
    const d2 = spawnDummy(s2.sim, CX + 900, CY, 1);
    step(s2.sim);
    cmd(s2.sim, { t: 'cast', slot: 0, x: CX + 900, y: CY, target: d2 });
    cmd(s2.sim, { t: 'move', x: CX - 300, y: CY });
    expect(collect(s2.sim, 90, s2.a)).toEqual([]);
    expect(champAbil(s2.sim, s2.a).walk).toBeNull();
  });

  it('Ignite out of range walks into range and lands', () => {
    const { sim, a } = solo('mira', ['entflammen', 'heilen']);
    const d = spawnDummy(sim, CX + 1200, CY, 1);
    step(sim);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 1200, y: CY, target: d });
    steps(sim, 90);
    expect(champAbil(sim, a).sumCdUntil[0]).toBeGreaterThan(sim.tick);
  });

  it('cooldown, mana, cc, no target and unlearned emit castFail to the own view only', () => {
    const { sim, a } = solo('grimald');
    cmd(sim, { t: 'cast', slot: 1, x: CX, y: CY });
    expect(fails(sim).map((f) => f.reason)).toEqual(['unlearned']);
    learn(sim, a, 0);
    learn(sim, a, 2);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 2000, y: CY + 500 });
    expect(fails(sim).map((f) => f.reason)).toEqual(['target']);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    steps(sim, 20);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    expect(fails(sim).map((f) => [f.slot, f.reason])).toEqual([[2, 'cooldown']]);
    expect(buildSnapshot(sim, 0, 0).events.some((e) => e.e === 'castFail')).toBe(true);
    expect(buildSnapshot(sim, 1, 5).events.some((e) => e.e === 'castFail')).toBe(false);
    sim.c.Mana.cur[a] = 0;
    const d = spawnDummy(sim, CX + 200, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 200, y: CY, target: d });
    expect(fails(sim).map((f) => f.reason)).toEqual(['mana']);
    addBuff(sim, a, { kind: 'silence', id: 't', src: d, ticks: 30 });
    cmd(sim, { t: 'cast', slot: 0, x: CX + 200, y: CY, target: d });
    expect(fails(sim).map((f) => f.reason)).toEqual(['cc']);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 200, y: CY });
    expect(fails(sim)).toEqual([]); // Flash under silence is fine
  });
});

describe('input buffer (~0.25 s) and Flash during wind-ups', () => {
  it('a spell pressed during an own wind-up is cast right after it (E -> Q)', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    learn(sim, a, 2);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    cmd(sim, { t: 'cast', slot: 0, x: CX + 300, y: CY, target: d });
    expect(fails(sim)).toEqual([]);
    expect(champAbil(sim, a).queued).not.toBeNull();
    const casts: number[] = [];
    for (let i = 0; i < 30; i++) {
      step(sim);
      for (const e of sim.events) if (e.e === 'cast' && e.src === a) casts.push(e.slot);
    }
    expect(casts).toEqual([0]);
    expect(champAbil(sim, a).queued).toBeNull();
  });

  it('a buffered press expires with castFail busy when the champion stays busy (long channel)', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    learn(sim, a, 2);
    const ab = champAbil(sim, a);
    ab.channel = { slot: 2, rank: 1, start: sim.tick, until: sim.tick + 60 };
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    const reasons: string[] = [];
    for (let i = 0; i < 20; i++) {
      step(sim);
      for (const f of fails(sim)) reasons.push(f.reason);
    }
    expect(reasons).toEqual(['busy']);
  });

  it('R-Flash: Flash during a non-targeted wind-up moves at once and the spell still resolves', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 2); // E: ground circle, 0.25 s wind-up
    cmd(sim, { t: 'cast', slot: 2, x: CX + 600, y: CY });
    expect(champAbil(sim, a).cast).not.toBeNull();
    cmd(sim, { t: 'spell', slot: 0, x: CX + 400, y: CY });
    expect(sim.c.Pos.x[a]).toBeGreaterThan(CX + 300);
    expect(champAbil(sim, a).cast).not.toBeNull();
    steps(sim, 10);
    expect(champAbil(sim, a).cast).toBeNull(); // resolved (not refunded / interrupted)
    expect(champAbil(sim, a).cdUntil[2]).toBeGreaterThan(sim.tick);
  });

  it('Flash pressed late in a dash goes off when the dash ends', () => {
    const { sim, a } = solo('mira');
    learn(sim, a, 2); // E: 300 dash at 1200 (8 ticks)
    cmd(sim, { t: 'cast', slot: 2, x: CX + 300, y: CY });
    step(sim);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 1000, y: CY });
    expect(fails(sim)).toEqual([]);
    steps(sim, 10);
    expect(sim.c.Pos.x[a]).toBeGreaterThan(CX + 600);
  });
});

describe('idle auto-attack (LoL "auto attack" option)', () => {
  it('an idle champion hits enemies in range without chasing; Stop holds fire until the next order; off by default', () => {
    const { sim, a } = solo('mira', ['sprung', 'heilen'], true);
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    expect(collect(sim, 60, a).length).toBeGreaterThan(0);
    cmd(sim, { t: 'stop' });
    expect(collect(sim, 60, a)).toEqual([]);
    cmd(sim, { t: 'move', x: CX - 10, y: CY });
    expect(collect(sim, 60, a).length).toBeGreaterThan(0);
    // out of range: no chase
    place(sim, d, CX + 1500, CY);
    steps(sim, 30);
    expect(sim.c.Pos.x[a]).toBeCloseTo(CX - 10, 0);
    expect(sim.c.Atk.target[a]).toBe(-1);
    // sim default (no flag): no idle autos
    const off = solo('mira');
    spawnDummy(off.sim, CX + 400, CY, 1);
    expect(collect(off.sim, 60, off.a)).toEqual([]);
  });
});

describe('projectile source info in the snapshot', () => {
  it('auto vs ability, champion id, survives the source', () => {
    const { sim, a } = solo('mira');
    learn(sim, a, 1);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    while (sim.c.Atk.phase[a] !== 2) step(sim);
    const p = buildSnapshot(sim, 0, 0).projectiles;
    expect(p.map((x) => [x.srcKind, x.champ, x.slot])).toEqual([[Kind.Champion, 'mira', -1]]);
    cmd(sim, { t: 'cast', slot: 1, x: CX - 1000, y: CY });
    steps(sim, 10);
    expect(buildSnapshot(sim, 0, 0).projectiles.some((x) => x.slot === 1 && x.champ === 'mira' && x.kind === 1)).toBe(true);
  });
});
