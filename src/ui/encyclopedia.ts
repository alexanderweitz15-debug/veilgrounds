// Encyclopedia (spec §13: every ability, item and bot parameter viewable in game). Pure data views, no sim.
import { CHAMPION_DATA } from '../sim/champions';
import type { AbilityData, Effect, Ranked, Scaling } from '../sim/champions/schema';
import itemsJson from '../data/items.json';
import type { ItemData } from '../sim/items/schema';
import { RUNES } from '../sim/items/runes';
import { PROFILES } from '../ai/profiles';
import { PLAYSTYLE_AXES, ARCHETYPES } from '../ai/contract';
import { AXIS_LABELS, ARCHETYPE_NAMES, ARCHETYPE_PLAYSTYLES, signed } from '../ai/params';
import { settings } from '../settings';
import { setPortrait, setSplash } from '../render/portraits';
import { setTip } from './tooltip';
import { abilityIcon, itemIcon, passiveIcon, runeIcon, setIcon } from './icons';
import './showcase.css';

type Lang = 'de' | 'en';
const L = (de: string, en: string): string => (settings.lang === 'de' ? de : en);
const items = itemsJson.items as unknown as ItemData[];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const ranked = (r: Ranked | undefined, unit = ''): string => (r === undefined ? '–' : Array.isArray(r) ? r.join('/') + unit : `${r}${unit}`);
const pct = (v?: number): string => (v ? `${Math.round(v * 100)} %` : '');

function scaling(s: Scaling): string {
  const parts = [s.byLevel ? `${s.byLevel[0]}–${s.byLevel[1]} (Lvl)` : ranked(s.base)];
  const r: [number | undefined, string][] = [
    [s.ad, 'AD'],
    [s.bonusAd, L('Bonus-AD', 'bonus AD')],
    [s.ap, 'AP'],
    [s.maxHp, L('max. HP', 'max HP')],
    [s.bonusHp, L('Bonus-HP', 'bonus HP')],
    [s.targetMaxHp, L('max. HP Ziel', 'target max HP')],
    [s.targetMissingHp, L('fehlende HP Ziel', 'target missing HP')],
  ];
  for (const [v, n] of r) if (v) parts.push(`+${pct(v)} ${n}`);
  return parts.join(' ');
}

function effectText(e: Effect): string {
  switch (e.kind) {
    case 'damage':
      return `${L('Schaden', 'Damage')} (${e.type === 'phys' ? L('phys.', 'phys.') : e.type === 'magic' ? L('mag.', 'magic') : L('wahr', 'true')}): ${scaling(e.amount)}`;
    case 'heal':
      return `${L('Heilung', 'Heal')}: ${scaling(e.amount)}`;
    case 'shield':
      return `${L('Schild', 'Shield')}: ${scaling(e.amount)}, ${e.duration} s`;
    case 'slow':
      return `${L('Verlangsamung', 'Slow')} ${ranked(e.pct, ' %')}, ${ranked(e.duration, ' s')}`;
    case 'knockback':
    case 'pull':
      return `${e.kind === 'pull' ? L('Zug', 'Pull') : L('Rückstoß', 'Knockback')} ${e.distance}`;
    case 'buff':
      return `${L('Buff', 'Buff')} ${e.stat} ${e.pct !== undefined ? ranked(e.pct, ' %') : ranked(e.flat)}, ${ranked(e.duration, ' s')}`;
    case 'reveal':
      return `${L('Enthüllt', 'Reveals')} ${e.duration} s`;
    case 'mark':
      return `${L('Markiert', 'Marks')} ${e.duration} s`;
    case 'hook':
      return L('Spezial-Logik', 'special logic');
    default:
      return `${e.kind} ${ranked((e as { duration: Ranked }).duration, ' s')}`;
  }
}

function abilityBlock(a: AbilityData, key: string, parent: HTMLElement, lang: Lang): void {
  const box = el('div', 'enc-ability', undefined, parent);
  const head = el('div', 'enc-ab-head', undefined, box);
  el('span', 'enc-key', key, head);
  el('span', 'enc-ab-name', a.name[lang], head);
  el('span', 'enc-ab-type', a.type, head);
  el('p', 'enc-desc', a.desc[lang], box);
  const facts: [string, string][] = [
    [L('Reichweite', 'Range'), ranked(a.range)],
    [L('Abklingzeit', 'Cooldown'), ranked(a.cooldown, ' s')],
    [L('Kosten', 'Cost'), a.costType === 'none' ? '–' : `${ranked(a.cost)} ${a.costType}`],
    [L('Cast-Zeit', 'Cast time'), `${a.castTime} s`],
  ];
  if (a.width) facts.push([L('Breite', 'Width'), String(a.width)]);
  if (a.speed) facts.push([L('Geschw.', 'Speed'), String(a.speed)]);
  if (a.radius) facts.push(['Radius', String(a.radius)]);
  if (a.angle) facts.push([L('Winkel', 'Angle'), `${a.angle}°`]);
  if (a.delay) facts.push([L('Verzögerung', 'Delay'), `${a.delay} s`]);
  const grid = el('div', 'enc-facts', undefined, box);
  for (const [k, v] of facts) {
    el('span', 'k', k, grid);
    el('span', 'v', v, grid);
  }
  const ul = el('ul', 'enc-effects', undefined, box);
  for (const e of a.effects) if (e.kind !== 'hook') el('li', '', effectText(e), ul);
  if (a.flags?.length) el('div', 'enc-flags', a.flags.join(' · '), box);
}

function championsTab(body: HTMLElement, lang: Lang): void {
  const ids = Object.keys(CHAMPION_DATA).sort((a, b) => CHAMPION_DATA[a]!.name.localeCompare(CHAMPION_DATA[b]!.name));
  const list = el('div', 'enc-list', undefined, body);
  const detail = el('div', 'enc-detail', undefined, body);
  const show = (id: string): void => {
    for (const b of list.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === id);
    const c = CHAMPION_DATA[id]!;
    detail.textContent = '';
    const pic = el('div', 'enc-portrait', undefined, detail);
    pic.style.cssText = 'float:right;width:168px;height:210px;margin:0 0 8px 12px;border:1px solid #6b5a35;background:#1c1824';
    setSplash(pic, id);
    el('h2', '', c.name, detail);
    el('div', 'enc-sub', `${c.title[lang]} · ${c.roles.join(' / ')} · ${c.attackType === 'melee' ? L('Nahkampf', 'melee') : L('Fernkampf', 'ranged')} ${c.base.range}`, detail);
    el('p', 'enc-desc', c.trainingPurpose[lang], detail);
    const b = c.base;
    const stats = el('div', 'enc-facts wide', undefined, detail);
    for (const [k, v] of [
      ['HP', `${b.hp} (+${b.hpGrowth})`],
      ['AD', `${b.ad} (+${b.adGrowth})`],
      [L('Rüstung', 'Armor'), `${b.armor} (+${b.armorGrowth})`],
      ['MR', `${b.mr} (+${b.mrGrowth})`],
      ['AS', `${b.as} (+${b.asGrowth} %)`],
      [L('Tempo', 'MS'), String(b.ms)],
    ] as [string, string][]) {
      el('span', 'k', k, stats);
      el('span', 'v', v, stats);
    }
    const p = el('div', 'enc-ability', undefined, detail);
    const ph = el('div', 'enc-ab-head', undefined, p);
    const pi = el('span', 'enc-ab-icon', undefined, ph);
    setIcon(pi, passiveIcon(id));
    setTip(pi, `passive:${id}`);
    el('span', 'enc-key', 'P', ph);
    el('span', 'enc-ab-name', c.passive.name[lang], ph);
    el('p', 'enc-desc', c.passive.desc[lang], p);
    c.abilities.forEach((a, i) => {
      abilityBlock(a, 'QWER'[i]!, detail, lang);
      const head = detail.lastElementChild?.querySelector<HTMLElement>('.enc-ab-head');
      if (!head) return;
      const ic = document.createElement('span');
      ic.className = 'enc-ab-icon';
      setIcon(ic, abilityIcon(id, i));
      setTip(ic, `ability:${id}:${i}:-1`);
      head.prepend(ic);
    });
    el('div', 'field-label', 'Power-Spike', detail);
    el('div', '', `${L('Level', 'Level')} ${c.spikeLevels.join(', ')} – ${c.spikeNote[lang]}`, detail);
    el('div', 'field-label', 'Signature-Combos', detail);
    const cl = el('ul', 'enc-effects', undefined, detail);
    for (const k of c.combos) el('li', '', `${k.name[lang]}: ${k.sequence.join(' → ')}`, cl);
  };
  for (const id of ids) {
    const b = el('button', 'enc-champ-btn', undefined, list);
    setPortrait(el('span', 'enc-mini-portrait', undefined, b), id);
    b.append(CHAMPION_DATA[id]!.name);
    b.dataset.id = id;
    b.addEventListener('click', () => show(id));
  }
  show(ids[0]!);
}

function itemsTab(body: HTMLElement, lang: Lang): void {
  const wrap = el('div', 'enc-scroll', undefined, body);
  const tiers: [ItemData['tier'], string][] = [
    ['starter', L('Startitems', 'Starter')],
    ['basic', L('Basis', 'Basic')],
    ['component', L('Komponenten', 'Components')],
    ['legendary', L('Legendär', 'Legendary')],
    ['boots', L('Stiefel', 'Boots')],
    ['consumable', L('Verbrauch', 'Consumables')],
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [tier, label] of tiers) {
    el('h3', '', label, wrap);
    const grid = el('div', 'enc-items', undefined, wrap);
    for (const it of items.filter((i) => i.tier === tier)) {
      const c = el('div', 'enc-item', undefined, grid);
      const hd = el('div', 'enc-ab-head', undefined, c);
      const ii = el('span', 'enc-ab-icon', undefined, hd);
      setIcon(ii, itemIcon(it.id));
      setTip(ii, `item:${it.id}`);
      el('span', 'enc-ab-name', it.name[lang], hd);
      el('span', 'enc-gold', String(it.cost), hd);
      el('div', 'enc-sub', Object.entries(it.stats).map(([k, v]) => `+${v} ${k}`).join(' · ') || '–', c);
      if (it.from.length) el('div', 'enc-sub', `${L('aus', 'from')}: ${it.from.map((f) => byId.get(f)?.name[lang] ?? f).join(' + ')}`, c);
      if (it.passive) el('p', 'enc-desc', `${it.passive.name[lang]}: ${it.passive.desc[lang]}`, c);
      if (it.active) el('p', 'enc-desc', `${L('Aktiv', 'Active')} – ${it.active.name[lang]}: ${it.active.desc[lang]} (CD ${it.active.cooldown} s)`, c);
    }
  }
  el('h3', '', L('Prägungen', 'Runes'), wrap);
  const rg = el('div', 'enc-items', undefined, wrap);
  for (const r of RUNES) {
    const c = el('div', 'enc-item', undefined, rg);
    const rh = el('div', 'enc-ab-head', undefined, c);
    const ri = el('span', 'enc-ab-icon', undefined, rh);
    setIcon(ri, runeIcon(r.id, r.kind === 'keystone'));
    setTip(ri, `rune:${r.id}`);
    el('span', 'enc-ab-name', `${r.name[lang]}${r.kind === 'keystone' ? ' ★' : ''}`, rh);
    el('p', 'enc-desc', r.desc[lang], c);
  }
}

const RANK_LABEL: Record<string, string> = {
  iron: 'Eisen', bronze: 'Bronze', silver: 'Silber', gold: 'Gold', platinum: 'Platin', emerald: 'Smaragd',
  diamond: 'Diamant', master: 'Meister', grandmaster: 'Großmeister', challenger: 'Challenger',
};

function ranksTab(body: HTMLElement, lang: Lang): void {
  const wrap = el('div', 'enc-scroll', undefined, body);
  el('p', 'enc-desc', L('Alle Bot-Parameter stammen aus src/data/bots/profiles/<rang>.json. Kein Wert ist im Code fest verdrahtet.', 'All bot parameters come from src/data/bots/profiles/<rank>.json; none are hard-coded.'), wrap);
  const table = el('table', 'enc-table', undefined, wrap);
  const head = el('tr', '', undefined, el('thead', '', undefined, table));
  el('th', '', L('Parameter', 'Parameter'), head);
  for (const p of PROFILES) el('th', '', lang === 'de' ? RANK_LABEL[p.rank]! : p.rank, head);
  const tb = el('tbody', '', undefined, table);
  const rows = (obj: (p: (typeof PROFILES)[number]) => Record<string, unknown>, label: string): void => {
    const sec = el('tr', 'sec', undefined, tb);
    el('td', '', label, sec).colSpan = PROFILES.length + 1;
    for (const k of Object.keys(obj(PROFILES[0]!))) {
      const tr = el('tr', '', undefined, tb);
      el('td', 'k', k, tr);
      for (const p of PROFILES) {
        const v = obj(p)[k];
        el('td', '', v === null ? '–' : String(v), tr);
      }
    }
  };
  rows((p) => p.targets as unknown as Record<string, unknown>, L('Zielwerte (Tabelle A)', 'Targets (table A)'));
  rows((p) => p.behavior as unknown as Record<string, unknown>, L('Verhalten (Tabelle B)', 'Behaviour (table B)'));
  for (const p of PROFILES) {
    el('h3', '', lang === 'de' ? RANK_LABEL[p.rank]! : p.rank, wrap);
    el('p', 'enc-desc', p.notes[lang], wrap);
  }
}

function stylesTab(body: HTMLElement, lang: Lang): void {
  const wrap = el('div', 'enc-scroll', undefined, body);
  el('p', 'enc-desc', L('Spielstile sind unabhängig vom Rang: Der Rang bestimmt, wie gut ein Bot spielt, der Stil, wie er spielt.', 'Play styles are independent of rank: rank decides how well a bot plays, style decides how.'), wrap);
  for (const a of PLAYSTYLE_AXES) el('div', 'enc-style', `${AXIS_LABELS[a].name[lang]}: ${AXIS_LABELS[a].left[lang]}  ◄─ −5 … +5 ─►  ${AXIS_LABELS[a].right[lang]}`, wrap);
  el('h3', '', L('Archetypen', 'Archetypes'), wrap);
  for (const id of ARCHETYPES) {
    const p = ARCHETYPE_PLAYSTYLES[id];
    el('div', 'enc-style', `${ARCHETYPE_NAMES[id][lang]}: ${PLAYSTYLE_AXES.map((a) => `${AXIS_LABELS[a].name[lang]} ${signed(p[a])}`).join(', ')}`, wrap);
  }
}

export function renderEncyclopedia(parent: HTMLElement, onBack: () => void): void {
  const lang = settings.lang;
  const panel = el('div', 'menu-panel enc', undefined, parent);
  const top = el('div', 'enc-top', undefined, panel);
  el('h2', '', L('Enzyklopädie', 'Encyclopedia'), top);
  const tabs = el('div', 'role-tabs', undefined, top);
  const back = el('button', 'menu-btn secondary', L('Zurück', 'Back'), top);
  back.addEventListener('click', onBack);
  const body = el('div', 'enc-body', undefined, panel);
  const views: [string, (b: HTMLElement, l: Lang) => void][] = [
    [L('Champions', 'Champions'), championsTab],
    [L('Items & Prägungen', 'Items & runes'), itemsTab],
    [L('Bot-Ränge', 'Bot ranks'), ranksTab],
    [L('Spielstile', 'Play styles'), stylesTab],
  ];
  const open = (i: number): void => {
    for (const [j, b] of [...tabs.children].entries()) b.classList.toggle('active', i === j);
    body.textContent = '';
    body.className = `enc-body ${i === 0 ? 'split' : ''}`;
    views[i]![1](body, lang);
  };
  views.forEach(([label], i) => el('button', 'role-tab', label, tabs).addEventListener('click', () => open(i)));
  open(0);
}
