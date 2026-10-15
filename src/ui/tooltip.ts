// LoL-style hover tooltips for everything with an icon: abilities (incl. passive), items, summoner spells, runes.
// Elements opt in with `data-tip` ("ability:<champ>:<slot>[:<rank>]", "passive:<champ>", "item:<id>",
// "summoner:<id>", "rune:<id>", "text:<plain text>"); one delegated listener renders a single floating panel.
import './tooltip.css';
import type { Effect, Ranked, Scaling } from '../sim/champions/schema';
import { CHAMPION_DATA } from '../sim/champions';
import { itemById } from '../sim/items/inventory';
import { RUNES } from '../sim/items/runes';
import { summonerDef } from '../sim/summoners';
import { settings } from '../settings';
import { t } from '../i18n';
import { abilityIcon, itemIcon, passiveIcon, runeIcon, summonerIcon } from './icons';
import { statLines } from './shop';
import { summonerName } from './names';

interface Tip {
  icon: string | null;
  title: string;
  sub?: string;
  /** Right-aligned header facts (cooldown, cost, range). */
  meta: string[];
  /** Coloured scaling chips ("Schaden 60/95/130 (+70 % AP)"). */
  chips?: { text: string; cls: string }[];
  body: string[];
  foot?: string;
}

const de = (): boolean => settings.lang === 'de';
const L = (d: string, e: string): string => (de() ? d : e);
const KEYS = ['Q', 'W', 'E', 'R'];

/** "60/95/130" with the current rank highlighted via brackets is not possible in text; rank shown in the sub line. */
const ranked = (v: Ranked | undefined): string => (v === undefined ? '' : Array.isArray(v) ? (v.every((x) => x === v[0]) ? fmt(v[0]!) : v.map(fmt).join('/')) : fmt(v));
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 1 : 0)).replace('.', de() ? ',' : '.');
const pct = (r: number): string => `${fmt(Math.round(r * 1000) / 10)} %`;

function scalingText(s: Scaling): { text: string; cls: string } {
  const base = s.byLevel ? `${fmt(s.byLevel[0])}–${fmt(s.byLevel[1])} (${L('nach Stufe', 'by level')})` : ranked(s.base);
  const parts: [number | undefined, string, string][] = [
    [s.ad, L('AD', 'AD'), 'ad'],
    [s.bonusAd, L('Bonus-AD', 'bonus AD'), 'ad'],
    [s.ap, 'AP', 'ap'],
    [s.maxHp, L('max. HP', 'max HP'), 'hp'],
    [s.bonusHp, L('Bonus-HP', 'bonus HP'), 'hp'],
    [s.targetMaxHp, L('max. HP des Ziels', "target's max HP"), 'hp'],
    [s.targetMissingHp, L('fehlende HP des Ziels', "target's missing HP"), 'hp'],
  ];
  const ratios = parts.filter(([v]) => v).map(([v, n]) => `+${pct(v!)} ${n}`);
  const cls = parts.find(([v]) => v)?.[2] ?? 'flat';
  return { text: ratios.length ? `${base} (${ratios.join(', ')})` : base, cls };
}

function effectChips(effects: Effect[]): { text: string; cls: string }[] {
  const out: { text: string; cls: string }[] = [];
  for (const e of effects) {
    if (e.kind === 'damage') {
      const s = scalingText(e.amount);
      const type = { phys: L('körperlicher Schaden', 'physical damage'), magic: L('magischer Schaden', 'magic damage'), true: L('absoluter Schaden', 'true damage') }[e.type];
      out.push({ text: `${s.text} ${type}`, cls: `dmg-${e.type}` });
    } else if (e.kind === 'heal') out.push({ text: `${L('Heilung', 'Heal')} ${scalingText(e.amount).text}`, cls: 'heal' });
    else if (e.kind === 'shield') out.push({ text: `${L('Schild', 'Shield')} ${scalingText(e.amount).text} (${fmt(e.duration)} s)`, cls: 'shield' });
    else if (e.kind === 'slow') out.push({ text: `${L('Verlangsamung', 'Slow')} ${ranked(e.pct)} % / ${ranked(e.duration)} s`, cls: 'cc' });
    else if (['root', 'stun', 'airborne', 'blind', 'silence', 'stasis'].includes(e.kind)) {
      const n: Record<string, [string, string]> = { root: ['Festhalten', 'Root'], stun: ['Betäubung', 'Stun'], airborne: ['Hochschleudern', 'Knock-up'], blind: ['Blendung', 'Blind'], silence: ['Verstummen', 'Silence'], stasis: ['Stasis', 'Stasis'] };
      out.push({ text: `${L(...n[e.kind]!)} ${ranked((e as { duration: Ranked }).duration)} s`, cls: 'cc' });
    } else if (e.kind === 'knockback' || e.kind === 'pull') out.push({ text: `${e.kind === 'pull' ? L('Heranziehen', 'Pull') : L('Rückstoß', 'Knockback')} ${fmt(e.distance)}`, cls: 'cc' });
  }
  return out;
}

function abilityTip(champ: string, slot: number, rank: number): Tip | null {
  const c = CHAMPION_DATA[champ];
  const a = c?.abilities[slot];
  if (!c || !a) return null;
  const cost = a.costType === 'none' || !a.cost ? '' : `${ranked(a.cost)} ${a.costType === 'mana' ? L('Mana', 'mana') : a.costType === 'energy' ? L('Energie', 'energy') : 'HP'}`;
  const range = typeof a.range === 'number' ? a.range : a.range[0];
  const max = slot === 3 ? 3 : 5;
  return {
    icon: abilityIcon(champ, slot),
    title: a.name[settings.lang],
    // rank < 0: outside a match (lobby, encyclopedia) - no rank line
    sub: rank < 0 ? `${KEYS[slot]} · ${slot === 3 ? L('Ultimative Fähigkeit', 'Ultimate') : L('Fähigkeit', 'Ability')}` : `${KEYS[slot]} · ${rank > 0 ? L(`Rang ${rank}/${max}`, `Rank ${rank}/${max}`) : L('Nicht erlernt', 'Not learned')}`,
    meta: [`⟳ ${ranked(a.cooldown)} s`, ...(cost ? [cost] : []), ...(range ? [`${L('Reichweite', 'Range')} ${fmt(range)}`] : [])],
    chips: effectChips(a.effects),
    body: [a.desc[settings.lang]],
  };
}

function passiveTip(champ: string): Tip | null {
  const c = CHAMPION_DATA[champ];
  if (!c) return null;
  return { icon: passiveIcon(champ), title: c.passive.name[settings.lang], sub: L('Passiv', 'Passive'), meta: [], body: [c.passive.desc[settings.lang]] };
}

function itemTip(id: string): Tip | null {
  const it = itemById(id);
  if (!it) return null;
  const body: string[] = [];
  if (it.passive) body.push(`${L('Passiv', 'Passive')} – ${it.passive.name[settings.lang]}: ${it.passive.desc[settings.lang]}`);
  if (it.active) body.push(`${L('Aktiv', 'Active')} – ${it.active.name[settings.lang]}: ${it.active.desc[settings.lang]}`);
  const from = it.from.map((f) => itemById(f)?.name[settings.lang] ?? f);
  return {
    icon: itemIcon(id),
    title: it.name[settings.lang],
    sub: t(`shop.tier.${it.tier}`) !== `shop.tier.${it.tier}` ? t(`shop.tier.${it.tier}`) : undefined,
    meta: [`◉ ${it.cost}`],
    chips: statLines(it).map((s) => ({ text: s, cls: 'stat' })),
    body,
    ...(from.length ? { foot: `${L('Aus', 'Built from')}: ${from.join(' + ')}` } : {}),
  };
}

const SUMMONER_DESC: Record<string, [string, string]> = {
  sprung: ['Teleportiert dich bis zu 400 Einheiten in Richtung Cursor.', 'Teleports you up to 400 units towards the cursor.'],
  heilen: ['Heilt dich und den nächsten Verbündeten (90–345 nach Stufe) und gibt 1 s lang +30 % Lauftempo.', 'Heals you and the nearest ally (90–345 by level) and grants +30% move speed for 1 s.'],
  geist: ['10 s lang +24–48 % Lauftempo (nach Stufe), du ignorierst Einheitenkollision.', '+24–48% move speed (by level) for 10 s, ignore unit collision.'],
  entflammen: ['Setzt einen gegnerischen Champion 5 s in Brand (60–410 absoluter Schaden) und verringert seine Heilung um 40 %.', 'Ignites an enemy champion for 5 s (60–410 true damage) and reduces its healing by 40%.'],
  erschoepfen: ['Verlangsamt einen gegnerischen Champion und verringert seinen verursachten Schaden für kurze Zeit.', 'Slows an enemy champion and reduces the damage it deals for a short time.'],
  reinigen: ['Entfernt Verlangsamung, Betäubung, Festhalten, Verstummen und Blendung und gibt kurz Zähigkeit.', 'Removes slows, stuns, roots, silences and blinds and grants brief tenacity.'],
  teleport: ['Kanalisiert und teleportiert dich zu einem verbündeten Turm, Vasallen oder Ward.', 'Channels, then teleports you to an allied tower, minion or ward.'],
  bannen: ['Verursacht 450–900 absoluten Schaden an einem Monster oder Vasallen in 500 Reichweite.', 'Deals 450–900 true damage to a monster or minion within 500 range.'],
};

function summonerTip(id: string): Tip | null {
  const d = summonerDef(id);
  if (!d) return null;
  const desc = SUMMONER_DESC[id];
  return { icon: summonerIcon(id), title: summonerName(id), sub: L('Beschwörerzauber', 'Summoner spell'), meta: [`⟳ ${d.cooldown} s`], body: desc ? [L(...desc)] : [] };
}

function runeTip(id: string): Tip | null {
  const r = RUNES.find((x) => x.id === id);
  if (!r) return null;
  const key = r.kind === 'keystone';
  return { icon: runeIcon(id, key), title: r.name[settings.lang], sub: key ? L('Schlüsselprägung', 'Keystone') : L('Nebenprägung', 'Minor rune'), meta: [], body: [r.desc[settings.lang]] };
}

function build(spec: string): Tip | null {
  const [kind, a = '', b, c] = spec.split(':');
  switch (kind) {
    case 'ability':
      return abilityTip(a, Number(b), Number(c ?? 0));
    case 'passive':
      return passiveTip(a);
    case 'item':
      return itemTip(a);
    case 'summoner':
      return summonerTip(a);
    case 'rune':
      return runeTip(a);
    case 'text':
      return { icon: null, title: spec.slice(5), meta: [], body: [] };
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------ panel
let panel: HTMLDivElement | null = null;
let current: HTMLElement | null = null;

function h(tag: string, cls: string, parent: HTMLElement, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function render(tip: Tip): void {
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'vg-tip';
    panel.setAttribute('role', 'tooltip');
  }
  // fullscreen game root or body: the panel must live inside the fullscreen element to be visible
  const host = (document.fullscreenElement as HTMLElement | null) ?? document.body;
  if (panel.parentElement !== host) host.appendChild(panel);
  panel.textContent = '';
  const head = h('div', 'tip-head', panel);
  if (tip.icon) {
    const i = h('div', 'tip-icon', head);
    i.style.backgroundImage = `url("${tip.icon}")`;
  }
  const names = h('div', 'tip-names', head);
  h('div', 'tip-title', names, tip.title);
  if (tip.sub) h('div', 'tip-sub', names, tip.sub);
  if (tip.meta.length) {
    const m = h('div', 'tip-meta', head);
    for (const x of tip.meta) h('div', '', m, x);
  }
  if (tip.chips?.length) {
    const cs = h('div', 'tip-chips', panel);
    for (const c of tip.chips) h('div', `tip-chip ${c.cls}`, cs, c.text);
  }
  for (const b of tip.body) h('p', 'tip-body', panel, b);
  if (tip.foot) h('div', 'tip-foot', panel, tip.foot);
  panel.classList.add('show');
}

function place(x: number, y: number): void {
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const pad = 14;
  let px = x + pad;
  let py = y - r.height - pad;
  if (px + r.width > innerWidth - 4) px = x - r.width - pad;
  if (py < 4) py = y + pad + 10;
  if (py + r.height > innerHeight - 4) py = innerHeight - r.height - 4;
  panel.style.left = `${Math.max(4, px)}px`;
  panel.style.top = `${Math.max(4, py)}px`;
}

function hide(): void {
  current = null;
  panel?.classList.remove('show');
}

let installed = false;
/** Installs the delegated hover handlers once (idempotent). */
export function installTooltips(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    if (el === current) return;
    if (!el) return hide();
    const tip = build(el.dataset.tip!);
    if (!tip) return hide();
    current = el;
    render(tip);
    place(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (current) place(e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('blur', hide);
}

/** Sets an element's tooltip spec; a changed spec on the hovered element re-renders live (rank-ups). */
export function setTip(el: HTMLElement, spec: string | null): void {
  installTooltips(); // lazy: only the (code-split) screens that use tooltips pull this module in
  if (el.dataset.tip === (spec ?? undefined)) return;
  if (spec) el.dataset.tip = spec;
  else delete el.dataset.tip;
  el.removeAttribute('title');
  if (el === current) {
    const tip = spec ? build(spec) : null;
    if (tip) render(tip);
    else hide();
  }
}
