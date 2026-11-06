// Progression UI (src/stats/progression.ts): ladder / level / missions / mastery card for the profile screen and the
// "this game" card of the post-game screen. Texts: i18n prog.*, mission.*, rank.*. Styles: profile.css (.pr-*).
import { t } from '../i18n';
import { MISSIONS, honorLevel, MASTERY_MAX, levelInfo, masteryLevel, masteryNext, rankInfo, type MissionState, type Progress, type ProgressDelta, type RankInfo } from '../stats/progression';
import { champName } from './names';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};
const bar = (parent: HTMLElement, frac: number, cls = ''): void => {
  const b = el('div', `pr-bar ${cls}`, parent);
  el('div', 'pr-fill', b).style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
};

/** "Gold II" / "Meister". */
const rankLabelOf = (r: RankInfo): string => {
  return `${t(`rank.${r.rank}`)}${r.division ? ` ${ROMAN[r.division]}` : ''}`;
};
export const rankLabel = (ladder: number): string => rankLabelOf(rankInfo(ladder));
const lpText = (ladder: number): string => {
  const r = rankInfo(ladder);
  return r.lpMax === null ? t('prog.lp', { n: r.lp }) : t('prog.lpOf', { n: r.lp, max: r.lpMax });
};

function missionRow(parent: HTMLElement, m: MissionState): void {
  const def = MISSIONS.find((x) => x.id === m.id);
  if (!def) return;
  const row = el('div', `pr-mission${m.done ? ' done' : ''}`, parent);
  el('span', 'pr-m-name', row, t(`mission.${m.id}`, { n: def.target }));
  el('span', 'pr-m-prog', row, m.done ? '✓' : `${m.progress}/${def.target}`);
  el('span', 'pr-m-xp', row, `+${def.xp} XP`);
  bar(row, m.progress / def.target, m.done ? 'done' : '');
}

/** Profile: rank + LP, account level, missions, top mastery champions. */
export function renderProgressCard(root: HTMLElement, p: Progress): void {
  const box = el('section', 'pf-sec pr-card', root);
  el('h3', 'pf-h', box, t('prog.title'));
  const top = el('div', 'pr-top', box);
  const rk = el('div', 'pr-rank', top);
  el('div', 'pr-rank-name', rk, rankLabel(p.ladder));
  el('div', 'pr-rank-lp', rk, p.games < 3 ? t('prog.placement', { n: p.games }) : lpText(p.ladder));
  const r = rankInfo(p.ladder);
  bar(rk, r.lpMax ? r.lp / r.lpMax : 1);
  const lv = levelInfo(p.xp);
  const lc = el('div', 'pr-level', top);
  el('div', 'pr-rank-name', lc, t('prog.level', { n: lv.level }));
  el('div', 'pr-rank-lp', lc, `${lv.into} / ${lv.need} XP`);
  bar(lc, lv.into / lv.need, 'xp');
  for (const kind of ['daily', 'weekly'] as const) {
    const list = p[kind];
    if (!list.length) continue;
    el('div', 'pr-sub', box, t(`prog.${kind}`));
    for (const m of list) missionRow(box, m);
  }
  el('div', 'pr-sub', box, t('honor.level', { n: honorLevel(p.honor ?? 0), given: p.honor ?? 0 }));
  const mast = Object.entries(p.mastery).sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  if (mast.length) {
    el('div', 'pr-sub', box, t('prog.mastery'));
    for (const [id, m] of mast) {
      const row = el('div', 'pr-mastery', box);
      el('span', 'pr-m-name', row, champName(id));
      const lvl = masteryLevel(m.score);
      el('span', 'pr-m-prog', row, lvl >= MASTERY_MAX ? t('prog.masteryMax') : t('prog.masteryLvl', { n: lvl }));
      const next = masteryNext(m.score);
      el('span', 'pr-m-xp', row, next ? `${m.score} / ${next}` : String(m.score));
    }
  }
}

/** Post-game: what this game did to LP, XP, missions, mastery. */
export function renderProgressDelta(root: HTMLElement, d: ProgressDelta): void {
  el('h3', 'pg-h3', root, t('prog.thisGame'));
  const box = el('div', 'pr-card pr-delta', root);
  const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
  const lp = d.lp;
  const key = (r: RankInfo): number => r.tier * 10 + (r.division ? 5 - r.division : 0);
  const promoted = key(lp.after) > key(lp.before);
  const demoted = key(lp.after) < key(lp.before);
  const a = el('div', 'pr-line', box);
  el('span', `pr-big ${lp.delta >= 0 ? 'up' : 'down'}`, a, `${sign(lp.delta)} LP`);
  el('span', '', a, `${rankLabelOf(lp.after)} · ${lp.placement ? t('prog.placementGame') : ''}`.replace(/ · $/, ''));
  if (promoted) el('span', 'pr-chip up', a, t('prog.promoted'));
  if (demoted) el('span', 'pr-chip down', a, t('prog.demoted'));
  const x = el('div', 'pr-line', box);
  el('span', '', x, `+${d.xp.gain} XP`);
  if (d.xp.after.level > d.xp.before.level) el('span', 'pr-chip up', x, t('prog.levelUp', { n: d.xp.after.level }));
  for (const m of d.missions) {
    const def = MISSIONS.find((q) => q.id === m.id);
    if (!def) continue;
    const l = el('div', `pr-line${m.justDone ? ' done' : ''}`, box);
    el('span', '', l, `${t(`mission.${m.id}`, { n: def.target })}: ${m.after}/${m.target}`);
    if (m.justDone) el('span', 'pr-chip up', l, `✓ +${m.xp} XP`);
  }
  const ms = d.mastery;
  const mline = el('div', 'pr-line', box);
  el('span', '', mline, `${champName(ms.champion)}: +${ms.gain} ${t('prog.mastery')}`);
  if (ms.levelAfter > ms.levelBefore) el('span', 'pr-chip up', mline, t('prog.masteryUp', { n: ms.levelAfter }));
}
