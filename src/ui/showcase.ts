// Champion showcase for lobbies and the encyclopedia: painted splash (4:5) next to name, title, roles and the
// passive + Q/W/E/R icons with LoL-style hover tooltips (src/ui/tooltip.ts).
import './showcase.css';
import { CHAMPION_DATA } from '../sim/champions';
import { setSplash } from '../render/portraits';
import { settings } from '../settings';
import { t } from '../i18n';
import { abilityIcon, passiveIcon, roleIcon, setIcon } from './icons';
import { setTip } from './tooltip';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function renderShowcase(parent: HTMLElement, id: string): HTMLElement {
  const d = CHAMPION_DATA[id];
  const box = el('div', 'showcase', parent);
  if (!d) return box;
  const splash = el('div', 'showcase-splash', box);
  setSplash(splash, id);
  const info = el('div', 'showcase-info', box);
  el('div', 'showcase-name', info, d.name);
  el('div', 'showcase-title', info, d.title[settings.lang]);
  const roles = el('div', 'showcase-roles', info);
  for (const r of d.roles) {
    const chip = el('span', 'showcase-role', roles);
    setIcon(el('span', 'role-icon', chip), roleIcon(r));
    chip.append(t(`role.${r}`));
  }
  el('div', 'showcase-meta', info, `${d.attackType === 'ranged' ? t('enc.ranged') : t('enc.melee')} · ${t('enc.range')} ${d.base.range}`);
  const abs = el('div', 'showcase-abilities', info);
  const pas = el('div', 'showcase-ab passive', abs);
  setIcon(pas, passiveIcon(id));
  setTip(pas, `passive:${id}`);
  el('span', 'key', pas, 'P');
  d.abilities.forEach((_, i) => {
    const b = el('div', `showcase-ab${i === 3 ? ' ult' : ''}`, abs);
    setIcon(b, abilityIcon(id, i));
    setTip(b, `ability:${id}:${i}:-1`);
    el('span', 'key', b, 'QWER'[i]!);
  });
  el('div', 'showcase-hint', info, t('showcase.hint'));
  return box;
}
