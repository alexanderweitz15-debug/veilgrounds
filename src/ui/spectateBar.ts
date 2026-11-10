// Spectator bar for a live bot-vs-bot game (classic lobby "Zuschauen"): pause, game speed, whose eyes (any of the 10
// players), camera follow / free, exit. Same look as the replay bar (replay.css); the sim runs in
// the normal worker link, commands are dropped (main.ts spectate). Own i18n keys spec.*.
import './replay.css';
import type { ReplayHost } from '../game/game';
import type { SimLink } from '../game/link';
import type { SimConfig } from '../sim/types';
import { champName } from './names';
import { t } from '../i18n';

const SPEEDS = [1, 2, 4, 8];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};

export function spectateMount(link: SimLink, config: SimConfig): (root: HTMLElement, host: ReplayHost) => void {
  return (root, host) => {
    root.classList.add('rp-mode');
    const bar = el('div', 'rp-bar spec-bar', root);
    for (const ev of ['pointerdown', 'mousedown', 'contextmenu'] as const) bar.addEventListener(ev, (e) => e.stopPropagation());
    const r1 = el('div', 'rp-row', bar);
    const pause = el('button', 'rp-btn', r1, t('spec.pause'));
    pause.addEventListener('click', () => host.setPaused(!host.state.paused));
    el('span', 'rp-label', r1, t('spec.speed'));
    const speedBtns = SPEEDS.map((s) => {
      const b = el('button', `rp-btn${s === 1 ? ' on' : ''}`, r1, `${s}x`);
      b.addEventListener('click', () => {
        link.setGameSpeed?.(s);
        speedBtns.forEach((x, i) => x.classList.toggle('on', SPEEDS[i] === s));
      });
      return b;
    });
    let cam: 'follow' | 'free' = 'follow';
    const camBtn = el('button', 'rp-btn', r1, t('spec.freeCam'));
    camBtn.addEventListener('click', () => {
      cam = cam === 'follow' ? 'free' : 'follow';
      host.setCamera(cam);
      camBtn.textContent = t(cam === 'follow' ? 'spec.freeCam' : 'spec.followCam');
    });
    el('button', 'rp-btn', r1, t('spec.exit')).addEventListener('click', () => host.exit());

    const r2 = el('div', 'rp-row', bar);
    el('span', 'rp-label', r2, t('spec.view'));
    const first = config.players[0]?.slot;
    const views = [...config.players]
      .sort((a, b) => a.team - b.team || a.slot - b.slot)
      .map((p) => {
        const b = el('button', `rp-btn team${p.team}${p.slot === first ? ' on' : ''}`, r2, champName(p.champion));
        b.addEventListener('click', () => {
          link.view?.(p.slot);
          views.forEach((v) => v.b.classList.toggle('on', v.slot === p.slot));
        });
        return { b, slot: p.slot };
      });
    host.setCamera('follow');
  };
}
