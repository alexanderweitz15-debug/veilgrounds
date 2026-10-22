// Runtime validation for champion JSON (src/data/champions/<id>.json) against src/sim/champions/schema.ts.
// tsc only sees widened JSON types (string literals become string, tuples become arrays), so enum values,
// tuple lengths, rank-array lengths and unknown keys are checked here. Used by the loader (index.ts) and tests.
import type { ChampionData, Role } from '../../sim/champions/schema';
import { PLAYSTYLE_AXES } from '../../ai/contract';

/** Deep-widened view of a schema type, matching what resolveJsonModule infers for a JSON file. */
export type Json<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? Json<U>[]
        : T extends object
          ? { [K in keyof T]: Json<T[K]> }
          : T;

export const ROLES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
export const ABILITY_TYPES = [
  'skillshot_line',
  'skillshot_circle',
  'cone',
  'targeted',
  'self',
  'dash',
  'blink',
  'zone',
  'summon',
] as const;
export const COMBO_TOKENS = ['Q', 'W', 'E', 'R', 'AA', 'FLASH'] as const;
const FLAGS = ['blocked_by_minions', 'pierce', 'unstoppable', 'recast', 'ground_target', 'ally_target', 'auto_reset', 'channel', 'mobility', 'stealth', 'root_ok'];
const COST_TYPES = ['mana', 'energy', 'hp', 'none'];
const RESOURCES = ['mana', 'energy', 'none'];
const TARGETS = ['hit', 'self', 'ally', 'allies', 'enemies'];
const BUFF_STATS = ['as', 'ms', 'ad', 'ap', 'armor', 'mr', 'dmgReduction', 'tenacity', 'invisible', 'untargetable', 'range', 'armorPen', 'projImmune'];
const VOICE_KEYS = ['pick', 'firstBlood', 'kill', 'death', 'recall', 'taunt'];
const SCORE_KEYS = ['engage', 'peel', 'range', 'scaling', 'waveclear', 'mobility'];

const TOP_KEYS = [
  'id', 'name', 'title', 'roles', 'archetype', 'trainingPurpose', 'attackType', 'resource', 'base', 'passive',
  'abilities', 'spikeLevels', 'spikeNote', 'maxOrder', 'combos', 'scores', 'voiceLines', 'silhouette',
];
/** Optional top-level keys (spec-bots §2 champion bias for rolled bot playstyles). */
const OPTIONAL_TOP_KEYS = ['botBias', 'ultChoices', 'botUltChoice'];
const BASE_KEYS = [
  'hp', 'hpGrowth', 'hpRegen', 'hpRegenGrowth', 'mana', 'manaGrowth', 'manaRegen', 'manaRegenGrowth', 'ad', 'adGrowth',
  'armor', 'armorGrowth', 'mr', 'mrGrowth', 'as', 'asGrowth', 'range', 'ms', 'windup', 'radius',
];
const ABILITY_REQUIRED = ['id', 'name', 'desc', 'type', 'castTime', 'movesWhileCasting', 'range', 'cooldown', 'cost', 'costType', 'effects'];
const ABILITY_OPTIONAL = ['width', 'speed', 'radius', 'angle', 'delay', 'duration', 'distance', 'flags', 'line'];
const SCALING_KEYS = ['base', 'ad', 'bonusAd', 'ap', 'maxHp', 'bonusHp', 'targetMaxHp', 'targetMissingHp', 'byLevel'];

/** Allowed keys per effect kind: [required, optional]. */
const EFFECT_KEYS: Record<string, [string[], string[]]> = {
  damage: [['kind', 'type', 'amount'], ['target']],
  heal: [['kind', 'amount', 'target'], []],
  shield: [['kind', 'amount', 'duration', 'target'], []],
  slow: [['kind', 'pct', 'duration'], ['target']],
  root: [['kind', 'duration'], ['target']],
  stun: [['kind', 'duration'], ['target']],
  airborne: [['kind', 'duration'], ['target']],
  blind: [['kind', 'duration'], ['target']],
  silence: [['kind', 'duration'], ['target']],
  stasis: [['kind', 'duration'], ['target']],
  knockback: [['kind', 'distance'], ['target']],
  pull: [['kind', 'distance'], ['target']],
  buff: [['kind', 'stat', 'duration', 'target'], ['pct', 'flat']],
  reveal: [['kind', 'duration'], ['target']],
  mark: [['kind', 'id', 'duration'], ['target']],
  hook: [['kind', 'id'], []],
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Every hook id referenced by a champion (passive hooks + ability hook effects), in order. */
export function hookIds(c: ChampionData): string[] {
  const ids = [...c.passive.hooks];
  for (const a of [...c.abilities, ...(c.ultChoices ?? [])]) for (const e of a.effects) if (e.kind === 'hook') ids.push(e.id);
  return ids;
}

/** Returns a list of human-readable problems; empty means the data conforms. */
export function validateChampion(raw: unknown, where = 'champion'): string[] {
  const errs: string[] = [];
  const err = (path: string, msg: string) => errs.push(`${where}${path ? '.' + path : ''}: ${msg}`);
  if (!isObj(raw)) return [`${where}: not an object`];
  const c = raw;

  // numbers: finite and non-negative everywhere
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) err(path, 'number not finite');
      else if (v < 0) err(path, `negative number ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  // botBias holds signed playstyle offsets (-5..+5), checked below
  for (const [k, x] of Object.entries(c)) if (k !== 'botBias') walk(x, k);

  const keys = (o: Obj, path: string, required: string[], optional: string[] = []) => {
    for (const k of required) if (!(k in o)) err(path, `missing "${k}"`);
    for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) err(path, `unknown key "${k}"`);
  };
  const l10n = (v: unknown, path: string) => {
    if (!isObj(v) || !isStr(v.de) || !isStr(v.en) || Object.keys(v).length !== 2) err(path, 'expected { de, en } non-empty strings');
  };
  const num = (v: unknown, path: string) => {
    if (typeof v !== 'number') err(path, 'expected number');
  };
  const ranked = (v: unknown, path: string, len: number) => {
    if (typeof v === 'number') return;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) err(path, 'expected number or number[]');
    else if (v.length !== len) err(path, `rank array length ${v.length}, expected ${len}`);
  };

  keys(c, '', TOP_KEYS, OPTIONAL_TOP_KEYS);
  if (c.botBias !== undefined) {
    if (!isObj(c.botBias)) err('botBias', 'expected object');
    else
      for (const [k, v] of Object.entries(c.botBias)) {
        if (!(PLAYSTYLE_AXES as readonly string[]).includes(k)) err(`botBias.${k}`, 'unknown playstyle axis');
        if (typeof v !== 'number' || !Number.isInteger(v) || v < -5 || v > 5) err(`botBias.${k}`, 'expected integer -5..+5');
      }
  }
  if (!isStr(c.id) || !/^[a-z]+$/.test(c.id)) err('id', 'expected lowercase ascii id');
  const id = String(c.id);
  if (!isStr(c.name)) err('name', 'expected string');
  l10n(c.title, 'title');
  l10n(c.trainingPurpose, 'trainingPurpose');
  l10n(c.spikeNote, 'spikeNote');
  if (!isStr(c.archetype)) err('archetype', 'expected string');
  if (!isStr(c.silhouette)) err('silhouette', 'expected string');

  if (!Array.isArray(c.roles) || c.roles.length < 1 || c.roles.length > 2) err('roles', 'expected 1 or 2 roles');
  else {
    c.roles.forEach((r, i) => ROLES.includes(r as Role) || err(`roles[${i}]`, `invalid role "${String(r)}"`));
    if (c.roles.length === 2 && c.roles[0] === c.roles[1]) err('roles', 'duplicate role');
  }
  if (c.attackType !== 'melee' && c.attackType !== 'ranged') err('attackType', 'expected melee|ranged');
  if (!RESOURCES.includes(c.resource as string)) err('resource', 'expected mana|energy|none');

  if (!isObj(c.base)) err('base', 'expected object');
  else {
    keys(c.base, 'base', BASE_KEYS, ['projectileSpeed']);
    for (const k of [...BASE_KEYS, 'projectileSpeed']) if (k in c.base) num(c.base[k], `base.${k}`);
    if (c.attackType === 'ranged' && typeof c.base.projectileSpeed !== 'number') err('base.projectileSpeed', 'ranged champion needs projectileSpeed');
    if (c.resource === 'none' && c.base.mana !== 0) err('base.mana', 'resource none but mana > 0');
  }

  if (!isObj(c.passive)) err('passive', 'expected object');
  else {
    keys(c.passive, 'passive', ['name', 'desc', 'hooks']);
    l10n(c.passive.name, 'passive.name');
    l10n(c.passive.desc, 'passive.desc');
    if (!Array.isArray(c.passive.hooks) || c.passive.hooks.some((h) => !isStr(h))) err('passive.hooks', 'expected string[]');
  }

  const hookSeen = new Set<string>();
  // Hook ids resolve per champion (src/sim/champions/<id>.ts), so they only need to be unique within one champion.
  // Convention for the Phase-2 roster is "<id>_<what>"; Mira's hand-written hooks predate it.
  const checkHook = (h: unknown, path: string) => {
    if (!isStr(h)) err(path, 'hook id must be a non-empty string');
    else if (hookSeen.has(h)) err(path, `duplicate hook id "${h}"`);
    else hookSeen.add(h);
  };
  if (isObj(c.passive) && Array.isArray(c.passive.hooks)) c.passive.hooks.forEach((h, i) => checkHook(h, `passive.hooks[${i}]`));

  const scaling = (v: unknown, path: string, len: number) => {
    if (!isObj(v)) return err(path, 'expected Scaling object');
    keys(v, path, ['base'], SCALING_KEYS.slice(1));
    ranked(v.base, `${path}.base`, len);
    for (const k of SCALING_KEYS.slice(1, -1)) if (k in v) num(v[k], `${path}.${k}`);
    if ('byLevel' in v && (!Array.isArray(v.byLevel) || v.byLevel.length !== 2 || v.byLevel.some((x) => typeof x !== 'number')))
      err(`${path}.byLevel`, 'expected [from, to]');
  };

  const effect = (e: unknown, path: string, len: number) => {
    if (!isObj(e) || typeof e.kind !== 'string' || !(e.kind in EFFECT_KEYS)) return err(path, `invalid effect kind "${isObj(e) ? String(e.kind) : '?'}"`);
    const [req, opt] = EFFECT_KEYS[e.kind]!;
    keys(e, path, req, opt);
    if ('target' in e && !TARGETS.includes(e.target as string)) err(`${path}.target`, `invalid target "${String(e.target)}"`);
    switch (e.kind) {
      case 'damage':
        if (!['phys', 'magic', 'true'].includes(e.type as string)) err(`${path}.type`, 'expected phys|magic|true');
        scaling(e.amount, `${path}.amount`, len);
        break;
      case 'heal':
        scaling(e.amount, `${path}.amount`, len);
        break;
      case 'shield':
        scaling(e.amount, `${path}.amount`, len);
        num(e.duration, `${path}.duration`);
        break;
      case 'slow':
        ranked(e.pct, `${path}.pct`, len);
        ranked(e.duration, `${path}.duration`, len);
        if (typeof e.pct === 'number' && e.pct > 100) err(`${path}.pct`, 'slow > 100%');
        break;
      case 'buff':
        if (!BUFF_STATS.includes(e.stat as string)) err(`${path}.stat`, `invalid stat "${String(e.stat)}"`);
        if ('pct' in e) ranked(e.pct, `${path}.pct`, len);
        if ('flat' in e) ranked(e.flat, `${path}.flat`, len);
        ranked(e.duration, `${path}.duration`, len);
        break;
      case 'knockback':
      case 'pull':
      case 'reveal':
        num(e.kind === 'reveal' ? e.duration : e.distance, path);
        break;
      case 'mark':
        if (!isStr(e.id)) err(`${path}.id`, 'expected string');
        num(e.duration, `${path}.duration`);
        break;
      case 'hook':
        checkHook(e.id, `${path}.id`);
        break;
      default: // root, stun, airborne, blind, silence, stasis
        ranked(e.duration, `${path}.duration`, len);
    }
  };

  let dashes = 0;
  const ability = (a: unknown, path: string, len: number): void => {
      if (!isObj(a)) return void err(path, 'expected object');
      keys(a, path, ABILITY_REQUIRED, ABILITY_OPTIONAL);
      if (!isStr(a.id) || !a.id.startsWith(id + '_')) err(`${path}.id`, `ability id must start with "${id}_"`);
      l10n(a.name, `${path}.name`);
      l10n(a.desc, `${path}.desc`);
      if (!ABILITY_TYPES.includes(a.type as (typeof ABILITY_TYPES)[number])) err(`${path}.type`, `invalid type "${String(a.type)}"`);
      if (a.type === 'dash') dashes++;
      if (typeof a.castTime !== 'number' || a.castTime < 0 || a.castTime > 0.5) err(`${path}.castTime`, 'expected 0..0.5');
      if (typeof a.movesWhileCasting !== 'boolean') err(`${path}.movesWhileCasting`, 'expected boolean');
      ranked(a.range, `${path}.range`, len);
      ranked(a.cooldown, `${path}.cooldown`, len);
      ranked(a.cost, `${path}.cost`, len);
      if ('duration' in a) ranked(a.duration, `${path}.duration`, len);
      for (const k of ['width', 'speed', 'radius', 'angle', 'delay', 'distance']) if (k in a) num(a[k], `${path}.${k}`);
      if (!COST_TYPES.includes(a.costType as string)) err(`${path}.costType`, 'invalid costType');
      if ('line' in a && a.line !== 'perpendicular' && a.line !== 'forward') err(`${path}.line`, 'expected perpendicular|forward');
      if ('line' in a && typeof a.width !== 'number') err(`${path}.line`, 'line geometry needs width');
      if (a.costType === 'mana' && c.resource !== 'mana') err(`${path}.costType`, 'mana cost on non-mana champion');
      if (a.costType === 'energy' && c.resource !== 'energy') err(`${path}.costType`, 'energy cost on non-energy champion');
      if (a.costType === 'none' && a.cost !== 0) err(`${path}.cost`, 'costType none but cost > 0');
      if ('flags' in a && (!Array.isArray(a.flags) || a.flags.some((f) => !FLAGS.includes(f as string)))) err(`${path}.flags`, 'invalid flag');
      if (a.type === 'skillshot_line' && (typeof a.width !== 'number' || typeof a.speed !== 'number'))
        err(path, 'skillshot_line needs width and speed');
      if ((a.type === 'skillshot_circle' || a.type === 'zone') && typeof a.radius !== 'number') err(path, `${a.type} needs radius`);
      if (a.type === 'cone' && typeof a.angle !== 'number') err(path, 'cone needs angle');
      if (!Array.isArray(a.effects)) err(`${path}.effects`, 'expected array');
      else a.effects.forEach((e, j) => effect(e, `${path}.effects[${j}]`, len));
  };
  if (!Array.isArray(c.abilities) || c.abilities.length !== 4) err('abilities', 'expected exactly 4 abilities (Q W E R)');
  else {
    c.abilities.forEach((a, i) => ability(a, `abilities[${'QWER'[i]!}]`, i === 3 ? 3 : 5));
    if (dashes > 1) err('abilities', `${dashes} abilities of type dash (max 1 hard dash)`);
  }
  // optional R choice (Sev): exactly 3 alternative ultimates (rank arrays of length 3) + bot pick weights
  if (c.ultChoices !== undefined) {
    if (!Array.isArray(c.ultChoices) || c.ultChoices.length !== 3) err('ultChoices', 'expected exactly 3 ultimates');
    else c.ultChoices.forEach((a, i) => ability(a, `ultChoices[${i}]`, 3));
    const w = c.botUltChoice;
    if (!Array.isArray(w) || w.length !== 3 || w.some((x) => typeof x !== 'number') || (w as number[]).reduce((a, b) => a + b, 0) <= 0)
      err('botUltChoice', 'expected 3 non-negative weights with a positive sum');
  } else if (c.botUltChoice !== undefined) err('botUltChoice', 'needs ultChoices');

  if (!Array.isArray(c.spikeLevels) || c.spikeLevels.length < 1 || c.spikeLevels.some((l) => typeof l !== 'number' || l < 1 || l > 18))
    err('spikeLevels', 'expected 1+ levels in 1..18');
  if (!Array.isArray(c.maxOrder) || [...c.maxOrder].sort().join('') !== 'EQW') err('maxOrder', 'expected a permutation of Q W E');

  if (!Array.isArray(c.combos) || c.combos.length !== 3) err('combos', 'expected exactly 3 combos');
  else
    c.combos.forEach((cb, i) => {
      if (!isObj(cb)) return err(`combos[${i}]`, 'expected object');
      keys(cb, `combos[${i}]`, ['name', 'sequence']);
      l10n(cb.name, `combos[${i}].name`);
      if (!Array.isArray(cb.sequence) || cb.sequence.length < 1) err(`combos[${i}].sequence`, 'expected non-empty array');
      else
        cb.sequence.forEach((t, j) => {
          if (!COMBO_TOKENS.includes(t as (typeof COMBO_TOKENS)[number])) err(`combos[${i}].sequence[${j}]`, `invalid token "${String(t)}"`);
        });
    });

  if (!isObj(c.scores)) err('scores', 'expected object');
  else {
    keys(c.scores, 'scores', SCORE_KEYS);
    for (const k of SCORE_KEYS) {
      const s = c.scores[k];
      if (typeof s !== 'number' || s < 0 || s > 5) err(`scores.${k}`, 'expected 0..5');
    }
  }

  if (!isObj(c.voiceLines)) err('voiceLines', 'expected object');
  else {
    keys(c.voiceLines, 'voiceLines', VOICE_KEYS);
    for (const k of VOICE_KEYS) if (k in c.voiceLines) l10n(c.voiceLines[k], `voiceLines.${k}`);
  }
  return errs;
}

/** Narrows widened JSON to ChampionData after runtime validation; throws with all problems otherwise. */
export function asChampion(raw: Json<ChampionData>, where?: string): ChampionData {
  const errs = validateChampion(raw, where ?? (raw as { id?: string }).id);
  if (errs.length) throw new Error(`Invalid champion data:\n${errs.join('\n')}`);
  return raw as ChampionData;
}
