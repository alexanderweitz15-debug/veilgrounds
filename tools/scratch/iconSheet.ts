// Icon contact sheet (see iconSheet.html): renders every item and rune icon at 64 / 48 / 34 px for review.
import { ITEMS } from '../../src/sim/items/inventory';
import { RUNES } from '../../src/sim/items/runes';
import { itemIcon, runeIcon, setIcon } from '../../src/ui/icons';

const root = document.getElementById('root')!;
const section = (title: string): HTMLElement => {
  const h = document.createElement('h2');
  h.textContent = title;
  root.appendChild(h);
  const row = document.createElement('div');
  row.className = 'row';
  root.appendChild(row);
  return row;
};
const cell = (row: HTMLElement, url: string | null, label: string, size: number): void => {
  const c = document.createElement('div');
  c.className = 'cell';
  const ic = document.createElement('div');
  ic.className = 'ic';
  ic.style.width = ic.style.height = `${size}px`;
  setIcon(ic, url);
  const s = document.createElement('span');
  s.textContent = label;
  c.append(ic, s);
  row.appendChild(c);
};
for (const size of [64, 48, 34]) {
  const row = section(`Items ${size} px`);
  for (const it of ITEMS) cell(row, itemIcon(it.id), it.name.de, size);
}
for (const size of [64, 40]) {
  const row = section(`Prägungen ${size} px`);
  for (const r of RUNES) cell(row, runeIcon(r.id, r.kind === 'keystone'), r.name.de, size);
}
