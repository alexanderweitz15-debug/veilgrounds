// Runtime validation of src/data/items.json (and of extra items in tests). Rejects unknown triggers, effects, conditions
// and keys (typos) with the JSON path and a "did you mean" hint. Runs at load (inventory.ts) and in tests/itemEngine.test.ts.
// Pure: no sim imports. The TS types are in schema.ts; this file is their runtime twin (kept in line by the tests).

import {
  ACTIVE_TARGETS, BUFF_KINDS, BUFF_STATS, EFFECT_TYPES, ITEM_STATS, ITEM_TAGS, ITEM_TIERS, RECIPIENTS, TARGET_KINDS, TRIGGERS,
  type ItemData, type Trigger,
} from './schema';

export class ItemFormatError extends Error {
  constructor(readonly errors: string[]) {
    super(`items.json: ${errors.length} error${errors.length === 1 ? '' : 's'}\n  ${errors.slice(0, 25).join('\n  ')}${errors.length > 25 ? `\n  ... and ${errors.length - 25} more` : ''}`);
    this.name = 'ItemFormatError';
  }
}

type Errs = string[];
type Chk = (v: unknown, p: string, e: Errs) => void;
interface Field {
  req?: boolean;
  chk: Chk;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function lev(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** `"x" (did you mean "y"?)` for a close candidate, else the full list. */
function hint(bad: string, valid: readonly string[]): string {
  let best = '';
  let bd = 99;
  for (const c of valid) {
    const d = lev(bad.toLowerCase(), c.toLowerCase());
    if (d < bd) (bd = d), (best = c);
  }
  return bd <= Math.max(2, Math.floor(bad.length / 3)) ? `did you mean "${best}"?` : `valid: ${valid.join(', ')}`;
}

// ------------------------------------------------------------------ primitives

const num: Chk = (v, p, e) => void (typeof v !== 'number' || !Number.isFinite(v) ? e.push(`${p}: expected a number, got ${JSON.stringify(v)}`) : undefined);
const numMin = (min: number): Chk => (v, p, e) => {
  num(v, p, e);
  if (typeof v === 'number' && v < min) e.push(`${p}: must be >= ${min}, got ${v}`);
};
const pos: Chk = (v, p, e) => {
  num(v, p, e);
  if (typeof v === 'number' && !(v > 0)) e.push(`${p}: must be > 0, got ${v}`);
};
const int: Chk = (v, p, e) => void (!Number.isInteger(v) ? e.push(`${p}: expected an integer, got ${JSON.stringify(v)}`) : undefined);
const posInt: Chk = (v, p, e) => {
  int(v, p, e);
  if (typeof v === 'number' && v < 1) e.push(`${p}: must be >= 1, got ${v}`);
};
const str: Chk = (v, p, e) => void (typeof v !== 'string' || v === '' ? e.push(`${p}: expected a non-empty string, got ${JSON.stringify(v)}`) : undefined);
const bool: Chk = (v, p, e) => void (typeof v !== 'boolean' ? e.push(`${p}: expected true or false, got ${JSON.stringify(v)}`) : undefined);
const oneOf =
  (list: readonly string[], what: string): Chk =>
  (v, p, e) =>
    void (typeof v !== 'string' || !list.includes(v) ? e.push(`${p}: unknown ${what} ${JSON.stringify(v)} (${hint(String(v), list)})`) : undefined);
const arrOf =
  (item: Chk, nonEmpty = false): Chk =>
  (v, p, e) => {
    if (!Array.isArray(v)) return e.push(`${p}: expected a list`);
    if (nonEmpty && v.length === 0) e.push(`${p}: must not be empty`);
    v.forEach((x, i) => item(x, `${p}[${i}]`, e));
  };
const recordOf =
  (item: Chk): Chk =>
  (v, p, e) => {
    if (!isObj(v)) return e.push(`${p}: expected an object`);
    for (const [k, x] of Object.entries(v)) item(x, `${p}.${k}`, e);
  };

/** Object with a fixed key set: unknown keys are errors, `req` keys must exist. */
function obj(fields: Record<string, Field>): Chk {
  const keys = Object.keys(fields);
  return (v, p, e) => {
    if (!isObj(v)) return e.push(`${p}: expected an object`);
    for (const k of Object.keys(v)) if (!fields[k]) e.push(`${p}.${k}: unknown key (${hint(k, keys)})`);
    for (const [k, f] of Object.entries(fields)) {
      if (v[k] === undefined) {
        if (f.req) e.push(`${p}.${k}: missing`);
      } else f.chk(v[k], `${p}.${k}`, e);
    }
  };
}
const R = (chk: Chk): Field => ({ req: true, chk });
const O = (chk: Chk): Field => ({ chk });

const l10n = obj({ de: R(str), en: R(str) });

// ------------------------------------------------------------------ values, conditions

const scaleKeys = ['ap', 'ad', 'bonusAd', 'armor', 'mr', 'maxHp', 'curHp', 'missingHp', 'targetMaxHp', 'targetCurHp', 'targetMissingHp', 'recipientMaxHp', 'recipientCurHp', 'recipientMissingHp', 'damage', 'overheal'];
const valueScale = obj({
  ...Object.fromEntries(scaleKeys.map((k) => [k, O(num)])),
  stacks: O(recordOf(num)),
});
const valueObj = obj({ base: O(num), perLevel: O(num), scale: O(valueScale), min: O(num), max: O(num) });
const value: Chk = (v, p, e) => (typeof v === 'number' ? num(v, p, e) : isObj(v) ? valueObj(v, p, e) : void e.push(`${p}: expected a number or a value object { base, perLevel, scale, min, max }, got ${JSON.stringify(v)}`));

const unitCond = obj({
  kind: O(arrOf(oneOf(TARGET_KINDS, 'unit kind'), true)),
  notKind: O(arrOf(oneOf(TARGET_KINDS, 'unit kind'), true)),
  team: O(oneOf(['enemy', 'ally'], 'team')),
  hpBelowPct: O(numMin(0)),
  hpAbovePct: O(numMin(0)),
  hasBuff: O(str),
});
const selfCond = obj({
  hpBelowPct: O(numMin(0)),
  hpAbovePct: O(numMin(0)),
  attack: O(oneOf(['melee', 'ranged'], 'attack type')),
  alive: O(bool),
  crowdControlled: O(bool),
  hasBuff: O(str),
  levelAtLeast: O(posInt),
});
const COND_KEYS: Record<string, Field> = {
  target: O(unitCond),
  source: O(unitCond),
  self: O(selfCond),
  crit: O(bool),
  overheal: O(bool),
  damageType: O(arrOf(oneOf(['phys', 'magic', 'true'], 'damage type'), true)),
  isAuto: O(bool),
  damageTakenPctMaxHp: O(pos),
  inCombatSeconds: O(pos),
  everyTicks: O(posInt),
  beforeSeconds: O(pos),
  afterSeconds: O(pos),
  castSlot: O(arrOf((x, q, ee) => void (![0, 1, 2, 3].includes(x as number) ? ee.push(`${q}: ability slot must be 0..3`) : undefined), true)),
  stacksAtLeast: O(recordOf(posInt)),
};
const cond = obj(COND_KEYS);

/** Which triggers a condition key is meaningful for (undefined = all). */
const COND_ONLY: Record<string, Trigger[]> = {
  crit: ['onHit'],
  overheal: ['onHit'],
  castSlot: ['onCast', 'onAbilityHit'],
  damageTakenPctMaxHp: ['onDamageTaken', 'onShieldBreak'],
  source: ['onDamageTaken', 'onShieldBreak'],
  damageType: ['onDamageTaken', 'modifyDamage'],
  isAuto: ['onDamageTaken', 'modifyDamage'],
  target: ['onHit', 'onAbilityHit', 'onKill', 'onTakedown', 'modifyDamage', 'modifyHeal'],
};
/** Triggers whose context has a target / a source unit. */
const HAS_TARGET: Trigger[] = ['onHit', 'onAbilityHit', 'onKill', 'onTakedown', 'modifyDamage', 'modifyHeal'];
const HAS_SOURCE: Trigger[] = ['onDamageTaken', 'onShieldBreak'];

// ------------------------------------------------------------------ effects

const timedOk = (eff: Record<string, unknown>, p: string, e: Errs, need: boolean): void => {
  const has = [eff.seconds, eff.ticks].filter((x) => x !== undefined).length;
  if (has > 1) e.push(`${p}: give either seconds or ticks, not both`);
  if (has === 0 && need) e.push(`${p}: missing duration (seconds or ticks)`);
};

const timed = { seconds: O(pos), ticks: O(posInt) };
const aim = { to: R(oneOf(RECIPIENTS, 'recipient')), radius: O(pos), range: O(pos), around: O(oneOf(['self', 'target'], 'center')) };
const dmgType = oneOf(['phys', 'magic', 'true'], 'damage type');

const EFFECTS: Record<(typeof EFFECT_TYPES)[number], Chk> = {
  damage: obj({ type: R(str), ...aim, dmgType: R(dmgType), value: R(value) }),
  heal: obj({ type: R(str), ...aim, value: R(value), perSeconds: O(pos) }),
  shield: obj({ type: R(str), ...aim, ...timed, value: R(value), id: R(str), healPower: O(bool), accumulate: O(bool), cap: O(value) }),
  applyBuff: obj({
    type: R(str), ...aim, ...timed, kind: R(oneOf(BUFF_KINDS, 'buff kind')), id: R(str), stat: O(oneOf(BUFF_STATS, 'buff stat')), pct: O(num), flat: O(num),
    stacks: O(obj({ max: R(posInt) })), damage: O(value), dmgType: O(dmgType), period: O(pos), uncleansable: O(bool),
  }),
  cleanse: obj({
    type: R(str), ...aim,
    kinds: O(arrOf(oneOf(['slow', 'blind', 'root', 'silence', 'stun', 'fear', 'grievous'], 'crowd-control kind'), true)),
    ids: O(arrOf(str, true)),
  }),
  restoreMana: obj({ type: R(str), value: R(value) }),
  gold: obj({ type: R(str), ...aim, amount: R(pos), counter: O(str) }),
  absorbDamage: obj({ type: R(str), value: R(value), rechargeSeconds: O(pos) }),
  healOverTime: obj({ type: R(str), ...timed, value: R(value), pool: O(str) }),
  addStack: obj({ type: R(str), ...timed, name: R(str), amount: O(posInt), max: R(posInt) }),
  clearStack: obj({ type: R(str), name: R(str) }),
  damageMult: obj({ type: R(str), mult: R(pos) }),
  healMult: obj({ type: R(str), mult: R(pos) }),
  statMult: obj({ type: R(str), stat: R(oneOf(['ad', 'ap', 'armor', 'mr', 'as', 'ms'], 'stat')), mult: R(pos) }),
  statAdd: obj({ type: R(str), stat: R(oneOf(['ad', 'ap', 'armor', 'mr', 'as', 'ms', 'range', 'tenacity'], 'stat')), value: R(value) }),
  stopMovement: obj({ type: R(str) }),
  placeSealWard: obj({ type: R(str) }),
};

/** Effect types that only make sense in one trigger kind. */
const EFFECT_ONLY: Record<string, Trigger[]> = {
  damageMult: ['modifyDamage'],
  healMult: ['modifyHeal'],
  statMult: ['onComputeStats'],
  statAdd: ['onComputeStats'],
  absorbDamage: ['onDamageTaken'],
};
const MODIFIER_TRIGGERS: Trigger[] = ['modifyDamage', 'modifyHeal', 'onComputeStats'];
/** Effects that name a recipient (`to`). */
const AIMED = new Set(['damage', 'heal', 'shield', 'applyBuff', 'cleanse', 'gold']);

interface Where {
  /** Triggers of the enclosing rule; empty for actives / uses. */
  triggers: Trigger[];
  /** Recipient context for actives: does it have a picked unit? */
  hasTarget: boolean;
  hasSource: boolean;
}

function effect(v: unknown, p: string, e: Errs, w: Where): void {
  if (!isObj(v)) return void e.push(`${p}: expected an object`);
  const type = v.type;
  if (typeof type !== 'string' || !(type in EFFECTS)) return void e.push(`${p}.type: unknown effect ${JSON.stringify(type)} (${hint(String(type), EFFECT_TYPES)})`);
  EFFECTS[type as keyof typeof EFFECTS](v, p, e);
  const only = EFFECT_ONLY[type];
  if (only) {
    if (w.triggers.length === 0) e.push(`${p}: effect "${type}" is only allowed in a ${only.join('/')} rule`);
    else for (const t of w.triggers) if (!only.includes(t)) e.push(`${p}: effect "${type}" is only allowed in a ${only.join('/')} rule, not ${t}`);
  } else if (w.triggers.some((t) => MODIFIER_TRIGGERS.includes(t))) {
    e.push(`${p}: ${w.triggers.filter((t) => MODIFIER_TRIGGERS.includes(t)).join('/')} rules take only ${Object.entries(EFFECT_ONLY).filter(([, ts]) => ts.some((t) => w.triggers.includes(t))).map(([k]) => k).join('/')} effects, not "${type}"`);
  }
  if (AIMED.has(type) && typeof v.to === 'string') {
    const to = v.to;
    const trig = w.triggers.length ? w.triggers : null;
    if (to === 'target' && (trig ? !trig.every((t) => HAS_TARGET.includes(t)) : !w.hasTarget)) e.push(`${p}.to: "target" has no meaning here (${trig ? trig.join('/') + ' has no target unit' : 'the active has no target unit'})`);
    if (to === 'source' && (trig ? !trig.every((t) => HAS_SOURCE.includes(t)) : true)) e.push(`${p}.to: "source" is only available in ${HAS_SOURCE.join('/')}`);
    if ((to === 'alliesInRadius' || to === 'enemiesInRadius') && v.radius === undefined) e.push(`${p}.radius: required for "${to}"`);
    if (to === 'nearestAlly' && v.range === undefined) e.push(`${p}.range: required for "nearestAlly"`);
    if (v.around === 'target' && (trig ? !trig.every((t) => HAS_TARGET.includes(t)) : !w.hasTarget)) e.push(`${p}.around: "target" has no meaning here`);
  }
  if (type === 'shield' || type === 'applyBuff' || type === 'healOverTime') timedOk(v, p, e, true);
  if (type === 'addStack') timedOk(v, p, e, false);
  if (type === 'applyBuff') {
    const kind = v.kind;
    if (kind === 'stat') {
      if (v.stat === undefined) e.push(`${p}.stat: required for kind "stat"`);
      if (v.pct === undefined && v.flat === undefined) e.push(`${p}: kind "stat" needs pct or flat`);
    } else if (v.stat !== undefined) e.push(`${p}.stat: only for kind "stat"`);
    if ((kind === 'slow' || kind === 'grievous') && typeof v.pct !== 'number') e.push(`${p}.pct: required for kind "${String(kind)}"`);
    if (kind === 'dot') {
      for (const k of ['damage', 'period', 'dmgType']) if (v[k] === undefined) e.push(`${p}.${k}: required for kind "dot"`);
    } else for (const k of ['damage', 'period', 'dmgType']) if (v[k] !== undefined) e.push(`${p}.${k}: only for kind "dot"`);
    if (v.stacks && !(kind === 'stat' && typeof v.pct === 'number')) e.push(`${p}.stacks: only for kind "stat" with pct`);
    if (kind !== 'stat' && kind !== 'slow' && kind !== 'grievous' && (v.pct !== undefined || v.flat !== undefined)) e.push(`${p}: pct/flat do not apply to kind "${String(kind)}"`);
  }
  if (type === 'shield' && v.cap !== undefined && v.accumulate !== true) e.push(`${p}.cap: needs accumulate: true`);
}

// ------------------------------------------------------------------ rules, passive, active

function rule(v: unknown, p: string, e: Errs): void {
  const base = obj({
    on: R((x, q, ee) => {
      const list = Array.isArray(x) ? x : [x];
      if (list.length === 0) ee.push(`${q}: must not be empty`);
      list.forEach((t, i) => oneOf(TRIGGERS, 'trigger')(t, Array.isArray(x) ? `${q}[${i}]` : q, ee));
    }),
    if: O(cond),
    cooldown: O(pos),
    charges: O(obj({ max: R(posInt), regenSeconds: R(pos) })),
    do: R(arrOf(() => undefined, true)),
  });
  base(v, p, e);
  if (!isObj(v)) return;
  const on = (Array.isArray(v.on) ? v.on : [v.on]).filter((t): t is Trigger => typeof t === 'string' && (TRIGGERS as readonly string[]).includes(t));
  if (isObj(v.if)) {
    for (const k of Object.keys(v.if)) {
      const only = COND_ONLY[k];
      if (only && on.length && !on.every((t) => only.includes(t))) e.push(`${p}.if.${k}: only meaningful for ${only.join('/')}, the rule triggers on ${on.join('/')}`);
    }
  }
  const mod = on.filter((t) => MODIFIER_TRIGGERS.includes(t));
  if (mod.length && (v.cooldown !== undefined || v.charges !== undefined)) e.push(`${p}: cooldown/charges are not allowed on ${mod.join('/')} rules (modifiers run many times per tick)`);
  if (mod.length && on.length > 1) e.push(`${p}.on: ${mod.join('/')} cannot be combined with other triggers`);
  if (Array.isArray(v.do)) {
    const w: Where = { triggers: on, hasTarget: false, hasSource: false };
    v.do.forEach((x, i) => effect(x, `${p}.do[${i}]`, e, w));
    if (v.do.filter((x) => isObj(x) && x.type === 'absorbDamage').length > 1) e.push(`${p}.do: at most one absorbDamage per rule`);
  }
}

const useBase = {
  target: R(oneOf(ACTIVE_TARGETS, 'target type')),
  range: O(pos),
  requires: O(arrOf(oneOf(['canAttack'], 'requirement'))),
  effects: R(arrOf(() => undefined, true)),
};
function useChecks(v: unknown, p: string, e: Errs): void {
  if (!isObj(v)) return;
  const w: Where = { triggers: [], hasTarget: v.target === 'allyChampion' || v.target === 'enemyChampion', hasSource: false };
  if (Array.isArray(v.effects)) v.effects.forEach((x, i) => effect(x, `${p}.effects[${i}]`, e, w));
  if ((v.target === 'allyChampion' || v.target === 'enemyChampion') && v.range === undefined) e.push(`${p}.range: required for target "${String(v.target)}"`);
  if ((v.target === 'self' || v.target === 'point') && v.range !== undefined) e.push(`${p}.range: only for unit targets`);
}

const passive = obj({
  name: R(l10n),
  desc: R(l10n),
  key: O(str),
  stack: O(oneOf(['unique', 'stack'], 'stack mode')),
  rules: O(arrOf(() => undefined, true)),
  laneMinionGold: O(obj({ mult: R(pos), untilSeconds: R(pos) })),
  quest: O(obj({ counter: R(str), goal: R(pos) })),
});
const active = obj({ name: R(l10n), desc: R(l10n), cooldown: R(pos), ...useBase });
const useData = obj(useBase);

const statsObj: Chk = (v, p, e) => {
  if (!isObj(v)) return e.push(`${p}: expected an object`);
  for (const [k, x] of Object.entries(v)) {
    if (!(ITEM_STATS as readonly string[]).includes(k)) e.push(`${p}.${k}: unknown stat (${hint(k, ITEM_STATS)})`);
    else num(x, `${p}.${k}`, e);
  }
};

const item = obj({
  id: R(str),
  name: R(l10n),
  tier: R(oneOf(ITEM_TIERS, 'tier')),
  cost: R(numMin(0)),
  from: R(arrOf(str)),
  stats: R(statsObj),
  passive: O(passive),
  active: O(active),
  use: O(useData),
  tags: R(arrOf(oneOf(ITEM_TAGS, 'tag'))),
  unique: O(str),
  maxOwned: O(posInt),
});

/** Validates one raw item; `at` names it in error paths. */
function checkItem(raw: unknown, at: string, e: Errs): void {
  item(raw, at, e);
  if (!isObj(raw)) return;
  if (isObj(raw.passive)) {
    const ps = raw.passive;
    if (Array.isArray(ps.rules)) ps.rules.forEach((r, i) => rule(r, `${at}.passive.rules[${i}]`, e));
    if (isObj(ps.quest)) {
      const counters = new Set<string>();
      for (const r of Array.isArray(ps.rules) ? ps.rules : []) for (const x of isObj(r) && Array.isArray(r.do) ? r.do : []) if (isObj(x) && x.type === 'gold' && typeof x.counter === 'string') counters.add(x.counter);
      if (typeof ps.quest.counter === 'string' && !counters.has(ps.quest.counter)) e.push(`${at}.passive.quest.counter: no gold effect of this passive feeds counter "${ps.quest.counter}"`);
    }
  }
  if (isObj(raw.active)) useChecks(raw.active, `${at}.active`, e);
  if (isObj(raw.use)) {
    useChecks(raw.use, `${at}.use`, e);
    if (raw.tier !== 'consumable') e.push(`${at}.use: only items of tier "consumable" have a use`);
  }
  if (raw.tier === 'consumable' && !raw.use) e.push(`${at}.use: consumables need a use block`);
  if (raw.tier === 'consumable' && raw.active) e.push(`${at}.active: consumables have a use, not an active`);
}

/**
 * Validates a list of raw items (the `items` array of items.json) against each other and against `known` ids (items
 * already loaded, for recipes). Returns the typed list or throws ItemFormatError listing every problem.
 */
export function validateItems(raw: unknown, known: readonly Pick<ItemData, 'id' | 'passive'>[] = []): ItemData[] {
  const e: Errs = [];
  if (!Array.isArray(raw)) throw new ItemFormatError(['items: expected a list']);
  const ids = new Set<string>(known.map((k) => k.id));
  const mine = new Set<string>();
  raw.forEach((it, i) => {
    const id = isObj(it) && typeof it.id === 'string' ? it.id : `#${i}`;
    checkItem(it, `items[${id}]`, e);
    if (isObj(it) && typeof it.id === 'string') {
      if (ids.has(it.id)) e.push(`items[${id}].id: duplicate item id`);
      ids.add(it.id);
      mine.add(it.id);
    }
  });
  for (const it of raw) {
    if (!isObj(it) || typeof it.id !== 'string' || !Array.isArray(it.from)) continue;
    for (const f of it.from) if (typeof f === 'string' && !ids.has(f)) e.push(`items[${it.id}].from: unknown item "${f}" (${hint(f, [...ids])})`);
  }
  // unique passive names (LoL): passives with the same name are one unique passive, so they must share a key
  const named = new Map<string, { id: string; key: string }>();
  const nameKey = (lang: 'de' | 'en', name: string): string => `${lang}:${name.toLowerCase()}`;
  for (const k of known) {
    const ps = k.passive;
    if (ps?.rules?.length) for (const lang of ['de', 'en'] as const) named.set(nameKey(lang, ps.name[lang]), { id: k.id, key: ps.key ?? k.id });
  }
  for (const it of raw) {
    if (!isObj(it) || typeof it.id !== 'string' || !isObj(it.passive) || !Array.isArray(it.passive.rules) || !it.passive.rules.length || !isObj(it.passive.name)) continue;
    const key = typeof it.passive.key === 'string' ? it.passive.key : it.id;
    for (const lang of ['de', 'en'] as const) {
      const name = it.passive.name[lang];
      if (typeof name !== 'string') continue;
      const other = named.get(nameKey(lang, name));
      if (other && other.key !== key) e.push(`items[${it.id}].passive.name.${lang}: passive name "${name}" is also used by item "${other.id}" with another key; items with the same passive name are one unique passive and must share \`passive.key\` (or get different names)`);
      else if (!other) named.set(nameKey(lang, name), { id: it.id, key });
    }
  }
  if (e.length) throw new ItemFormatError(e);
  return raw as ItemData[];
}

/** Validates the whole items.json document (`{ items: [...] }`). */
export function validateItemsDocument(doc: unknown): ItemData[] {
  if (!isObj(doc) || !('items' in doc)) throw new ItemFormatError(['document: expected { "items": [...] }']);
  return validateItems(doc.items);
}
