// Death timers above the minimap (C2, LoL: dead allies and enemies with portrait + respawn seconds). Lives inside
// .minimap-wrap so it scales with the minimap (--ui). One node per champion, built once (lazy portrait queue),
// hidden while alive and ordered by time left via CSS `order`.
import type { ClientState } from '../game/state';
import { setPortrait } from '../render/portraits';
import { champName } from './names';
import { t } from '../i18n';

interface Node {
  root: HTMLElement;
  num: HTMLElement;
  key: string;
}

export class DeathBar {
  readonly root = document.createElement('div');
  private readonly nodes = new Map<number, Node>();

  constructor() {
    this.root.className = 'death-bar';
  }

  update(state: ClientState): void {
    const snap = state.snap;
    if (!snap) return;
    const dead = state.objectives.deadList();
    const shown = new Set<number>();
    dead.forEach(({ row, left }, i) => {
      let n = this.nodes.get(row.slot);
      if (!n) {
        const root = document.createElement('div');
        const pic = document.createElement('span');
        pic.className = 'db-pic';
        pic.textContent = champName(row.champ).charAt(0);
        if (row.champ) setPortrait(pic, row.champ);
        const num = document.createElement('span');
        num.className = 'db-num';
        root.append(pic, num);
        this.root.appendChild(root);
        n = { root, num, key: '' };
        this.nodes.set(row.slot, n);
      }
      shown.add(row.slot);
      const secs = left === null ? '' : String(Math.ceil(left));
      const cls = `db-item ${row.team === snap.team ? 'ally' : 'enemy'}`;
      const key = `${cls}|${secs}|${i}`;
      if (key === n.key) return;
      n.key = key;
      n.root.className = cls;
      n.root.style.order = String(i);
      n.num.textContent = secs;
      n.root.title = left === null ? champName(row.champ) : t('score.respawnTip', { name: champName(row.champ), s: secs });
    });
    for (const [slot, n] of this.nodes) {
      if (shown.has(slot) || n.key === 'hidden') continue;
      n.key = 'hidden';
      n.root.className = 'db-item hidden';
    }
    this.root.classList.toggle('empty', shown.size === 0);
  }
}
