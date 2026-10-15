// DOM HUD: bottom panel (portrait, bars, abilities, summoners, items, gold), top bar (clock, kills, towers,
// CS), kill feed, respawn timer, pause / game-over overlays and placeholder panels. Writes are diffed.
import { PING_COLOR } from './pingWheel';
import type { ClientState } from '../game/state';
import type { AbilityHud } from '../sim/systems/abilities';
import { Kind, type SimEvent } from '../sim/types';
import { t } from '../i18n';
import { settings } from '../settings';
import { keyLabel, binds, type Action } from '../input/keybinds';
import { abilityInfo, champName, summonerName } from './names';
import type { Panel, Armed } from '../input/controller';
import { CUM_XP } from '../sim/systems/economy';
import type { PlayerSetup } from '../sim/types';
import { ShopPanel, itemAbbr, itemTooltip } from './shop';
import { Scoreboard } from './scoreboard';
import { BotDebugPanel } from './botDebug';
import { setPortrait } from '../render/portraits';

const KILLFEED_MS = 9000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Set text only when it changed (avoids layout churn). */
function setText(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}
function setStyle(e: HTMLElement, k: string, v: string): void {
  if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v);
}
function toggle(e: HTMLElement, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

interface SlotView {
  root: HTMLElement;
  icon: HTMLElement;
  cd: HTMLElement;
  cdNum: HTMLElement;
  pips: HTMLElement;
  plus: HTMLButtonElement;
  key: HTMLElement;
}

export interface HudHooks {
  levelUp(slot: 0 | 1 | 2 | 3): void;
  cheat(op: string): void;
  arm(a: Armed): void;
  quit(): void;
  /** Shop (Agent H). */
  buy(item: string): void;
  sell(slot: number): void;
  /** Trinket swap (Agent J); clicking the trinket slot in the fountain. */
  swapTrinket?(id: 'schleierward' | 'suchfeuer'): void;
}

type TrinketHud = NonNullable<NonNullable<ClientState['snap']>['me']>['trinket'];

export class Hud {
  readonly root = el('div', 'hud');
  private readonly slots: SlotView[] = [];
  private readonly items: HTMLElement[] = [];
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly mpFill: HTMLElement;
  private readonly mpText: HTMLElement;
  private readonly shieldFill: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpRing: HTMLElement;
  private readonly portrait: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly kills: [HTMLElement, HTMLElement];
  private readonly towers: [HTMLElement, HTMLElement];
  private readonly cs: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly respawn: HTMLElement;
  private readonly recall: HTMLElement;
  private readonly recallFill: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly over: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly armedHint: HTMLElement;
  private readonly panels: Record<Panel, HTMLElement>;
  readonly debugText: HTMLElement;
  /** F9 bot overlay (src/ui/botDebug.ts), filled by Game from the worker's bot rows. */
  readonly botDebug: BotDebugPanel;
  private readonly noChamp: HTMLElement;
  private feedEntries: { at: number; node: HTMLElement }[] = [];
  private champ = '';
  private readonly shop: ShopPanel;
  private readonly score: Scoreboard;
  private itemKey = '';
  private readonly marks: HTMLElement;
  private trinketKey = '';
  private trinketSwap: 'schleierward' | 'suchfeuer' | null = null;

  constructor(hooks: HudHooks, sandbox: boolean, players: readonly PlayerSetup[] = []) {
    const r = this.root;
    // ---- top bar
    const top = el('div', 'hud-top', r);
    this.kills = [el('span', 'k blue', top, '0'), el('span', 'k red', top, '0')];
    top.insertBefore(el('span', 'sep', undefined, '⚔'), this.kills[1]);
    const tw = el('span', 'towers', top);
    el('span', 'lbl', tw, t('hud.towers'));
    this.towers = [el('span', 'blue', tw, '0'), el('span', 'red', tw, '0')];
    tw.insertBefore(el('span', '', undefined, ':'), this.towers[1]);
    this.cs = el('span', 'cs', top, '');
    this.clock = el('span', 'clock', top, '00:00');

    // ---- kill feed
    this.feed = el('div', 'killfeed', r);

    // ---- bottom panel
    const bottom = el('div', 'hud-bottom', r);
    const portraitWrap = el('div', 'portrait-wrap', bottom);
    this.xpRing = el('div', 'xp-ring', portraitWrap);
    this.portrait = el('div', 'portrait', portraitWrap, '?');
    this.level = el('div', 'level', portraitWrap, '1');
    const center = el('div', 'hud-center', bottom);
    const abil = el('div', 'abilities', center);
    const keys: Action[] = ['q', 'w', 'e', 'r', 'd', 'f'];
    keys.forEach((k, i) => {
      if (i === 4) el('div', 'abil-gap', abil);
      const root = el('div', `slot ${i >= 4 ? 'summ' : 'abil'}`, abil);
      const icon = el('div', 'icon', root);
      const cd = el('div', 'cd', root);
      const cdNum = el('div', 'cdnum', root);
      const key = el('div', 'key', root, keyLabel(binds[k]));
      const pips = el('div', 'pips', root);
      const plus = el('button', 'plus', root, '+');
      plus.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (i < 4) hooks.levelUp(i as 0 | 1 | 2 | 3);
      });
      this.slots.push({ root, icon, cd, cdNum, pips, plus, key });
    });
    const bars = el('div', 'bars', center);
    const hp = el('div', 'bar hp', bars);
    this.hpFill = el('div', 'fill', hp);
    this.shieldFill = el('div', 'shield', hp);
    this.hpText = el('div', 'txt', hp);
    const mp = el('div', 'bar mp', bars);
    this.mpFill = el('div', 'fill', mp);
    this.mpText = el('div', 'txt', mp);
    const inv = el('div', 'inventory', bottom);
    const grid = el('div', 'items', inv);
    const itemKeys: Action[] = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'trinket'];
    itemKeys.forEach((k, i) => {
      const s = el('div', i === 6 ? 'item trinket' : 'item', grid);
      el('div', 'abbr', s);
      el('div', 'key', s, keyLabel(binds[k]));
      if (i === 6) {
        el('div', 'tcd', s);
        el('div', 'charges', s);
        s.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.trinketSwap) hooks.swapTrinket?.(this.trinketSwap);
        });
      }
      this.items.push(s);
    });
    this.gold = el('div', 'gold', inv, '0');
    this.gold.addEventListener('mousedown', (e) => (e.stopPropagation(), this.togglePanel('shop')));
    this.armedHint = el('div', 'armed-hint', bottom);

    // ---- centre overlays
    this.respawn = el('div', 'respawn', r);
    this.recall = el('div', 'recall', r);
    el('div', 'lbl', this.recall);
    this.recallFill = el('div', 'fill', el('div', 'track', this.recall));
    this.noChamp = el('div', 'nochamp', r, t('hud.noChampion'));
    this.pause = el('div', 'pause-overlay', r);
    el('div', 'big', this.pause, t('hud.paused'));
    el('div', 'hint', this.pause, t('hud.pausedHint'));
    this.over = el('div', 'gameover', r);
    this.overTitle = el('div', 'big', this.over);
    el('button', 'btn', this.over, t('menu.quit')).addEventListener('click', () => hooks.quit());

    // ---- placeholder panels
    this.panels = {
      scoreboard: el('div', 'panel scoreboard', r, t('hud.scoreboard')),
      shop: el('div', 'panel shop', r, t('hud.shop')),
      debug: el('div', 'panel debug', r),
    };
    el('div', 'ttl', this.panels.debug, t('hud.debug'));
    this.debugText = el('pre', '', this.panels.debug);
    this.botDebug = new BotDebugPanel(this.panels.debug);
    this.shop = new ShopPanel(this.panels.shop, hooks);
    this.score = new Scoreboard(this.panels.scoreboard, players);
    // active jungle/objective buffs (Dornenbock, Glutwächter, Schleierwächter) above the ability bar
    this.marks = el('div', 'buff-marks', r);

    // ---- sandbox cheats
    if (sandbox) {
      const ch = el('div', 'cheats', r);
      el('div', 'ttl', ch, t('cheat.title'));
      const ops: [string, string][] = [
        ['refreshCd', 'cheat.refreshCd'], ['refreshHp', 'cheat.refreshHp'], ['levelUp', 'cheat.levelUp'], ['gold', 'cheat.gold'],
        ['teleport', 'cheat.teleport'], ['spawnDummy', 'cheat.spawnDummy'], ['toggleMinions', 'cheat.toggleMinions'], ['towersInvulnerable', 'cheat.towersInvulnerable'],
      ];
      for (const [op, key] of ops) {
        const b = el('button', 'btn small', ch, t(key));
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('click', () => {
          if (op === 'teleport' || op === 'spawnDummy') hooks.arm(op);
          else hooks.cheat(op);
          if (op === 'toggleMinions' || op === 'towersInvulnerable') b.classList.toggle('on');
        });
      }
    }
    this.applyScale();
  }

  applyScale(): void {
    this.root.style.setProperty('--ui', String(settings.uiScale / 100));
  }

  togglePanel(p: Panel, on?: boolean): void {
    this.panels[p].classList.toggle('open', on);
  }

  isPanelOpen(p: Panel): boolean {
    return this.panels[p].classList.contains('open');
  }

  setArmed(a: Armed): void {
    setText(this.armedHint, a === 'attackMove' ? t('hud.attackMoveArmed') : a ? t('hud.teleportArmed') : '');
  }

  flashItem(i: number): void {
    const s = this.items[i];
    if (!s) return;
    s.classList.remove('flash');
    void s.offsetWidth;
    s.classList.add('flash');
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    if (ev.e === 'ping') {
      const who = [...state.byId.values()].find((e) => e.kind === Kind.Champion && e.slot === ev.slot);
      const node = el('div', 'entry ping', this.feed, `${champName(who?.champ ?? null)}: ${t(`ping.${ev.kind}`)}`);
      node.style.borderLeftColor = PING_COLOR[ev.kind];
      this.feedEntries.push({ at: now, node });
      return;
    }
    if (ev.e !== 'death') return;
    let text = '';
    if (ev.kind === Kind.Champion) {
      const victim = state.byId.get(ev.eid);
      const killer = state.byId.get(ev.killer);
      const vName = champName(victim?.champ ?? null);
      text = killer && killer.kind === Kind.Champion ? t('kill.slain', { a: champName(killer.champ), b: vName }) : t('kill.executed', { b: vName });
    } else if (ev.kind === Kind.Tower) text = t('kill.tower', { team: t(`team.${ev.team}`) });
    else if (ev.kind === Kind.Inhibitor) text = t('kill.inhib', { team: t(`team.${ev.team}`) });
    else return;
    const node = el('div', `entry ${ev.team === state.myTeam ? 'bad' : 'good'}`, this.feed, text);
    this.feedEntries.push({ at: now, node });
  }

  update(state: ClientState, now: number): void {
    const snap = state.snap;
    // kill feed expiry
    while (this.feedEntries.length && now - this.feedEntries[0]!.at > KILLFEED_MS) this.feedEntries.shift()!.node.remove();
    toggle(this.pause, 'open', state.paused);
    if (state.winner !== null) {
      toggle(this.over, 'open', true);
      setText(this.overTitle, state.winner === state.myTeam ? t('hud.victory') : t('hud.defeat'));
      toggle(this.over, 'win', state.winner === state.myTeam);
    }
    if (!snap) return;
    const time = snap.time;
    setText(this.clock, `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`);
    setText(this.kills[0], String(state.kills[0]));
    setText(this.kills[1], String(state.kills[1]));
    setText(this.towers[0], String(state.towers[0]));
    setText(this.towers[1], String(state.towers[1]));
    this.score.update(snap);
    const me = snap.me;
    toggle(this.noChamp, 'open', !me);
    if (!me) {
      this.drawAbilities([]);
      return;
    }
    const meE = state.byId.get(me.eid);
    if (me.champ !== this.champ) {
      this.champ = me.champ;
      setText(this.portrait, champName(me.champ).charAt(0));
      this.portrait.title = champName(me.champ);
      if (me.champ) setPortrait(this.portrait, me.champ);
    }
    setText(this.cs, `${t('hud.cs')} ${me.cs} (${(me.cs / Math.max(1, time / 60)).toFixed(1)}/min)`);
    setText(this.level, String(me.level));
    // xp is cumulative; CUM_XP[L] = total xp needed to reach level L
    const lo = CUM_XP[me.level] ?? 0;
    const hi = CUM_XP[me.level + 1];
    setStyle(this.xpRing, '--p', hi === undefined ? '1' : String(Math.min(1, Math.max(0, (me.xp - lo) / Math.max(1, hi - lo)))));
    setText(this.gold, String(Math.floor(me.gold)));
    this.drawItems(me.items ?? [], me.marks ?? []);
    this.drawTrinket(me.trinket);
    if (this.panels.shop.classList.contains('open')) this.shop.update(me);
    if (meE) {
      const total = Math.max(meE.maxHp, meE.hp + meE.shield) || 1;
      setStyle(this.hpFill, 'width', `${(100 * meE.hp) / total}%`);
      setStyle(this.shieldFill, 'left', `${(100 * meE.hp) / total}%`);
      setStyle(this.shieldFill, 'width', `${(100 * meE.shield) / total}%`);
      setText(this.hpText, `${Math.ceil(meE.hp)} / ${Math.round(meE.maxHp)}`);
      setStyle(this.mpFill, 'width', `${meE.maxMana ? (100 * meE.mana) / meE.maxMana : 0}%`);
      setText(this.mpText, meE.maxMana ? `${Math.floor(meE.mana)} / ${Math.round(meE.maxMana)}` : '');
    }
    this.drawAbilities(me.abilities);
    // respawn + recall
    toggle(this.respawn, 'open', me.dead);
    toggle(this.root, 'dead', me.dead);
    if (me.dead) setText(this.respawn, t('hud.respawn', { s: Math.ceil(me.respawnIn) }));
    const tp = me.teleportLeft ?? 0; // Teleport channel reuses the recall bar (4 s)
    toggle(this.recall, 'open', me.recallLeft > 0 || tp > 0);
    if (tp > 0) {
      setText(this.recall.firstElementChild as HTMLElement, `${summonerName('teleport')} ${tp.toFixed(1)}`);
      setStyle(this.recallFill, 'width', `${Math.min(100, (tp / 4) * 100)}%`);
    } else if (me.recallLeft > 0) {
      setText(this.recall.firstElementChild as HTMLElement, t('hud.recall', { s: me.recallLeft.toFixed(1) }));
      setStyle(this.recallFill, 'width', `${Math.min(100, (me.recallLeft / 8) * 100)}%`);
    }
  }

  /** Item slots (abbreviated names + tooltip) and active jungle/objective buffs. */
  private drawItems(items: (string | null)[], marks: { id: string; left: number }[]): void {
    const key = items.join(',') + '|' + marks.map((m) => `${m.id}:${Math.ceil(m.left)}`).join(',');
    if (key === this.itemKey) return;
    this.itemKey = key;
    this.items.forEach((s, i) => {
      if (i === 6) return; // trinket slot: drawTrinket
      const id = items[i] ?? null;
      setText(s.firstElementChild as HTMLElement, id ? itemAbbr(id) : '');
      toggle(s, 'filled', !!id);
      s.title = id ? itemTooltip(id) : '';
    });
    this.marks.textContent = '';
    for (const m of marks) {
      const b = el('div', `buff-mark ${m.id}`, this.marks, `${t(`buff.${m.id}`)} ${Math.ceil(m.left)}s`);
      b.title = t(`buff.${m.id}.desc`);
    }
  }

  /** Trinket slot: short name, charges, recharge / cooldown sweep; gold ring when a swap is possible. */
  private drawTrinket(tr: TrinketHud): void {
    const s = this.items[6];
    if (!s || !tr) return;
    const key = `${tr.id}|${tr.charges}|${tr.canSwap}|${Math.ceil(tr.cdLeft * 4)}`;
    if (key === this.trinketKey) return;
    this.trinketKey = key;
    this.trinketSwap = tr.canSwap;
    const name = t(`trinket.${tr.id}`);
    setText(s.querySelector('.abbr') as HTMLElement, name.slice(0, 2));
    toggle(s, 'filled', true);
    toggle(s, 'swap', !!tr.canSwap);
    toggle(s, 'empty-charges', tr.charges <= 0);
    setText(s.querySelector('.charges') as HTMLElement, tr.maxCharges > 1 ? String(tr.charges) : '');
    // veil: sweep shows the recharge of the next charge; sweeper: its cooldown
    setStyle(s.querySelector('.tcd') as HTMLElement, '--p', tr.cdLeft > 0 && tr.cdTotal > 0 ? String(tr.cdLeft / tr.cdTotal) : '0');
    const swap = tr.canSwap ? `
${t('trinket.swap', { name: t(`trinket.${tr.canSwap}`) })}` : '';
    s.title = `${name}
${t(`trinket.${tr.id}.desc`)}${tr.cdLeft > 0 ? ` (${Math.ceil(tr.cdLeft)} s)` : ''}${swap}`;
  }

  private drawAbilities(list: AbilityHud[]): void {
    for (let i = 0; i < 6; i++) {
      const s = this.slots[i]!;
      const a = list[i];
      toggle(s.root, 'empty', !a);
      if (!a) {
        setText(s.cdNum, '');
        setStyle(s.cd, '--p', '0');
        toggle(s.plus, 'show', false);
        continue;
      }
      const isSumm = i >= 4;
      const info = isSumm ? { name: summonerName(a.id), desc: '' } : abilityInfo(this.champ, i, a.id);
      const label = info.name.slice(0, isSumm ? 2 : 3);
      setText(s.icon, label);
      const title = info.desc ? `${info.name}\n${info.desc}` : info.name;
      if (s.root.title !== title) s.root.title = title;
      const ready = a.cdLeft <= 0.05;
      toggle(s.root, 'unlearned', !isSumm && a.rank === 0);
      toggle(s.root, 'cooling', !ready);
      setStyle(s.cd, '--p', ready ? '0' : String(a.cdTotal > 0 ? a.cdLeft / a.cdTotal : 1));
      setText(s.cdNum, ready ? '' : a.cdLeft >= 1 ? String(Math.ceil(a.cdLeft)) : a.cdLeft.toFixed(1));
      toggle(s.plus, 'show', !isSumm && a.canLevel);
      if (!isSumm && s.pips.childElementCount !== a.maxRank) {
        s.pips.textContent = '';
        for (let k = 0; k < a.maxRank; k++) el('i', '', s.pips);
      }
      if (!isSumm) for (let k = 0; k < s.pips.children.length; k++) toggle(s.pips.children[k] as HTMLElement, 'on', k < a.rank);
    }
  }
}
