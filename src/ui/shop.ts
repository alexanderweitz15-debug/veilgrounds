// Shop panel (P): items by tier with cost/stats/recipe, recommended build of the own champion highlighted,
// buy/sell buttons. Buying only works in the own fountain (or while dead); the sim enforces it, the UI mirrors it.
import './gamePanels.css';
import type { PlayerHud } from '../sim/snapshot';
import type { ItemData, ItemStat, ItemTier } from '../sim/items/schema';
import { ITEMS, ITEM_SLOTS, SELL_RATIO, itemById, recipePrice } from '../sim/items/inventory';
import { BUILDS } from '../ai/bot/builds';
import { settings } from '../settings';
import { t } from '../i18n';

const TIERS: ItemTier[] = ['starter', 'consumable', 'basic', 'component', 'boots', 'legendary'];
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
  if (it.passive) lines.push(`${it.passive.name[settings.lang]}: ${it.passive.desc[settings.lang]} (${t('shop.later')})`);
  if (it.active) lines.push(`${it.active.name[settings.lang]}: ${it.active.desc[settings.lang]} (${t('shop.later')})`);
  return lines.join('\n');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export interface ShopHooks {
  buy(item: string): void;
  sell(slot: number): void;
}

export class ShopPanel {
  private selected: string | null = null;
  private key = '';

  constructor(private readonly root: HTMLElement, private readonly hooks: ShopHooks) {
    root.textContent = '';
    // clicks inside the panel must not turn into move commands on the canvas
    for (const ev of ['mousedown', 'contextmenu', 'wheel'] as const) root.addEventListener(ev, (e) => e.stopPropagation());
  }

  update(me: PlayerHud | null): void {
    if (!me) return;
    const key = [me.champ, Math.floor(me.gold), me.items.join(','), me.inFountain || me.dead, this.selected, settings.lang].join('|');
    if (key === this.key) return;
    this.key = key;
    this.render(me);
  }

  private canBuy(me: PlayerHud, it: ItemData): { ok: boolean; price: number; why?: string } {
    const { price, consumes } = recipePrice(me.items, it);
    if (!me.inFountain && !me.dead) return { ok: false, price, why: t('shop.notInShop') };
    if (it.unique && me.items.some((x, i) => x && !consumes.includes(i) && itemById(x)?.unique === it.unique)) return { ok: false, price, why: t('shop.unique') };
    if (!me.items.some((x, i) => i < ITEM_SLOTS && (x === null || consumes.includes(i)))) return { ok: false, price, why: t('shop.full') };
    if (me.gold < price) return { ok: false, price, why: t('shop.gold') };
    return { ok: true, price };
  }

  private render(me: PlayerHud): void {
    const r = this.root;
    r.textContent = '';
    const head = el('div', 'shop-head', r);
    el('div', 'ttl', head, t('hud.shop'));
    el('div', 'gold', head, String(Math.floor(me.gold)));
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
      el('div', 'shop-tier', list, t(`shop.tier.${tier}`));
      const grid = el('div', 'shop-grid', list);
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
      if (sel.passive) el('div', 'shop-passive', det, `${sel.passive.name[settings.lang]}: ${sel.passive.desc[settings.lang]} (${t('shop.later')})`);
      if (sel.active) el('div', 'shop-passive', det, `${sel.active.name[settings.lang]}: ${sel.active.desc[settings.lang]} (${t('shop.later')})`);
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
    }

    const inv = el('div', 'shop-inv', r);
    el('span', 'lbl', inv, t('shop.inventory'));
    me.items.slice(0, ITEM_SLOTS).forEach((id, slot) => {
      const s = el('div', `shop-slot${id ? '' : ' empty'}`, inv);
      if (!id) return;
      el('div', 'abbr', s, itemAbbr(id));
      s.title = itemTooltip(id);
      const sell = el('button', 'btn small', s, `${t('shop.sell')} +${Math.floor((itemById(id)?.cost ?? 0) * SELL_RATIO)}`);
      sell.disabled = !me.inFountain && !me.dead;
      sell.addEventListener('click', () => this.hooks.sell(slot));
    });
  }

  private card(me: PlayerHud, id: string, parent: HTMLElement, rec: boolean): void {
    const it = itemById(id);
    if (!it) return;
    const q = this.canBuy(me, it);
    const c = el('button', `shop-item${rec ? ' rec' : ''}${q.ok ? ' afford' : ''}${this.selected === id ? ' sel' : ''}${me.items.includes(id) ? ' owned' : ''}`, parent);
    el('div', 'abbr', c, itemAbbr(id));
    el('div', 'price', c, String(q.price));
    c.title = itemTooltip(id);
    c.addEventListener('click', () => {
      this.selected = id;
      this.key = '';
      this.render(me);
    });
    // right click buys directly (like LoL)
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (q.ok) this.hooks.buy(id);
    });
  }
}
