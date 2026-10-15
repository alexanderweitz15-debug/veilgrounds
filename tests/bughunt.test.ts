// Regression tests for the bug-hunt findings (H = high, M = medium, L = low priority). Each test failed before its fix.
import { describe, expect, it } from 'vitest';
import { createSim, spawnUnit, stateHash, step, type Sim } from '../src/sim/sim';
import { CELL, findPath, nearestWalkable, walkable } from '../src/sim/map';
import { sanitize } from '../src/sim/systems/input';
import { Kind, sec, type SimEvent } from '../src/sim/types';
import { addBuff, hasBuff } from '../src/sim/buffs';
import { dealDamage, kill } from '../src/sim/damage';
import { champAbil, isBusy, levelAbility } from '../src/sim/systems/abilities';
import { spawnDummy } from '../src/sim/systems/champions';
import { matchOver, towerState } from '../src/sim/systems/towers';
import { sees } from '../src/sim/vision';
import { buildSnapshot, teamEvents } from '../src/sim/snapshot';
import { teleporting } from '../src/sim/summoners';
import { trinketHud } from '../src/sim/wards';
import { buyItem, quote } from '../src/sim/items/inventory';
import { grantGold } from '../src/sim/systems/economy';
import { CX, CY, NO_RUNES, cmd, makeSim, mira, place, steps } from './combat-helpers';

const inMap = (p: { x: number; y: number }): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < 16000 && p.y < 16000;

describe('H1: commands far outside the map / NaN must not freeze the worker', () => {
  it('nearestWalkable clamps out-of-map and NaN points onto a walkable in-map cell', () => {
    const sim = makeSim();
    const nav = sim.map.nav;
    for (const [x, y] of [
      [8000, 20000],
      [8000, -3000],
      [20000, 8000],
      [-50, 8000],
      [16000, 16000],
      [NaN, NaN],
      [NaN, 8000],
      [Infinity, -Infinity],
    ] as const) {
      const p = nearestWalkable(nav, x, y);
      expect(inMap(p), `${x},${y}`).toBe(true);
      expect(walkable(nav, p.x, p.y), `${x},${y}`).toBe(true);
    }
  });

  it('input drops non-finite coordinates and clamps the rest onto the map', () => {
    const sim = makeSim();
    expect(sanitize(sim, { t: 'move', x: NaN, y: 100 })).toBeNull();
    expect(sanitize(sim, { t: 'cast', slot: 0, x: 100, y: Infinity })).toBeNull();
    expect(sanitize(sim, { t: 'spell', slot: 0, x: NaN, y: NaN })).toBeNull();
    expect(sanitize(sim, { t: 'ward', x: NaN, y: 1 })).toBeNull();
    expect(sanitize(sim, { t: 'move', x: 8000, y: 20000 })).toEqual({ t: 'move', x: 8000, y: 16000 });
    expect(sanitize(sim, { t: 'attackMove', x: -5, y: 3 })).toEqual({ t: 'attackMove', x: 0, y: 3 });
    expect(sanitize(sim, { t: 'stop' })).toEqual({ t: 'stop' });
    expect(sanitize(sim, { t: 'item', slot: 0 })).toEqual({ t: 'item', slot: 0 });
  });

  it('move / attack-move far outside the map or to NaN completes a tick and keeps the champion in the map', () => {
    const sim = makeSim();
    const m = mira(sim);
    place(sim, m, CX, CY);
    cmd(sim, { t: 'move', x: 8000, y: 20000 });
    cmd(sim, { t: 'attackMove', x: 30000, y: 8000 }); // only x outside: used to wrap into another grid row
    cmd(sim, { t: 'move', x: NaN, y: NaN });
    for (let i = 0; i < 30 * 20; i++) step(sim);
    expect(inMap({ x: sim.c.Pos.x[m]!, y: sim.c.Pos.y[m]! })).toBe(true);
    expect(walkable(sim.map.nav, sim.c.Pos.x[m]!, sim.c.Pos.y[m]!)).toBe(true);
  });

  it('findPath to a point beyond the map edge terminates with in-map waypoints', () => {
    const sim = makeSim();
    const path = findPath(sim.map.nav, CX, CY, 16000 + 5 * CELL, CY);
    expect(path.length).toBeGreaterThan(0);
    for (const p of path) expect(inMap(p)).toBe(true);
  });
});

// ------------------------------------------------------------------ shared setup for the sim bugs

function duo(champ0: string, champ1: string, sums0: [string, string] = ['sprung', 'heilen']): { sim: Sim; a: number; b: number } {
  const sim = createSim({
    seed: 3,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [
      { slot: 0, team: 0, champion: champ0, role: 'mid', summoners: sums0, isHuman: true, runes: NO_RUNES },
      { slot: 5, team: 1, champion: champ1, role: 'top', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
    ],
  });
  const a = sim.slots[0]!;
  const b = sim.slots[5]!;
  place(sim, a, CX, CY);
  place(sim, b, CX + 300, CY);
  step(sim);
  return { sim, a, b };
}

function solo(champion: string, sums: [string, string] = ['sprung', 'heilen']): { sim: Sim; a: number } {
  const sim = makeSim({ players: [{ slot: 0, team: 0, champion, role: 'mid', summoners: sums, isHuman: true }] });
  const a = mira(sim);
  place(sim, a, CX, CY);
  step(sim);
  return { sim, a };
}

/** Rank `slot` once at `level`. */
function learn(sim: Sim, eid: number, slot: number, level = 1): void {
  sim.c.Champ.level[eid] = Math.max(sim.c.Champ.level[eid]!, level);
  sim.c.Champ.skillPoints[eid] = sim.c.Champ.skillPoints[eid]! + 1;
  levelAbility(sim, eid, slot);
}

function enemyMinion(sim: Sim, x: number, y: number, team = 1): number {
  const m = spawnUnit(sim, Kind.MinionMelee, team, x, y, 48);
  sim.c.Hp.max[m] = sim.c.Hp.cur[m] = 1000;
  return m;
}

const invisible = (sim: Sim, eid: number): void => void addBuff(sim, eid, { kind: 'stat', stat: 'invisible', id: 'test_invis', src: -1, ticks: 600 });

/** Events of the next tick (one optional slot-0 command). */
function tickEvents(sim: Sim, c?: Parameters<typeof cmd>[1]): SimEvent[] {
  step(sim, c ? [{ slot: 0, cmd: c }] : []);
  return [...sim.events];
}

describe('H2: summoner spells need vision of their target', () => {
  it('Ignite does not land on an enemy the team cannot see (invisible / bush)', () => {
    const { sim, b } = duo('mira', 'brom', ['entflammen', 'bannen']);
    invisible(sim, b);
    step(sim);
    expect(sees(sim, 0, b)).toBe(false);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY, target: b });
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY }); // cursor variant
    expect(hasBuff(sim, b, 'dot', 'entflammen')).toBe(false);
  });

  it('Ignite still lands on a visible enemy', () => {
    const { sim, b } = duo('mira', 'brom', ['entflammen', 'bannen']);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY, target: b });
    expect(hasBuff(sim, b, 'dot', 'entflammen')).toBe(true);
  });

  it('Smite does not hit an unseen minion', () => {
    const { sim } = solo('mira', ['bannen', 'heilen']);
    const m = enemyMinion(sim, CX + 300, CY);
    invisible(sim, m);
    step(sim);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY, target: m });
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY });
    expect(sim.c.Hp.cur[m]).toBe(1000);
  });
});

describe('H3 / M7: recasts and leaps respect crowd control', () => {
  const recastEvents = (evs: SimEvent[], a: number): number => evs.filter((e) => e.e === 'cast' && e.src === a && e.recast).length;

  it('Isolde Q recast window: a stunned Isolde cannot recast; the window stays open for after the stun', () => {
    const { sim, a } = duo('isolde', 'brom');
    learn(sim, a, 0);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 100, y: CY });
    steps(sim, sec(1.7));
    addBuff(sim, a, { kind: 'stun', id: 'test', src: -1, ticks: 20 });
    expect(recastEvents(tickEvents(sim, { t: 'cast', slot: 0, x: CX + 100, y: CY }), a)).toBe(0);
    steps(sim, 21);
    expect(recastEvents(tickEvents(sim, { t: 'cast', slot: 0, x: CX + 100, y: CY }), a)).toBe(1);
  });

  it('silence blocks a window recast too', () => {
    const { sim, a } = duo('isolde', 'brom');
    learn(sim, a, 0);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 100, y: CY });
    steps(sim, sec(1.7));
    addBuff(sim, a, { kind: 'silence', id: 'test', src: -1, ticks: 20 });
    expect(recastEvents(tickEvents(sim, { t: 'cast', slot: 0, x: CX + 100, y: CY }), a)).toBe(0);
  });

  it('Isolde R (leap) cannot be cast while rooted', () => {
    const { sim, a, b } = duo('isolde', 'brom');
    learn(sim, a, 3, 6);
    addBuff(sim, a, { kind: 'root', id: 'test', src: -1, ticks: 60 });
    const evs = tickEvents(sim, { t: 'cast', slot: 3, x: CX + 300, y: CY, target: b });
    expect(evs.some((e) => e.e === 'cast' && e.src === a)).toBe(false);
    steps(sim, 20);
    expect(sim.c.Pos.x[a]).toBe(CX);
  });
});

describe('M5: a targeted wind-up does not hit a recycled eid', () => {
  const hitsOn = (sim: Sim, a: number, m: number): number => {
    let hits = 0;
    for (let i = 0; i < 20; i++) for (const e of tickEvents(sim)) if (e.e === 'damage' && e.src === a && e.dst === m) hits++;
    return hits;
  };

  it('Grimald Q fizzles when its target eid became another unit during the wind-up', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    const m = enemyMinion(sim, CX + 250, CY);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: m });
    expect(isBusy(sim, a)).toBe(true); // wind-up running
    sim.c.Unit.serial[m] = ++sim.serialCounter; // the old target died, its eid now belongs to a new unit
    expect(hitsOn(sim, a, m)).toBe(0);
  });

  it('control: without recycling the same cast hits', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    const m = enemyMinion(sim, CX + 250, CY);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: m });
    expect(hitsOn(sim, a, m)).toBeGreaterThan(0);
  });
});

describe('M6: structures are immune to crowd control', () => {
  it('stun / airborne / root / slow on a tower are refused; stat buffs still apply', () => {
    const sim = makeSim();
    const t = towerState(sim).list.find((r) => r.kind === Kind.Tower)!.eid;
    for (const kind of ['stun', 'airborne', 'root', 'slow', 'silence', 'stasis'] as const) {
      expect(addBuff(sim, t, { kind, id: 'test', src: -1, ticks: 14, pct: 30 }), kind).toBe(false);
      expect(hasBuff(sim, t, kind), kind).toBe(false);
    }
    expect(addBuff(sim, t, { kind: 'stat', stat: 'armor', id: 'shred', src: -1, ticks: 30, pct: -10 })).toBe(true);
  });
});

describe('M8: Renn E does not lock onto hidden enemies or wards', () => {
  for (const what of ['invisible enemy', 'enemy ward'] as const) {
    it(`${what} at the cursor: plain blink to the cursor`, () => {
      const { sim, a } = solo('renn');
      learn(sim, a, 2);
      if (what === 'invisible enemy') invisible(sim, spawnDummy(sim, CX + 400, CY, 1));
      else {
        const w = spawnUnit(sim, Kind.Ward, 1, CX + 400, CY, 20);
        sim.c.Hp.max[w] = sim.c.Hp.cur[w] = 3;
      }
      step(sim);
      cmd(sim, { t: 'cast', slot: 2, x: CX + 400, y: CY });
      steps(sim, 15);
      expect(Math.abs(sim.c.Pos.x[a]! - (CX + 400))).toBeLessThan(1);
    });
  }
});

describe('M1: respawn forgets the attack-move order', () => {
  it('a champion that died while attack-moving stands still after respawning', () => {
    const { sim, a } = solo('mira');
    spawnDummy(sim, CX + 700, CY, 1); // acquired on the way: the attack-move is "chasing" when the champion dies
    cmd(sim, { t: 'attackMove', x: CX + 1500, y: CY });
    steps(sim, 30);
    expect(sim.c.Atk.target[a]).toBeGreaterThanOrEqual(0);
    kill(sim, a, -1);
    sim.c.Champ.respawnAt[a] = sim.tick + 2;
    steps(sim, 5);
    expect(sim.c.Unit.alive[a]).toBe(1);
    const x = sim.c.Pos.x[a]!;
    const y = sim.c.Pos.y[a]!;
    steps(sim, 90);
    expect([sim.c.Pos.x[a], sim.c.Pos.y[a]]).toEqual([x, y]);
    expect(sim.c.Atk.attackMove[a]).toBe(0);
  });
});

describe('M2: replays of bot games reproduce the state hash', () => {
  it('building snapshots (what bots and the client do every tick) never changes the sim state', async () => {
    const { classicConfig } = await import('../src/ai/runner');
    const sim = createSim(classicConfig('aurel', 'mid', 'gold', { seed: 42 }));
    for (let i = 0; i < 3; i++) {
      const h = stateHash(sim);
      for (let s = 0; s < 10; s++) buildSnapshot(sim, s < 5 ? 0 : 1, s);
      expect(stateHash(sim), `tick ${sim.tick}`).toBe(h);
      step(sim);
    }
  });

  it('a recorded bot game replays to the same hash', async () => {
    const { BotRunner, classicConfig } = await import('../src/ai/runner');
    const { Recorder, playReplay } = await import('../src/replay/replay');
    const config = classicConfig('aurel', 'mid', 'gold', { seed: 42 });
    const sim = createSim(config);
    const rec = new Recorder(config);
    const bots = new BotRunner(config);
    while (sim.tick < 450) {
      const i = bots.tick(sim);
      rec.record(sim.tick, i);
      step(sim, i);
      buildSnapshot(sim, 0, 0);
    }
    const r = rec.finish(sim);
    expect(stateHash(playReplay(JSON.parse(JSON.stringify(r))))).toBe(r.hash);
  }, 60_000);
});

describe('M3: the 1v1 arena always ends', () => {
  // TODO(bot agent): unskip once bots engage in arena mode (src/ai arena change not committed yet)
  it('an idle player out of sight range is found and fought by the bot', async () => {
    const { BotRunner } = await import('../src/ai/runner');
    const { trainerConfig } = await import('../src/game/modes');
    const { trainerHud } = await import('../src/sim/trainer');
    const config = trainerConfig({ mode: 'arena', opts: { rounds: 1, roundSec: 45, level: 6 }, teamSize: 1 }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 7);
    const sim = createSim(config);
    const bots = new BotRunner(config);
    for (let i = 0; i < 30 * 60 && !trainerHud(sim)?.done; i++) step(sim, bots.tick(sim));
    expect(trainerHud(sim)?.done).toBe(true);
  }, 60_000);

  it('endless draws are capped: two idle champions end the match after maxRounds', async () => {
    const { trainerConfig } = await import('../src/game/modes');
    const { trainerHud } = await import('../src/sim/trainer');
    const config = trainerConfig({ mode: 'arena', opts: { rounds: 1, roundSec: 3, level: 6 }, teamSize: 1 }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 7);
    const sim = createSim(config);
    for (let i = 0; i < 30 * 40 && !trainerHud(sim)?.done; i++) step(sim);
    const hud = trainerHud(sim)!;
    expect(hud.done).toBe(true);
    expect(hud.won).toBe(false);
  });
});

describe('M4: separation never pushes minions into walls or off the map', () => {
  it('two overlapping minions next to a wall both stay on walkable ground', () => {
    const sim = makeSim();
    const nav = sim.map.nav;
    let bx = CX;
    while (bx < 16000 && walkable(nav, bx + 1, CY)) bx++;
    const a = enemyMinion(sim, bx - 3, CY);
    const b = enemyMinion(sim, bx - 13, CY);
    expect(walkable(nav, sim.c.Pos.x[a]!, CY)).toBe(true);
    step(sim);
    for (const m of [a, b]) expect(walkable(nav, sim.c.Pos.x[m]!, sim.c.Pos.y[m]!)).toBe(true);
  });
});

describe('H4 + fog: kill events name the champions, killing blows reach the client, hidden eids are masked', () => {
  function killBrom(): { sim: Sim; a: number; b: number; evs0: SimEvent[]; evs1: SimEvent[] } {
    const { sim, a, b } = duo('mira', 'brom');
    sim.c.Hp.cur[b] = 1;
    step(sim, [{ slot: 0, cmd: { t: 'attack', target: b } }]);
    for (let i = 0; i < 90 && sim.c.Unit.alive[b]; i++) step(sim);
    expect(sim.c.Unit.alive[b]).toBe(0);
    return { sim, a, b, evs0: teamEvents(sim, 0).events, evs1: teamEvents(sim, 1).events };
  }

  it('the death event carries victim and killer champion ids', () => {
    const { evs0, b } = killBrom();
    const d = evs0.find((e) => e.e === 'death' && e.eid === b);
    expect(d).toMatchObject({ champ: 'brom', killerChamp: 'mira', killerKind: Kind.Champion, killerTeam: 0 });
  });

  it('the killing blow damage event is in the killer team view (damage number, match stats) and the victim team view', () => {
    const { evs0, evs1, a, b } = killBrom();
    expect(evs0.some((e) => e.e === 'damage' && e.dst === b && e.src === a)).toBe(true);
    expect(evs1.some((e) => e.e === 'damage' && e.dst === b)).toBe(true);
  });

  it('an unseen attacker / killer is masked to -1 (no eid leak), the kill feed still has the killer champion', () => {
    const { sim, a, b } = duo('mira', 'brom');
    invisible(sim, b);
    step(sim);
    dealDamage(sim, b, a, 10, 'phys');
    expect(teamEvents(sim, 0).events.find((e) => e.e === 'damage' && e.dst === a)).toMatchObject({ src: -1 });
    expect(teamEvents(sim, 1).events.find((e) => e.e === 'damage' && e.dst === a)).toMatchObject({ src: b }); // own team knows
    kill(sim, a, b);
    expect(teamEvents(sim, 0).events.find((e) => e.e === 'death')).toMatchObject({ killer: -1, killerChamp: 'brom' });
    expect(sim.events.find((e) => e.e === 'death')).toMatchObject({ killer: b }); // the shared sim event is untouched
  });
});

describe('low priority sim fixes', () => {
  it('DoT kill credit survives the death of its caster (Ignite)', () => {
    const { sim, a, b } = duo('mira', 'brom', ['entflammen', 'heilen']);
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY, target: b });
    expect(hasBuff(sim, b, 'dot', 'entflammen')).toBe(true);
    kill(sim, a, -1);
    sim.c.Hp.cur[b] = 3;
    let killer: number | null = null;
    for (let i = 0; i < 60 && killer === null; i++) for (const e of tickEvents(sim)) if (e.e === 'death' && e.eid === b) killer = e.killer;
    expect(killer).toBe(a);
  });

  it('an interrupted wind-up refunds mana only up to the maximum', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    const m = enemyMinion(sim, CX + 250, CY);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: m });
    sim.c.Mana.cur[a] = sim.c.Mana.max[a]!; // regen filled the bar during the wind-up
    addBuff(sim, a, { kind: 'stun', id: 'test', src: -1, ticks: 10 });
    step(sim); // the refund tick (snapshots are built right after it)
    expect(sim.c.Mana.cur[a]).toBeLessThanOrEqual(sim.c.Mana.max[a]!);
  });

  it('targeted enemy abilities ignore wards; ally abilities only take allied champions', () => {
    const { sim, a } = solo('grimald');
    learn(sim, a, 0);
    const w = spawnUnit(sim, Kind.Ward, 1, CX + 250, CY, 20);
    sim.c.Hp.max[w] = sim.c.Hp.cur[w] = 3;
    step(sim);
    expect(tickEvents(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: w }).some((e) => e.e === 'cast' && e.src === a)).toBe(false);
    const f = solo('ferris');
    learn(f.sim, f.a, 1);
    const own = enemyMinion(f.sim, CX + 250, CY, 0);
    step(f.sim);
    expect(tickEvents(f.sim, { t: 'cast', slot: 1, x: CX + 250, y: CY, target: own }).some((e) => e.e === 'cast' && e.src === f.a)).toBe(false);
  });

  it('swapping the trinket away and back keeps the Suchfeuer cooldown', () => {
    const { sim, a } = solo('mira');
    const fo = sim.map.sides[0].fountain;
    place(sim, a, fo.x, fo.y);
    sim.c.Champ.level[a] = 9;
    step(sim);
    cmd(sim, { t: 'trinket', id: 'suchfeuer' });
    cmd(sim, { t: 'ward', x: fo.x + 200, y: fo.y + 200 });
    expect(trinketHud(sim, a).cdLeft).toBeGreaterThan(0);
    cmd(sim, { t: 'trinket', id: 'schleierward' });
    cmd(sim, { t: 'trinket', id: 'suchfeuer' });
    expect(trinketHud(sim, a).id).toBe('suchfeuer');
    expect(trinketHud(sim, a).cdLeft).toBeGreaterThan(0);
  });

  it('no Flash and no Teleport channel during an own wind-up', () => {
    const { sim, a } = solo('grimald', ['sprung', 'teleport']);
    learn(sim, a, 0);
    const m = enemyMinion(sim, CX + 250, CY);
    step(sim);
    cmd(sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: m });
    expect(isBusy(sim, a)).toBe(true);
    cmd(sim, { t: 'spell', slot: 0, x: CX - 400, y: CY });
    expect(sim.c.Pos.x[a]).toBe(CX);
    expect(champAbil(sim, a).sumCdUntil[0]).toBe(0);
    // Teleport (fresh sim, Q ready): no channel started during the wind-up
    const t2 = solo('grimald', ['sprung', 'teleport']);
    learn(t2.sim, t2.a, 0);
    const m2 = enemyMinion(t2.sim, CX + 250, CY);
    step(t2.sim);
    const tw = towerState(t2.sim).list.find((r) => r.team === 0 && r.kind === Kind.Tower)!;
    cmd(t2.sim, { t: 'cast', slot: 0, x: CX + 250, y: CY, target: m2 });
    expect(isBusy(t2.sim, t2.a)).toBe(true);
    cmd(t2.sim, { t: 'spell', slot: 1, x: tw.x, y: tw.y, target: tw.eid });
    expect(teleporting(t2.sim, t2.a)).toBe(false);
  });

  it('legendary items are unique (one of each)', () => {
    const { sim, a } = solo('mira');
    const fo = sim.map.sides[0].fountain;
    place(sim, a, fo.x, fo.y);
    step(sim);
    grantGold(sim, a, 20000);
    expect(buyItem(sim, a, 'sturmbogen')).toBe(true);
    expect(quote(sim, a, 'sturmbogen')).toMatchObject({ ok: false, reason: 'unique' });
  });

  it('sandbox cheats: no negative / NaN gold or XP, teleport never lands in a wall', () => {
    const { sim, a } = solo('mira');
    const gold = sim.c.Champ.gold[a]!;
    const xp = sim.c.Champ.xp[a]!;
    cmd(sim, { t: 'cheat', op: 'gold', value: NaN });
    cmd(sim, { t: 'cheat', op: 'gold', value: -5000 });
    cmd(sim, { t: 'cheat', op: 'levelUp', value: NaN });
    expect(sim.c.Champ.gold[a]).toBe(gold);
    expect(sim.c.Champ.xp[a]).toBe(xp);
    const nav = sim.map.nav;
    const c = nav.walk.findIndex((v, i) => v === 0 && i > nav.w * 20 && i % nav.w > 20 && i % nav.w < nav.w - 20);
    const wx = ((c % nav.w) + 0.5) * CELL;
    const wy = (Math.floor(c / nav.w) + 0.5) * CELL;
    expect(walkable(nav, wx, wy)).toBe(false);
    cmd(sim, { t: 'cheat', op: 'teleport', x: wx, y: wy });
    expect(walkable(nav, sim.c.Pos.x[a]!, sim.c.Pos.y[a]!)).toBe(true);
  });
});

describe('M11: a decided match stops', () => {
  it('matchOver once a nexus fell', () => {
    const { sim, a } = solo('mira');
    expect(matchOver(sim)).toBe(false);
    const nexus = towerState(sim).list.find((r) => r.kind === Kind.Nexus && r.team === 1)!.eid;
    kill(sim, nexus, a);
    expect(matchOver(sim)).toBe(true);
  });
});
