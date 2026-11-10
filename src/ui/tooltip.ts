// LoL-style hover tooltips for everything with an icon: abilities (incl. passive), items, summoner spells, runes.
// Elements opt in with `data-tip` ("ability:<champ>:<slot>[:<rank>]", "passive:<champ>", "item:<id>[:shop]",
// "summoner:<id>", "rune:<id>", "text:<plain text>"); one delegated listener renders a single floating panel.
// Live numbers: hud.ts feeds the player's stats via setTipContext(); ability damage shows "80 (+42)" resolved with the
// current AD / AP / HP, cooldowns include ability haste, the learned rank is highlighted (maths: tooltipMath.ts).
import './tooltip.css';
import type { Effect, Ranked } from '../sim/champions/schema';
import { CHAMPION_DATA } from '../sim/champions';
import { abilityForSlot } from '../data/champions';
import { ITEMS, itemById, recipePrice, sellValue } from '../sim/items/inventory';
import { RUNES } from '../sim/items/runes';
import { BARRIER_SHIELD, summonerDef } from '../sim/summoners';
import type { PlayerHud } from '../sim/snapshot';
import { settings } from '../settings';
import { t } from '../i18n';
import { abilityIcon, itemIcon, passiveIcon, runeIcon, summonerIcon } from './icons';
import { statLines } from './shop';
import { goldEfficiency } from './goldEfficiency';
import { summonerName } from './names';
import { S, buildTree, byLevelValue, compareStats, compareTarget, fmtNum, hasteCooldown, hasteReductionPct, isPctStat, keywordSegs, rankedSegs, scalingSegs, type Lang, type Ratio, type Seg, type TipStats } from './tooltipMath';

interface Tip {
  icon: string | null;
  title: string;
  sub?: string;
  /** Right-aligned header facts (cooldown, cost, range), one run list per line. */
  meta: Seg[][];
  /** Coloured scaling chips ("Schaden 60/95/130 (+70 % AP)"). */
  chips?: { segs: Seg[]; cls: string }[];
  body: Seg[][];
  foot?: Seg[][];
}

const lang = (): Lang => settings.lang;
const de = (): boolean => settings.lang === 'de';
const L = (d: string, e: string): string => (de() ? d : e);
const KEYS = ['Q', 'W', 'E', 'R'];
const P = (s: string): Seg[] => [S(s)];

// ------------------------------------------------------------------------------------------------ live context
interface Ctx {
  stats: TipStats;
  items: (string | null)[];
}
let ctx: Ctx | null = null;
let lastLive = 0;

/** Called by the HUD every snapshot with the player's state (null outside a match). Re-renders a hovered tip ~2x per second. */
export function setTipContext(me: PlayerHud | null): void {
  if (!me) {
    ctx = null;
    return;
  }
  const s = me.stats;
  ctx = { stats: { level: me.level, ad: s.ad, bonusAd: s.bonusAd ?? 0, ap: s.ap, maxHp: s.maxHp ?? 0, bonusHp: s.bonusHp ?? 0, haste: s.haste ?? 0 }, items: me.items };
  const now = performance.now();
  if (current && now - lastLive > 450) {
    lastLive = now;
    const tip = build(current.dataset.tip!);
    if (tip) render(tip);
  }
}

const NAMES = (): Record<Ratio['key'], string> => ({
  ad: 'AD',
  bonusAd: L('Bonus-AD', 'bonus AD'),
  ap: 'AP',
  maxHp: L('max. HP', 'max HP'),
  bonusHp: L('Bonus-HP', 'bonus HP'),
  targetMaxHp: L('max. HP des Ziels', "target's max HP"),
  targetMissingHp: L('fehlende HP des Ziels', "target's missing HP"),
});

// ------------------------------------------------------------------------------------------------ abilities
function effectChips(effects: Effect[], rank: number): { segs: Seg[]; cls: string }[] {
  const out: { segs: Seg[]; cls: string }[] = [];
  const rs = (v: Ranked, dp?: number): Seg[] => rankedSegs(v, rank, lang(), undefined, dp);
  const sc = (s: Parameters<typeof scalingSegs>[0]): Seg[] => scalingSegs(s, rank, ctx?.stats ?? null, lang(), NAMES(), L('nach Stufe', 'by level'));
  for (const e of effects) {
    if (e.kind === 'damage') {
      const type = { phys: L('körperlicher Schaden', 'physical damage'), magic: L('magischer Schaden', 'magic damage'), true: L('absoluter Schaden', 'true damage') }[e.type];
      out.push({ segs: [...sc(e.amount), S(` ${type}`)], cls: `dmg-${e.type}` });
    } else if (e.kind === 'heal') out.push({ segs: [S(`${L('Heilung', 'Heal')} `), ...sc(e.amount)], cls: 'heal' });
    else if (e.kind === 'shield') out.push({ segs: [S(`${L('Schild', 'Shield')} `), ...sc(e.amount), S(` (${fmtNum(e.duration, lang())} s)`)], cls: 'shield' });
    else if (e.kind === 'slow') out.push({ segs: [S(`${L('Verlangsamung', 'Slow')} `), ...rs(e.pct), S(' % / '), ...rs(e.duration), S(' s')], cls: 'cc' });
    else if (['root', 'stun', 'airborne', 'blind', 'silence', 'stasis'].includes(e.kind)) {
      const n: Record<string, [string, string]> = { root: ['Festhalten', 'Root'], stun: ['Betäubung', 'Stun'], airborne: ['Hochschleudern', 'Knock-up'], blind: ['Blendung', 'Blind'], silence: ['Verstummen', 'Silence'], stasis: ['Stasis', 'Stasis'] };
      out.push({ segs: [S(`${L(...n[e.kind]!)} `), ...rs((e as { duration: Ranked }).duration), S(' s')], cls: 'cc' });
    } else if (e.kind === 'knockback' || e.kind === 'pull') out.push({ segs: P(`${e.kind === 'pull' ? L('Heranziehen', 'Pull') : L('Rückstoß', 'Knockback')} ${fmtNum(e.distance, lang())}`), cls: 'cc' });
  }
  return out;
}

function abilityTip(champ: string, slot: number, rank: number): Tip | null {
  const c = CHAMPION_DATA[champ];
  const a = abilityForSlot(champ, slot); // 4..6 = R choices (Sev)
  if (!c || !a) return null;
  const haste = ctx?.stats.haste ?? 0;
  const live = ctx !== null && rank >= 0; // outside a match (lobby, encyclopedia) rank is -1: plain numbers
  const r = live ? rank : 0;
  const costName = a.costType === 'mana' ? L('Mana', 'mana') : a.costType === 'energy' ? L('Energie', 'energy') : 'HP';
  const range = typeof a.range === 'number' ? a.range : a.range[0];
  const max = slot >= 3 ? 3 : 5;
  const meta: Seg[][] = [[S('⟳ '), ...rankedSegs(a.cooldown, r, lang(), live ? (v) => hasteCooldown(v, haste) : undefined, 1), S(' s')]];
  if (a.costType !== 'none' && a.cost) meta.push([...rankedSegs(a.cost, r, lang()), S(` ${costName}`)]);
  if (range) meta.push(P(`${L('Reichweite', 'Range')} ${fmtNum(range, lang())}`));
  return {
    icon: abilityIcon(champ, slot),
    title: a.name[settings.lang],
    sub: rank < 0 ? `${KEYS[Math.min(3, slot)]} · ${slot >= 3 ? L('Ultimative Fähigkeit', 'Ultimate') : L('Fähigkeit', 'Ability')}` : `${KEYS[Math.min(3, slot)]} · ${rank > 0 ? L(`Rang ${rank}/${max}`, `Rank ${rank}/${max}`) : L('Nicht erlernt', 'Not learned')}`,
    meta,
    chips: effectChips(a.effects, r),
    body: [keywordSegs(a.desc[settings.lang], lang())],
    ...(live && haste > 0 ? { foot: [P(L(`Fähigkeitstempo ${fmtNum(haste, lang())}: ${fmtNum(hasteReductionPct(haste), lang())} % weniger Abklingzeit`, `Ability haste ${fmtNum(haste, lang())}: ${fmtNum(hasteReductionPct(haste), lang())}% less cooldown`))] } : {}),
  };
}

function passiveTip(champ: string): Tip | null {
  const c = CHAMPION_DATA[champ];
  if (!c) return null;
  return { icon: passiveIcon(champ), title: c.passive.name[settings.lang], sub: L('Passiv', 'Passive'), meta: [], body: [keywordSegs(c.passive.desc[settings.lang], lang())] };
}

// ------------------------------------------------------------------------------------------------ items
function itemTip(id: string, shop: boolean): Tip | null {
  const it = itemById(id);
  if (!it) return null;
  const body: Seg[][] = [];
  if (it.passive) body.push([S(`${L('Passiv', 'Passive')} – ${it.passive.name[settings.lang]}: `, 'dim'), ...keywordSegs(it.passive.desc[settings.lang], lang())]);
  if (it.active) body.push([S(`${L('Aktiv', 'Active')} – ${it.active.name[settings.lang]}: `, 'dim'), ...keywordSegs(it.active.desc[settings.lang], lang())]);
  const tierName = t(`shop.tier.${it.tier}`) !== `shop.tier.${it.tier}` ? t(`shop.tier.${it.tier}`) : undefined;
  const meta: Seg[][] = [];
  const net = shop && ctx ? recipePrice(ctx.items, it).price : it.cost;
  meta.push(net < it.cost ? [S('◉ '), S(String(it.cost), 'strike'), S(` ${net}`, 'cur')] : P(`◉ ${it.cost}`));
  meta.push(P(t('shop.sellFor', { gold: sellValue(id) })));
  const chips = statLines(it).map((s) => ({ segs: P(s), cls: 'stat' }));
  const foot: Seg[][] = [];
  // shop only: efficiency, build tree, "builds into", difference to the owned item of the same kind
  if (shop) {
    const ge = goldEfficiency(it);
    if (ge) foot.push([S(t('shop.goldEff', { pct: ge.pct, value: ge.value }), ge.pct >= 100 ? 'good' : 'dim')]);
    if (it.from.length) {
      const tree = buildTree(it, ctx?.items ?? [], itemById);
      foot.push([S(`${L('Aus', 'Built from')}: `, 'dim'), ...tree.flatMap((n, i) => [...(i ? [S(' + ', 'dim')] : []), S(`${'· '.repeat(n.depth)}${itemById(n.id)?.name[settings.lang] ?? n.id}${n.owned ? ' ✓' : ''}`, n.owned ? 'good' : undefined)])]);
    }
    const into = ITEMS.filter((i) => i.from.includes(id)).map((i) => i.id).slice(0, 6);
    if (into.length) foot.push([S(`${L('Baut zu', 'Builds into')}: `, 'dim'), S(into.map((x) => itemById(x)?.name[settings.lang] ?? x).join(', '))]);
    const other = ctx ? compareTarget(it, ctx.items, itemById) : null;
    if (other) {
      const diff = compareStats(it, other);
      if (diff.length) foot.push([S(`${L('Gegenüber', 'Compared to')} ${other.name[settings.lang]}: `, 'dim'), ...diff.flatMap((d, i) => [...(i ? [S(', ')] : []), S(`${d.delta > 0 ? '+' : ''}${fmtNum(d.delta, lang())}${isPctStat(d.stat) ? ' %' : ''} ${t(`stat.${d.stat}`)}`, d.delta > 0 ? 'good' : 'bad')])]);
    }
  } else if (it.from.length) {
    foot.push([S(`${L('Aus', 'Built from')}: `, 'dim'), S(it.from.map((f) => itemById(f)?.name[settings.lang] ?? f).join(' + '))]);
  }
  return { icon: itemIcon(id), title: it.name[settings.lang], ...(tierName ? { sub: tierName } : {}), meta, chips, body, ...(foot.length ? { foot } : {}) };
}


const SUMMONER_DESC: Record<string, [string, string]> = {
  sprung: ['Teleportiert dich bis zu 400 Einheiten in Richtung Cursor.', 'Teleports you up to 400 units towards the cursor.'],
  heilen: ['Heilt dich und den nächsten Verbündeten (90–345 nach Stufe) und gibt 1 s lang +30 % Lauftempo.', 'Heals you and the nearest ally (90–345 by level) and grants +30% move speed for 1 s.'],
  geist: ['10 s lang +24–48 % Lauftempo (nach Stufe), du ignorierst Einheitenkollision.', '+24–48% move speed (by level) for 10 s, ignore unit collision.'],
  entflammen: ['Setzt einen gegnerischen Champion 5 s in Brand (60–410 absoluter Schaden) und verringert seine Heilung um 40 %.', 'Ignites an enemy champion for 5 s (60–410 true damage) and reduces its healing by 40%.'],
  erschoepfen: ['Verlangsamt einen gegnerischen Champion 2,5 s lang um 30 % und verringert seinen verursachten Schaden um 40 %.', 'Slows an enemy champion by 30% for 2.5 s and reduces the damage it deals by 40%.'],
  schneeball: ['Trifft einen gegnerischen Champion (bis 900 Reichweite) für 60–160 absoluten Schaden und verlangsamt ihn 1,5 s um 40 %.', 'Hits an enemy champion (up to 900 range) for 60–160 true damage and slows it by 40% for 1.5 s.'],
  reinigen: ['Entfernt Verlangsamung, Betäubung, Festhalten, Verstummen und Blendung und gibt kurz Zähigkeit.', 'Removes slows, stuns, roots, silences and blinds and grants brief tenacity.'],
  barriere: ['Gibt dir 2 s lang einen Schild (115–455 nach Stufe).', 'Shields you for 2 s (115–455 by level).'],
  teleport: ['Kanalisiert und teleportiert dich zu einem verbündeten Turm, Vasallen oder Ward.', 'Channels, then teleports you to an allied tower, minion or ward.'],
  bannen: ['Verursacht 450–900 absoluten Schaden an einem Monster oder Vasallen in 500 Reichweite.', 'Deals 450–900 true damage to a monster or minion within 500 range.'],
};

/** Level-scaled summoner values (lo at level 1, hi at 18; same numbers as sim/summoners.ts): id -> [what, lo, hi, unit]. */
const SUMMONER_SCALING: Record<string, [string, string, number, number, string]> = {
  heilen: ['Heilung', 'Heal', 90, 345, ''],
  geist: ['Lauftempo', 'Move speed', 24, 48, ' %'],
  entflammen: ['Absoluter Schaden', 'True damage', 60, 410, ''],
  barriere: ['Schild', 'Shield', BARRIER_SHIELD[0], BARRIER_SHIELD[1], ''],
  bannen: ['Schaden an Monstern', 'Damage to monsters', 450, 900, ''],
};

function summonerTip(id: string): Tip | null {
  const d = summonerDef(id);
  if (!d) return null;
  const desc = SUMMONER_DESC[id];
  return { icon: summonerIcon(id), title: summonerName(id), sub: L('Beschwörerzauber', 'Summoner spell'), meta: [P(`⟳ ${d.cooldown} s`)], body: desc ? [keywordSegs(L(...desc), lang())] : [], ...liveSummoner(id) };
}

/** Foot line with the value at the player's current level (only inside a match). */
function liveSummoner(id: string): { foot: Seg[][] } | Record<string, never> {
  const s = SUMMONER_SCALING[id];
  if (!s || !ctx) return {};
  const v = byLevelValue([s[2], s[3]], ctx.stats.level);
  return { foot: [[S(L(`Stufe ${ctx.stats.level}: `, `Level ${ctx.stats.level}: `), 'dim'), S(` ${fmtNum(v, lang())}${s[4]}`, 'cur')]] };
}

function runeTip(id: string): Tip | null {
  const r = RUNES.find((x) => x.id === id);
  if (!r) return null;
  const key = r.kind === 'keystone';
  return { icon: runeIcon(id, key), title: r.name[settings.lang], sub: key ? L('Schlüsselprägung', 'Keystone') : L('Nebenprägung', 'Minor rune'), meta: [], chips: runeStats(r), body: [keywordSegs(r.desc[settings.lang], lang())] };
}

/** Flat stats of a minor rune as chips (+8 AD ...). */
function runeStats(r: (typeof RUNES)[number]): { segs: Seg[]; cls: string }[] {
  return Object.entries(r.stats ?? {}).map(([k, v]) => ({ segs: P(`+${v}${isPctStat(k) ? ' %' : ''} ${k === 'adaptive' ? L('Adaptiv', 'Adaptive') : t(`stat.${k}`)}`), cls: 'stat' }));
}

function build(spec: string): Tip | null {
  const [kind, a = '', b, c] = spec.split(':');
  switch (kind) {
    case 'ability':
      return abilityTip(a, Number(b), Number(c ?? 0));
    case 'passive':
      return passiveTip(a);
    case 'item':
      return itemTip(a, b === 'shop');
    case 'summoner':
      return summonerTip(a);
    case 'rune':
      return runeTip(a);
    case 'text': {
      const [title = '', ...body] = spec.slice(5).split(/\r?\n/); // first line = title, the rest = body paragraphs
      return { icon: null, title, meta: [], body: body.map(P) };
    }
    case 'timed': {
      // `timed:<seconds>:<inner spec>`: the inner tooltip plus the remaining time (buff chips)
      const tip = build(spec.slice(spec.indexOf(':', 6) + 1));
      if (tip) tip.foot = [...(tip.foot ?? []), P(t('buff.left', { s: a }))];
      return tip;
    }
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

/** Runs of text as spans (cls = colour / emphasis class from tooltipMath). */
function segs(parent: HTMLElement, list: Seg[]): void {
  for (const s of list) {
    if (!s.cls) parent.appendChild(document.createTextNode(s.text));
    else h('span', `tt-${s.cls}`, parent, s.text);
  }
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
    for (const x of tip.meta) segs(h('div', '', m), x);
  }
  if (tip.chips?.length) {
    const cs = h('div', 'tip-chips', panel);
    for (const c of tip.chips) segs(h('div', `tip-chip ${c.cls}`, cs), c.segs);
  }
  for (const b of tip.body) segs(h('p', 'tip-body', panel), b);
  if (tip.foot?.length) {
    const f = h('div', 'tip-foot', panel);
    for (const x of tip.foot) segs(h('div', '', f), x);
  }
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
