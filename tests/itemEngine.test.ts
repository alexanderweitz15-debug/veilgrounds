// Item engine (A7): format validation, every trigger and effect building block, uniqueness / stacking rules and the
// anti-heal / anti-tank / anti-burst / anti-CC samples from tests/fixtures/itemEngineItems.json (fixtures only, not in
// the live item list: A12 owns content). Docs: docs/ITEMS-FORMAT.md. The numbers of the live items are pinned by
// tests/itemEngine.golden.test.ts.
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, makeSim, place, steps } from './combat-helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { step, stateHash, type Sim } from '../src/sim/sim';
import { Kind, sec, type Command } from '../src/sim/types';
import { dealDamage, effectiveResist, heal, kill, mitigation } from '../src/sim/damage';
import { addBuff, buffs, hasBuff } from '../src/sim/buffs';
import { spawnMinion } from '../src/sim/systems/minions';
import { passiveHooksOf } from '../src/sim/champions';
import { ITEMS, buyItem, inventory, itemById, quote, registerItems } from '../src/sim/items/inventory';
import { itemCooldownLeft } from '../src/sim/items/itemHooks';
import { ItemFormatError, validateItems } from '../src/sim/items/validate';
import { TRIGGERS, EFFECT_TYPES } from '../src/sim/items/schema';
import { buildSnapshot } from '../src/sim/snapshot';
import fixture from './fixtures/itemEngineItems.json';
import { abilityHit, autos, duel } from './itemHelpers';

let undo: () => void = () => undefined;
beforeAll(() => {
  undo = registerItems(fixture.items);
});
afterAll(() => undo());

const use = (sim: Sim, slot: number, x?: number, y?: number): void => step(sim, [{ slot: 0, cmd: { t: 'item', slot, x, y } as Command }]);
const buff = (sim: Sim, eid: number, id: string) => buffs(sim, eid).find((b) => b.id === id && b.until > sim.tick);
const magicHits = (ev: { type: string }[]): number => ev.filter((e) => e.type === 'magic').length;

// ------------------------------------------------------------------ format validation

describe('items.json format', () => {
  const base = (): Record<string, any> => ({
    id: 'probe',
    name: { de: 'Probe', en: 'Probe' },
    tier: 'basic',
    cost: 400,
    from: [],
    stats: { ad: 5 },
    tags: ['ad'],
    passive: {
      name: { de: 'P', en: 'P' },
      desc: { de: 'P', en: 'P' },
      rules: [{ on: 'onHit', do: [{ type: 'damage', to: 'target', dmgType: 'magic', value: 5 }] }],
    },
  });
  const fails = (mutate: (it: Record<string, any>) => void, ...expected: (string | RegExp)[]): void => {
    const it = base();
    mutate(it);
    let err: unknown;
    try {
      validateItems([it], ITEMS);
    } catch (e) {
      err = e;
    }
    expect(err, 'should have been rejected').toBeInstanceOf(ItemFormatError);
    for (const x of expected) expect((err as Error).message).toMatch(x);
  };

  it('the live items.json and the fixture items are valid', () => {
    expect(ITEMS.length).toBeGreaterThan(50);
    expect(() => validateItems(JSON.parse(JSON.stringify(fixture.items)), ITEMS.filter((i) => !i.id.startsWith('fx_')))).not.toThrow();
  });

  it('no item uses the former code-hook ids any more', () => {
    for (const it of ITEMS) {
      expect(JSON.stringify(it)).not.toContain('"hook"');
    }
  });

  it('rejects a mistyped trigger, with path and hint', () => {
    fails((it) => (it.passive.rules[0].on = 'onHti'), /items\[probe\]\.passive\.rules\[0\]\.on: unknown trigger "onHti" \(did you mean "onHit"\?\)/);
    fails((it) => (it.passive.rules[0].on = ['onHit', 'onKil']), /rules\[0\]\.on\[1\]: unknown trigger "onKil" \(did you mean "onKill"\?\)/);
  });

  it('rejects a mistyped effect type and unknown keys', () => {
    fails((it) => (it.passive.rules[0].do[0].type = 'damge'), /do\[0\]\.type: unknown effect "damge" \(did you mean "damage"\?\)/);
    fails((it) => (it.passive.rules[0].do[0].dmgTyp = 'magic'), /do\[0\]\.dmgTyp: unknown key \(did you mean "dmgType"\?\)/);
    fails((it) => delete it.passive.rules[0].do[0].dmgType, /do\[0\]\.dmgType: missing/);
    fails((it) => (it.passive.rules[0].dooo = []), /rules\[0\]\.dooo: unknown key \(did you mean "do"\?\)/);
    fails((it) => (it.passive.hook = 'stormbow'), /passive\.hook: unknown key/);
  });

  it('rejects mistyped conditions, stats, tags and tiers', () => {
    fails((it) => (it.passive.rules[0].if = { crti: true }), /rules\[0\]\.if\.crti: unknown key \(did you mean "crit"\?\)/);
    fails((it) => (it.passive.rules[0].if = { target: { kind: ['champoin'] } }), /unknown unit kind "champoin" \(did you mean "champion"\?\)/);
    fails((it) => (it.stats.armr = 5), /stats\.armr: unknown stat \(did you mean "armor"\?\)/);
    fails((it) => (it.tags = ['adc']), /tags\[0\]: unknown tag "adc"/);
    fails((it) => (it.tier = 'legendry'), /tier: unknown tier "legendry" \(did you mean "legendary"\?\)/);
    fails((it) => delete it.name.en, /name\.en: missing/);
  });

  it('rejects triggers used with conditions, effects or recipients that cannot work there', () => {
    fails((it) => (it.passive.rules[0].if = { castSlot: [0] }), /if\.castSlot: only meaningful for onCast\/onAbilityHit, the rule triggers on onHit/);
    fails((it) => (it.passive.rules[0].on = 'onTick'), /do\[0\]\.to: "target" has no meaning here \(onTick has no target unit\)/);
    fails((it) => (it.passive.rules[0].do[0].to = 'source'), /"source" is only available in onDamageTaken\/onShieldBreak/);
    fails((it) => (it.passive.rules[0] = { on: 'modifyDamage', do: [{ type: 'heal', to: 'self', value: 1 }] }), /modifyDamage rules take only damageMult effects, not "heal"/);
    fails((it) => (it.passive.rules[0].do = [{ type: 'damageMult', mult: 2 }]), /effect "damageMult" is only allowed in a modifyDamage rule, not onHit/);
    fails((it) => (it.passive.rules[0] = { on: 'modifyDamage', cooldown: 1, do: [{ type: 'damageMult', mult: 2 }] }), /cooldown\/charges are not allowed on modifyDamage rules/);
    fails((it) => (it.passive.rules[0] = { on: 'onTick', do: [{ type: 'absorbDamage', value: 5 }] }), /absorbDamage" is only allowed in a onDamageTaken rule/);
    fails((it) => (it.passive.rules[0].do[0] = { type: 'damage', to: 'enemiesInRadius', dmgType: 'true', value: 5 }), /do\[0\]\.radius: required for "enemiesInRadius"/);
  });

  it('rejects incomplete buffs, durations and numbers', () => {
    const buffRule = (b: Record<string, unknown>) => (it: Record<string, any>) => (it.passive.rules[0].do[0] = { type: 'applyBuff', to: 'target', id: 'x', ...b });
    fails(buffRule({ kind: 'slow', pct: 20 }), /missing duration \(seconds or ticks\)/);
    fails(buffRule({ kind: 'slow', pct: 20, seconds: 1, ticks: 30 }), /either seconds or ticks/);
    fails(buffRule({ kind: 'slow', seconds: 1 }), /pct: required for kind "slow"/);
    fails(buffRule({ kind: 'stat', pct: 5, seconds: 1 }), /stat: required for kind "stat"/);
    fails(buffRule({ kind: 'dot', seconds: 3 }), /damage: required for kind "dot"/);
    fails(buffRule({ kind: 'stun', seconds: -1 }), /seconds: must be > 0/);
    fails(buffRule({ kind: 'frozen', seconds: 1 }), /unknown buff kind "frozen"/);
    fails((it) => (it.passive.rules[0].do[0].value = 'five'), /value: expected a number/);
    fails((it) => (it.passive.rules[0].do[0].value = { base: 5, scale: { apq: 1 } }), /scale\.apq: unknown key \(did you mean "ap"\?\)/);
  });

  it('rejects consumables without use, quests nobody feeds, unknown recipes and duplicate ids', () => {
    fails((it) => (it.tier = 'consumable'), /use: consumables need a use block/);
    fails((it) => (it.use = { target: 'self', effects: [{ type: 'restoreMana', value: 1 }] }), /use: only items of tier "consumable" have a use/);
    fails((it) => (it.passive.quest = { counter: 'gold', goal: 10 }), /quest\.counter: no gold effect of this passive feeds counter "gold"/);
    fails((it) => (it.from = ['langschwerd']), /from: unknown item "langschwerd" \(did you mean "langschwert"\?\)/);
    fails((it) => (it.id = 'langschwert'), /id: duplicate item id/);
    fails((it) => (it.active = { name: { de: 'A', en: 'A' }, desc: { de: 'A', en: 'A' }, cooldown: 10, target: 'enemyChampion', effects: [{ type: 'restoreMana', value: 1 }] }), /active\.range: required for target "enemyChampion"/);
  });

  it('items with the same passive name must share one key (unique passive names)', () => {
    const other = ITEMS.find((i) => i.passive?.rules?.length)!;
    fails((it) => (it.passive.name = { ...other.passive!.name }), new RegExp(`passive name "${other.passive!.name.en}" is also used by item "${other.id}" with another key`));
    fails((it) => ((it.passive.name = { ...other.passive!.name }), (it.passive.key = 'someOtherKey')), /with another key/);
    const ok = base();
    ok.passive.name = { ...other.passive!.name };
    ok.passive.key = other.passive!.key ?? other.id; // sharing the key makes it the same unique passive
    expect(() => validateItems([ok], ITEMS)).not.toThrow();
  });

  it('reports every problem at once', () => {
    const it = base();
    it.passive.rules[0].on = 'onHti';
    it.passive.rules[0].do[0].type = 'damge';
    it.stats.armr = 1;
    try {
      validateItems([it], ITEMS);
      throw new Error('accepted');
    } catch (e) {
      expect((e as ItemFormatError).errors).toHaveLength(3);
    }
  });

  it('every trigger and effect type of the schema is validated and implemented', () => {
    // a rule per trigger / effect type compiles and fires in the tests below; here: the lists are what the docs name
    expect([...TRIGGERS]).toEqual(['onHit', 'onAbilityHit', 'onCast', 'onKill', 'onTakedown', 'onDamageTaken', 'onShieldBreak', 'onTick', 'modifyDamage', 'modifyHeal', 'onComputeStats']);
    expect(EFFECT_TYPES).toHaveLength(17);
  });
});

// ------------------------------------------------------------------ building blocks for the planned items

describe('anti-heal (grievous wounds)', () => {
  it('Wundenklinge: hits on champions cut their healing by 40 % for 3 s', () => {
    const { sim, me, foe } = duel({ items: ['fx_wundenklinge'] });
    sim.c.Hp.cur[foe] = 100;
    expect(heal(sim, foe, 100)).toBeCloseTo(100);
    sim.c.Hp.cur[foe] = 100;
    autos(sim, me, foe, 1);
    expect(buff(sim, foe, 'fx_grievous')?.pct).toBe(40);
    sim.c.Hp.cur[foe] = 100;
    expect(heal(sim, foe, 100)).toBeCloseTo(60);
    step(sim, [{ slot: 0, cmd: { t: 'stop' } }]);
    steps(sim, sec(3) + 2);
    sim.c.Hp.cur[foe] = 100;
    expect(heal(sim, foe, 100)).toBeCloseTo(100);
  });

  it('Wundenklinge: ability hits apply it too, minions do not get it', () => {
    const { sim, me, foe } = duel({ items: ['fx_wundenklinge'] });
    abilityHit(sim, me, foe);
    expect(hasBuff(sim, foe, 'grievous', 'fx_grievous')).toBe(true);
    const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY);
    for (const h of passiveHooksOf(sim, me)) h.onAutoHit?.(sim, me, m, 10, { crit: false, overheal: 0 });
    expect(hasBuff(sim, m, 'grievous')).toBe(false);
  });

  it('Wundrauch (active): enemies within 600 lose 50 % healing for 4 s, 60 s cooldown', () => {
    const d = duel({ items: ['fx_wundrauch'], allies: [300] });
    const { sim, foe } = d;
    place(sim, d.foe, CX + 500, CY);
    use(sim, 0);
    expect(buff(sim, foe, 'fx_smoke')?.pct).toBe(50);
    expect(buff(sim, d.allies[0]!, 'fx_smoke')).toBeUndefined(); // allies are not enemies
    expect(buildSnapshot(sim, 0, 0).me!.itemCds[0]!.total).toBe(60);
    expect(itemCooldownLeft(sim, d.me, 'fx_wundrauch')).toBeGreaterThan(sec(59));
    use(sim, 0);
    expect(sim.events.some((e) => e.e === 'castFail' && e.reason === 'cooldown')).toBe(true);
  });

  it('Wundrauch: out of range nothing happens (but the active is spent)', () => {
    const { sim, foe, me } = duel({ items: ['fx_wundrauch'] });
    place(sim, foe, CX + 900, CY);
    use(sim, 0);
    expect(buff(sim, foe, 'fx_smoke')).toBeUndefined();
    expect(itemCooldownLeft(sim, me, 'fx_wundrauch')).toBeGreaterThan(0);
  });
});

describe('anti-tank (max-HP damage, penetration)', () => {
  it('Titanspalter: 30 % armor penetration as item stat, removed with the item', () => {
    const { sim, me, foe } = duel({ items: ['fx_titanspalter'] });
    expect(sim.c.Stats.armorPenPct[me]).toBeCloseTo(0.3);
    const armor = sim.c.Stats.armor[foe]!;
    sim.c.Stats.armor[foe] = 100;
    expect(effectiveResist(sim, me, foe, 'phys')).toBeCloseTo(70);
    sim.c.Stats.armor[foe] = armor;
    inventory(sim, me)[0] = null;
    step(sim);
    expect(sim.c.Stats.armorPenPct[me]).toBeCloseTo(0);
  });

  it('Leerenstab: flat magic penetration as item stat', () => {
    const { sim, me, foe } = duel({ items: ['fx_leerenstab'] });
    expect(sim.c.Stats.magicPen[me]).toBe(20);
    sim.c.Stats.mr[foe] = 50;
    expect(effectiveResist(sim, me, foe, 'magic')).toBe(30);
    steps(sim, 5); // delta-applied: no compounding over ticks
    expect(sim.c.Stats.magicPen[me]).toBe(20);
  });

  it('Titanspalter: hits on champions deal 3 % of their max HP as magic damage, capped at 40', () => {
    const { sim, me, foe } = duel({ items: ['fx_titanspalter'] });
    const mr = sim.c.Stats.mr[foe]!;
    const expectHit = (max: number): number => Math.min(40, max * 0.03) * mitigation(effectiveResist(sim, me, foe, 'magic'));
    const small = autos(sim, me, foe, 1).find((e) => e.type === 'magic')!;
    expect(sim.c.Hp.max[foe]! * 0.03).toBeLessThan(40);
    expect(small.amount).toBeCloseTo(expectHit(sim.c.Hp.max[foe]!), 6);
    expect(mr).toBeGreaterThanOrEqual(0);
    step(sim, [{ slot: 0, cmd: { t: 'stop' } }]);
    for (let i = 0; i < 3; i++) inventory(sim, foe)[i] = 'riesenguertel'; // +1050 max HP: 3 % would be above the cap
    steps(sim, 2);
    expect(sim.c.Hp.max[foe]! * 0.03).toBeGreaterThan(40);
    const big = autos(sim, me, foe, 1).find((e) => e.type === 'magic')!;
    expect(big.amount).toBeCloseTo(40 * mitigation(effectiveResist(sim, me, foe, 'magic')), 6);
  });
});

describe('anti-burst (shield and damage reduction on burst)', () => {
  it('Bollwerk: a 20 %-of-max-HP hit grants a shield, once per 30 s; the broken shield gives damage reduction', () => {
    const { sim, me, foe } = duel({ items: ['fx_bollwerk'] });
    const { Hp } = sim.c;
    const max = Hp.max[me]!;
    dealDamage(sim, foe, me, max * 0.05, 'true'); // too small
    expect(buff(sim, me, 'fx_panic')).toBeUndefined();
    dealDamage(sim, foe, me, max * 0.25, 'true');
    const sh = buff(sim, me, 'fx_panic')!;
    expect(sh.amount).toBeCloseTo(max * 0.2, 6);
    expect(Hp.shield[me]).toBeCloseTo(max * 0.2, 6);
    expect(buff(sim, me, 'fx_resolve')).toBeUndefined();
    // another big hit during the cooldown: no new shield, but it breaks the old one -> damage reduction
    dealDamage(sim, foe, me, max * 0.3, 'true');
    expect(Hp.shield[me]).toBeCloseTo(0, 6);
    expect(buff(sim, me, 'fx_resolve')?.pct).toBe(30);
    const hp = Hp.cur[me]!;
    expect(dealDamage(sim, foe, me, 100, 'true')).toBeCloseTo(70);
    expect(Hp.cur[me]).toBeCloseTo(hp - 70);
    // cooldown over: the shield comes back
    steps(sim, sec(30) + 1);
    Hp.cur[me] = max;
    dealDamage(sim, foe, me, max * 0.25, 'true');
    expect(buff(sim, me, 'fx_panic')).toBeDefined();
  });
});

describe('anti-CC (tenacity, cleanse)', () => {
  it('Reinigungsamulett: 35 % tenacity shortens stuns', () => {
    const { sim, me } = duel({ items: ['fx_reinigungsamulett'] });
    expect(sim.c.Stats.tenacity[me]).toBeCloseTo(0.35);
    addBuff(sim, me, { kind: 'stun', id: 'probe', src: -1, ticks: 100 });
    const b = buffs(sim, me).find((x) => x.id === 'probe')!;
    expect(b.until - b.start).toBe(65);
    steps(sim, 5);
    expect(sim.c.Stats.tenacity[me]).toBeCloseTo(0.35); // rebuilt every tick: no compounding
  });

  it('Reinigungsamulett (active): usable while stunned, removes CC and grants tenacity', () => {
    const { sim, me } = duel({ items: ['fx_reinigungsamulett'] });
    for (const kind of ['stun', 'root', 'silence', 'blind', 'slow'] as const) addBuff(sim, me, { kind, id: `p_${kind}`, src: -1, ticks: sec(5), pct: 30 });
    addBuff(sim, me, { kind: 'airborne', id: 'p_air', src: -1, ticks: sec(5) });
    addBuff(sim, me, { kind: 'stun', id: 'p_dark', src: -1, ticks: sec(5), uncleansable: true });
    use(sim, 0);
    for (const kind of ['stun', 'root', 'silence', 'blind', 'slow']) expect(buffs(sim, me).some((b) => b.id === `p_${kind}` && b.until > sim.tick)).toBe(false);
    expect(hasBuff(sim, me, 'airborne')).toBe(true); // not cleansable
    expect(hasBuff(sim, me, 'stun', 'p_dark')).toBe(true); // uncleansable
    expect(buff(sim, me, 'fx_purge')?.pct).toBe(40);
    step(sim);
    expect(sim.c.Stats.tenacity[me]).toBeCloseTo(0.75);
    expect(buildSnapshot(sim, 0, 0).me!.itemCds[0]!.total).toBe(90);
  });
});

describe('unit-targeted actives', () => {
  it('Fangnetz roots the visible enemy champion nearest to the point, within range', () => {
    const { sim, foe, me } = duel({ items: ['fx_fangnetz'] });
    use(sim, 0, CX + 380, CY);
    expect(buff(sim, foe, 'fx_net')).toBeDefined();
    expect(hasBuff(sim, foe, 'root')).toBe(true);
    expect(itemCooldownLeft(sim, me, 'fx_fangnetz')).toBeGreaterThan(sec(44));
  });

  it('Fangnetz fails (no cooldown) without a target in range', () => {
    const { sim, foe, me } = duel({ items: ['fx_fangnetz'] });
    place(sim, foe, CX + 1000, CY);
    steps(sim, 2);
    use(sim, 0, CX + 1000, CY);
    expect(buff(sim, foe, 'fx_net')).toBeUndefined();
    expect(sim.events.some((e) => e.e === 'castFail' && e.reason === 'target')).toBe(true);
    expect(itemCooldownLeft(sim, me, 'fx_fangnetz')).toBe(0);
  });

  it('Segensperle shields the chosen ally: 100 + 50 % AP', () => {
    const { sim, allies, me } = duel({ items: ['fx_segensperle'], allies: [300] });
    use(sim, 0, CX - 300, CY);
    expect(buff(sim, allies[0]!, 'fx_blessing')?.amount).toBeCloseTo(100 + 0.5 * sim.c.Stats.ap[me]!);
    expect(buff(sim, me, 'fx_blessing')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ triggers, stacks, conditions

describe('stacks, onTakedown, onKill, onCast, onComputeStats', () => {
  const souls = (sim: Sim, me: number): number => {
    const ps = (sim.state.items as any).ent.get(me)?.passives.get('fx_ahnenkelch');
    const s = ps?.stacks.souls;
    return s && (s[1] === 0 || sim.tick < s[1]) ? s[0] : 0;
  };
  const lastHit = (sim: Sim, me: number): void => {
    const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY);
    kill(sim, m, me);
  };

  it('minion kills give souls (max 10, 20 s), each soul +4 AP', () => {
    const { sim, me } = duel({ items: ['fx_ahnenkelch'] });
    const ap0 = sim.c.Stats.ap[me]!;
    expect(souls(sim, me)).toBe(0);
    for (let i = 0; i < 12; i++) lastHit(sim, me);
    expect(souls(sim, me)).toBe(10);
    step(sim);
    expect(sim.c.Stats.ap[me]).toBeCloseTo(ap0 + 40);
    steps(sim, sec(20) + 1);
    expect(souls(sim, me)).toBe(0);
    expect(sim.c.Stats.ap[me]).toBeCloseTo(ap0);
  });

  it('champion takedowns give a soul (onTakedown), kills of champions count once', () => {
    const { sim, me, foe } = duel({ items: ['fx_ahnenkelch'] });
    kill(sim, foe, me);
    expect(souls(sim, me)).toBe(1);
  });

  it('casting restores 5 mana per soul and, from 5 souls, heals 30 (onCast + stacksAtLeast)', () => {
    const { sim, me } = duel({ items: ['fx_ahnenkelch'] });
    const { Mana, Hp } = sim.c;
    const cast = (): void => void passiveHooksOf(sim, me).forEach((h) => h.onCast?.(sim, me, 0));
    Mana.cur[me] = 100;
    Hp.cur[me] = 300;
    cast();
    expect([Mana.cur[me], Hp.cur[me]]).toEqual([100, 300]); // no souls
    for (let i = 0; i < 4; i++) lastHit(sim, me);
    Mana.cur[me] = 100;
    cast();
    expect([Mana.cur[me], Hp.cur[me]]).toEqual([120, 300]); // 4 souls: 20 mana, no heal
    lastHit(sim, me);
    Mana.cur[me] = 100;
    cast();
    expect([Mana.cur[me], Hp.cur[me]]).toEqual([125, 330]);
  });

  it('a real ability cast fires onCast', () => {
    const { sim, me } = duel({ items: ['fx_ahnenkelch'] });
    for (let i = 0; i < 5; i++) lastHit(sim, me);
    step(sim, [{ slot: 0, cmd: { t: 'levelUp', slot: 0 } }]);
    sim.c.Hp.cur[me] = 300;
    step(sim, [{ slot: 0, cmd: { t: 'cast', slot: 0, x: CX + 400, y: CY } }]);
    steps(sim, 20);
    expect(sim.c.Hp.cur[me]).toBeGreaterThan(329);
  });
});

describe('modifiers and self conditions (fx_fels)', () => {
  it('modifyHeal multiplies ability heals by 1.25', () => {
    const { sim, me } = duel({ items: ['fx_fels'] });
    let a = 100;
    for (const h of passiveHooksOf(sim, me)) if (h.modifyHeal) a = h.modifyHeal(sim, me, me, a);
    expect(a).toBeCloseTo(125);
  });

  it('modifyDamage: +10 % on basic attacks vs champions above 90 % HP only', () => {
    const { sim, me, foe } = duel({ items: ['fx_fels'] });
    expect(dealDamage(sim, me, foe, 100, 'true')).toBeCloseTo(100); // not an auto
    const mod = (hpPct: number, auto: boolean): number => {
      sim.c.Hp.cur[foe] = sim.c.Hp.max[foe]! * hpPct;
      let a = 100;
      for (const h of passiveHooksOf(sim, me)) if (h.modifyDamage) a = h.modifyDamage(sim, me, foe, a, 'phys', auto);
      return a;
    };
    expect(mod(1, true)).toBeCloseTo(110);
    expect(mod(0.8, true)).toBe(100);
    expect(mod(1, false)).toBe(100);
  });

  it('onComputeStats with self conditions: +20 armor below 30 % HP while crowd controlled', () => {
    const { sim, me } = duel({ items: ['fx_fels'] });
    const armor = sim.c.Stats.armor[me]!;
    sim.c.Hp.cur[me] = sim.c.Hp.max[me]! * 0.2;
    step(sim);
    expect(sim.c.Stats.armor[me]).toBeCloseTo(armor);
    addBuff(sim, me, { kind: 'stun', id: 'probe', src: -1, ticks: 60 });
    step(sim);
    expect(sim.c.Stats.armor[me]).toBeCloseTo(armor + 20);
    steps(sim, 80);
    expect(sim.c.Stats.armor[me]).toBeCloseTo(armor);
  });
});

describe('more building blocks (items defined inline: JSON only, no engine code)', () => {
  const mk = (id: string, rules: unknown[], extra: Record<string, unknown> = {}) => ({
    id,
    name: { de: id, en: id },
    tier: 'basic',
    cost: 300,
    from: [],
    stats: {},
    tags: [],
    passive: { name: { de: `P ${id}`, en: `P ${id}` }, desc: { de: 'P', en: 'P' }, rules },
    ...extra,
  });
  const player = (slot: number, team: 0 | 1, champion: string) => ({ slot, team, champion, role: 'mid' as const, summoners: ['sprung', 'heilen'] as [string, string], isHuman: slot === 0, runes: { keystone: 'none', minor: ['none', 'none', 'none'] as [string, string, string] } });

  it('area effect around the hit unit scales with each unit\'s own HP (recipientMaxHp), damage source conditions', () => {
    const undo1 = registerItems([
      mk('fx_splash', [
        { on: 'onHit', if: { target: { kind: ['champion'] } }, do: [{ type: 'damage', to: 'enemiesInRadius', around: 'target', radius: 350, dmgType: 'true', value: { scale: { recipientMaxHp: 0.02 } } }] },
      ]),
      mk('fx_revenge', [
        { on: 'onDamageTaken', if: { source: { kind: ['champion'], team: 'enemy' } }, do: [{ type: 'applyBuff', to: 'source', kind: 'slow', id: 'fx_rev', pct: 25, seconds: 2 }] },
      ]),
    ]);
    try {
      const sim = makeSim({ players: [player(0, 0, 'mira'), player(5, 1, 'gorvam'), player(6, 1, 'mira')] });
      const [me, a, b] = [sim.slots[0]!, sim.slots[5]!, sim.slots[6]!];
      place(sim, me, CX, CY);
      place(sim, a, CX + 400, CY);
      place(sim, b, CX + 400, CY + 200);
      inventory(sim, me)[0] = 'fx_splash';
      inventory(sim, me)[1] = 'fx_revenge';
      steps(sim, 1);
      const ha = sim.c.Hp.cur[a]!;
      const hb = sim.c.Hp.cur[b]!;
      for (const h of passiveHooksOf(sim, me)) h.onAutoHit?.(sim, me, a, 10, { crit: false, overheal: 0 });
      expect(ha - sim.c.Hp.cur[a]!).toBeCloseTo(sim.c.Hp.max[a]! * 0.02, 6);
      expect(hb - sim.c.Hp.cur[b]!).toBeCloseTo(sim.c.Hp.max[b]! * 0.02, 6);
      expect(sim.c.Hp.max[a]).not.toBe(sim.c.Hp.max[b]); // different champions: each unit scaled with its own HP
      // being hit by an enemy champion slows it
      dealDamage(sim, a, me, 10, 'true');
      expect(buff(sim, a, 'fx_rev')?.pct).toBe(25);
      dealDamage(sim, -1, me, 10, 'true'); // environment: no source
    } finally {
      undo1();
    }
  });

  it('clearStack, self.levelAtLeast and self.hasBuff', () => {
    const undo1 = registerItems([
      mk('fx_stacker', [
        { on: 'onKill', do: [{ type: 'addStack', name: 'n', max: 5 }] },
        { on: 'onTakedown', do: [{ type: 'clearStack', name: 'n' }] },
        { on: 'onHit', if: { self: { levelAtLeast: 3, hasBuff: 'fx_marker' } }, do: [{ type: 'damage', to: 'target', dmgType: 'true', value: { scale: { stacks: { n: 10 } } } }] },
      ]),
    ]);
    try {
      const { sim, me, foe } = duel({ items: ['fx_stacker'] });
      const hit = (): number => {
        const before = sim.c.Hp.cur[foe]!;
        for (const h of passiveHooksOf(sim, me)) h.onAutoHit?.(sim, me, foe, 1, { crit: false, overheal: 0 });
        return before - sim.c.Hp.cur[foe]!;
      };
      for (let i = 0; i < 3; i++) kill(sim, spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY), me);
      expect(hit()).toBe(0); // level 1, no marker
      sim.c.Champ.level[me] = 3;
      expect(hit()).toBe(0); // no marker
      addBuff(sim, me, { kind: 'stat', stat: 'ad', id: 'fx_marker', src: me, pct: 1, ticks: 600 });
      expect(hit()).toBeCloseTo(30 * mitigation(0), 6); // true damage: 3 stacks x 10
      kill(sim, foe, me); // takedown clears the stacks
      sim.c.Hp.cur[foe] = sim.c.Hp.max[foe]!;
      sim.c.Unit.alive[foe] = 1;
      expect(hit()).toBe(0);
    } finally {
      undo1();
    }
  });
});

describe('consumable use', () => {
  it('Rachetrank: heal, mana and gold in one use, item spent', () => {
    const { sim, me } = duel({ items: ['fx_rachetrank', 'fx_rachetrank'] });
    const { Hp, Mana, Champ } = sim.c;
    Hp.cur[me] = 100;
    Mana.cur[me] = 10;
    const g = Champ.gold[me]!;
    use(sim, 0);
    expect(Hp.cur[me]).toBeCloseTo(150, 0);
    expect(Mana.cur[me]).toBeCloseTo(40, 0);
    expect(Champ.gold[me]! - g).toBe(10);
    expect(inventory(sim, me).slice(0, 2)).toEqual([null, 'fx_rachetrank']);
  });
});

// ------------------------------------------------------------------ unique / stacking / ownership rules

describe('unique passives, stacking and ownership limits', () => {
  it('a unique passive applies once: two copies of one item, or two items with the same key', () => {
    const run = (items: string[]): number => {
      const { sim, me, foe } = duel({ items });
      return magicHits(autos(sim, me, foe, 1));
    };
    const one = run(['fx_einzigartig_a']);
    const two = run(['fx_einzigartig_a', 'fx_einzigartig_a']);
    const mixed = run(['fx_einzigartig_a', 'fx_einzigartig_b']);
    expect([one, two, mixed]).toEqual([1, 1, 1]);
  });

  it('stats of both unique items still add up', () => {
    const { sim, me } = duel({ items: ['fx_einzigartig_a', 'fx_einzigartig_b'] });
    const base = duel();
    expect(sim.c.Stats.ap[me]! - base.sim.c.Stats.ap[base.me]!).toBe(10);
    expect(sim.c.Stats.ad[me]! - base.sim.c.Stats.ad[base.me]!).toBe(10);
  });

  it('stack: "stack" passives apply once per copy', () => {
    const run = (items: string[]): number => {
      const { sim, me, foe } = duel({ items });
      return magicHits(autos(sim, me, foe, 1));
    };
    expect([run(['fx_stapelring']), run(['fx_stapelring', 'fx_stapelring']), run(['fx_stapelring', 'fx_stapelring', 'fx_stapelring'])]).toEqual([1, 2, 3]);
  });

  it('maxOwned: two of Zweimal, legendaries stay at one, others unlimited', () => {
    const { sim, me } = duel();
    sim.c.Champ.gold[me] = 100000;
    const f = sim.map.sides[0]!.fountain;
    place(sim, me, f.x, f.y);
    expect(buyItem(sim, me, 'fx_zweimal')).toBe(true);
    expect(buyItem(sim, me, 'fx_zweimal')).toBe(true);
    expect(quote(sim, me, 'fx_zweimal').reason).toBe('unique');
    expect(buyItem(sim, me, 'fx_wundenklinge')).toBe(true);
    expect(quote(sim, me, 'fx_wundenklinge').reason).toBe('unique');
    expect(itemById('langschwert')!.maxOwned).toBeUndefined();
  });

  it('registerItems rejects duplicates and can be undone', () => {
    const extra = { ...fixture.items[2]!, id: 'fx_temp', passive: { ...fixture.items[2]!.passive!, name: { de: 'Temp', en: 'Temp' } } };
    const undoTemp = registerItems([extra]);
    expect(itemById('fx_temp')).toBeDefined();
    expect(() => registerItems([extra])).toThrow(/duplicate item id/);
    undoTemp();
    expect(itemById('fx_temp')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ cooldowns, charges, determinism

describe('rule cooldowns, charges and determinism', () => {
  const cdItem = (rule: Record<string, unknown>) => ({
    id: 'fx_cd',
    name: { de: 'CD', en: 'CD' },
    tier: 'basic',
    cost: 300,
    from: [],
    stats: {},
    tags: [],
    passive: { name: { de: 'P cd', en: 'P cd' }, desc: { de: 'P', en: 'P' }, rules: [{ on: 'onHit', do: [{ type: 'damage', to: 'target', dmgType: 'true', value: 7 }], ...rule }] },
  });

  it('cooldown: one proc per window; charges: spent per proc and regained after the regen time', () => {
    const undo1 = registerItems([cdItem({ cooldown: 2, charges: { max: 2, regenSeconds: 20 } })]);
    try {
      const { sim, me, foe } = duel({ items: ['fx_cd'] });
      const stop = (): void => step(sim, [{ slot: 0, cmd: { t: 'stop' } }]);
      const procs = (n: number): number => autos(sim, me, foe, n).filter((e) => e.type === 'true').length;
      expect(procs(2)).toBe(1); // second auto is inside the 2 s cooldown
      stop();
      steps(sim, sec(2.5));
      expect(procs(1)).toBe(1); // second charge
      stop();
      steps(sim, sec(3));
      expect(procs(1)).toBe(0); // out of charges, the first one is not back yet
      stop();
      steps(sim, sec(20));
      expect(procs(1)).toBe(1); // regained 20 s after the first spend
    } finally {
      undo1();
    }
  });

  it('same inputs with fixture items: same state hash', () => {
    const run = (): string => {
      const d = duel({ items: ['fx_titanspalter', 'fx_bollwerk', 'fx_ahnenkelch', 'fx_wundenklinge', 'fx_stapelring'], allies: [300] });
      autos(d.sim, d.me, d.foe, 3);
      dealDamage(d.sim, d.foe, d.me, d.sim.c.Hp.max[d.me]! * 0.3, 'true');
      abilityHit(d.sim, d.me, d.foe);
      kill(d.sim, d.foe, d.me);
      steps(d.sim, 200);
      return stateHash(d.sim);
    };
    expect(run()).toBe(run());
  });
});
