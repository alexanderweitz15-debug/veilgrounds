// deriveHints: ChampionData -> ChampionHints. Pure and deterministic; the single source of the generated entries
// (tools/botHints/generate.ts writes its output) and the fallback of the loader for a champion without an entry.
// Every number comes from the champion data (ability type, range, width, speed, delay, effects, cooldown, scores,
// combos); the only constants are the thresholds below, named and explained.

import type { AbilityData, ChampionData, Effect, Ranked } from '../../../sim/champions/schema';
import {
  SLOT_KEYS,
  type AbilityHint,
  type AbilityRole,
  type AimKind,
  type ChampionHints,
  type ComboHint,
  type FightRole,
  type HoldFor,
} from './schema';

/** A damage skillshot / targeted spell with at least this range (and a cooldown at most POKE_MAX_CD) is poke. */
const POKE_MIN_RANGE = 600;
const POKE_MAX_CD = 10;
/** Reaches of line / area spells are capped here (global ultimates: the lane view ends there). */
const REACH_CAP = 1800;
/** The bot starts a ranged spell at this share of its range (the target keeps walking while the spell flies). */
const USE_SHARE = 0.92;
/** A self-centred spell needs the target within this extra reach around the caster when it has no radius. */
const SELF_REACH_EXTRA = 150;
/** Roles of the old fightRole() regexes (src/ai/bot/kite.ts), now data. */
const FRONTLINE = /tank|juggernaut|bruiser|engage|battlemage/;
const SUPPORT_ARCH = /support|enchanter|healer|tether/;
const ASSASSIN = /assassin/;
/** Speeds from this on count as instant (hitscan-like). */
const INSTANT_SPEED = 20000;

const last = (v: Ranked | undefined): number => (v === undefined ? 0 : typeof v === 'number' ? v : (v[v.length - 1] ?? 0));
const round = (n: number): number => Math.round(n * 100) / 100;

const onEnemies = (e: Effect): boolean => !('target' in e) || e.target === undefined || e.target === 'hit' || e.target === 'enemies';

const CC_TIER: Partial<Record<Effect['kind'], number>> = { slow: 1, blind: 2, silence: 2, knockback: 3, pull: 3, root: 3, stun: 4, airborne: 4 };

function ccOf(ab: AbilityData): number {
  let t = 0;
  for (const e of ab.effects) if (onEnemies(e)) t = Math.max(t, CC_TIER[e.kind] ?? 0);
  return t;
}
const damages = (ab: AbilityData): boolean => ab.effects.some((e) => e.kind === 'damage' && onEnemies(e));
const supportive = (ab: AbilityData): boolean =>
  !!ab.flags?.includes('ally_target') || ab.effects.some((e) => (e.kind === 'heal' || e.kind === 'shield' || (e.kind === 'buff' && e.target !== 'self' && e.target !== 'hit')) && 'target' in e && (e.target === 'ally' || e.target === 'allies'));
const heals = (ab: AbilityData): boolean => ab.effects.some((e) => e.kind === 'heal' || e.kind === 'shield');

function aimOf(ab: AbilityData): AimKind {
  switch (ab.type) {
    case 'skillshot_line':
      return 'line';
    case 'skillshot_circle':
    case 'zone':
    case 'summon':
      return 'circle';
    case 'cone':
      return 'cone';
    case 'targeted':
      return 'target';
    case 'self':
      return 'self';
    case 'dash':
      return 'dash';
    case 'blink':
      return 'blink';
  }
}

/** Reach of the ability from the caster (units): what an enemy has to stay out of. */
function reachOf(ab: AbilityData, auto: number): number {
  const range = last(ab.range);
  switch (ab.type) {
    case 'dash':
    case 'blink':
      return (ab.distance ?? range) + auto;
    case 'self':
      return ab.radius ? ab.radius : auto + SELF_REACH_EXTRA;
    case 'cone':
      return Math.min(range, REACH_CAP);
    default:
      return Math.min(range, REACH_CAP);
  }
}

function useRange(ab: AbilityData, auto: number): [number, number] {
  const reach = reachOf(ab, auto);
  switch (ab.type) {
    case 'dash':
    case 'blink':
      // a gap closer starts beyond auto reach and within its distance
      return [round(auto * 0.5), round(reach)];
    case 'self':
      return [0, round(reach)];
    case 'targeted':
      return [0, round(reach)];
    default:
      return [0, round(reach * USE_SHARE)];
  }
}

function dodgeable(ab: AbilityData): boolean {
  if (ab.type === 'skillshot_line') return (ab.speed ?? 0) < INSTANT_SPEED;
  if (ab.type === 'skillshot_circle' || ab.type === 'zone' || ab.type === 'summon') return (ab.delay ?? 0) > 0 || (ab.castTime ?? 0) > 0;
  if (ab.type === 'cone') return (ab.castTime ?? 0) > 0;
  return false;
}

function rolesOf(ab: AbilityData, slot: number, c: ChampionData, cc: number, dmg: boolean): AbilityRole[] {
  const roles: AbilityRole[] = [];
  const offensive = dmg || cc > 0;
  const range = last(ab.range);
  const reach = reachOf(ab, c.base.range);
  const cd = last(ab.cooldown);
  const aim = aimOf(ab);
  const mobile = ab.type === 'dash' || ab.type === 'blink' || !!ab.flags?.includes('mobility');
  if (mobile && !supportive(ab)) {
    roles.push('escape');
    // a gap closer with damage / CC, or the champion's whole kit is about getting on top of someone
    if (offensive || c.scores.engage >= 3) roles.push('engage');
  }
  if (cc >= 3) {
    roles.push('cc');
    // a long hard-CC spell of an engage champion starts the fight (hook, root, pull)
    if (!mobile && c.scores.engage >= 4 && (aim === 'line' || aim === 'circle' || aim === 'target') && range >= POKE_MIN_RANGE) roles.push('engage');
  }
  if (supportive(ab)) roles.push('peel');
  if (heals(ab)) roles.push('sustain');
  if (ab.type === 'self' && !dmg && (cc >= 1 || ab.effects.some((e) => e.kind === 'knockback')) && ab.effects.every((e) => onEnemies(e) || e.kind === 'buff')) roles.push('disengage');
  if ((ab.type === 'zone' || ab.type === 'skillshot_circle') && cc > 0 && !roles.includes('cc')) roles.push('zone');
  else if (ab.type === 'zone' && dmg) roles.push('zone');
  if (ab.type === 'summon') roles.push('summon');
  if (dmg && !mobile) {
    const ranged = aim === 'line' || aim === 'circle' || aim === 'target' || aim === 'cone';
    if (slot !== 3 && ranged && reach >= POKE_MIN_RANGE && cd <= POKE_MAX_CD) roles.push('poke');
    else roles.push('burst');
  }
  if (!dmg && !roles.length && ab.effects.some((e) => e.kind === 'buff')) roles.push('buff');
  if (slot === 3) roles.push('ult');
  if (!roles.length) roles.push('utility');
  return [...new Set(roles)];
}

function holdOf(roles: AbilityRole[], slot: number, c: ChampionData): HoldFor {
  if (slot === 3) return 'kill';
  if (roles.includes('engage')) return 'engage';
  if (roles.includes('peel') && c.scores.peel >= 3) return 'peel';
  if (roles.includes('cc') && !roles.includes('poke')) return c.scores.engage >= 3 ? 'engage' : 'peel';
  return 'none';
}

function threatOf(slot: number, cc: number, dmg: boolean): 0 | 1 | 2 | 3 {
  if (!dmg && cc === 0) return 0;
  if (slot === 3 || cc >= 4) return 3;
  if (cc >= 3) return 2;
  return dmg ? 1 : 0;
}

function abilityHint(c: ChampionData, slot: number): AbilityHint {
  const ab = c.abilities[slot]!;
  const cc = ccOf(ab);
  const dmg = damages(ab);
  const roles = rolesOf(ab, slot, c, cc, dmg);
  const rangeRaw = last(ab.range);
  return {
    slot: SLOT_KEYS[slot]!,
    aim: aimOf(ab),
    roles,
    range: round(ab.type === 'self' ? (ab.radius ?? 0) : ab.type === 'dash' || ab.type === 'blink' ? (ab.distance ?? rangeRaw) : rangeRaw),
    useRange: useRange(ab, c.base.range),
    speed: ab.speed ?? 0,
    width: ab.width ?? 0,
    radius: ab.radius ?? 0,
    castTime: ab.castTime,
    delay: ab.delay ?? 0,
    cc,
    damage: dmg,
    dodgeable: dodgeable(ab),
    threat: threatOf(slot, cc, dmg),
    holdFor: holdOf(roles, slot, c),
  };
}

function fightRoleOf(c: ChampionData): FightRole {
  if (SUPPORT_ARCH.test(c.archetype) && !/engage/.test(c.archetype)) return 'support';
  if (FRONTLINE.test(c.archetype)) return 'frontline';
  if (ASSASSIN.test(c.archetype)) return 'assassin';
  return 'carry';
}

const clamp5 = (n: number): number => Math.max(0, Math.min(5, Math.round(n)));

export function deriveHints(c: ChampionData): ChampionHints {
  const auto = c.base.range;
  const abilities = [0, 1, 2, 3].map((i) => abilityHint(c, i)) as ChampionHints['abilities'];
  const has = (slot: number, r: AbilityRole): boolean => abilities[slot]!.roles.includes(r);
  const slotsWith = (r: AbilityRole): number[] => [0, 1, 2, 3].filter((s) => has(s, r));
  const reach = (s: number): number => reachOf(c.abilities[s]!, auto);
  const maxReach = (slots: number[], fallback: number): number => (slots.length ? Math.max(...slots.map(reach)) : fallback);

  // combos: the champion's signature combos (data) classified by what they do, plus single-ability poke / peel combos
  const combos: ComboHint[] = [];
  const idx: Record<string, number> = { Q: 0, W: 1, E: 2, R: 3 };
  c.combos.forEach((cb, i) => {
    const seq = [...cb.sequence];
    const first = seq.find((t) => t in idx);
    const kind = seq.includes('R') ? 'allin' : first !== undefined && has(idx[first]!, 'engage') && (first === seq[0] || seq[0] === 'FLASH') ? 'engage' : 'trade';
    combos.push({ id: `${c.id}_data${i + 1}`, kind, sequence: seq, source: 'data' });
  });
  const pokes = slotsWith('poke').sort((a, b) => reach(b) - reach(a));
  if (pokes.length) combos.push({ id: `${c.id}_poke`, kind: 'poke', sequence: [SLOT_KEYS[pokes[0]!]!], source: 'generated' });
  const peels = slotsWith('cc').filter((s) => !has(s, 'poke') || c.scores.peel >= 3);
  if (peels.length && c.scores.peel >= 3) combos.push({ id: `${c.id}_peel`, kind: 'peel', sequence: [SLOT_KEYS[peels[0]!]!], source: 'generated' });

  const main = combos.find((k) => k.kind === 'trade') ?? combos.find((k) => k.kind !== 'allin') ?? combos[0];
  const firstTok = main?.sequence.find((t) => t in idx);
  const trade = firstTok !== undefined ? Math.max(auto + 50, reach(idx[firstTok]!)) : auto + 50;
  // the ultimate is left out: spacing in lane keys on the basic kit (a global R is no reason to stand 1800 away)
  const offensive = [0, 1, 2].filter((s) => abilities[s]!.damage || abilities[s]!.cc > 0);
  const burst = abilities.filter((a) => a.damage).length;
  const pokeStrength = clamp5(pokes.length * 1.5 + (maxReach(pokes, 0) >= 800 ? 1.5 : maxReach(pokes, 0) >= POKE_MIN_RANGE ? 0.5 : 0));

  return {
    id: c.id,
    schema: 1,
    status: 'generated',
    roleHints: { fightRole: fightRoleOf(c), engage: clamp5(c.scores.engage), peel: clamp5(c.scores.peel), poke: pokeStrength, burst: clamp5(burst + (ASSASSIN.test(c.archetype) ? 1 : 0)) },
    keyRanges: {
      auto,
      trade: round(trade),
      engage: round(maxReach(slotsWith('engage'), auto)),
      poke: round(maxReach(pokes, auto)),
      threat: round(Math.max(auto, maxReach(offensive, auto))),
      peel: round(maxReach(slotsWith('peel'), 0)),
    },
    combos,
    abilities,
  };
}
