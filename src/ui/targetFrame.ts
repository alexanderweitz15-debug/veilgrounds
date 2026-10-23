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
const CC_ORDER = Object.keys(CC_BIT) as (keyof typeof CC_BIT)[];

export interface Chip {
  key: string;
  label: string;
  /** Seconds left (CC / marks), absent for auras without a known duration. */
  left?: number;
  icon?: string | null;
  kind: 'cc' | 'buff' | 'mark';
  tip: string;
}

/** CC + ability-buff chips of a visible unit (+ jungle/objective marks of the own champion). */
export function unitChips(e: SnapEntity, tick: number, marks: { id: string; left: number }[] = []): Chip[] {
  const out: Chip[] = [];
  if (e.cc) {
    const left = e.ccEnd ? Math.max(0, (e.ccEnd - tick) / 30) : undefined;
    for (const c of CC_ORDER) {
      if (!(e.cc & CC_BIT[c])) continue;
      const label = c === 'slow' && e.slow ? `${t(`cc.${c}`)} ${Math.round(e.slow)} %` : t(`cc.${c}`);
      out.push({ key: `cc:${c}`, label, ...(left !== undefined ? { left } : {}), kind: 'cc', tip: label });
    }
  }
  for (const id of e.auras ?? []) {
    const [champ, key] = id.split('_') as [string, string | undefined];
    const slot = SLOT_OF[key ?? ''];
    const name = slot !== undefined ? abilityInfo(champ, slot, id).name : champName(champ);
    out.push({ key: `aura:${id}`, label: name, icon: slot !== undefined ? abilityIcon(champ, slot) : null, kind: 'buff', tip: `${champName(champ)}: ${name}` });
  }
  for (const m of marks) out.push({ key: `mark:${m.id}`, label: t(`buff.${m.id}`), left: m.left, kind: 'mark', tip: `${t(`buff.${m.id}`)}\n${t(`buff.${m.id}.desc`)}` });
  return out;
}

/** Render chips into `root` (rebuilt only when the visible content changed). Returns the new key. */
export function drawChips(root: HTMLElement, chips: Chip[], prevKey: string): string {
  const key = chips.map((c) => `${c.key}:${c.left === undefined ? '' : Math.ceil(c.left)}`).join(',');
  if (key === prevKey) return key;
  root.textContent = '';
  for (const c of chips) {
    const b = el('div', `chip buff-mark ${c.kind} ${c.key.split(':')[1] ?? ''}`, root);
    if (c.icon) setIcon(el('span', 'chip-ico', b), c.icon);
    el('span', 'chip-lbl', b, c.label);
    if (c.left !== undefined) el('span', 'chip-t', b, `${Math.ceil(c.left)}s`);
    setTip(b, `text:${c.tip}`);
  }
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
  private readonly items = el('div', 'tf-items', this.body);
  private readonly chips = el('div', 'tf-chips', this.body);
  /** Alt+click on a shown item: "Wren hat Sturmklinge" as a labelled ping (set by the HUD). */
  onItemPing?: (label: string) => void;
  private eid: number | null = null;
  private identity = '';
  private chipKey = '';
  private itemKey = '';

  constructor() {
    const hp = el('div', 'tf-bar hp', this.body);
    this.hpFill = el('div', 'fill', hp);
    this.shield = el('div', 'shield', hp);
    this.hpText = el('div', 'txt', hp);
    this.mp = el('div', 'tf-bar mp', this.body);
    this.mpFill = el('div', 'fill', this.mp);
    this.body.append(this.info, this.items, this.chips);
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
      this.chipKey = this.itemKey = '';
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
