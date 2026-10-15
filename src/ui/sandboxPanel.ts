// Sandbox panel (Phase 5): every sandbox cheat in one panel (the HUD's basic cheat list is only used outside the
// sandbox). Set level, gold, cooldown/HP refresh, permanent cooldown reset, god mode, teleport / dummy at the cursor,
// minion wave now, jungle camps now, lane minions on/off, invulnerable towers. No-cooldown / god-mode states come
// back from the snapshot (PlayerHud.sandbox), so those buttons always show what the sim actually does.
import './trainer.css';
import type { CheatOp } from '../sim/types';
import type { PlayerHud } from '../sim/snapshot';
import { t } from '../i18n';

export type SendCheat = (op: CheatOp, value?: number) => void;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class SandboxPanel {
  readonly root: HTMLElement;
  private readonly noCd: HTMLButtonElement;
  private readonly god: HTMLButtonElement;

  constructor(parent: HTMLElement, send: SendCheat, arm?: (a: 'teleport' | 'spawnDummy') => void) {
    this.root = el('div', 'sbx-panel', parent);
    // clicks here must not reach the game canvas (move orders)
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    el('div', 'tr-title', this.root, t('cheat.title'));
    const btn = (parent: HTMLElement, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', '', parent, label);
      b.addEventListener('click', fn);
      return b;
    };
    // level
    const lvlRow = el('div', 'sbx-row', this.root);
    const lvl = el('select', '', lvlRow);
    el('option', '', lvl, t('sandbox.level')).value = '';
    for (let l = 1; l <= 18; l++) el('option', '', lvl, `${t('sandbox.levelN')} ${l}`).value = String(l);
    lvl.addEventListener('change', () => {
      if (lvl.value) send('setLevel', Number(lvl.value));
      lvl.value = '';
    });
    btn(lvlRow, t('cheat.levelUp'), () => send('levelUp'));
    const gold = el('div', 'sbx-row', this.root);
    btn(gold, '+1000 G', () => send('gold', 1000));
    btn(gold, '+10000 G', () => send('gold', 10000));
    btn(this.root, t('cheat.refreshCd'), () => send('refreshCd'));
    btn(this.root, t('cheat.refreshHp'), () => send('refreshHp'));
    this.noCd = btn(this.root, t('sandbox.noCd'), () => send('noCooldowns'));
    this.god = btn(this.root, t('sandbox.god'), () => send('godMode'));
    if (arm) {
      btn(this.root, t('cheat.teleport'), () => arm('teleport'));
      btn(this.root, t('cheat.spawnDummy'), () => arm('spawnDummy'));
    }
    btn(this.root, t('sandbox.wave'), () => send('spawnWave'));
    btn(this.root, t('sandbox.camps'), () => send('respawnCamps'));
    // client-side toggle state (the sim flags are not in the snapshot)
    const minions = btn(this.root, t('cheat.toggleMinions'), () => (send('toggleMinions'), minions.classList.toggle('on')));
    const towers = btn(this.root, t('cheat.towersInvulnerable'), () => (send('towersInvulnerable'), towers.classList.toggle('on')));
  }

  update(me: PlayerHud | null | undefined): void {
    this.noCd.classList.toggle('on', !!me?.sandbox?.noCd);
    this.god.classList.toggle('on', !!me?.sandbox?.god);
  }

  dispose(): void {
    this.root.remove();
  }
}
