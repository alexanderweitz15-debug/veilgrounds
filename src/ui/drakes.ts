// Elemental Leviathans on the client (pure: no DOM, testable in node): names, colours, stat text, buff-bar entries,
// the epic-timer element and the announcer banners. The sim side is src/sim/drakes.ts, data src/data/drakes.json.
import { ELDER, ELDER_ELEM, ELEMENTS, SOUL_AT, type DrakeStats } from '../sim/drakes';
import type { SnapDrake } from '../sim/snapshot';
import { t } from '../i18n';

/** Icon glyph per element (names of the drawing functions in icons.ts). */
export const DRAKE_GLYPH: Record<string, string> = { glut: 'flame', flut: 'wave', fels: 'gem', wind: 'wing', arkan: 'spiral', elder: 'crown' };

export const elemId = (e: number): string => (e === ELDER_ELEM ? 'elder' : (ELEMENTS[e]?.id ?? ''));
export const elemColor = (e: number): string => (e === ELDER_ELEM ? ELDER.color : (ELEMENTS[e]?.color ?? '#7fb6bf'));
/** Particle kind (render/fx.ts) of the monster's ambient effect. */
export const elemFx = (e: number): string => (e === ELDER_ELEM ? ELDER.fx : (ELEMENTS[e]?.fx ?? 'mote'));
export const elemName = (e: number): string => t(`drake.${elemId(e)}`);
const shortName = (e: number): string => t(`drake.short.${elemId(e)}`);

/** "+6 % Angriffsschaden, +40 Leben" for a bonus block of drakes.json (`times` = number of stacked kills). */
export function statText(s: DrakeStats, times = 1): string {
  return Object.entries(s)
    .map(([k, v]) => `+${Math.round(v! * times * 10) / 10}${k.endsWith('Pct') ? ' %' : ''} ${t(`stat.${k.replace(/^(ad|ap)Pct$/, '$1')}`)}`)
    .join(', ');
}

export interface DrakeBuff {
  key: string;
  label: string;
  elem: number;
  soul: boolean;
  /** Name line and bonus text (tooltip body = name, stats, optional progress). */
  name: string;
  stats: string;
  /** Soul progress line (stacks only). */
  progress: string;
}

/** Buff-bar entries of one team: every element stack (with its summed bonus) and the soul. */
export function drakeBuffs(kills: readonly number[], soulElem: number): DrakeBuff[] {
  const out: DrakeBuff[] = [];
  const count = new Map<number, number>();
  for (const e of kills) count.set(e, (count.get(e) ?? 0) + 1);
  const progress = t('drake.soulProgress', { n: Math.min(kills.length, SOUL_AT), max: SOUL_AT });
  for (const [elem, n] of count) out.push({ key: `drake:${elemId(elem)}:${n}`, label: n > 1 ? `${shortName(elem)} ${n}x` : shortName(elem), elem, soul: false, name: `${elemName(elem)} x${n}`, stats: statText(ELEMENTS[elem]!.perKill, n), progress });
  if (soulElem >= 0) out.push({ key: 'drake:soul', label: t('drake.soulChip', { name: shortName(soulElem) }), elem: soulElem, soul: true, name: t('drake.soulOf', { name: elemName(soulElem) }), stats: statText(ELEMENTS[soulElem]!.soul), progress: '' });
  return out;
}

/** Tooltip text of one buff-bar entry. */
export const drakeBuffTip = (b: DrakeBuff): string => [b.name, b.stats, b.progress].filter(Boolean).join('\n');

/** Scoreboard tooltip of a team's Leviathan kills / soul. */
export const drakeSummary = (kills: readonly number[], soulElem: number): string =>
  drakeBuffs(kills, soulElem).map(drakeBuffTip).join('\n\n') || t('drake.soulProgress', { n: 0, max: SOUL_AT });

/** Element the epic-timer chip shows: the current one while the monster is up, else the announced next (-1 = unknown). */
export const chipElem = (d: SnapDrake | undefined, up: boolean): number => (!d ? -1 : up ? d.cur : d.next);

/** Epic-timer tooltip line about the element (empty when unknown). */
export function chipLine(d: SnapDrake | undefined, up: boolean): string {
  const e = chipElem(d, up);
  return e < 0 ? '' : t(up ? 'drake.nowLine' : 'drake.nextLine', { name: elemName(e) });
}

export interface Banner {
  title: string;
  sub: string;
  tone: 'neutral' | 'epic' | 'bad';
  prio: number;
}
/** What the announcer saw of the drake state last (to detect changes). */
export interface DrakeSeen {
  next: number;
  cur: number;
  soul: [number, number];
}
export const newDrakeSeen = (): DrakeSeen => ({ next: -1, cur: -1, soul: [-1, -1] });

/** Banners for what changed since `seen` (updated in place): next element announced, soul claimed, Uralt-Leviathan spawned. */
export function drakeBanners(seen: DrakeSeen, d: SnapDrake | undefined, mine: number): Banner[] {
  const out: Banner[] = [];
  if (!d) return out;
  if (d.next !== seen.next && d.next >= 0 && d.next !== ELDER_ELEM) out.push({ title: t('ann.drakeNext', { name: elemName(d.next) }), sub: d.next === d.soulType ? t('ann.drakeNextSoul') : '', tone: 'neutral', prio: 1 });
  for (const team of [0, 1]) {
    const s = d.soul[team]!;
    if (s >= 0 && seen.soul[team]! < 0) out.push({ title: t(team === mine ? 'ann.drakeSoulOwn' : 'ann.drakeSoulEnemy'), sub: elemName(s), tone: team === mine ? 'epic' : 'bad', prio: 2 });
  }
  if (d.cur === ELDER_ELEM && seen.cur !== ELDER_ELEM) out.push({ title: t('ann.elderSpawn'), sub: t('ann.elderSpawnSub', { pct: ELDER.executePct }), tone: 'epic', prio: 2 });
  seen.next = d.next;
  seen.cur = d.cur;
  seen.soul = [d.soul[0], d.soul[1]];
  return out;
}

/** Banner of a Leviathan kill: the element is `cur` (still the killed one when the event arrives); the elder has its own text. */
export function drakeKillBanner(d: SnapDrake | undefined, ours: boolean): { title: string; sub: string } {
  if (d && d.cur === ELDER_ELEM) return { title: t(ours ? 'ann.elderOwn' : 'ann.elderEnemy'), sub: t('ann.elderSub', { s: ELDER.buffS }) };
  return { title: t(ours ? 'ann.leviathanOwn' : 'ann.leviathanEnemy'), sub: d && d.cur >= 0 ? elemName(d.cur) : '' };
}
