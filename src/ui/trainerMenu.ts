// Trainer hub (Phase 5): pick a trainer, then the practice lobby (champion, summoners, runes) with the trainer's
// own options (duration, difficulty, dummy, bot rank, team size ...).
import './gamePanels.css';
import './trainer.css';
import { TRAINER_MODES, type TrainerMode, type TrainerSetup } from '../game/modes';
import type { TrainerOpts } from '../sim/types';
import { RANKS, type Rank } from '../ai/profiles/schema';
import { t } from '../i18n';
import { SCENARIO_IDS, type ScenarioId } from '../sim/trainer/scenarios';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export function renderTrainerMenu(
  root: HTMLElement,
  onBack: () => void,
  onPick: (mode: TrainerMode) => void,
  /** D5 plan cards start a trainer with the suggested options (main.ts merges them into its setup); else onPick. */
  onPickWith?: (mode: TrainerMode, opts: TrainerOpts) => void,
): void {
  root.textContent = '';
  root.classList.add('menu-screen', 'classic-lobby');
  const panel = el('div', 'menu-panel classic-panel tr-menu', root);
  el('h2', 'menu-title', panel, t('trainer.title'));
  // D5 training plan from the match history (IndexedDB; empty history = provisional plan)
  const planBox = el('div', 'tr-plan', panel);
  void Promise.all([import('../stats/history'), import('../modes/trainingPlanView')]).then(async ([h, v]) => {
    const history = await h.loadHistory().catch(() => []);
    if (planBox.isConnected) v.renderTrainingPlan(planBox, history, (it) => (onPickWith ? onPickWith(it.mode, it.opts) : onPick(it.mode)));
  });
  const cards = el('div', 'tr-cards', panel);
  for (const m of TRAINER_MODES) {
    const c = el('button', 'tr-card', cards);
    el('div', 'n', c, t(`trainer.mode.${m}`));
    el('div', 'd', c, t(`trainer.mode.${m}Desc`));
    c.addEventListener('click', () => onPick(m));
  }
  const row = el('div', 'row-buttons', panel);
  el('button', 'menu-btn secondary', row, t('menu.back')).addEventListener('click', onBack);
}

/** Default options per trainer (kept by main.ts between runs). */
export function defaultSetup(mode: TrainerMode): TrainerSetup {
  switch (mode) {
    case 'lastHit':
      return { mode, opts: { durationSec: 300, tower: false } };
    case 'dodge':
      return { mode, opts: { difficulty: 2, lives: 5 } };
    case 'kite':
      return { mode, opts: { dummy: 'strafe', level: 6, durationSec: 120 } };
    case 'laneDuel':
      return { mode, opts: { kills: 1, cs: 100 }, botRank: 'gold' };
    case 'jungleDuel':
      return { mode, opts: { durationSec: 300 }, botRank: 'gold' };
    case 'arena':
      return { mode, opts: { level: 11, rounds: 3, roundSec: 45 }, botRank: 'gold', teamSize: 3 };
    case 'scenario':
      return { mode, opts: { scenario: SCENARIO_IDS[0] }, botRank: 'gold' };
  }
}

function select<T extends string | number>(parent: HTMLElement, label: string, values: readonly T[], cur: T | undefined, name: (v: T) => string, set: (v: T) => void): void {
  const l = el('label', '', parent, label);
  const s = el('select', '', l);
  for (const v of values) {
    const o = el('option', '', s, name(v));
    o.value = String(v);
    if (v === cur) o.selected = true;
  }
  s.addEventListener('change', () => set(values.find((v) => String(v) === s.value)!));
}

/** Options block for the practice lobby; mutates `setup`. */
export function trainerOptions(setup: TrainerSetup): (parent: HTMLElement) => void {
  return (parent) => {
    el('div', 'field-label', parent, t('trainer.options'));
    const box = el('div', 'tr-opts', parent);
    const o = setup.opts;
    const minutes = (v: number): string => t('trainer.opt.min', { n: v / 60 });
    const rank = (): void => select(box, t('trainer.opt.botRank'), RANKS, setup.botRank ?? 'gold', (r: Rank) => t(`rank.${r}`), (r) => (setup.botRank = r));
    switch (setup.mode) {
      case 'lastHit': {
        select(box, t('trainer.opt.duration'), [300, 600], o.durationSec, minutes, (v) => (o.durationSec = v));
        const l = el('label', 'inline', box);
        const cb = el('input', '', l);
        cb.type = 'checkbox';
        cb.checked = !!o.tower;
        cb.addEventListener('change', () => (o.tower = cb.checked));
        l.append(t('trainer.opt.tower'));
        break;
      }
      case 'dodge':
        select(box, t('trainer.opt.difficulty'), [1, 2, 3] as const, o.difficulty, (v) => t(`trainer.diff.${v}`), (v) => (o.difficulty = v));
        select(box, t('trainer.opt.lives'), [3, 5, 10], o.lives, String, (v) => (o.lives = v));
        break;
      case 'kite':
        select(box, t('trainer.opt.dummy'), ['stand', 'strafe', 'chase'] as const, o.dummy, (v) => t(`trainer.dummy.${v}`), (v) => (o.dummy = v));
        select(box, t('trainer.opt.level'), [1, 6, 11, 16], o.level, String, (v) => (o.level = v));
        select(box, t('trainer.opt.duration'), [60, 120, 300], o.durationSec, minutes, (v) => (o.durationSec = v));
        break;
      case 'laneDuel':
        rank();
        select(box, t('trainer.opt.kills'), [1, 2, 3], o.kills, String, (v) => (o.kills = v));
        select(box, t('trainer.opt.cs'), [50, 100], o.cs, String, (v) => (o.cs = v));
        break;
      case 'jungleDuel':
        rank();
        select(box, t('trainer.opt.duration'), [180, 300, 480], o.durationSec, minutes, (v) => (o.durationSec = v));
        break;
      case 'arena':
        rank();
        select(box, t('trainer.opt.teamSize'), [1, 2, 3, 4, 5], setup.teamSize, (n) => t('trainer.opt.vs', { n, m: n }), (v) => (setup.teamSize = v));
        select(box, t('trainer.opt.rounds'), [2, 3, 5], o.rounds, String, (v) => (o.rounds = v));
        select(box, t('trainer.opt.level'), [6, 11, 16], o.level, String, (v) => (o.level = v));
        break;
      case 'scenario': {
        // scenario list + its German description and goal; opponents are bots of the chosen rank
        const desc = el('div', 'tr-sc-desc');
        const show = (id: string): void => {
          desc.textContent = '';
          el('div', 'd', desc, t(`scenario.${id}.desc`));
          el('div', 'g', desc, `${t('scenario.goalLabel')}: ${t(`scenario.${id}.goal`)}`);
        };
        select(box, t('trainer.opt.scenario'), SCENARIO_IDS, (o.scenario ?? SCENARIO_IDS[0]) as ScenarioId, (id) => t(`scenario.${id}.name`), (id) => {
          o.scenario = id;
          show(id);
        });
        rank();
        box.appendChild(desc);
        show(o.scenario ?? SCENARIO_IDS[0]);
        break;
      }
    }
  };
}
