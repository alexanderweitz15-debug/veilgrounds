// Sev Aschenblick kit, Fassung 3 (docs/champions/sev.md): one behavioural test per mechanic, the R choice (permanent,
// bot default from data) and the sim extensions it uses (decoy clone with fake HP bar, uncleansable, root_ok).
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { stateHash, step, type Sim } from '../src/sim/sim';
import { addBuff, buffs, canMove, hasBuff, healMult, strongestSlow } from '../src/sim/buffs';
import { castSummonerSpell } from '../src/sim/summoners';
import { abilityHud, abilityOf, botUltPick, levelAbility, refreshCooldowns, ultChoiceOf } from '../src/sim/systems/abilities';
import { missingHooks } from '../src/sim/champions';
import { dealDamage } from '../src/sim/damage';
import { spawnDummy } from '../src/sim/systems/champions';
import { buildSnapshot } from '../src/sim/snapshot';
import { sec, type Command, type PlayerSetup } from '../src/sim/types';
import { AMATERASU, GENJUTSU, MOON, blickStacks, isAmaterasuBurning, sevClone, susanooActive, tsukuyomiTarget } from '../src/sim/champions/sev';
import { CX, CY, cmd, collect, makeSim, place, steps } from './combat-helpers';

const player = (slot: number, champion: string, team: 0 | 1, human: boolean, summoners: [string, string] = ['sprung', 'heilen']): PlayerSetup => ({ slot, team, champion, role: 'mid', summoners, isHuman: human });

interface Setup {
  sim: Sim;
  s: number;
  foes: number[];
}

/** Sev at (CX, CY) with ranks [Q, W, E, R] (human unless `bot`); enemy Thessalys (team 1) at the given offsets. */
function setup(ranks: [number, number, number, number], enemies: [number, number][] = [], o: { bot?: boolean; seed?: number; ult?: 0 | 1 | 2 } = {}): Setup {
  const sim = makeSim({ seed: o.seed ?? 1, players: [player(0, 'sev', 0, !o.bot), ...enemies.map((_, i) => player(i + 1, 'thessaly', 1, false, ['reinigen', 'heilen']))] });
  const s = sim.slots[0]!;
  place(sim, s, CX, CY);
  const foes = enemies.map(([dx, dy], i) => {
    const e = sim.slots[i + 1]!;
    place(sim, e, CX + dx, CY + dy);
    return e;
  });
  sim.c.Champ.level[s] = ranks[3] > 0 ? 16 : 9;
  sim.c.Champ.skillPoints[s] = 30;
  ranks.forEach((r, slot) => {
    for (let i = 0; i < r; i++) levelAbility(sim, s, slot);
  });
  step(sim);
  if (o.ult !== undefined) cmd(sim, { t: 'ultChoice', choice: o.ult });
  return { sim, s, foes };
}

const cast = (slot: 0 | 1 | 2 | 3, x: number, y: number, target?: number): Command => ({ t: 'cast', slot, x, y, target });
const dmgTo = (hits: { dst: number; amount: number }[], t: number): number => hits.filter((h) => h.dst === t).reduce((a, h) => a + h.amount, 0);

describe('Sev hooks', () => {
  it('every hook id (abilities + the three ultimates) is exported', () => {
    expect(missingHooks('sev')).toEqual([]);
  });
});

describe('Passive Rabenblick', () => {
  it('3 ability hits stun for 0.75 s (genjutsu), then 12 s per-target cooldown', () => {
    const { sim, s, foes } = setup([1, 0, 1, 0], [[450, 0]]);
    const f = foes[0]!;
    for (let i = 0; i < 2; i++) {
      refreshCooldowns(sim, s);
      cmd(sim, cast(0, CX + 450, CY));
      steps(sim, 45);
    }
    expect(blickStacks(sim, s, f)).toBe(2);
    refreshCooldowns(sim, s);
    sim.c.Face.x[f] = 1; // looks away: E only slows, but still a hit
    sim.c.Face.y[f] = 0;
    cmd(sim, cast(2, CX + 450, CY, f));
    steps(sim, 14);
    expect(hasBuff(sim, f, 'stun', GENJUTSU)).toBe(true);
    expect(blickStacks(sim, s, f)).toBe(0);
    steps(sim, 30);
    for (let i = 0; i < 3; i++) {
      refreshCooldowns(sim, s);
      cmd(sim, cast(0, CX + 450, CY));
      steps(sim, 45);
    }
    expect(blickStacks(sim, s, f)).toBe(3); // capped, genjutsu on cooldown
    expect(hasBuff(sim, f, 'stun', GENJUTSU)).toBe(false);
  });
});

describe('Q Feuerball', () => {
  it('explodes on the first unit hit (AoE 220) and leaves burning ground', () => {
    const { sim, s } = setup([1, 0, 0, 0]);
    const a = spawnDummy(sim, CX + 500, CY, 1);
    const b = spawnDummy(sim, CX + 600, CY + 150, 1); // off the line, inside the blast
    step(sim);
    const hits = collect(sim, sec(2.5), s, cast(0, CX + 500, CY));
    expect(dmgTo(hits, a)).toBeGreaterThan(0);
    expect(dmgTo(hits, b)).toBeGreaterThan(0);
    // explosion + at least two burning-ground ticks on a
    expect(hits.filter((h) => h.dst === a).length).toBeGreaterThanOrEqual(3);
  });

  it('explodes at max range when it hits nothing', () => {
    const { sim, s } = setup([1, 0, 0, 0]);
    const d = spawnDummy(sim, CX + 900, CY + 160, 1); // beside the end point, not on the path
    step(sim);
    const hits = collect(sim, sec(1.5), s, cast(0, CX + 900, CY));
    expect(dmgTo(hits, d)).toBeGreaterThan(0);
  });

  it('recast during the 0.4 s wind-up is a fake: no fireball, mana back, 2 s cooldown', () => {
    const { sim, s } = setup([1, 0, 0, 0]);
    const d = spawnDummy(sim, CX + 500, CY, 1);
    step(sim);
    const mana = sim.c.Mana.cur[s]!;
    cmd(sim, cast(0, CX + 500, CY));
    steps(sim, 4);
    cmd(sim, cast(0, CX + 500, CY));
    const hits = collect(sim, 30, s);
    expect(dmgTo(hits, d)).toBe(0);
    expect(sim.c.Mana.cur[s]!).toBeGreaterThanOrEqual(mana - 1e-6);
    const cd = abilityHud(sim, s)[0]!.cdLeft;
    expect(cd).toBeGreaterThan(0.5);
    expect(cd).toBeLessThan(1.5);
  });
});

describe('W Krähendoppel', () => {
  it('blinks 400 even while rooted (not while stunned) and leaves a crow clone with Sev’s look', () => {
    const { sim, s } = setup([0, 1, 0, 0], [[300, 300]]);
    addBuff(sim, s, { kind: 'root', id: 'test', src: -1, ticks: sec(2) });
    cmd(sim, cast(1, CX + 1000, CY));
    expect(sim.c.Pos.x[s]!).toBeGreaterThan(CX + 350);
    const c = sevClone(sim, s);
    expect(c).toBeGreaterThan(0);
    expect(sim.c.Pos.x[c]!).toBeCloseTo(CX, 0);
    expect(sim.c.Hp.max[c]).toBe(sim.c.Hp.max[s]);
    const e = buildSnapshot(sim, 1, 1).entities.find((x) => x.id === c)!;
    expect(e.look).toBe('sev');
    // stunned: no blink
    const { sim: sim2, s: s2 } = setup([0, 1, 0, 0]);
    addBuff(sim2, s2, { kind: 'stun', id: 'test', src: -1, ticks: sec(2) });
    cmd(sim2, cast(1, CX + 1000, CY));
    expect(sim2.c.Pos.x[s2]!).toBeCloseTo(CX, 0);
  });

  it('the clone bursts after 1.5 s (damage + slow + Gaze) or at once when hit', () => {
    const { sim, s, foes } = setup([0, 1, 0, 0], [[-150, 0], [-150, 120]]);
    const [a, b] = foes as [number, number];
    const hits = collect(sim, sec(1.5) + 3, s, cast(1, CX + 1000, CY));
    expect(sevClone(sim, s)).toBe(-1);
    expect(dmgTo(hits, a)).toBeGreaterThan(0);
    expect(strongestSlow(sim, a)).toBe(35);
    expect(blickStacks(sim, s, a)).toBe(1);
    // hit by anything (an auto) -> bursts immediately
    refreshCooldowns(sim, s);
    place(sim, s, CX, CY);
    step(sim);
    cmd(sim, cast(1, CX + 1000, CY));
    const c = sevClone(sim, s);
    dealDamage(sim, b, c, 5, 'phys', { isAuto: true });
    expect(sevClone(sim, s)).toBe(-1);
  });

  it('enemy projectiles already flying at Sev switch to the clone (substitution)', () => {
    const { sim, s, foes } = setup([0, 1, 0, 0], [[520, 0]]);
    const f = foes[0]!;
    const { Proj } = sim.c;
    const flying = (): boolean => [...query(sim.world, [Proj])].some((p) => Proj.target[p] === s && Proj.src[p] === f);
    let fired = false;
    for (let i = 0; i < 90 && !fired; i++) {
      step(sim, i === 0 ? [{ slot: 1, cmd: { t: 'attack', target: s } }] : []);
      fired = flying();
    }
    expect(fired).toBe(true);
    const hp = sim.c.Hp.cur[s]!;
    cmd(sim, cast(1, CX - 1000, CY));
    step(sim, [{ slot: 1, cmd: { t: 'stop' } }]);
    let hitSev = false;
    for (let i = 0; i < 20; i++) {
      step(sim);
      hitSev ||= sim.events.some((e) => e.e === 'damage' && e.src === f && e.dst === s);
    }
    expect(hitSev).toBe(false);
    expect(sim.c.Hp.cur[s]!).toBeGreaterThanOrEqual(hp - 1e-6);
    expect(sevClone(sim, s)).toBe(-1); // the auto popped the clone
  });
});

describe('E Bannblick', () => {
  it('stuns 1.25 s if the target faces Sev, else slows 40 % (look-away counterplay)', () => {
    for (const facing of [true, false]) {
      const { sim, foes } = setup([0, 0, 1, 0], [[500, 0]]);
      const f = foes[0]!;
      sim.c.Face.x[f] = facing ? -1 : 1;
      sim.c.Face.y[f] = 0;
      cmd(sim, cast(2, CX + 500, CY, f));
      steps(sim, 14);
      expect(hasBuff(sim, f, 'stun', 'sev_e')).toBe(facing);
      expect(strongestSlow(sim, f)).toBe(facing ? 0 : 40);
      if (facing) {
        const st = buffs(sim, f).find((b) => b.kind === 'stun' && b.id === 'sev_e')!;
        expect(st.until - st.start).toBe(sec(1.25));
      }
    }
  });
});

describe('R choice', () => {
  it('a human picks once (permanent); R is not castable before the choice', () => {
    const { sim, s, foes } = setup([0, 0, 0, 1], [[400, 0]]);
    expect(ultChoiceOf(sim, s)).toBe(-1);
    expect(abilityHud(sim, s)[3]!.ultChoice).toEqual({ options: ['sev_r1', 'sev_r2', 'sev_r3'], chosen: -1 });
    let casted = false;
    for (let i = 0; i < 10; i++) {
      step(sim, i === 0 ? [{ slot: 0, cmd: cast(3, CX + 400, CY, foes[0]) }] : []);
      casted ||= sim.events.some((e) => e.e === 'cast' && e.src === s);
    }
    expect(casted).toBe(false);
    cmd(sim, { t: 'ultChoice', choice: 2 });
    cmd(sim, { t: 'ultChoice', choice: 0 });
    expect(ultChoiceOf(sim, s)).toBe(2);
    expect(abilityOf(sim, s, 3).id).toBe('sev_r3');
    expect(abilityHud(sim, s)[3]!.id).toBe('sev_r3');
  });

  it('a bot learning R without a choice gets the deterministic data pick (botUltChoice)', () => {
    const picks = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const a = setup([0, 0, 0, 1], [], { bot: true, seed });
      const b = setup([0, 0, 0, 1], [], { bot: true, seed });
      expect(ultChoiceOf(a.sim, a.s)).toBe(ultChoiceOf(b.sim, b.s));
      expect(ultChoiceOf(a.sim, a.s)).toBe(botUltPick(a.sim, a.s));
      picks.add(ultChoiceOf(a.sim, a.s));
    }
    expect(picks.size).toBe(3); // every option is in the weighted pool
  });
});

describe('R1 Amaterasu', () => {
  it('uncleansable black flames with grievous wounds; jump once to the nearest enemy within 400 on death', () => {
    const { sim, foes } = setup([0, 0, 0, 1], [[450, 0], [450, 200], [450, -330]], { ult: 0 });
    const [a, b, c] = foes as [number, number, number];
    cmd(sim, cast(3, CX + 450, CY, a));
    steps(sim, 10);
    expect(isAmaterasuBurning(sim, a)).toBe(true);
    expect(healMult(sim, a)).toBeCloseTo(0.6);
    castSummonerSpell(sim, a, 'reinigen', 0, 0);
    step(sim);
    expect(isAmaterasuBurning(sim, a)).toBe(true);
    dealDamage(sim, -1, a, 1e6, 'true');
    steps(sim, 2);
    expect(isAmaterasuBurning(sim, b)).toBe(true); // 200 beats 330
    dealDamage(sim, -1, b, 1e6, 'true');
    steps(sim, 2);
    expect(isAmaterasuBurning(sim, c)).toBe(false); // once only
    expect(buffs(sim, b).filter((x) => x.id === AMATERASU).length).toBe(0);
  });
});

describe('R2 Susanoo', () => {
  it('shield, slow immunity, sweeping autos, one sword-thrust recast', () => {
    const { sim, s, foes } = setup([0, 0, 0, 1], [[450, 0], [450, 150], [900, 0]], { ult: 1 });
    const [a, b, c] = foes as [number, number, number];
    addBuff(sim, s, { kind: 'slow', id: 'test', src: a, pct: 50, ticks: sec(3) });
    cmd(sim, cast(3, CX, CY));
    steps(sim, 10);
    expect(susanooActive(sim, s)).toBe(true);
    expect(sim.c.Hp.shield[s]!).toBeGreaterThan(200);
    expect(strongestSlow(sim, s)).toBe(0);
    const autos = collect(sim, 60, s, { t: 'attack', target: a });
    expect(dmgTo(autos, b)).toBeGreaterThan(0); // the sweep hits the neighbour of the auto target
    const thrust = collect(sim, 5, s, cast(3, CX + 1000, CY));
    expect(dmgTo(thrust, c)).toBeGreaterThan(0); // 900 away on the line
    const again = collect(sim, 5, s, cast(3, CX + 1000, CY));
    expect(dmgTo(again, c)).toBe(0); // recast only once
  });
});

describe('R3 Tsukuyomi', () => {
  it('suppresses 1.5 s, roots Sev, tints the target, damage scales with missing health', () => {
    const run = (hpFrac: number): number => {
      const { sim, s, foes } = setup([0, 0, 0, 1], [[400, 0]], { ult: 2 });
      const f = foes[0]!;
      sim.c.Hp.cur[f] = sim.c.Hp.max[f]! * hpFrac;
      cmd(sim, cast(3, CX + 400, CY, f));
      steps(sim, 10);
      expect(hasBuff(sim, f, 'suppress', 'sev_r3')).toBe(true);
      expect(hasBuff(sim, f, 'mark', MOON)).toBe(true);
      expect(canMove(sim, s)).toBe(false);
      expect(tsukuyomiTarget(sim, s)).toBe(f);
      const hits = collect(sim, sec(1.6), s);
      expect(hasBuff(sim, f, 'suppress', 'sev_r3')).toBe(false);
      return dmgTo(hits, f);
    };
    const full = run(1);
    const half = run(0.5);
    expect(full).toBeGreaterThan(100);
    expect(half).toBeGreaterThan(full * 1.2);
  });
});

describe('Sev determinism', () => {
  it('same inputs give the same state hash (all abilities, each ultimate)', () => {
    for (const ult of [0, 1, 2] as const) {
      const run = (): string => {
        const { sim, foes } = setup([1, 1, 1, 1], [[450, 0], [450, 150]], { ult });
        const f = foes[0]!;
        const script: [number, Command][] = [
          [1, cast(2, CX + 450, CY, f)],
          [20, cast(0, CX + 450, CY)],
          [60, cast(3, CX + 450, CY, f)],
          [90, cast(3, CX + 450, CY, f)],
          [120, cast(1, CX - 300, CY)],
          [140, { t: 'attack', target: f }],
        ];
        for (let i = 0; i < 220; i++) {
          const c = script.find(([t]) => t === i);
          step(sim, c ? [{ slot: 0, cmd: c[1] }] : []);
        }
        return stateHash(sim);
      };
      expect(run()).toBe(run());
    }
  });
});
