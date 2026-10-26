// Interactive tutorial, UI part: the step card (title, text, n/total, tip, skip / quit), highlight rings around HUD
// elements and the finish card. The logic (steps, detection, sandbox preparation, progress) is src/ui/tutorialSteps.ts.
import './tutorial.css';
import type { Snapshot } from '../sim/snapshot';
import type { Command } from '../sim/types';
import type { SimLink } from '../game/link';
import { loadMap } from '../sim/map';
import { SANDBOX_DUMMY } from '../game/modes';
import { binds, keyLabel, type Action } from '../input/keybinds';
import { t } from '../i18n';
import { TutorialEngine, loadProgress, saveProgress, type Geo } from './tutorialSteps';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

/** Map points the preparation of a step teleports to. */
export function tutorialGeo(): Geo {
  const side = loadMap().sides[0];
  return { fountain: side.fountain, ownTower: side.towers.mid[0]!, dummy: SANDBOX_DUMMY };
}

export class TutorialController {
  readonly engine: TutorialEngine;
  private readonly card: HTMLElement;
  private readonly rings: HTMLElement;
  private tipShown = false;
  private ringKey = '';

  constructor(
    private readonly root: HTMLElement,
    send: (cmd: Command) => void,
    private readonly quit: () => void,
  ) {
    this.engine = new TutorialEngine(send, tutorialGeo(), loadProgress());
    this.engine.onChange = () => {
      saveProgress(this.engine.progress);
      this.draw();
    };
    // rings first, so the card stays on top
    this.rings = el('div', 'tut-rings', root);
    this.card = el('div', 'tut-card', root);
    // clicks on the card must not reach the game canvas (move orders)
    for (const type of ['mousedown', 'pointerdown', 'contextmenu']) this.card.addEventListener(type, (e) => e.stopPropagation());
    this.draw();
  }

  /** Every snapshot. */
  ingest(snap: Snapshot): void {
    this.engine.ingest(snap);
  }

  /** Wrap the link's send so the engine sees what the player's input does. */
  watchLink(link: SimLink): void {
    const orig = link.send.bind(link);
    link.send = (cmd) => {
      this.engine.onCommand(cmd);
      orig(cmd);
    };
  }

  /** Every frame: tip timer, ring positions (the HUD can move / resize). */
  frame(): void {
    if (this.engine.showTip !== this.tipShown) this.draw();
    this.placeRings();
  }

  private text(id: string, part: string, keys: string[]): string {
    const vars: Record<string, string> = {};
    for (const k of keys) vars[k] = keyLabel(binds[k as Action] ?? '');
    return t(`tutorial.step.${id}.${part}`, vars);
  }

  private draw(): void {
    const e = this.engine;
    this.tipShown = e.showTip;
    const c = this.card;
    c.textContent = '';
    c.classList.toggle('finished', e.phase === 'finished');
    c.classList.toggle('flash', e.phase === 'flash');
    el('div', 'tut-label', c, t('tutorial.label'));
    if (e.phase === 'finished') {
      el('h3', 'tut-title', c, t('tutorial.finishTitle'));
      el('p', 'tut-text', c, t('tutorial.finishText'));
      const row = el('div', 'tut-row', c);
      el('button', 'tut-btn', row, t('tutorial.restart')).addEventListener('click', () => e.restart());
      el('button', 'tut-btn primary', row, t('tutorial.quit')).addEventListener('click', this.quit);
      this.setRings([]);
      return;
    }
    const step = e.step;
    if (!step) return;
    const total = e.steps.length;
    el('div', 'tut-progress', c, t('tutorial.stepOf', { n: e.index + 1, total }));
    const bar = el('div', 'tut-bar', c);
    for (let i = 0; i < total; i++) {
      const id = e.steps[i]!.id;
      el('span', e.done.has(id) ? 'on' : e.skipped.has(id) ? 'skip' : i === e.index ? 'cur' : '', bar);
    }
    el('h3', 'tut-title', c, this.text(step.id, 'title', []));
    if (e.phase === 'flash') {
      el('p', 'tut-ok', c, `✓ ${t('tutorial.done')}`);
      this.setRings([]);
      return;
    }
    el('p', 'tut-text', c, this.text(step.id, 'text', step.keys));
    if (step.total) el('div', 'tut-count', c, `${e.count} / ${step.total}`);
    if (e.showTip) {
      const tip = el('p', 'tut-tip', c);
      el('b', '', tip, `${t('tutorial.tipLabel')}: `);
      tip.append(this.text(step.id, 'tip', step.keys));
    }
    const row = el('div', 'tut-row', c);
    el('button', 'tut-btn', row, t('tutorial.skip')).addEventListener('click', () => e.skip());
    el('button', 'tut-btn', row, t('tutorial.quit')).addEventListener('click', this.quit);
    this.setRings(step.highlight);
  }

  // ---------------------------------------------------------------- highlight rings

  private selectors: string[] = [];

  private setRings(selectors: string[]): void {
    this.selectors = selectors;
    this.ringKey = '';
    this.placeRings();
  }

  /** One ring div per matched element, positioned from getBoundingClientRect (no classes on HUD nodes). */
  private placeRings(): void {
    if (!this.selectors.length) {
      if (this.rings.childElementCount) this.rings.textContent = '';
      return;
    }
    const base = this.root.getBoundingClientRect();
    const rects: DOMRect[] = [];
    for (const s of this.selectors) for (const n of this.root.querySelectorAll(s)) rects.push(n.getBoundingClientRect());
    const key = rects.map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`).join('|');
    if (key === this.ringKey) return;
    this.ringKey = key;
    this.rings.textContent = '';
    for (const r of rects) {
      if (r.width < 2 || r.height < 2) continue; // hidden slot (display: none)
      const ring = el('div', 'tut-ring', this.rings);
      ring.style.cssText = `left:${r.left - base.left - 4}px;top:${r.top - base.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
    }
  }

  dispose(): void {
    this.rings.remove();
    this.card.remove();
    this.engine.onChange = null;
  }
}
