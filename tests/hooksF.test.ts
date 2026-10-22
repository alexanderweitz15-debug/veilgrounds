// Agent F champion hooks: one behavioural test per signature mechanic + hook coverage.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { spawnUnit, stateHash, step, type Sim } from '../src/sim/sim';
import { addBuff, hasBuff, strongestSlow } from '../src/sim/buffs';
import { spawnDummy } from '../src/sim/systems/champions';
import { abilityHud, levelAbility, refreshCooldowns } from '../src/sim/systems/abilities';
import { missingHooks } from '../src/sim/champions';
import { Kind, sec, type Command, type PlayerSetup } from '../src/sim/types';
import { lineWalkable, walkable } from '../src/sim/map';
import { sees } from '../src/sim/vision';
import { grimaldTraps } from '../src/sim/champions/grimald';
import { corvinReloading, corvinShots } from '../src/sim/champions/corvin';
import { hagenTolls } from '../src/sim/champions/hagen';
import { lysaStacks } from '../src/sim/champions/lysa';
import { isBurning } from '../src/sim/champions/wren';
import { lioSparks } from '../src/sim/champions/lio';
import { tobinTetherTarget } from '../src/sim/champions/tobin';
import { harkOf } from '../src/sim/champions/ottilie';
import { petsOf } from '../src/sim/summons';
import { dealDamage } from '../src/sim/damage';
import { spawnProjectile } from '../src/sim/systems/projectiles';

import { CX, CY, cmd, collect, makeSim, place, steps } from './combat-helpers';

const F_CHAMPS = ['isolde', 'dagny', 'grimald', 'lio', 'ottilie', 'aurel', 'corvin', 'lysa', 'tobin', 'wren', 'hagen', 'kiran', 'oda'];

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: 0, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0 });

/** Champion at (CX, CY) with `level` and skill ranks given as [Q, W, E, R]. */
function setup(champion: string, ranks: [number, number, number, number] = [1, 1, 1, 0], level = 1, extra: PlayerSetup[] = []): { sim: Sim; m: number } {
  const sim = makeSim({ players: [player(0, champion), ...extra] });
  const m = sim.slots[0]!;
  place(sim, m, CX, CY);
  sim.c.Champ.level[m] = Math.max(level, ranks[3] > 0 ? 6 : 1, ...ranks.slice(0, 3).map((r) => 2 * r - 1));
  sim.c.Champ.skillPoints[m] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, m, slot);
  });
  step(sim);
  return { sim, m };
}

const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });

describe('Agent F hooks coverage', () => {
  it('every hook id of the 13 champions is exported', () => {
    for (const id of F_CHAMPS) expect([id, missingHooks(id)]).toEqual([id, []]);
  });
});

describe('Corvin drum', () => {
  it('6 shots, the last +50 %, then a 1.5 s reload without autos; E cancels the reload', () => {
    const { sim, m } = setup('corvin');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const fires: number[] = [];
    const hits: { tick: number; amount: number }[] = [];
    let reloadSeenAt = -1;
    for (let i = 0; i < 400 && fires.length < 7; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'attack', target: d } }] : []);
      for (const e of sim.events) {
        if (e.e === 'attack' && e.src === m) fires.push(sim.tick - 1);
        if (e.e === 'damage' && e.src === m) hits.push({ tick: sim.tick - 1, amount: e.amount });
      }
      if (reloadSeenAt < 0 && corvinReloading(sim, m)) reloadSeenAt = sim.tick - 1;
    }
    expect(fires).toHaveLength(7);
    const normalGap = fires[1]! - fires[0]!;
    // 7th windup starts only after the reload (started at the 6th shot's hit point)
    expect(reloadSeenAt).toBeGreaterThan(fires[5]!);
    expect(fires[6]! - reloadSeenAt).toBeGreaterThanOrEqual(45);
    expect(fires[6]! - fires[5]!).toBeGreaterThan(normalGap);
    const ad = sim.c.Stats.ad[m]!;
    expect(hits.slice(0, 7).map((h) => h.amount)).toEqual([ad, ad, ad, ad, ad, ad, ad * 0.5]);
    steps(sim, 20);
    expect(corvinShots(sim, m)).toBe(5); // 7th shot fired from the refilled drum
  });

  it('E during the reload restores 3 shots and allows attacking at once', () => {
    const { sim, m } = setup('corvin');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    for (let i = 0; i < 400 && !corvinReloading(sim, m); i++) step(sim);
    expect(corvinReloading(sim, m)).toBe(true);
    cmd(sim, cast(2, CX - 500, CY));
    steps(sim, 20);
    expect(corvinReloading(sim, m)).toBe(false);
    expect(corvinShots(sim, m)).toBe(3);
  });
});

describe('Hagen bell toll', () => {
  it('3 ability casts make the next auto stun for 0.5 s', () => {
    const { sim, m } = setup('hagen', [1, 0, 0, 0]);
    const d = spawnDummy(sim, CX + 150, CY, 1);
    for (let i = 0; i < 3; i++) {
      refreshCooldowns(sim, m);
      cmd(sim, cast(0, CX, CY));
      steps(sim, 10);
    }
    expect(hagenTolls(sim, m)).toBe(3);
    cmd(sim, { t: 'attack', target: d });
    let stunned = false;
    for (let i = 0; i < 60 && !stunned; i++) (step(sim), (stunned = hasBuff(sim, d, 'stun', 'hagen_bell')));
    expect(stunned).toBe(true);
    expect(hagenTolls(sim, m)).toBe(0);
  });
});

describe('Dagny', () => {
  it('Q empowers the next auto; every 3rd auto bursts 4 % max HP around the target', () => {
    const { sim, m } = setup('dagny');
    const d = spawnDummy(sim, CX + 150, CY, 1);
    const d2 = spawnDummy(sim, CX + 150, CY + 150, 1);
    cmd(sim, cast(0, CX, CY));
    steps(sim, 8);
    const hits = collect(sim, 150, m, { t: 'attack', target: d });
    const ad = sim.c.Stats.ad[m]!;
    const maxHp = sim.c.Hp.max[m]!;
    expect(hits[0]!.amount).toBeCloseTo(ad, 6);
    expect(hits[1]!.amount).toBeCloseTo(60 + 0.06 * maxHp, 6); // Q damage on the empowered auto
    const bursts = hits.filter((h) => Math.abs(h.amount - 0.04 * maxHp) < 1e-6);
    expect(bursts.map((h) => h.dst).sort()).toEqual([d, d2].sort());
  });
});

describe('Kiran Q sweet spot', () => {
  it('roots only when the hit is in the last 300 of range', () => {
    for (const [dx, rooted] of [[900, true], [500, false]] as const) {
      const { sim } = setup('kiran');
      const d = spawnDummy(sim, CX + dx, CY, 1);
      step(sim);
      cmd(sim, cast(0, CX + 1000, CY));
      let root = false;
      for (let i = 0; i < 40; i++) (step(sim), (root ||= hasBuff(sim, d, 'root', 'kiran_q')));
      expect([dx, root]).toEqual([dx, rooted]);
    }
  });
});

describe('Wren embers', () => {
  it('Q-empowered auto ignites; autos on burning targets deal +10 %', () => {
    const { sim, m } = setup('wren');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    cmd(sim, cast(0, CX, CY));
    steps(sim, 8);
    const hits = collect(sim, 75, m, { t: 'attack', target: d });
    const ad = sim.c.Stats.ad[m]!;
    const amounts = hits.map((h) => h.amount);
    expect(amounts[0]).toBeCloseTo(ad, 6); // the empowered auto itself (target not burning yet)
    expect(amounts[1]).toBeCloseTo(40, 6); // Q damage on the empowered auto, ignites
    expect(amounts.some((a) => Math.abs(a - 1.1 * ad) < 1e-6)).toBe(true); // next auto on the burning target
    expect(amounts.some((a) => Math.abs(a - 8) < 1e-6)).toBe(true); // burn tick (byLevel 8 at level 1)
  });
});

describe('Aurel R', () => {
  it('damage lands after the 1.2 s stasis ends', () => {
    const { sim, m } = setup('aurel', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    cmd(sim, cast(3, CX + 600, CY));
    const hits: { tick: number; amount: number }[] = [];
    let stasisAt = -1;
    for (let i = 0; i < 90; i++) {
      step(sim);
      if (stasisAt < 0 && hasBuff(sim, d, 'stasis')) stasisAt = sim.tick - 1;
      for (const e of sim.events) if (e.e === 'damage' && e.src === m) hits.push({ tick: sim.tick - 1, amount: e.amount });
    }
    expect(stasisAt).toBeGreaterThan(0);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBeCloseTo(250, 6);
    expect(hits[0]!.tick - stasisAt).toBeGreaterThanOrEqual(36);
  });
});

describe('Lysa thread run', () => {
  it('stacks on the same target: +4 % AS each, +25 range per 2 stacks; switching resets', () => {
    const { sim, m } = setup('lysa');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    const d2 = spawnDummy(sim, CX + 400, CY + 200, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    for (let i = 0; i < 600 && lysaStacks(sim, m) < 5; i++) step(sim);
    expect(lysaStacks(sim, m)).toBe(5);
    step(sim);
    expect(sim.c.Stats.range[m]).toBe(600 + 50);
    expect(sim.c.Stats.as[m]).toBeCloseTo(0.64 * 1.2, 6);
    cmd(sim, { t: 'attack', target: d2 });
    for (let i = 0; i < 200 && lysaStacks(sim, m) !== 1; i++) step(sim);
    expect(lysaStacks(sim, m)).toBe(1);
  });
});

describe('Lio sparks', () => {
  it('the 3rd ability hit on a target explodes (byLevel 40 at level 1)', () => {
    const { sim, m } = setup('lio');
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const all: number[] = [];
    for (let i = 0; i < 3; i++) {
      refreshCooldowns(sim, m);
      all.push(...collect(sim, 40, m, cast(0, CX + 800, CY)).map((h) => h.amount));
      if (i < 2) expect(lioSparks(sim, m, d)).toBe(i + 1);
    }
    expect(all.filter((a) => a === 60)).toHaveLength(3);
    expect(all.filter((a) => a === 40)).toHaveLength(1);
    expect(lioSparks(sim, m, d)).toBe(0);
  });
});

describe('Isolde Q', () => {
  it('cut: the next auto deals +20 % AD bonus phys at rank 1', () => {
    const { sim, m } = setup('isolde');
    const d = spawnDummy(sim, CX + 150, CY, 1);
    cmd(sim, cast(0, CX, CY));
    steps(sim, 8);
    const hits = collect(sim, 40, m, { t: 'attack', target: d });
    const ad = sim.c.Stats.ad[m]!;
    expect(hits.slice(0, 2).map((h) => h.amount)).toEqual([ad, 0.2 * ad]);
  });
});

describe('Tobin W', () => {
  it('dash grants sea legs and the next auto slows 50 %', () => {
    const { sim, m } = setup('tobin');
    const d = spawnDummy(sim, CX + 600, CY, 1);
    cmd(sim, cast(1, CX + 300, CY));
    steps(sim, 15);
    expect(hasBuff(sim, m, 'stat', 'tobin_sea_legs')).toBe(true);
    cmd(sim, { t: 'attack', target: d });
    let slowed = false;
    for (let i = 0; i < 60 && !slowed; i++) (step(sim), (slowed = strongestSlow(sim, d) === 50));
    expect(slowed).toBe(true);
  });
});

describe('Oda E', () => {
  it('cleanses slows from the targeted ally', () => {
    const { sim } = setup('oda', [1, 1, 1, 0], 1, [player(1, 'mira')]);
    const ally = sim.slots[1]!;
    place(sim, ally, CX + 300, CY);
    addBuff(sim, ally, { kind: 'slow', id: 'test', pct: 50, ticks: 300 });
    step(sim);
    expect(strongestSlow(sim, ally)).toBe(50);
    cmd(sim, cast(2, CX + 300, CY, ally));
    steps(sim, 8);
    expect(strongestSlow(sim, ally)).toBe(0);
  });
});

describe('Aurel Q', () => {
  it('passes through units but stops after its 2nd champion', () => {
    const { sim, m } = setup('aurel');
    const ds = [300, 500, 700].map((dx) => spawnDummy(sim, CX + dx, CY, 1));
    step(sim);
    const hits = collect(sim, 40, m, cast(0, CX + 1000, CY));
    expect(hits.map((h) => h.dst)).toEqual([ds[0], ds[1]]);
  });
});

describe('Isolde W', () => {
  it('outer half (325-650) is slowed 80 % and heals Isolde for half the damage', () => {
    const { sim, m } = setup('isolde');
    const inner = spawnDummy(sim, CX + 200, CY, 1);
    const outer = spawnDummy(sim, CX + 500, CY, 1);
    sim.c.Hp.cur[m] = 200;
    step(sim);
    const hp = sim.c.Hp.cur[m]!;
    const hits = collect(sim, 30, m, cast(1, CX + 600, CY)); // castTime + 0.5 s delay (engine)
    expect(strongestSlow(sim, inner)).toBe(0);
    expect(strongestSlow(sim, outer)).toBe(80);
    const dmg = hits.find((h) => h.dst === outer)!.amount;
    expect(sim.c.Hp.cur[m]! - hp).toBeCloseTo(0.5 * dmg + (30 * sim.c.Hp.regen[m]!) / 30, 0);
  });
});

describe('Grimald R', () => {
  it('landing applies the -20 % attack speed aura to nearby enemies', () => {
    const { sim } = setup('grimald', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 700, CY, 1);
    step(sim);
    cmd(sim, cast(3, CX + 650, CY));
    let aura = false;
    for (let i = 0; i < 30 && !aura; i++) (step(sim), (aura = hasBuff(sim, d, 'stat', 'grimald_r')));
    expect(aura).toBe(true);
  });
});

describe('Ottilie E', () => {
  it('fires a 130 % basic attack at the enemy in front at the start of the hop', () => {
    const { sim, m } = setup('ottilie');
    const d = spawnDummy(sim, CX + 400, CY, 1);
    step(sim);
    const hits = collect(sim, 40, m, cast(2, CX + 400, CY));
    expect(hits.map((h) => [h.dst, h.amount])).toEqual([[d, 1.3 * sim.c.Stats.ad[m]!]]);
  });
});

describe('Tobin Q tether', () => {
  it('roots a tethered target that is farther than 650 when the tether ends', () => {
    for (const [moveTo, rooted] of [[CX + 1300, true], [CX + 500, false]] as const) {
      const { sim, m } = setup('tobin');
      const d = spawnDummy(sim, CX + 400, CY, 1);
      step(sim);
      cmd(sim, cast(0, CX + 1000, CY));
      steps(sim, 15);
      expect(tobinTetherTarget(sim, m)).toBe(d);
      place(sim, d, moveTo, CY); // the dummy "walks" away (or stays close)
      let root = false;
      for (let i = 0; i < 90; i++) (step(sim), (root ||= hasBuff(sim, d, 'root', 'tobin_q')));
      expect([moveTo, root]).toEqual([moveTo, rooted]);
    }
  });
});

describe('Aurel E rewind', () => {
  it('returns him to his position from 3 s before the cast', () => {
    const { sim, m } = setup('aurel', [0, 0, 1, 0]);
    const xs: number[] = []; // xs[t] = x at the start of tick t
    const run = (n: number, first?: Command): void => {
      for (let i = 0; i < n; i++) {
        xs[sim.tick] = sim.c.Pos.x[m]!;
        step(sim, i === 0 && first ? [{ slot: 0, cmd: first }] : []);
      }
    };
    run(10);
    run(150, { t: 'move', x: CX + 1400, y: CY });
    const castTick = sim.tick;
    run(30, cast(2, CX + 1400, CY));
    expect(xs[castTick - 90]!).toBeGreaterThan(CX + 100); // mid-walk, so the test is not trivially CX
    expect(sim.c.Pos.x[m]!).toBeCloseTo(xs[castTick - 90]!, 6);
  });
});

describe('Oda Q', () => {
  it('heals the first ally hit (and only that); an enemy hit gets damage + slow without healing anyone', () => {
    const { sim, m } = setup('oda', [1, 1, 1, 0], 1, [player(1, 'mira')]);
    const ally = sim.slots[1]!;
    place(sim, ally, CX + 300, CY);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    sim.c.Hp.cur[ally] = 200;
    step(sim);
    const hp = sim.c.Hp.cur[ally]!;
    const hits = collect(sim, 40, m, cast(0, CX + 900, CY));
    expect(sim.c.Hp.cur[ally]! - hp).toBeGreaterThan(39); // 40 heal at rank 1 (+ regen)
    expect(hits.filter((h) => h.dst === d)).toHaveLength(0); // the stone stopped at the ally
    place(sim, ally, CX - 300, CY);
    sim.c.Hp.cur[ally] = 200;
    refreshCooldowns(sim, m);
    step(sim);
    const hp2 = sim.c.Hp.cur[ally]!;
    const hits2 = collect(sim, 40, m, cast(0, CX + 900, CY));
    expect(hits2.map((h) => [h.dst, h.amount])).toEqual([[d, 60]]);
    expect(strongestSlow(sim, d)).toBe(25);
    expect(sim.c.Hp.cur[ally]! - hp2).toBeLessThan(5); // only regen
  });
});

describe('Corvin W keg', () => {
  it('nothing happens on cast; the keg explodes when Corvin shoots it', () => {
    const { sim, m } = setup('corvin');
    const d = spawnDummy(sim, CX + 600, CY + 100, 1);
    step(sim);
    const onCast = collect(sim, 15, m, cast(1, CX + 600, CY));
    expect(onCast).toHaveLength(0);
    const keg = petsOf(sim, m, 'corvin_keg')[0]!;
    expect(keg).toBeGreaterThan(0);
    // step until the keg blast lands, then check the slow at that moment (hitbox 65 makes the shot land earlier)
    const hits: ReturnType<typeof collect> = [];
    for (let i = 0; i < 60 && !hits.some((h) => h.dst === d); i++) hits.push(...collect(sim, 1, m, i === 0 ? { t: 'attack', target: keg } : undefined));
    expect(hits.some((h) => h.dst === d && Math.abs(h.amount - (70 + 0.7 * sim.c.Stats.ad[m]!)) < 1e-6)).toBe(true);
    expect(strongestSlow(sim, d)).toBe(40);
  });
});

describe('Ottilie Hark', () => {
  it('Hark spawns with her, fights her target, and respawns 30 s after dying', () => {
    const { sim, m } = setup('ottilie');
    const h = harkOf(sim, m);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(sim.c.Hp.max[h]).toBe(360);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    cmd(sim, { t: 'attack', target: d });
    let harkHit = false;
    for (let i = 0; i < 120 && !harkHit; i++) {
      step(sim);
      harkHit = sim.events.some((e) => e.e === 'damage' && e.src === h && e.dst === d);
    }
    expect(harkHit).toBe(true);
    sim.c.Hp.cur[h] = 1;
    dealDamage(sim, -1, h, 10, 'true');
    steps(sim, 2);
    expect(harkOf(sim, m)).toBe(-1);
    steps(sim, 30 * 30);
    expect(harkOf(sim, m)).toBeGreaterThanOrEqual(0);
  });
});

describe('Lysa E tripwire', () => {
  it('roots only the first enemy champion crossing the wire, then disappears', () => {
    const { sim } = setup('lysa');
    const a = spawnDummy(sim, CX + 600, CY + 400, 1);
    const b = spawnDummy(sim, CX + 600, CY + 500, 1);
    step(sim);
    cmd(sim, cast(2, CX + 600, CY)); // wire along y through (CX+600, CY), half length 250
    steps(sim, 12);
    expect(hasBuff(sim, a, 'root') || hasBuff(sim, b, 'root')).toBe(false); // nobody inside the 250 circle is hit
    place(sim, a, CX + 600, CY + 200); // a steps onto the wire
    steps(sim, 2);
    expect(hasBuff(sim, a, 'root', 'lysa_e')).toBe(true);
    place(sim, b, CX + 600, CY + 100);
    steps(sim, 2);
    expect(hasBuff(sim, b, 'root', 'lysa_e')).toBe(false);
  });
  it('an untouched wire expires after 4 s', () => {
    const { sim } = setup('lysa');
    const a = spawnDummy(sim, CX + 600, CY + 400, 1);
    step(sim);
    cmd(sim, cast(2, CX + 600, CY));
    steps(sim, 8 + 4 * 30 + 15);
    place(sim, a, CX + 600, CY + 100);
    steps(sim, 3);
    expect(hasBuff(sim, a, 'root')).toBe(false);
  });
});

describe('Kiran E fate link', () => {
  it('the ally takes 20 % less and Kiran takes that share', () => {
    const { sim, m } = setup('kiran', [1, 1, 1, 0], 1, [player(1, 'mira')]);
    const ally = sim.slots[1]!;
    place(sim, ally, CX + 300, CY);
    step(sim);
    cmd(sim, cast(2, CX + 300, CY, ally));
    steps(sim, 8);
    const [ah, kh] = [sim.c.Hp.cur[ally]!, sim.c.Hp.cur[m]!];
    dealDamage(sim, -1, ally, 100, 'true');
    steps(sim, 2);
    expect(ah - sim.c.Hp.cur[ally]!).toBeCloseTo(80, 0);
    expect(kh - sim.c.Hp.cur[m]!).toBeCloseTo(20, 0);
  });
});

describe('Isolde Q recast', () => {
  it('break (recast after 1.5 s): x1.4 bonus with a true-damage share and a 25 % slow', () => {
    const { sim, m } = setup('isolde');
    const d = spawnDummy(sim, CX + 150, CY, 1);
    step(sim);
    cmd(sim, cast(0, CX, CY));
    steps(sim, 50);
    cmd(sim, cast(0, CX, CY)); // recast inside the 1.5-3.5 s window
    // 30 ticks: the auto lands after a 10-tick wind-up (windup 0.22), the 1 s slow is still on at the end
    const hits = collect(sim, 30, m, { t: 'attack', target: d });
    const ad = sim.c.Stats.ad[m]!;
    expect(hits.slice(0, 3).map((h) => h.amount)).toEqual([ad, 0.2 * ad * 1.4 * 0.6, 0.2 * ad * 1.4 * 0.4].map((v) => expect.closeTo(v, 6)));
    expect(strongestSlow(sim, d)).toBe(25);
  });
});

describe('Isolde R dome', () => {
  it('leaps to the target; autos inside deal +4 % current HP true; enemy projectiles from outside are destroyed', () => {
    const { sim, m } = setup('isolde', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 350, CY, 1);
    step(sim);
    cmd(sim, cast(3, CX + 350, CY, d));
    steps(sim, 25);
    expect(sim.c.Pos.x[m]!).toBeGreaterThan(CX + 150);
    const hits = collect(sim, 40, m, { t: 'attack', target: d });
    expect(hits.some((h) => Math.abs(h.amount - 0.04 * 1000) < 1e-6)).toBe(true); // dummy at full 1000 HP
    // an enemy line projectile from outside never reaches Isolde
    const proj = spawnProjectile(sim, { kind: 0, src: d, team: 1, x: CX + 1200, y: CY, target: m, speed: 1200, payload: { t: 'auto', src: d, srcSerial: sim.c.Unit.serial[d]!, amount: 50, type: 'true', raw: true, crit: false, miss: false } });
    const hp = sim.c.Hp.cur[m]!;
    steps(sim, 30);
    expect(sim.c.Hp.cur[m]!).toBeGreaterThanOrEqual(hp);
    void proj;
  });
});

describe('Lio R spark rain', () => {
  it('5 strikes over 1 s; the 3rd hit on the same target stuns', () => {
    const { sim, m } = setup('lio', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    let stunned = false;
    const hits: number[] = [];
    for (let i = 0; i < 50; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: cast(3, CX + 600, CY) }] : []);
      for (const e of sim.events) if (e.e === 'damage' && e.src === m && e.dst === d) hits.push(e.amount);
      stunned ||= hasBuff(sim, d, 'stun', 'lio_r');
    }
    expect(hits.filter((a) => a === 80)).toHaveLength(5);
    expect(hits.some((a) => Math.abs(a - (40 + (140 * 5) / 17)) < 1e-6)).toBe(true); // spark explosion (level 6)
    expect(stunned).toBe(true);
  });
});

describe('Hagen R storm peal', () => {
  it('slow grows 15 % per full second inside', () => {
    const { sim } = setup('hagen', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 300, CY, 1);
    step(sim);
    cmd(sim, cast(3, CX, CY));
    steps(sim, 10);
    expect(strongestSlow(sim, d)).toBe(15);
    steps(sim, 30);
    expect(strongestSlow(sim, d)).toBe(30);
    steps(sim, 60);
    expect(strongestSlow(sim, d)).toBe(60);
  });
});

describe('Dagny E shield wall', () => {
  it('destroys enemy projectiles coming from the front, not from behind', () => {
    for (const [fromX, blocked] of [[CX + 600, true], [CX - 600, false]] as const) {
      const { sim, m } = setup('dagny');
      const d = spawnDummy(sim, fromX, CY, 1);
      step(sim);
      cmd(sim, { t: 'move', x: CX + 1, y: CY }); // face +x
      cmd(sim, cast(2, CX + 100, CY));
      steps(sim, 8);
      const hp = sim.c.Hp.cur[m]!;
      spawnProjectile(sim, { kind: 0, src: d, team: 1, x: fromX, y: CY, target: m, speed: 1500, payload: { t: 'auto', src: d, srcSerial: sim.c.Unit.serial[d]!, amount: 50, type: 'true', raw: true, crit: false, miss: false } });
      steps(sim, 20);
      expect([fromX, sim.c.Hp.cur[m]! < hp - 40]).toEqual([fromX, !blocked]);
    }
  });
});

describe('Isolde E wire', () => {
  it('pulls her to terrain; the recast dash stuns the first enemy champion and grants the AS buff', () => {
    const { sim, m } = setup('isolde');
    const nav = sim.map.nav;
    let spot: [number, number, number] | null = null;
    for (let y = 2000; y < 14000 && !spot; y += 100)
      for (let x = 2000; x < 14000 && !spot; x += 100) {
        if (!walkable(nav, x, y) || !walkable(nav, x - 700, y) || !lineWalkable(nav, x - 700, y, x, y)) continue;
        for (let d = 300; d <= 600; d += 25) if (!walkable(nav, x + d, y)) { if (lineWalkable(nav, x, y, x + d - 50, y)) spot = [x, y, d]; break; }
      }
    expect(spot).not.toBeNull();
    const [x, y] = spot!;
    place(sim, m, x, y);
    step(sim);
    cmd(sim, cast(2, x + 800, y));
    steps(sim, 25);
    const px = sim.c.Pos.x[m]!;
    expect(px).toBeGreaterThan(x + 150);
    expect(hasBuff(sim, m, 'stat', 'isolde_e')).toBe(false); // first cast grants nothing
    const d = spawnDummy(sim, px - 250, y, 1);
    step(sim);
    cmd(sim, cast(2, px - 1000, y));
    let stunned = false;
    for (let i = 0; i < 20 && !stunned; i++) (step(sim), (stunned = hasBuff(sim, d, 'stun', 'isolde_e')));
    expect(stunned).toBe(true);
    expect(hasBuff(sim, m, 'stat', 'isolde_e')).toBe(true);
  });
  it('a second press during the wind-up does not dash', () => {
    const { sim, m } = setup('isolde');
    cmd(sim, cast(2, CX + 800, CY));
    cmd(sim, cast(2, CX + 800, CY));
    steps(sim, 20);
    expect(sim.c.Pos.x[m]).toBe(CX);
  });
  it('no terrain: no movement and half cooldown', () => {
    const { sim, m } = setup('isolde');
    cmd(sim, cast(2, CX + 800, CY));
    steps(sim, 12);
    expect(sim.c.Pos.x[m]).toBe(CX);
    expect(abilityHud(sim, m)[2]!.cdLeft).toBeLessThan(9);
  });
});

describe('Grimald traps', () => {
  it('a monster kill leaves a trap that roots the first enemy champion stepping on it', () => {
    const { sim, m } = setup('grimald', [1, 1, 1, 0], 1, [{ slot: 5, team: 1, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false }]);
    const enemy = sim.slots[5]!;
    const mon = spawnUnit(sim, Kind.Monster, 2, CX + 150, CY, 50);
    sim.c.Hp.max[mon] = sim.c.Hp.cur[mon] = 5;
    step(sim);
    cmd(sim, { t: 'attack', target: mon });
    for (let i = 0; i < 60 && grimaldTraps(sim, m).length === 0; i++) step(sim);
    expect(grimaldTraps(sim, m)).toEqual([{ x: CX + 150, y: CY }]);
    place(sim, enemy, CX + 150, CY + 50);
    steps(sim, 2);
    expect(hasBuff(sim, enemy, 'root', 'grimald_trap')).toBe(true);
    expect(grimaldTraps(sim, m)).toHaveLength(0);
  });
});

describe('Lysa R falloff', () => {
  it('each champion after the first takes 10 % less per champion pierced', () => {
    const { sim, m } = setup('lysa', [0, 0, 0, 1]);
    const ds = [600, 800, 1000].map((dx) => spawnDummy(sim, CX + dx, CY, 1));
    step(sim);
    const hits = collect(sim, 90, m, cast(3, CX + 2000, CY));
    const base = 250 + 1.2 * sim.c.Stats.ad[m]!;
    expect(ds.map((d) => hits.find((h) => h.dst === d)?.amount)).toEqual([base, base * 0.9, base * 0.81].map((v) => expect.closeTo(v, 6)));
  });
});

describe('Corvin R volley', () => {
  it('6 bullets across the cone, each stops at the first unit; no damage from the cone itself', () => {
    const { sim, m } = setup('corvin', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 600, CY, 1);
    step(sim);
    const hits = collect(sim, 40, m, cast(3, CX + 1000, CY));
    const per = 60 + 0.4 * sim.c.Stats.ad[m]!;
    // bullet offsets at 600: +-22, +-65, +-108; the dummy (radius 65 + half width 25) catches the inner four
    expect(hits.filter((h) => h.dst === d).map((h) => h.amount)).toEqual([per, per, per, per].map((v) => expect.closeTo(v, 6)));
  });
});

describe('Wren R and E', () => {
  it('R: 5 strikes over 2 s, all igniting', () => {
    const { sim, m } = setup('wren', [0, 0, 0, 1]);
    const d = spawnDummy(sim, CX + 800, CY, 1);
    step(sim);
    const hits = collect(sim, 75, m, cast(3, CX + 800, CY));
    const strike = 80 + 0.4 * sim.c.Stats.ad[m]!;
    expect(hits.filter((h) => h.dst === d && Math.abs(h.amount - strike) < 1e-6)).toHaveLength(5);
    expect(isBurning(sim, d)).toBe(true);
  });
  it('E: hops away from the cursor and leaves smoke hiding units inside from the enemy', () => {
    const { sim, m } = setup('wren', [0, 0, 1, 0], 1, [{ slot: 5, team: 1, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: false }]);
    const enemy = sim.slots[5]!;
    place(sim, enemy, CX + 100, CY + 50);
    step(sim);
    cmd(sim, cast(2, CX + 500, CY));
    steps(sim, 12);
    expect(sim.c.Pos.x[m]!).toBeCloseTo(CX - 300, 6);
    expect(sees(sim, 0, enemy)).toBe(false); // inside the smoke, 400 from Wren
  });
});

describe('Aurel balance wheel', () => {
  it('the first ability casts 30 % faster, the next one within 8 s at normal speed', () => {
    const { sim, m } = setup('aurel');
    const windup = (): number => {
      cmd(sim, cast(0, CX + 1000, CY));
      let n = 1;
      while (query(sim.world, [sim.c.Proj]).length === 0 && n < 30) (step(sim), n++);
      return n;
    };
    const fast = windup();
    steps(sim, 40);
    refreshCooldowns(sim, m);
    const normal = windup();
    expect(fast).toBeLessThan(normal);
    expect(normal - fast).toBe(sec(0.25) - sec(0.25 * 0.7));
  });
});

describe('Tobin sea legs', () => {
  it('Flash also grants +20 % attack speed', () => {
    const { sim, m } = setup('tobin');
    cmd(sim, { t: 'spell', slot: 0, x: CX + 300, y: CY });
    expect(hasBuff(sim, m, 'stat', 'tobin_sea_legs')).toBe(true);
  });
});

describe('Agent F hooks determinism', () => {
  it('two sims with the same inputs end in the same state hash', () => {
    const roster = ['ottilie', 'aurel', 'oda', 'isolde', 'wren', 'corvin', 'lysa', 'lio', 'hagen', 'kiran'];
    const run = (): string => {
      const sim = makeSim({ players: roster.map((c, i) => ({ slot: i, team: (i < 5 ? 0 : 1) as 0 | 1, champion: c, role: 'mid' as const, summoners: ['sprung', 'heilen'] as [string, string], isHuman: false })) });
      roster.forEach((_, i) => {
        const e = sim.slots[i]!;
        place(sim, e, CX + (i < 5 ? -300 : 300), CY - 400 + 160 * (i % 5));
        sim.c.Champ.level[e] = 6;
        sim.c.Champ.skillPoints[e] = 4;
        for (const slot of [0, 1, 2, 3]) levelAbility(sim, e, slot);
      });
      for (let t = 0; t < 300; t++) {
        const inputs: { slot: number; cmd: Command }[] = [];
        for (let i = 0; i < roster.length; i++) {
          const foe = sim.slots[i < 5 ? 5 + (i % 5) : i % 5]!;
          const fx = sim.c.Pos.x[foe]!;
          const fy = sim.c.Pos.y[foe]!;
          const phase = (t + 7 * i) % 60;
          if (phase === 0) inputs.push({ slot: i, cmd: { t: 'cast', slot: ((t / 60) | 0) % 4 as 0 | 1 | 2 | 3, x: fx, y: fy, target: foe } });
          else if (phase === 20) inputs.push({ slot: i, cmd: { t: 'attack', target: foe } });
        }
        step(sim, inputs);
      }
      return stateHash(sim);
    };
    expect(run()).toBe(run());
  });
});
