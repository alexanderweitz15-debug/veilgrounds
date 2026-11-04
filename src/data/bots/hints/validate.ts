// Runtime validation of src/data/bots/hints/<id>.json against schema.ts and the champion data it describes
// (tsc only sees widened JSON types). Returns a list of problems; empty = valid. Used by the loader, the generator
// and tests/a13Hints.test.ts. A27 curates the files: this is the guard rail.

import type { ChampionData } from '../../../sim/champions/schema';
import { ABILITY_ROLES, AIM_KINDS, COMBO_KINDS, COMBO_TOKENS, FIGHT_ROLES, HOLD_FOR, SLOT_KEYS } from './schema';

const AIM_OF_TYPE: Record<string, string> = {
  skillshot_line: 'line',
  skillshot_circle: 'circle',
  zone: 'circle',
  summon: 'circle',
  cone: 'cone',
  targeted: 'target',
  self: 'self',
  dash: 'dash',
  blink: 'blink',
};

/** No reach in the data may exceed this (global ultimates are capped in derive.ts). */
const MAX_REACH = 3000;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateHints(h: unknown, champ: ChampionData): string[] {
  const bad: string[] = [];
  const err = (m: string): void => void bad.push(`${champ.id}: ${m}`);
  if (!obj(h)) return [`${champ.id}: entry is not an object`];
  if (h.id !== champ.id) err(`id '${String(h.id)}' does not match the champion`);
  if (h.schema !== 1) err('schema must be 1');
  if (h.status !== 'generated' && h.status !== 'curated') err("status must be 'generated' or 'curated'");

  const rh = h.roleHints;
  if (!obj(rh)) err('roleHints missing');
  else {
    if (!FIGHT_ROLES.includes(rh.fightRole as never)) err(`roleHints.fightRole '${String(rh.fightRole)}' unknown`);
    for (const k of ['engage', 'peel', 'poke', 'burst']) if (!isNum(rh[k]) || rh[k] < 0 || rh[k] > 5) err(`roleHints.${k} must be 0..5`);
  }

  const kr = h.keyRanges;
  if (!obj(kr)) err('keyRanges missing');
  else {
    for (const k of ['auto', 'trade', 'engage', 'poke', 'threat', 'peel']) if (!isNum(kr[k]) || kr[k] < 0 || kr[k] > MAX_REACH) err(`keyRanges.${k} must be 0..${MAX_REACH}`);
    if (isNum(kr.auto) && isNum(kr.threat) && kr.threat < kr.auto) err('keyRanges.threat must not be below keyRanges.auto');
    if (isNum(kr.auto) && Math.abs(kr.auto - champ.base.range) > 1e-6) err(`keyRanges.auto ${kr.auto} differs from the champion's attack range ${champ.base.range}`);
  }

  const ab = h.abilities;
  if (!Array.isArray(ab) || ab.length !== 4) err('abilities must have exactly 4 entries (Q W E R)');
  else {
    ab.forEach((a: unknown, i) => {
      const at = `abilities[${i}]`;
      if (!obj(a)) return void err(`${at} is not an object`);
      if (a.slot !== SLOT_KEYS[i]) err(`${at}.slot must be ${SLOT_KEYS[i]}`);
      if (!AIM_KINDS.includes(a.aim as never)) err(`${at}.aim '${String(a.aim)}' unknown`);
      else if (AIM_OF_TYPE[champ.abilities[i]!.type] !== a.aim) err(`${at}.aim '${String(a.aim)}' does not match the champion data (${champ.abilities[i]!.type})`);
      if (!Array.isArray(a.roles) || !a.roles.length || a.roles.some((r) => !ABILITY_ROLES.includes(r as never))) err(`${at}.roles must be a non-empty list of known roles`);
      for (const k of ['range', 'speed', 'width', 'radius', 'castTime', 'delay']) if (!isNum(a[k]) || (a[k] as number) < 0) err(`${at}.${k} must be a number >= 0`);
      if (isNum(a.range) && a.range > MAX_REACH * 10) err(`${at}.range is absurd`);
      const ur = a.useRange;
      if (!Array.isArray(ur) || ur.length !== 2 || !isNum(ur[0]) || !isNum(ur[1]) || ur[0] < 0 || ur[1] < ur[0] || ur[1] > MAX_REACH) err(`${at}.useRange must be [min, max] with 0 <= min <= max <= ${MAX_REACH}`);
      if (!isNum(a.cc) || a.cc < 0 || a.cc > 5) err(`${at}.cc must be 0..5`);
      if (typeof a.damage !== 'boolean' || typeof a.dodgeable !== 'boolean') err(`${at}.damage / dodgeable must be booleans`);
      if (![0, 1, 2, 3].includes(a.threat as number)) err(`${at}.threat must be 0..3`);
      if (!HOLD_FOR.includes(a.holdFor as never)) err(`${at}.holdFor '${String(a.holdFor)}' unknown`);
    });
  }

  const cb = h.combos;
  if (!Array.isArray(cb) || !cb.length) err('combos must be a non-empty list');
  else {
    const ids = new Set<string>();
    for (const c of cb) {
      if (!obj(c)) {
        err('combo is not an object');
        continue;
      }
      if (typeof c.id !== 'string' || !c.id || ids.has(c.id)) err(`combo id '${String(c.id)}' missing or duplicated`);
      else ids.add(c.id);
      if (!COMBO_KINDS.includes(c.kind as never)) err(`combo ${String(c.id)}: kind '${String(c.kind)}' unknown`);
      if (!Array.isArray(c.sequence) || !c.sequence.length || c.sequence.some((t) => !COMBO_TOKENS.includes(t as string))) err(`combo ${String(c.id)}: sequence must be a non-empty list of ${COMBO_TOKENS.join(' ')}`);
      if (!['data', 'generated', 'curated'].includes(c.source as string)) err(`combo ${String(c.id)}: source unknown`);
    }
    if (!cb.some((c) => obj(c) && (c.kind === 'trade' || c.kind === 'engage' || c.kind === 'allin'))) err('combos need at least one trade, engage or allin combo');
  }
  return bad;
}
