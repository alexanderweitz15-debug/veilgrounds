// Bot configuration files (spec-bots §10 format), e.g. data/bots/configs.json or a file passed to tools:
// { "id", "champion", "rank", "skill", "variance", "playstyle", "personalitySeed", "archetype" }.
// parseBotConfig validates one object; applyBotConfig writes it onto a PlayerSetup's bot field.

import configsJson from '../data/bots/configs.json';
import type { PlayerSetup } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { RANKS, type Rank } from './profiles/schema';
import { ARCHETYPES, PLAYSTYLE_AXES, type Archetype, type Playstyle, type PlaystyleAxis } from './contract';

export interface BotConfig {
  id: string;
  champion?: string;
  rank: Rank;
  skill?: number;
  variance: 'stable' | 'normal' | 'volatile';
  playstyle?: Partial<Playstyle>;
  personalitySeed?: number;
  archetype?: Archetype;
}

const VARIANCES = ['stable', 'normal', 'volatile'] as const;

/** Validates one config object; throws with all problems. */
export function parseBotConfig(raw: unknown): BotConfig {
  const errs: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('bot config: not an object');
  const o = raw as Record<string, unknown>;
  const allowed = ['id', 'champion', 'rank', 'skill', 'variance', 'playstyle', 'personalitySeed', 'archetype'];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(`unknown key "${k}"`);
  if (typeof o.id !== 'string' || !o.id) errs.push('id: expected string');
  if (o.champion !== undefined && (typeof o.champion !== 'string' || !CHAMPION_DATA[o.champion])) errs.push(`champion: unknown "${String(o.champion)}"`);
  if (!RANKS.includes(o.rank as Rank)) errs.push(`rank: expected one of ${RANKS.join(', ')}`);
  if (o.skill !== undefined && (typeof o.skill !== 'number' || o.skill < 0 || o.skill > 100)) errs.push('skill: expected 0..100');
  if (o.variance !== undefined && !VARIANCES.includes(o.variance as (typeof VARIANCES)[number])) errs.push('variance: expected stable | normal | volatile');
  if (o.personalitySeed !== undefined && (typeof o.personalitySeed !== 'number' || !Number.isInteger(o.personalitySeed))) errs.push('personalitySeed: expected integer');
  if (o.archetype !== undefined && !ARCHETYPES.includes(o.archetype as Archetype)) errs.push(`archetype: expected one of ${ARCHETYPES.join(', ')}`);
  if (o.playstyle !== undefined) {
    if (typeof o.playstyle !== 'object' || o.playstyle === null) errs.push('playstyle: expected object');
    else
      for (const [k, v] of Object.entries(o.playstyle)) {
        if (!(PLAYSTYLE_AXES as readonly string[]).includes(k)) errs.push(`playstyle.${k}: unknown axis`);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < -5 || v > 5) errs.push(`playstyle.${k}: expected integer -5..+5`);
      }
  }
  if (errs.length) throw new Error(`bot config ${String(o.id ?? '?')}:\n${errs.join('\n')}`);
  return {
    id: o.id as string,
    rank: o.rank as Rank,
    variance: (o.variance as BotConfig['variance']) ?? 'normal',
    ...(o.champion !== undefined ? { champion: o.champion as string } : {}),
    ...(o.skill !== undefined ? { skill: o.skill as number } : {}),
    ...(o.playstyle !== undefined ? { playstyle: { ...(o.playstyle as Partial<Record<PlaystyleAxis, number>>) } } : {}),
    ...(o.personalitySeed !== undefined ? { personalitySeed: o.personalitySeed as number } : {}),
    ...(o.archetype !== undefined ? { archetype: o.archetype as Archetype } : {}),
  };
}

/** Bundled configs (data/bots/configs.json), validated at load. */
export const BOT_CONFIGS: readonly BotConfig[] = (configsJson.configs as unknown[]).map(parseBotConfig);

/** Writes a config onto a bot slot (champion only if given); keeps name and other lobby fields. */
export function applyBotConfig(setup: PlayerSetup, cfg: BotConfig): PlayerSetup {
  const bot: NonNullable<PlayerSetup['bot']> = { ...(setup.bot ?? { rank: cfg.rank, variance: cfg.variance }), rank: cfg.rank, variance: cfg.variance };
  if (cfg.skill !== undefined) bot.skill = cfg.skill;
  if (cfg.playstyle) bot.playstyle = { ...cfg.playstyle };
  if (cfg.archetype) bot.archetype = cfg.archetype;
  if (cfg.personalitySeed !== undefined) bot.personalitySeed = cfg.personalitySeed;
  return { ...setup, ...(cfg.champion ? { champion: cfg.champion } : {}), isHuman: false, bot };
}
