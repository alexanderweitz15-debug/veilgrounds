// Honor vote on the post-game screen (LoL-like): pick one allied player (bot) and a category, once per game; gives a
// little XP and raises the honor level on the profile (progression.ts giveHonor). Allies are the human's team without the human.
import { t } from '../i18n';
import { giveHonor } from '../stats/progression';
import type { PlayerSetup } from '../sim/types';
import { champName } from './names';

const CATEGORIES = [1, 2, 3];

export function renderHonor(panel: HTMLElement, players: readonly PlayerSetup[]): void {
  const me = players.find((p) => p.isHuman);
  const allies = players.filter((p) => me && p.team === me.team && !p.isHuman);
  if (!allies.length) return;
  const box = document.createElement('div');
  box.className = 'honor-box';
  const h = document.createElement('h3');
  h.className = 'pg-h3';
  h.textContent = t('honor.title');
  const hint = document.createElement('div');
  hint.className = 'honor-hint';
  hint.textContent = t('honor.hint');
  box.append(h, hint);
  for (const a of allies) {
    const row = document.createElement('div');
    row.className = 'honor-row';
    const name = document.createElement('span');
    name.textContent = `${a.bot?.name ?? 'Bot'} (${champName(a.champion)})`;
    row.appendChild(name);
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'menu-btn secondary honor-btn';
      b.textContent = t(`honor.${c}`);
      b.addEventListener('click', () => {
        void giveHonor().catch(() => 0);
        box.textContent = '';
        box.append(h, Object.assign(document.createElement('div'), { className: 'honor-hint', textContent: t('honor.thanks') }));
      });
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  panel.appendChild(box);
}
