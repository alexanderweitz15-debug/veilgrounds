// Characterization trace of the item system (A7, item engine migration). One universal combat script runs for every
// item (alone, doubled, and in sets); every number it produces (damage events, HP/shield/mana/gold, buffs, cooldown HUD)
// is recorded exactly. tests/fixtures/itemsGolden.json was generated from the code-hook implementation BEFORE the
// data-driven engine replaced it; tests/itemEngine.golden.test.ts requires the new engine to reproduce it bit-exactly.
// Regenerate (only after an intended balance/base-stat change): UPDATE_GOLDEN=1 npx vitest run tests/itemEngine.golden
// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { CX, CY, place } from './combat-helpers';
import { step, type Sim } from '../src/sim/sim';
import { Kind, type Command } from '../src/sim/types';
import { dealDamage, kill } from '../src/sim/damage';
import { buffs } from '../src/sim/buffs';
import { spawnMinion } from '../src/sim/systems/minions';
import { passiveHooksOf } from '../src/sim/champions';
import { ITEMS, buyItem, inventory, quote } from '../src/sim/items/inventory';
import { givingLampQuestDone, minionGoldMult, stormMantleLeft } from '../src/sim/items/itemHooks';
import { buildSnapshot } from '../src/sim/snapshot';
import { abilityHit, duel } from './itemHelpers';

type Row = (number | string | boolean | null)[];

const STAT_FIELDS = ['ad', 'bonusAd', 'ap', 'armor', 'mr', 'as', 'range', 'ms', 'crit', 'lethality', 'armorPenPct', 'magicPen', 'lifesteal', 'haste', 'tenacity'] as const;

function stats(sim: Sim, e: number): number[] {
  const { Stats, Hp, Mana } = sim.c;
  return [...STAT_FIELDS.map((f) => Stats[f][e]!), Hp.max[e]!, Hp.regen[e]!, Mana.max[e]!, Mana.regen[e]!];
}

/** Stats of every item alone in a duel (bonus stats, passives that rewrite stats). */
export function statsTrace(only?: ReadonlySet<string>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const it of ITEMS) {
    if (only && !only.has(it.id)) continue;
    const { sim, me } = duel({ items: [it.id] });
    out[it.id] = stats(sim, me);
  }
  return out;
}

class Script {
  readonly log: Row[] = [];
  private t0: number;
  private sig = new Map<number, string>();
  constructor(
    readonly sim: Sim,
    readonly me: number,
    readonly foe: number,
    readonly ally: number,
  ) {
    this.t0 = sim.tick;
  }
  private who(e: number): string {
    return e === this.me ? 'me' : e === this.foe ? 'foe' : e === this.ally ? 'ally' : e < 0 ? 'env' : `e${e}`;
  }
  /** Advances n ticks (first with `cmds`), logging damage and gold events. */
  adv(n: number, cmds: Command[] = []): void {
    const { sim } = this;
    for (let i = 0; i < n; i++) {
      step(sim, i === 0 ? cmds.map((cmd) => ({ slot: 0, cmd })) : []);
      for (const ev of sim.events) {
        if (ev.e === 'damage') this.log.push(['dmg', sim.tick - this.t0, this.who(ev.src), this.who(ev.dst), ev.amount, ev.type, !!ev.crit]);
        else if (ev.e === 'gold') this.log.push(['gold', sim.tick - this.t0, this.who(ev.eid), ev.amount]);
        else if (ev.e === 'castFail') this.log.push(['castFail', sim.tick - this.t0, ev.slot, ev.reason]);
      }
      // buff set changes (application, refresh with new values, expiry), exact ticks
      for (const e of [this.me, this.foe, this.ally]) {
        const sg = buffs(sim, e)
          .filter((b) => b.until > sim.tick)
          .map((b) => `${b.kind}/${b.id}/${b.stat ?? ''}/${b.pct}/${b.flat}/${b.amount}/${b.until - sim.tick > 1 ? 'x' : 'last'}`)
          .join(' ');
        if (sg !== (this.sig.get(e) ?? '')) {
          this.sig.set(e, sg);
          this.log.push(['buffchg', sim.tick - this.t0, this.who(e), sg]);
        }
      }
    }
  }
  /** Direct (out-of-step) damage; events of this call are not in sim.events yet, so log the return value. */
  hit(src: number, dst: number, amount: number, type: 'phys' | 'magic' | 'true'): void {
    const hp = this.sim.c.Hp.cur[dst]!;
    const dealt = dealDamage(this.sim, src, dst, amount, type);
    this.log.push(['hit', this.sim.tick - this.t0, this.who(src), this.who(dst), amount, type, dealt, hp - this.sim.c.Hp.cur[dst]!]);
  }
  snap(label: string): void {
    const { sim, me, foe, ally } = this;
    const { Hp, Mana, Champ } = sim.c;
    const row: Row = [label, sim.tick - this.t0];
    for (const e of [me, foe, ally]) row.push(Hp.cur[e]!, Hp.max[e]!, Hp.shield[e]!);
    row.push(Mana.cur[me]!, Mana.max[me]!, Champ.gold[me]!, Champ.gold[ally]!, ...stats(sim, me), ...stats(sim, foe).slice(0, 8));
    this.log.push(row);
    for (const e of [me, foe, ally]) {
      const bs = buffs(sim, e)
        .filter((b) => b.until > sim.tick)
        .map((b): Row => [b.kind, b.id, b.stat ?? '', b.pct, b.flat, b.amount, b.until - sim.tick, b.period, b.src === me ? 'me' : b.src === foe ? 'foe' : b.src === ally ? 'ally' : String(b.src)]);
      this.log.push(['buffs', label, this.who(e), JSON.stringify(bs)]);
    }
  }
}

/**
 * The universal script: crit autos, ability hits, damage taken (magic, physical), last hits (minion, monster), execute
 * range, ability heals, item use (slots 0 and 1), ticking at low HP in and out of combat.
 */
export function scriptTrace(items: string[], champ: string): Row[] {
  const melee = champ === 'gorvam';
  const d = duel({ champ, items, allies: [300] });
  const { sim, me, foe } = d;
  const ally = d.allies[0]!;
  const { Hp, Stats } = sim.c;
  const s = new Script(sim, me, foe, ally);
  if (melee) place(sim, foe, CX + 150, CY);
  s.snap('start');
  // 1. crit autos (the tick the command is sent counts as first of 200)
  Stats.crit[me] = 1;
  s.adv(50, [{ t: 'attack', target: foe }]);
  s.snap('autos50');
  s.adv(150);
  s.snap('autos');
  // 2. ability resolutions (fire onAbilityHit), spaced like real casts
  for (let i = 0; i < 4; i++) {
    const evs = abilityHit(sim, me, foe);
    s.log.push(['abilityHit', i, ...evs.flatMap((e) => [e.amount, e.type])]);
    s.snap(`ability${i}`);
    s.adv(i === 3 ? 100 : 5);
  }
  s.snap('abilities');
  // 3. damage taken: magic, physical, a big hit (shield/absorb thresholds), true
  s.hit(foe, me, 100, 'magic');
  s.hit(foe, me, 100, 'phys');
  s.hit(foe, me, 400, 'magic');
  s.hit(foe, me, 30, 'true');
  s.snap('taken');
  // 4. last hits
  const m = spawnMinion(sim, Kind.MinionMelee, 1, 0, CX + 200, CY);
  const g0 = sim.c.Champ.gold[me]!;
  Hp.cur[me] = Math.max(1, Hp.cur[me]! - 50);
  sim.c.Mana.cur[me] = Math.max(0, sim.c.Mana.cur[me]! - 100);
  kill(sim, m, me);
  s.log.push(['minionKill', sim.c.Champ.gold[me]! - g0, minionGoldMult(sim, me), sim.c.Mana.cur[me]!]);
  const mon = spawnMinion(sim, Kind.MinionMelee, 2, 0, CX + 220, CY);
  sim.c.Unit.kind[mon] = Kind.Monster;
  Hp.max[mon] = Hp.cur[mon] = 3000;
  s.hit(me, mon, 100, 'true');
  s.hit(me, mon, 100, 'phys');
  s.snap('lasthits');
  // 5. execute range and heal power
  Hp.cur[foe] = Hp.max[foe]! * 0.3;
  s.hit(me, foe, 100, 'true');
  s.hit(me, foe, 100, 'phys');
  Hp.cur[foe] = Hp.max[foe]!;
  let a = 100;
  for (const h of passiveHooksOf(sim, me)) if (h.modifyHeal) a = h.modifyHeal(sim, me, ally, a);
  s.log.push(['healPower', a]);
  // 6. item use
  Hp.cur[me] = Math.max(1, Hp.max[me]! * 0.4);
  for (const slot of [0, 1, 0]) {
    s.adv(1, [{ t: 'item', slot } as Command]);
    const hud = buildSnapshot(sim, 0, 0).me!.itemCds.map((c) => [c.left, c.total]);
    s.log.push(['use', slot, JSON.stringify(hud), JSON.stringify(inventory(sim, me).slice(0, 6))]);
  }
  s.snap('used');
  // 7. in combat, low HP: tick through regen/DoT/aura upkeep, then out of combat
  s.hit(foe, me, 1, 'true');
  for (let i = 0; i < 6; i++) {
    s.adv(10);
    s.snap(`combat${i}`);
  }
  s.adv(400);
  s.snap('calm');
  s.log.push(['misc', stormMantleLeft(sim, me), givingLampQuestDone(sim, me), minionGoldMult(sim, me)]);
  return s.log;
}

const SETS: Record<string, string[]> = {
  tank: ['wallherz', 'sturmgewand', 'lebenswurzel', 'hueterstab', 'zeitglas', 'kettenrelais'],
  adc: ['sturmbogen', 'blutkrone', 'scharfrichterbeil', 'schwarze_kette', 'trank', 'trank'],
  mage: ['schleierstab', 'frostkern', 'brandglas', 'funkenkelch', 'hueterlampe', 'zauberring'],
  mix: ['spenderlampe', 'jaegerzahn', 'dornenklinge', 'stiefel_hast', 'siegelward', 'kettenrelais'],
};

/** Shop rules: buy results (reasons, prices) for double legendaries, unique groups, full inventory. */
export function shopTrace(): Row[] {
  const out: Row[] = [];
  const { sim, me } = duel();
  sim.c.Champ.gold[me] = 100000;
  const f = sim.map.sides[0]!.fountain;
  place(sim, me, f.x, f.y);
  const seq = [
    'langschwert', 'spitzhacke', 'sturmbogen', 'sturmbogen', 'kurzschwert', 'zauberring', 'stiefel', 'stiefel_ruestung', 'trank', 'trank',
    'zeitglas', 'zeitglas', 'kettenrelais', 'blutdolch', 'langschwert', 'siegelward',
  ];
  for (const id of seq) {
    const q = quote(sim, me, id);
    const gold = sim.c.Champ.gold[me]!;
    out.push([id, q.ok, q.reason ?? '', q.price, JSON.stringify(q.consumes), buyItem(sim, me, id), gold - sim.c.Champ.gold[me]!]);
  }
  out.push(['inv', JSON.stringify(inventory(sim, me))]);
  return out;
}

/** `only`: item ids to trace (the fixture's; items added after the fixture was made are not pinned). */
export function goldenTrace(only?: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = { stats: statsTrace(only), shop: shopTrace() };
  const script: Record<string, Row[]> = {};
  for (const it of ITEMS) {
    if (only && !only.has(it.id)) continue;
    const special = it.passive || it.active;
    script[`${it.id}:mira`] = scriptTrace([it.id], 'mira');
    if (special) script[`${it.id}:gorvam`] = scriptTrace([it.id], 'gorvam');
    if (special && it.tier === 'legendary') script[`${it.id}x2:mira`] = scriptTrace([it.id, it.id], 'mira');
  }
  for (const [k, set] of Object.entries(SETS)) {
    script[`set:${k}:mira`] = scriptTrace(set, 'mira');
    script[`set:${k}:gorvam`] = scriptTrace(set, 'gorvam');
  }
  out.script = script;
  return out;
}
