// R choice cards (Sev, ChampionData.ultChoices): once R is learned and not chosen yet, three cards appear above the
// ability bar (icon, name, one-line description, full tooltip on hover). Click or keys 1/2/3 send the 'ultChoice'
// command; the sim makes the choice permanent and the R slot then shows the chosen ultimate (hud.ts ultDisplaySlot).
import './ultChoice.css';
import type { AbilityHud } from '../sim/systems/abilities';
import { abilityForSlot } from '../data/champions';
import { abilityIcon, setIcon } from './icons';
import { setTip } from './tooltip';
import { settings } from '../settings';
import { t } from '../i18n';

const firstSentence = (s: string): string => {
  const i = s.search(/[.!?](\s|$)/);
  return i > 0 ? s.slice(0, i + 1) : s;
};

export class UltChoiceCards {
  readonly root: HTMLElement;
  private champ = '';
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly choose: (c: 0 | 1 | 2) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ult-choice';
    parent.insertBefore(this.root, parent.firstChild);
    // keys 1/2/3 pick while the cards are open (capture: before item keys / camera binds)
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.open || !this.root.isConnected || e.repeat) return;
        const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
        if (k < 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.pick(k as 0 | 1 | 2);
      },
      true,
    );
  }

  private pick(c: 0 | 1 | 2): void {
    this.open = false;
    this.root.classList.remove('show');
    this.choose(c);
  }

  /** Per HUD update with the R entry of the own ability HUD. */
  update(champ: string, r: AbilityHud | undefined): void {
    const want = !!r?.ultChoice && r.ultChoice.chosen < 0 && r.rank > 0;
    if (champ !== this.champ) this.build(champ);
    if (want !== this.open) {
      this.open = want;
      this.root.classList.toggle('show', want);
    }
  }

  private build(champ: string): void {
    this.champ = champ;
    this.root.textContent = '';
    const title = document.createElement('div');
    title.className = 'uc-title';
    title.textContent = t('ultChoice.title');
    this.root.appendChild(title);
    const row = document.createElement('div');
    row.className = 'uc-row';
    this.root.appendChild(row);
    for (let i = 0; i < 3; i++) {
      const a = abilityForSlot(champ, 4 + i);
      if (!a) continue;
      const card = document.createElement('button');
      card.className = 'uc-card';
      const icon = document.createElement('div');
      icon.className = 'uc-icon';
      setIcon(icon, abilityIcon(champ, 4 + i));
      const key = document.createElement('div');
      key.className = 'uc-key';
      key.textContent = String(i + 1);
      const name = document.createElement('div');
      name.className = 'uc-name';
      name.textContent = a.name[settings.lang];
      const desc = document.createElement('div');
      desc.className = 'uc-desc';
      desc.textContent = firstSentence(a.desc[settings.lang]);
      card.append(icon, key, name, desc);
      setTip(card, `ability:${champ}:${4 + i}:-1`);
      card.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.pick(i as 0 | 1 | 2);
      });
      row.appendChild(card);
    }
  }
}
