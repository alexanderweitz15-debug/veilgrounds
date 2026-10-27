// Target frame (C3, LoL: left-click a unit -> frame top left with portrait, level, HP/mana, crowd control, ability
// buffs; champions also K/D/A and, for the own team, items) and the shared buff/CC chips also used for the own
// buff bar above the ability bar. Only snapshot data (fog-safe): the frame closes when the unit leaves vision or dies.
import type { ClientState } from '../game/state';
import type { SnapEntity } from '../sim/snapshot';
import { Kind } from '../sim/types';
import { CC_BIT } from '../sim/buffs';
import { setPortrait } from '../render/portraits';
import { abilityInfo, champName, variantName } from './names';
import { abilityIcon, itemIcon, setIcon } from './icons';
import { setTip } from './tooltip';
import { t } from '../i18n';
import { itemPingText } from '../game/pingText';
import { itemName } from './shop';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const SLOT_OF: Record<string, number> = { q: 0, w: 1, e: 2, r: 3 };
const ST_IDS = ['ad', 'ap', 'armor', 'mr', 'ms'];
const ST_FULL = ['stat.ad', 'stat.ap', 'stat.armor', 'stat.mr', 'stat.msFlat'];
const CC_ORDER = Object.keys(CC_BIT) as (keyof typeof CC_BIT)[];

export interface Chip {
  key: string;
  label: string;
  /** Seconds left (CC / buffs / marks), absent for auras without a known duration. */
  left?: number;
  icon?: string | null;
  kind: 'cc' | 'buff' | 'mark';
  /** Tooltip spec (src/ui/tooltip.ts); wrapped in `timed:` while `left` is known. */
  tip: string;
}

/** Tooltip spec with the remaining whole seconds as footer. */
const timedTip = (spec: string, left: number | undefined): string => (left === undefined ? spec : `timed:${Math.ceil(left)}:${spec}`);

/** CC + ability-buff chips of a visible unit (+ jungle/objective buffs and the own marks). */
export function unitChips(e: SnapEntity, tick: number, marks: { id: string; left: number }[] = []): Chip[] {
  const out: Chip[] = [];
  if (e.cc) {
    const left = e.ccEnd ? Math.max(0, (e.ccEnd - tick) / 30) : undefined;
    for (const c of CC_ORDER) {
      if (!(e.cc & CC_BIT[c])) continue;
      const label = c === 'slow' && e.slow ? `${t(`cc.${c}`)} ${Math.round(e.slow)} %` : t(`cc.${c}`);
      out.push({ key: `cc:${c}`, label, ...(left !== undefined ? { left } : {}), kind: 'cc', tip: timedTip(`text:${label}`, left) });
    }
  }
  for (const id of e.auras ?? []) {
    const [champ, key] = id.split('_') as [string, string | undefined];
    const slot = SLOT_OF[key ?? ''];
    const name = slot !== undefined ? abilityInfo(champ, slot, id).name : champName(champ);
    const left = e.auraLeft?.[id];
    out.push({ key: `aura:${id}`, label: name, ...(left !== undefined ? { left } : {}), icon: slot !== undefined ? abilityIcon(champ, slot) : null, kind: 'buff', tip: timedTip(slot !== undefined ? `ability:${champ}:${slot}:-1` : key === 'p' ? `passive:${champ}` : `text:${champName(champ)}: ${name}`, left) });
  }
  const seen = new Set<string>();
  for (const m of [...marks, ...(e.buffs ?? [])]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ key: `mark:${m.id}`, label: t(`buff.${m.id}`), left: m.left, kind: 'mark', tip: timedTip(`text:${t(`buff.${m.id}`)}\n${t(`buff.${m.id}.desc`)}`, m.left) });
  }
  return out;
}

/** Remaining fraction 0..1 of a timed chip; the longest `left` seen on the node counts as the full duration. */
export function ringFraction(node: { dataset: DOMStringMap }, left: number): number {
  const max = Math.max(Number(node.dataset.max ?? 0), left);
  node.dataset.max = String(max);
  return max > 0 ? Math.min(1, left / max) : 0;
}

/** Render chips into `root`, reusing the nodes of unchanged chips (a hovered tooltip survives the per-second update). Returns the new key. */
export function drawChips(root: HTMLElement, chips: Chip[], prevKey: string): string {
  const key = chips.map((c) => `${c.key}:${c.left === undefined ? '' : Math.ceil(c.left)}`).join(',');
  if (key === prevKey) return key;
  const old = new Map<string, HTMLElement>();
  for (const n of Array.from(root.children) as HTMLElement[]) old.set(n.dataset.k!, n);
  chips.forEach((c, i) => {
    let b = old.get(c.key);
    old.delete(c.key);
    if (!b) {
      b = el('div', `chip buff-mark ${c.kind} ${c.key.split(':')[1] ?? ''}`);
      b.dataset.k = c.key;
      if (c.icon) setIcon(el('span', 'chip-ico', b), c.icon);
      el('span', 'chip-ring', b);
      el('span', 'chip-lbl', b);
      el('span', 'chip-t', b);
    }
    (b.querySelector('.chip-lbl') as HTMLElement).textContent = c.label;
    (b.querySelector('.chip-t') as HTMLElement).textContent = c.left === undefined ? '' : `${Math.ceil(c.left)}s`;
    // time-left ring: fraction of the longest value seen for this chip (the first sighting is ~the full duration)
    const ring = b.querySelector('.chip-ring') as HTMLElement;
    ring.style.display = c.left === undefined ? 'none' : '';
    if (c.left !== undefined) b.style.setProperty('--p', String(ringFraction(b, c.left)));
    setTip(b, c.tip);
    if (root.children[i] !== b) root.insertBefore(b, root.children[i] ?? null);
  });
  for (const n of old.values()) n.remove();
  return key;
}

export class TargetFrame {
  readonly root = el('div', 'target-frame');
  private readonly pic = el('div', 'tf-pic', this.root);
  private readonly level = el('div', 'tf-level', this.root);
  private readonly body = el('div', 'tf-body', this.root);
  private readonly name = el('div', 'tf-name', this.body);
  private readonly hpFill: HTMLElement;
  private readonly shield: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly mp: HTMLElement;
  private readonly mpFill: HTMLElement;
  private readonly info = el('div', 'tf-info', this.body);
  private readonly stats = el('div', 'tf-stats', this.body);
  private readonly items = el('div', 'tf-items', this.body);
  private readonly chips = el('div', 'tf-chips', this.body);
  /** Alt+click on a shown item: "Wren hat Sturmklinge" as a labelled ping (set by the HUD). */
  onItemPing?: (label: string) => void;
  private eid: number | null = null;
  private identity = '';
  private chipKey = '';
  private itemKey = '';
  private statKey = '';

  constructor() {
    const hp = el('div', 'tf-bar hp', this.body);
    this.hpFill = el('div', 'fill', hp);
    this.shield = el('div', 'shield', hp);
    this.hpText = el('div', 'txt', hp);
    this.mp = el('div', 'tf-bar mp', this.body);
    this.mpFill = el('div', 'fill', this.mp);
    this.body.append(this.info, this.stats, this.items, this.chips);
  }

  select(eid: number | null): void {
    this.eid = eid;
  }

  update(state: ClientState): void {
    const snap = state.snap;
    const e = this.eid !== null && snap ? state.byId.get(this.eid) : undefined;
    const ok = !!e && e.alive && e.kind !== Kind.Ward;
    this.root.classList.toggle('open', ok);
    if (!ok || !e || !snap) {
      if (this.eid !== null && snap && !e) this.eid = null; // left vision / died: LoL closes the frame
      return;
    }
    const champ = e.kind === Kind.Champion ? e.champ : null;
    const id = `${e.id}:${e.serial}`;
    if (id !== this.identity) {
      this.identity = id;
      this.chipKey = this.itemKey = this.statKey = '';
      this.root.className = `target-frame open ${e.team === state.myTeam ? 'ally' : e.team <= 1 ? 'enemy' : 'neutral'}`;
      this.pic.style.backgroundImage = '';
      this.pic.textContent = (champ ? champName(champ) : variantName(e.variant, e.kind)).charAt(0);
      if (champ) setPortrait(this.pic, champ);
      this.name.textContent = champ ? champName(champ) : variantName(e.variant, e.kind);
    }
    this.level.textContent = e.level ? String(e.level) : '';
    const total = Math.max(e.maxHp, e.hp + e.shield) || 1;
    this.hpFill.style.width = `${(100 * Math.max(0, e.hp)) / total}%`;
    this.shield.style.left = `${(100 * Math.max(0, e.hp)) / total}%`;
    this.shield.style.width = `${(100 * e.shield) / total}%`;
    this.hpText.textContent = `${Math.min(Math.round(e.maxHp), Math.ceil(Math.max(0, e.hp)))} / ${Math.round(e.maxHp)}`;
    this.mp.style.display = e.maxMana > 0 ? '' : 'none';
    if (e.maxMana > 0) this.mpFill.style.width = `${(100 * e.mana) / e.maxMana}%`;
    const row = champ ? snap.players.find((p) => p.slot === e.slot) : undefined;
    const info = row ? `${row.kills} / ${row.deaths} / ${row.assists} · CS ${row.cs}` : '';
    if (this.info.textContent !== info) this.info.textContent = info;
    // AD / AP / armor / MR / move speed (full stat name as tooltip)
    const sk = e.st?.join(',') ?? '';
    if (sk !== this.statKey) {
      this.statKey = sk;
      this.stats.textContent = '';
      (e.st ?? []).forEach((v, i) => {
        const id = ST_IDS[i]!;
        const s = el('span', 'tf-st', this.stats, `${t(`tf.st.${id}`)} ${v}`);
        setTip(s, `text:${t(ST_FULL[i]!)}`);
      });
    }
    // items of any row that carries them (own team today; enemies once the sim sends last-seen items, user 19 Oct)
    const items = row?.items ?? [];
    const ik = items.join(',');
    if (ik !== this.itemKey) {
      this.itemKey = ik;
      this.items.textContent = '';
      for (const it of items) {
        if (!it) continue;
        const s = el('span', 'mini-item', this.items);
        setIcon(s, itemIcon(it));
        setTip(s, `item:${it}`);
        s.addEventListener('mousedown', (e) => {
          if (!e.altKey) return;
          e.stopPropagation();
          this.onItemPing?.(itemPingText(this.name.textContent ?? '', itemName(it)));
        });
      }
    }
    this.chipKey = drawChips(this.chips, unitChips(e, snap.tick), this.chipKey);
  }
}
