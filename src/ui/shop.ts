// Shop panel (P): items by tier with cost/stats/recipe, recommended build of the own champion highlighted,
// buy/sell buttons. Buying only works in the own fountain (or while dead); the sim enforces it, the UI mirrors it.
import './gamePanels.css';
import type { PlayerHud } from '../sim/snapshot';
import type { ItemData, ItemStat, ItemTier } from '../sim/items/schema';
import { ITEMS, ITEM_SLOTS, SELL_RATIO, itemById, recipePrice } from '../sim/items/inventory';
import { BUILDS } from '../ai/bot/builds';
import { settings } from '../settings';
import { t } from '../i18n';
import { itemIcon, setIcon } from './icons';
import { shopLayoutKey } from './shopLayout';
import './icons.css';
import { setTip } from './tooltip';

// small tiers first so they share a row (the shop fits a 720p screen without scrolling)
const TIERS: ItemTier[] = ['starter', 'consumable', 'boots', 'basic', 'component', 'legendary'];
const PCT: ReadonlySet<ItemStat> = new Set(['asPct', 'critPct', 'lifestealPct', 'msPct', 'hpRegenPct', 'manaRegenPct', 'healShieldPowerPct']);

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

/** Item icon (procedural, src/ui/icons.ts) with the short name as fallback. */
function iconEl(parent: HTMLElement, id: string): void {
  const url = itemIcon(id);
  const d = el('div', url ? 'abbr item-icon' : 'abbr', parent, url ? '' : itemAbbr(id));
  setIcon(d, url);
}

export interface ShopHooks {
  buy(item: string): void;
  sell(slot: number): void;
}

export class ShopPanel {
  private selected: string | null = null;
  private key = '';
  private gold = -1;
  /** Latest HUD data (click handlers read it, not the snapshot the panel was built from). */
  private me: PlayerHud | null = null;
  private cards: { el: HTMLElement; it: ItemData }[] = [];
  private goldEl: HTMLElement | null = null;
  private buyBtn: { el: HTMLButtonElement; it: ItemData } | null = null;

  constructor(private readonly root: HTMLElement, private readonly hooks: ShopHooks) {
    root.textContent = '';
    // clicks inside the panel must not turn into move commands on the canvas
    for (const ev of ['mousedown', 'contextmenu', 'wheel'] as const) root.addEventListener(ev, (e) => e.stopPropagation());
  }

  update(me: PlayerHud | null): void {
    if (!me) return;
    this.me = me;
    const key = shopLayoutKey(me, this.selected, settings.lang);
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

  private render(me: PlayerHud): void {
    const r = this.root;
    const scroll = [...r.querySelectorAll<HTMLElement>('.shop-list, .shop-detail')].map((e) => e.scrollTop);
    r.textContent = '';
    this.cards = [];
    this.buyBtn = null;
    this.gold = Math.floor(me.gold);
    const head = el('div', 'shop-head', r);
    el('div', 'ttl', head, t('hud.shop'));
    this.goldEl = el('div', 'gold', head, String(this.gold));
    if (!me.inFountain && !me.dead) el('div', 'shop-hint', head, t('shop.notInShop'));
    el('button', 'btn small shop-close', head, '✕').addEventListener('click', () => r.classList.remove('open'));

    const build = BUILDS[me.champ];
    const rec = new Set<string>(build ? [...build.starter, build.standard.boots, ...build.standard.core] : []);
    if (build) {
      const row = el('div', 'shop-rec', r);
      el('span', 'lbl', row, t('shop.recommended'));
      for (const id of [...build.starter, build.standard.boots, ...build.standard.core]) this.card(me, id, row, true);
    }

    const body = el('div', 'shop-body', r);
    const list = el('div', 'shop-list', body);
    for (const tier of TIERS) {
      const items = ITEMS.filter((i) => i.tier === tier).sort((a, b) => a.cost - b.cost);
      if (!items.length) continue;
      const sec = el('div', 'shop-sec', list);
      el('div', 'shop-tier', sec, t(`shop.tier.${tier}`));
      const grid = el('div', 'shop-grid', sec);
      for (const it of items) this.card(me, it.id, grid, rec.has(it.id));
    }

    const det = el('div', 'shop-detail', body);
    const sel = this.selected ? itemById(this.selected) : undefined;
    if (!sel) el('div', 'shop-empty', det, t('shop.pick'));
    else {
      el('div', 'shop-name', det, sel.name[settings.lang]);
      const q = this.canBuy(me, sel);
      el('div', 'shop-cost', det, q.price !== sel.cost ? `${q.price} (${sel.cost})` : String(sel.cost));
      for (const l of statLines(sel)) el('div', 'shop-stat', det, l);
      if (sel.passive) el('div', 'shop-passive', det, `${sel.passive.name[settings.lang]}: ${sel.passive.desc[settings.lang]}`);
      if (sel.active) el('div', 'shop-passive', det, `${sel.active.name[settings.lang]}: ${sel.active.desc[settings.lang]}`);
      if (sel.from.length) {
        el('div', 'shop-sub', det, t('shop.recipe'));
        const from = el('div', 'shop-from', det);
        for (const c of sel.from) this.card(me, c, from, rec.has(c));
      }
      const into = ITEMS.filter((i) => i.from.includes(sel.id));
      if (into.length) {
        el('div', 'shop-sub', det, t('shop.buildsInto'));
        const g = el('div', 'shop-from', det);
        for (const i of into) this.card(me, i.id, g, rec.has(i.id));
      }
      const b = el('button', 'btn primary shop-buy', det, `${t('shop.buy')} (${q.price})`);
      b.disabled = !q.ok;
      if (q.why) b.title = q.why;
      b.addEventListener('click', () => this.hooks.buy(sel.id));
      this.buyBtn = { el: b, it: sel };
    }

    const inv = el('div', 'shop-inv', r);
    el('span', 'lbl', inv, t('shop.inventory'));
    me.items.slice(0, ITEM_SLOTS).forEach((id, slot) => {
      const s = el('div', `shop-slot${id ? '' : ' empty'}`, inv);
      if (!id) return;
      iconEl(s, id);
      setTip(s, `item:${id}`);
      const sell = el('button', 'btn small', s, `${t('shop.sell')} +${Math.floor((itemById(id)?.cost ?? 0) * SELL_RATIO)}`);
      sell.disabled = !me.inFountain && !me.dead;
      sell.addEventListener('click', () => this.hooks.sell(slot));
    });
    // a rebuild (inventory / selection changed) keeps the scroll position
    [...r.querySelectorAll<HTMLElement>('.shop-list, .shop-detail')].forEach((e, i) => (e.scrollTop = scroll[i] ?? 0));
  }

  private card(me: PlayerHud, id: string, parent: HTMLElement, rec: boolean): void {
    const it = itemById(id);
    if (!it) return;
    const q = this.canBuy(me, it);
    const c = el('button', `shop-item${rec ? ' rec' : ''}${q.ok ? ' afford' : ''}${this.selected === id ? ' sel' : ''}${me.items.includes(id) ? ' owned' : ''}`, parent);
    iconEl(c, id);
    el('div', 'price', c, String(q.price));
    setTip(c, `item:${id}`);
    this.cards.push({ el: c, it });
    c.addEventListener('click', () => {
      this.selected = id;
      this.key = '';
      this.update(this.me ?? me);
    });
    // right click buys directly (like LoL); checked against the latest gold, not the one at build time
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.canBuy(this.me ?? me, it).ok) this.hooks.buy(id);
    });
  }
}
