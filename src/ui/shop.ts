// Shop panel (P), LoL-like: category filters + search on the left, item tiles by tier in the middle, details on the
// right (price after owned components, stats, passive/active, build tree, builds into, buy), inventory with sell
// at the bottom. Buying only works in the own fountain (or while dead); the sim enforces it, the UI mirrors it.
import './gamePanels.css';
import './shop.css';
import type { PlayerHud } from '../sim/snapshot';
import type { ItemData, ItemStat, ItemTier } from '../sim/items/schema';
import { ITEMS, ITEM_SLOTS, SELL_RATIO, itemById, recipePrice } from '../sim/items/inventory';
import { BUILDS } from '../ai/bot/builds';
import { settings } from '../settings';
import { t } from '../i18n';
import { itemIcon, setIcon, statIcon } from './icons';
import { shopLayoutKey } from './shopLayout';
import './icons.css';
import { setTip } from './tooltip';
import { goldEfficiency } from './goldEfficiency';

const TIERS: ItemTier[] = ['starter', 'boots', 'basic', 'component', 'legendary', 'consumable'];
const PCT: ReadonlySet<ItemStat> = new Set(['asPct', 'critPct', 'lifestealPct', 'msPct', 'hpRegenPct', 'manaRegenPct', 'healShieldPowerPct', 'magicPenPct', 'armorPenPct', 'tenacity']);
/** Stat -> icon key of statIcon (src/ui/icons.ts) for the stat chips. */
const STAT_ICON: Partial<Record<ItemStat, string>> = {
  ad: 'ad', lethality: 'ad', ap: 'ap', armor: 'armor', mr: 'mr', hp: 'hp', mana: 'mana', asPct: 'as', critPct: 'crit',
  msFlat: 'ms', msPct: 'ms', haste: 'haste', lifestealPct: 'hp', hpRegenPct: 'hp', manaRegenPct: 'mana', healShieldPowerPct: 'hp',
  magicPen: 'ap', magicPenPct: 'ap', armorPenPct: 'ad', tenacity: 'armor',
};

type Cat = 'all' | 'rec' | 'ad' | 'ap' | 'def' | 'as' | 'boots' | 'support' | 'jungle' | 'consumable';
const CATS: [Cat, string | null][] = [
  ['all', null], ['rec', null], ['ad', 'ad'], ['ap', 'ap'], ['def', 'armor'], ['as', 'as'], ['boots', 'ms'], ['support', 'mana'], ['jungle', null], ['consumable', null],
];

function inCat(it: ItemData, cat: Cat, rec: ReadonlySet<string>): boolean {
  const s = it.stats;
  const tag = (x: ItemData['tags'][number]): boolean => it.tags.includes(x);
  switch (cat) {
    case 'all':
      return true;
    case 'rec':
      return rec.has(it.id);
    case 'ad':
      return !!(s.ad || s.lethality) || tag('ad') || tag('lethality');
    case 'ap':
      return !!s.ap || tag('ap');
    case 'def':
      return !!(s.armor || s.mr || s.hp) || tag('tank');
    case 'as':
      return !!(s.asPct || s.critPct) || tag('crit') || tag('onhit');
    case 'boots':
      return it.tier === 'boots';
    case 'support':
      return tag('support') || !!(s.healShieldPowerPct || s.manaRegenPct);
    case 'jungle':
      return tag('jungle');
    case 'consumable':
      return it.tier === 'consumable';
  }
}

export const itemName = (id: string | null | undefined): string => (id ? itemById(id)?.name[settings.lang] ?? id : '');
/** Short label for 34 px slots. */
export const itemAbbr = (id: string): string => itemName(id).replace(/^(Stiefel der |Stiefel )/, '').slice(0, 3);

export function statLines(it: ItemData): string[] {
  return (Object.entries(it.stats) as [ItemStat, number][]).map(([k, v]) => `+${v}${PCT.has(k) ? ' %' : ''} ${t(`stat.${k}`)}`);
}

export function itemTooltip(id: string): string {
  const it = itemById(id);
  if (!it) return id;
  const lines = [`${it.name[settings.lang]} (${it.cost})`, ...statLines(it)];
  if (it.passive) lines.push(`${it.passive.name[settings.lang]}: ${it.passive.desc[settings.lang]}`);
  if (it.active) lines.push(`${it.active.name[settings.lang]}: ${it.active.desc[settings.lang]}`);
  return lines.join('\n');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function iconEl(parent: HTMLElement, id: string, cls = 'sp-icon'): HTMLElement {
  const url = itemIcon(id);
  const d = el('div', cls, parent, url ? '' : itemAbbr(id));
  setIcon(d, url);
  return d;
}

export interface ShopHooks {
  buy(item: string): void;
  sell(slot: number): void;
  /** Team chat line (Alt+click item ping, C4). */
  say?(text: string): void;
}

export class ShopPanel {
  private selected: string | null = null;
  private cat: Cat = 'all';
  private query = '';
  private key = '';
  private gold = -1;
  /** Latest HUD data (click handlers read it, not the snapshot the panel was built from). */
  private me: PlayerHud | null = null;
  private cards: { el: HTMLElement; it: ItemData; price: HTMLElement }[] = [];
  private goldEl: HTMLElement | null = null;
  private buyBtn: { el: HTMLButtonElement; it: ItemData } | null = null;

  constructor(private readonly root: HTMLElement, private readonly hooks: ShopHooks) {
    root.textContent = '';
    root.classList.add('sp-root');
    // clicks inside the panel must not turn into move commands on the canvas
    for (const ev of ['mousedown', 'contextmenu', 'wheel'] as const) root.addEventListener(ev, (e) => e.stopPropagation());
  }

  update(me: PlayerHud | null): void {
    if (!me) return;
    this.me = me;
    const key = `${shopLayoutKey(me, this.selected, settings.lang)}|${this.cat}|${this.query}`;
    if (key !== this.key) {
      this.key = key;
      this.render(me);
    } else if (Math.floor(me.gold) !== this.gold) this.refresh(me);
  }

  /** Gold changed: update the gold label and affordability in place (no rebuild). */
  private refresh(me: PlayerHud): void {
    this.gold = Math.floor(me.gold);
    if (this.goldEl) this.goldEl.textContent = String(this.gold);
    for (const c of this.cards) c.el.classList.toggle('afford', this.canBuy(me, c.it).ok);
    if (this.buyBtn) {
      const q = this.canBuy(me, this.buyBtn.it);
      this.buyBtn.el.disabled = !q.ok;
      this.buyBtn.el.title = q.why ?? '';
    }
  }

  private canBuy(me: PlayerHud, it: ItemData): { ok: boolean; price: number; why?: string } {
    const { price, consumes } = recipePrice(me.items, it);
    if (!me.inFountain && !me.dead) return { ok: false, price, why: t('shop.notInShop') };
    if (it.unique && me.items.some((x, i) => x && !consumes.includes(i) && itemById(x)?.unique === it.unique)) return { ok: false, price, why: t('shop.unique') };
    if (it.tier === 'legendary' && me.items.some((x, i) => x === it.id && !consumes.includes(i))) return { ok: false, price, why: t('shop.unique') };
    if (!me.items.some((x, i) => i < ITEM_SLOTS && (x === null || consumes.includes(i)))) return { ok: false, price, why: t('shop.full') };
    if (me.gold < price) return { ok: false, price, why: t('shop.gold') };
    return { ok: true, price };
  }

  private select(id: string): void {
    this.selected = id;
    this.key = '';
    if (this.me) this.update(this.me);
  }

  private render(me: PlayerHud): void {
    const r = this.root;
    const scroll = [...r.querySelectorAll<HTMLElement>('.sp-list, .sp-detail')].map((e) => e.scrollTop);
    const searchFocused = document.activeElement?.classList.contains('sp-search') ?? false;
    r.textContent = '';
    this.cards = [];
    this.buyBtn = null;
    this.gold = Math.floor(me.gold);
    const build = BUILDS[me.champ];
    const recList = build ? [...build.starter, build.standard.boots, ...build.standard.core] : [];
    const rec = new Set(recList);

    // ---- header: title, gold, search, close
    const head = el('div', 'sp-head', r);
    el('div', 'sp-title', head, t('hud.shop'));
    const g = el('div', 'sp-gold', head);
    el('span', 'sp-coin', g);
    this.goldEl = el('span', '', g, String(this.gold));
    if (!me.inFountain && !me.dead) el('div', 'sp-hint', head, t('shop.notInShop'));
    const search = el('input', 'sp-search', head);
    search.placeholder = t('shop.search');
    search.value = this.query;
    search.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not cast abilities
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      if (this.me) this.update(this.me);
    });
    el('button', 'sp-close', head, '✕').addEventListener('click', () => r.classList.remove('open'));

    const body = el('div', 'sp-body', r);
    // ---- categories
    const nav = el('div', 'sp-nav', body);
    for (const [cat, icon] of CATS) {
      if (cat === 'rec' && !rec.size) continue;
      const b = el('button', `sp-cat${this.cat === cat ? ' on' : ''}`, nav);
      const ic = el('span', 'sp-cat-icon', b);
      const url = icon ? statIcon(icon) : cat === 'jungle' ? itemIcon(ITEMS.find((i) => i.tags.includes('jungle'))?.id ?? '') : cat === 'consumable' ? itemIcon('trank') : null;
      if (url) setIcon(ic, url);
      else ic.textContent = cat === 'rec' ? '★' : '◆';
      b.append(t(`shop.cat.${cat}`));
      b.addEventListener('click', () => {
        this.cat = cat;
        if (this.me) this.update(this.me);
      });
    }

    // ---- item list by tier
    const list = el('div', 'sp-list', body);
    const q = this.query;
    let shown = 0;
    for (const tier of TIERS) {
      const items = ITEMS.filter((i) => i.tier === tier && inCat(i, this.cat, rec) && (!q || i.name[settings.lang].toLowerCase().includes(q))).sort((a, b) => a.cost - b.cost);
      if (!items.length) continue;
      el('div', 'sp-tier', list, t(`shop.tier.${tier}`));
      const grid = el('div', 'sp-grid', list);
      for (const it of items) this.card(me, it.id, grid, rec.has(it.id));
      shown += items.length;
    }
    if (!shown) el('div', 'sp-empty', list, t('shop.none'));

    // ---- details
    const det = el('div', 'sp-detail', body);
    const sel = this.selected ? itemById(this.selected) : undefined;
    if (!sel) {
      el('div', 'sp-empty', det, t('shop.pick'));
      if (recList.length) {
        el('div', 'sp-sub', det, t('shop.recommended'));
        const rr = el('div', 'sp-grid', det);
        for (const id of recList) this.card(me, id, rr, true);
      }
    } else {
      const top = el('div', 'sp-dhead', det);
      iconEl(top, sel.id, 'sp-icon big');
      const nm = el('div', 'sp-dname', top);
      el('div', 'sp-name', nm, sel.name[settings.lang]);
      const qb = this.canBuy(me, sel);
      const cost = el('div', 'sp-cost', nm);
      el('span', 'sp-coin', cost);
      cost.append(String(qb.price));
      if (qb.price !== sel.cost) el('span', 'sp-full', cost, String(sel.cost));
      const stats = el('div', 'sp-stats', det);
      for (const [k, v] of Object.entries(sel.stats) as [ItemStat, number][]) {
        const s = el('div', 'sp-stat', stats);
        const ic = el('span', 'sp-stat-icon', s);
        const url = STAT_ICON[k] ? statIcon(STAT_ICON[k]!) : null;
        if (url) setIcon(ic, url);
        s.append(`+${v}${PCT.has(k) ? ' %' : ''} ${t(`stat.${k}`)}`);
      }
      // gold efficiency of the stats (LoL wiki method; passives/actives are not priced)
      const ge = goldEfficiency(sel);
      if (ge) {
        const g = el('div', `sp-goldeff${ge.pct >= 100 ? ' good' : ''}`, det, t('shop.goldEff', { pct: ge.pct, value: ge.value }));
        setTip(g, `text:${t('shop.goldEffTip')}`);
      }
      if (sel.passive) this.effect(det, t('shop.passive'), sel.passive.name[settings.lang], sel.passive.desc[settings.lang]);
      if (sel.active) this.effect(det, t('shop.active'), sel.active.name[settings.lang], `${sel.active.desc[settings.lang]} (${sel.active.cooldown} s)`);
      if (sel.from.length) {
        el('div', 'sp-sub', det, t('shop.recipe'));
        this.tree(me, sel, el('div', 'sp-tree', det), 0, [...me.items]);
      }
      const into = ITEMS.filter((i) => i.from.includes(sel.id));
      if (into.length) {
        el('div', 'sp-sub', det, t('shop.buildsInto'));
        const gi = el('div', 'sp-grid', det);
        for (const i of into) this.card(me, i.id, gi, rec.has(i.id));
      }
      const b = el('button', 'sp-buy', det, `${t('shop.buy')}  ·  ${qb.price}`);
      b.disabled = !qb.ok;
      if (qb.why) b.title = qb.why;
      b.addEventListener('click', () => this.hooks.buy(sel.id));
      this.buyBtn = { el: b, it: sel };
    }

    // ---- inventory
    const inv = el('div', 'sp-inv', r);
    el('span', 'sp-sub', inv, t('shop.inventory'));
    me.items.slice(0, ITEM_SLOTS).forEach((id, slot) => {
      const s = el('div', `sp-slot${id ? '' : ' empty'}`, inv);
      if (!id) return;
      iconEl(s, id);
      setTip(s, `item:${id}`);
      s.addEventListener('click', () => this.select(id));
      const sell = el('button', 'sp-sell', s, `+${Math.floor((itemById(id)?.cost ?? 0) * SELL_RATIO)}`);
      sell.title = t('shop.sell');
      sell.disabled = !me.inFountain && !me.dead;
      sell.addEventListener('click', (e) => (e.stopPropagation(), this.hooks.sell(slot)));
    });

    // a rebuild (inventory / selection / filter changed) keeps scroll position and search focus
    [...r.querySelectorAll<HTMLElement>('.sp-list, .sp-detail')].forEach((e, i) => (e.scrollTop = scroll[i] ?? 0));
    if (searchFocused) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  private effect(parent: HTMLElement, kind: string, name: string, desc: string): void {
    const d = el('div', 'sp-effect', parent);
    el('span', 'sp-effect-kind', d, kind);
    el('span', 'sp-effect-name', d, name);
    el('div', 'sp-effect-desc', d, desc);
  }

  /** Build tree: each component with its own components below; owned ones (consumed once each) are checked. */
  private tree(me: PlayerHud, it: ItemData, parent: HTMLElement, depth: number, pool: (string | null)[]): void {
    for (const c of it.from) {
      const sub = itemById(c);
      if (!sub) continue;
      const k = pool.indexOf(c);
      const owned = k >= 0 && k < ITEM_SLOTS;
      if (owned) pool[k] = null;
      const row = el('div', `sp-node${owned ? ' owned' : ''}`, parent);
      row.style.paddingLeft = `${depth * 18}px`;
      iconEl(row, c, 'sp-icon small');
      el('span', 'sp-node-name', row, sub.name[settings.lang]);
      el('span', 'sp-node-cost', row, owned ? '✓' : String(sub.cost));
      setTip(row, `item:${c}`);
      row.addEventListener('click', () => this.select(c));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.canBuy(this.me ?? me, sub).ok) this.hooks.buy(c);
      });
      if (!owned && sub.from.length) this.tree(me, sub, parent, depth + 1, pool);
    }
  }

  private pingItem(it: ItemData): void {
    const me = this.me;
    if (!me || !this.hooks.say) return;
    const name = it.name[settings.lang];
    if (me.items.includes(it.id)) return this.hooks.say(t('chat.itemPing', { item: name }));
    const q = this.canBuy(me, it);
    const missing = Math.max(0, Math.ceil(q.price - me.gold));
    this.hooks.say(missing > 0 ? t('chat.itemBuyingMissing', { item: name, gold: missing }) : t('chat.itemBuying', { item: name }));
  }

  private card(me: PlayerHud, id: string, parent: HTMLElement, rec: boolean): void {
    const it = itemById(id);
    if (!it) return;
    const q = this.canBuy(me, it);
    const owned = me.items.includes(id);
    const c = el('button', `sp-item tier-${it.tier}${rec ? ' rec' : ''}${q.ok ? ' afford' : ''}${this.selected === id ? ' sel' : ''}${owned ? ' owned' : ''}`, parent);
    iconEl(c, id);
    const price = el('div', 'sp-price', c, String(q.price));
    if (q.price !== it.cost) price.classList.add('reduced');
    setTip(c, `item:${id}`);
    this.cards.push({ el: c, it, price });
    c.addEventListener('click', (e) => {
      // LoL: Alt+click pings the item to the team (owned / buying, gold still missing)
      if (e.altKey) return this.pingItem(it);
      this.select(id);
    });
    // right click buys directly (like LoL); checked against the latest gold, not the one at build time
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.canBuy(this.me ?? me, it).ok) this.hooks.buy(id);
    });
  }
}
