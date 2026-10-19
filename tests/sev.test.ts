// Sev Aschenblick kit (docs/champions/sev.md): one behavioural test per mechanic + the sim extensions it brought
// (fear CC, uncleansable buffs, decoy pet with fake HP bar, targetOk / onPetDamaged hooks).
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { stateHash, step, type Sim } from '../src/sim/sim';
import { addBuff, buffs, canCast, ccLevel, hasBuff, healMult, isFeared } from '../src/sim/buffs';
import { castSummonerSpell } from '../src/sim/summoners';
import { abilityHud, castSummoner, levelAbility, refreshCooldowns } from '../src/sim/systems/abilities';
import { missingHooks } from '../src/sim/champions';
import { buildSnapshot } from '../src/sim/snapshot';
import { dealDamage } from '../src/sim/damage';
import { spawnDummy } from '../src/sim/systems/champions';
import { petsOf } from '../src/sim/summons';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { DECOY, EMBER, NACHBILD, hasNachbild, isEmbered, sevBann, sevDecoy } from '../src/sim/champions/sev';
import { CX, CY, cmd, collect, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string, team: 0 | 1, summoners: [string, string] = ['sprung', 'heilen']): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners, isHuman: slot === 0 });

/** Sev at (CX, CY) with ranks [Q, W, E, R]; enemies (team 1) at the given offsets. */
function setup(ranks: [number, number, number, number], enemies: [number, number][] = [], level = 9): { sim: Sim; s: number; foes: number[] } {
  const sim = makeSim({ players: [player(0, 'sev', 0), ...enemies.map((_, i) => player(i + 1, 'thessaly', 1, ['reinigen', 'heilen']))] });
  const s = sim.slots[0]!;
  place(sim, s, CX, CY);
  const foes = enemies.map(([dx, dy], i) => {
    const e = sim.slots[i + 1]!;
    place(sim, e, CX + dx, CY + dy);
    return e;
  });
  sim.c.Champ.level[s] = Math.max(level, ranks[3] > 0 ? 6 : 1);
  sim.c.Champ.skillPoints[s] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, s, slot);
  });
  step(sim);
  return { sim, s, foes };
}

const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });

describe('Sev hooks', () => {
  it('every hook id is exported', () => {
    expect(missingHooks('sev')).toEqual([]);
  });
});

describe('Sev Q Glutblick', () => {
  it('hits the first unit for magic damage and leaves a Nachbild', () => {
    const { sim, s } = setup([1, 0, 0, 0]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const hits = collect(sim, 40, s, cast(0, CX + 500, CY));
    expect(hits.filter((h) => h.dst === d).length).toBe(1);
    expect(hasNachbild(sim, d, s)).toBe(true);
  });

  it('recast during the 0.4 s wind-up is a fake: no beam, mana back, 2 s cooldown', () => {
    const { sim, s } = setup([1, 0, 0, 0]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const mana = sim.c.Mana.cur[s]!;
    cmd(sim, cast(0, CX + 500, CY));
    expect(sim.c.Mana.cur[s]!).toBeLessThan(mana);
    steps(sim, 4);
    cmd(sim, cast(0, CX + 500, CY));
    const hits = collect(sim, 30, s);
    expect(hits.filter((h) => h.dst === d)).toEqual([]);
    expect(sim.c.Mana.cur[s]!).toBeGreaterThanOrEqual(mana - 1e-6);
    const cd = abilityHud(sim, s)[0]!.cdLeft;
    // 2 s cooldown started at the fake (30 ticks stepped since): about 1 s left, far below the 7 s cooldown
    expect(cd).toBeGreaterThan(0.5);
    expect(cd).toBeLessThan(1.5);
  });
});

describe('Sev W Schwarzglut', () => {
  it('burns 4 s per second, grievous wounds 40 %, Nachbild; Reinigen does not remove it', () => {
    const { sim, s, foes } = setup([0, 1, 0, 0], [[400, 0]]);
    const f = foes[0]!;
    const hits = collect(sim, sec(5), s, cast(1, CX + 400, CY, f));
    const onF = hits.filter((h) => h.dst === f);
    expect(onF.length).toBe(4);
    expect(new Set(onF.map((h) => Math.round(h.amount))).size).toBe(1);
    // re-apply and try to cleanse
    refreshCooldowns(sim, s);
    cmd(sim, cast(1, CX + 400, CY, f));
    steps(sim, 10);
    expect(isEmbered(sim, f)).toBe(true);
    expect(hasNachbild(sim, f, s)).toBe(true);
    expect(healMult(sim, f)).toBeCloseTo(0.6);
    expect(buffs(sim, f).filter((b) => b.id === EMBER).every((b) => b.uncleansable)).toBe(true);
    castSummonerSpell(sim, f, 'reinigen', 0, 0);
    step(sim);
    expect(isEmbered(sim, f)).toBe(true);
    expect(hasBuff(sim, f, 'grievous', EMBER)).toBe(true);
  });

  it('jumps once to the nearest enemy within 300 when the target dies', () => {
    const { sim, foes } = setup([0, 1, 0, 0], [[400, 0], [400, 200], [400, -280]]);
    const [a, b, c] = foes as [number, number, number];
    cmd(sim, cast(1, CX + 400, CY, a));
    steps(sim, 12);
    expect(isEmbered(sim, a)).toBe(true);
    dealDamage(sim, -1, a, 1e6, 'true');
    steps(sim, 2);
    expect(isEmbered(sim, b)).toBe(true); // 200 away beats 280
    expect(isEmbered(sim, c)).toBe(false);
    dealDamage(sim, -1, b, 1e6, 'true');
    steps(sim, 2);
    expect(isEmbered(sim, c)).toBe(false); // only one jump
  });

  it('on his own decoy: the decoy burns 4 s and damages enemies within 250', () => {
    const { sim, s, foes } = setup([0, 1, 1, 0], [[-150, 0]]);
    const f = foes[0]!;
    cmd(sim, cast(2, CX + 450, CY));
    step(sim);
    const d = sevDecoy(sim, s);
    expect(d).toBeGreaterThan(0);
    const hits = collect(sim, sec(4.5), s, cast(1, CX, CY, d));
    expect(hits.filter((h) => h.dst === f).length).toBeGreaterThanOrEqual(3);
    // the burning decoy outlived its 2.5 s lifetime
    expect(petsOf(sim, s, DECOY).length).toBe(0);
  });
});

describe('Sev E Trugbild', () => {
  it('blinks 450 and leaves a decoy with Sev’s HP numbers at the start for 2.5 s', () => {
    const { sim, s } = setup([0, 0, 1, 0]);
    cmd(sim, cast(2, CX + 1000, CY));
    expect(sim.c.Pos.x[s]!).toBeGreaterThan(CX + 400);
    const d = sevDecoy(sim, s);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(sim.c.Pos.x[d]!).toBeCloseTo(CX, 0);
    expect(sim.c.Hp.max[d]).toBe(sim.c.Hp.max[s]);
    steps(sim, sec(2.5) + 2);
    expect(sevDecoy(sim, s)).toBe(-1);
  });

  it('snapshots show the decoy as Sev (look + level) to the enemy team', () => {
    const { sim, s } = setup([0, 0, 1, 0], [[300, 0]]);
    cmd(sim, cast(2, CX + 450, CY));
    const d = sevDecoy(sim, s);
    const snap = buildSnapshot(sim, 1, 1);
    const e = snap.entities.find((x) => x.id === d)!;
    expect(e.look).toBe('sev');
    expect(e.level).toBe(sim.c.Champ.level[s]);
    expect(e.maxMana).toBe(sim.c.Mana.max[s]);
  });

  it('an enemy ability hitting the decoy gives the attacker a Nachbild; autos do not', () => {
    const { sim, s, foes } = setup([0, 0, 1, 0], [[300, 0], [300, 200]]);
    cmd(sim, cast(2, CX - 450, CY));
    const d = sevDecoy(sim, s);
    dealDamage(sim, foes[0]!, d, 10, 'magic');
    dealDamage(sim, foes[1]!, d, 10, 'phys', { isAuto: true });
    expect(hasNachbild(sim, foes[0]!, s)).toBe(true);
    expect(hasNachbild(sim, foes[1]!, s)).toBe(false);
  });
});

describe('Sev passive Nachbild', () => {
  it('autos on a Nachbild target deal bonus magic damage and extend the ember by 0.5 s', () => {
    const { sim, s, foes } = setup([0, 1, 0, 0], [[400, 0]]);
    const f = foes[0]!;
    cmd(sim, cast(1, CX + 400, CY, f));
    steps(sim, 10);
    const before = buffs(sim, f).find((b) => b.kind === 'dot' && b.id === EMBER)!.until;
    const hits = collect(sim, 45, s, { t: 'attack', target: f });
    const after = buffs(sim, f).find((b) => b.kind === 'dot' && b.id === EMBER)!.until;
    expect(after - before).toBeGreaterThanOrEqual(sec(0.5));
    // auto + bonus instance land on the same tick
    const byTick = new Map<number, number>();
    for (const h of hits.filter((x) => x.dst === f)) byTick.set(h.tick, (byTick.get(h.tick) ?? 0) + 1);
    expect([...byTick.values()].some((n) => n >= 2)).toBe(true);
  });
});

describe('Sev R Augenbann', () => {
  it('needs a Nachbild target', () => {
    const { sim, s, foes } = setup([0, 0, 0, 1], [[500, 0]]);
    cmd(sim, cast(3, CX + 500, CY, foes[0]!));
    steps(sim, 20);
    expect(isFeared(sim, foes[0]!)).toBe(false);
    expect(abilityHud(sim, s)[3]!.cdLeft).toBe(0);
  });

  it('after 0.5 s eye contact: fear 1.5 s (flees, no casts/summoners, revealed), then damage; +50 % with ember', () => {
    const run = (withEmber: boolean): number => {
      const { sim, s, foes } = setup([0, 1, 0, 1], [[500, 0]]);
      const f = foes[0]!;
      addBuff(sim, f, { kind: 'mark', id: NACHBILD, src: s, ticks: sec(5) });
      if (withEmber) {
        cmd(sim, cast(1, CX + 500, CY, f));
        steps(sim, 10);
      }
      cmd(sim, cast(3, CX + 500, CY, f));
      steps(sim, sec(0.5) + 1);
      expect(isFeared(sim, f)).toBe(true);
      expect(canCast(sim, f)).toBe(false);
      expect(castSummoner(sim, f, 0, 0, 0)).toBe('cc');
      expect(ccLevel(sim, f)).toBe(3.5);
      expect(sevBann(sim, s)?.t).toBe(f);
      const x0 = sim.c.Pos.x[f]!;
      steps(sim, 20);
      expect(sim.c.Pos.x[f]!).toBeGreaterThan(x0 + 40); // walks away from Sev (who is at -x)
      const hits = collect(sim, sec(1.5), s);
      const big = hits.filter((h) => h.dst === f).map((h) => h.amount).sort((a, b) => b - a)[0] ?? 0;
      expect(isFeared(sim, f)).toBe(false);
      return big;
    };
    const plain = run(false);
    const burned = run(true);
    expect(plain).toBeGreaterThan(100);
    expect(burned / plain).toBeCloseTo(1.5, 1);
  });

  it('tenacity shortens the fear', () => {
    const { sim, s, foes } = setup([0, 0, 0, 1], [[500, 0]]);
    const f = foes[0]!;
    addBuff(sim, f, { kind: 'mark', id: NACHBILD, src: s, ticks: sec(5) });
    addBuff(sim, f, { kind: 'stat', stat: 'tenacity', id: 'test', src: f, pct: 50, ticks: sec(10) });
    step(sim);
    expect(sim.c.Stats.tenacity[f]!).toBeGreaterThan(0);
    cmd(sim, cast(3, CX + 500, CY, f));
    steps(sim, sec(0.5) + 1);
    const fear = buffs(sim, f).find((b) => b.kind === 'fear')!;
    expect(fear.until - fear.start).toBeLessThan(sec(1.5));
  });

  it('losing sight during the eye contact cancels the cast', () => {
    const { sim, s, foes } = setup([0, 0, 0, 1], [[500, 0]]);
    const f = foes[0]!;
    addBuff(sim, f, { kind: 'mark', id: NACHBILD, src: s, ticks: sec(5) });
    cmd(sim, cast(3, CX + 500, CY, f));
    steps(sim, 3);
    addBuff(sim, f, { kind: 'stat', stat: 'invisible', id: 'test', src: f, ticks: sec(3) });
    steps(sim, 20);
    expect(isFeared(sim, f)).toBe(false);
  });
});

describe('Sev determinism', () => {
  it('same inputs give the same state hash', () => {
    const run = (): string => {
      const { sim, s, foes } = setup([1, 1, 1, 1], [[450, 0], [450, 150]]);
      const f = foes[0]!;
      const script: [number, Command][] = [
        [1, cast(1, CX + 450, CY, f)],
        [15, cast(0, CX + 450, CY)],
        [40, cast(3, CX + 450, CY, f)],
        [80, cast(2, CX - 300, CY)],
        [100, { t: 'attack', target: f }],
      ];
      for (let i = 0; i < 200; i++) {
        const c = script.find(([t]) => t === i);
        step(sim, c ? [{ slot: 0, cmd: c[1] }] : []);
      }
      void s;
      return stateHash(sim);
    };
    expect(run()).toBe(run());
  });
});
