// Post-game build review: the items the player ended with, and the core items of the champion's standard build that were
// still missing (hint for the next game). The build data is the bots' (src/ai/bot/builds.ts), read-only.
import { t } from '../i18n';
import { missingCore } from './buildReviewCalc';
import { itemById } from '../sim/items/inventory';
import { itemIcon } from './icons';
import { setTip } from './tooltip';

function strip(parent: HTMLElement, ids: readonly string[]): void {
  const row = document.createElement('div');
  row.className = 'br-row';
  for (const id of ids) {
    const it = document.createElement('span');
    it.className = 'br-item';
    it.style.backgroundImage = `url("${itemIcon(id)}")`;
    setTip(it, `item:${id}`);
    row.appendChild(it);
  }
  parent.appendChild(row);
}

export function renderBuildReview(panel: HTMLElement, champion: string, items: readonly (string | null)[] | undefined): void {
  if (!items) return;
  const owned = items.filter((x): x is string => !!x && !!itemById(x));
  if (!owned.length) return;
  const box = document.createElement('div');
  box.className = 'br-box';
  const h = document.createElement('h3');
  h.className = 'pg-h3';
  h.textContent = t('build.title');
  box.appendChild(h);
  strip(box, owned);
  const miss = missingCore(champion, items).slice(0, 4);
  if (miss.length) {
    const l = document.createElement('div');
    l.className = 'br-label';
    l.textContent = t('build.missing');
    box.appendChild(l);
    strip(box, miss);
  }
  panel.appendChild(box);
}
