// Settings form (used in the main menu and the in-game Escape menu): language, camera, UI scale, toggles and
// key rebinding. Rebuilds itself on language change.
import { t } from '../i18n';
import { settings, updateSettings, type Settings } from '../settings';
import { ACTIONS, binds, keyLabel, resetBinds, setBind, type Action } from '../input/keybinds';

export function buildSettingsPanel(onLang: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'settings';
  let capturing: { action: Action; btn: HTMLButtonElement } | null = null;

  const onKey = (e: KeyboardEvent): void => {
    if (!capturing) return;
    // the menu was closed (e.g. "Weiter") while waiting for a key: the capture ends, the key goes to the game
    if (!root.isConnected || !root.getClientRects().length) {
      capturing = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') setBind(capturing.action, e.code);
    capturing = null;
    render();
  };
  window.addEventListener('keydown', onKey, true);
  // detach the capture listener once the panel leaves the DOM
  new MutationObserver((_, obs) => {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey, true);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });

  const row = (label: string, control: HTMLElement): void => {
    const r = document.createElement('label');
    r.className = 'row';
    const s = document.createElement('span');
    s.textContent = label;
    r.append(s, control);
    root.appendChild(r);
  };
  const check = (key: keyof Settings): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = settings[key] as boolean;
    i.addEventListener('change', () => updateSettings({ [key]: i.checked } as Partial<Settings>));
    return i;
  };
  const slider = (key: 'cameraSpeed' | 'uiScale' | 'volume', min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'slider';
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(settings[key]);
    const v = document.createElement('em');
    v.textContent = fmt(settings[key]);
    i.addEventListener('input', () => {
      // moving the UI scale slider switches automatic scaling off
      updateSettings(key === 'uiScale' ? { uiScale: Number(i.value), uiScaleAuto: false } : { [key]: Number(i.value) });
      v.textContent = fmt(Number(i.value));
      if (key === 'uiScale' && autoBox) autoBox.checked = false;
    });
    wrap.append(i, v);
    return wrap;
  };
  const select = <V extends string>(value: V, opts: [V, string][], set: (v: V) => void): HTMLSelectElement => {
    const s = document.createElement('select');
    for (const [v, l] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => set(s.value as V));
    return s;
  };

  let autoBox: HTMLInputElement | null = null;
  const section = (title: string): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    root.appendChild(h);
  };

  function render(): void {
    root.textContent = '';
    row(t('set.lang'), select(settings.lang, [['de', 'Deutsch'], ['en', 'English']], (v) => {
      updateSettings({ lang: v });
      render();
      onLang();
    }));
    row(t('set.cameraSpeed'), slider('cameraSpeed', 0.3, 3, 0.1, (v) => `${v.toFixed(1)}×`));
    autoBox = check('uiScaleAuto');
    row(t('set.uiScaleAuto'), autoBox);
    row(t('set.uiScale'), slider('uiScale', 80, 150, 5, (v) => `${v}%`));
    row(t('set.damageNumbers'), check('damageNumbers'));
    row(t('set.attackMoveOnCursor'), check('attackMoveOnCursor'));
    row(t('set.castIndicator'), check('castIndicator'));
    row(t('set.edgeScroll'), check('edgeScroll'));
    row(t('set.cameraLocked'), check('cameraLocked'));
    row(t('set.fullscreenLock'), check('fullscreenLock'));
    row(t('set.botToxicity'), check('botToxicity'));
    row(t('set.volume'), slider('volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
    section(t('set.graphicsTitle'));
    row(t('set.graphics'), select<Settings['graphics']>(settings.graphics, [['low', t('set.gfx.low')], ['medium', t('set.gfx.medium')], ['high', t('set.gfx.high')]], (v) => updateSettings({ graphics: v })));
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = t('set.graphicsNote');
    root.appendChild(note);
    section(t('set.a11yTitle'));
    row(t('set.colorMode'), select<Settings['colorMode']>(settings.colorMode, [
      ['normal', t('set.cb.normal')], ['deuteranopia', t('set.cb.deuteranopia')], ['protanopia', t('set.cb.protanopia')], ['tritanopia', t('set.cb.tritanopia')],
    ], (v) => updateSettings({ colorMode: v })));
    row(t('set.reduceMotion'), check('reduceMotion'));
    row(t('set.highContrast'), check('highContrast'));
    row(t('set.visualCues'), check('visualCues'));
    const h = document.createElement('h3');
    h.textContent = t('set.keybinds');
    root.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'binds';
    for (const a of ACTIONS) {
      const l = document.createElement('span');
      l.textContent = t(`act.${a}`);
      const b = document.createElement('button');
      b.className = 'btn small key';
      b.textContent = capturing?.action === a ? t('set.pressKey') : keyLabel(binds[a]);
      b.addEventListener('click', () => {
        capturing = { action: a, btn: b };
        b.textContent = t('set.pressKey');
      });
      grid.append(l, b);
    }
    root.appendChild(grid);
    const reset = document.createElement('button');
    reset.className = 'btn small';
    reset.textContent = t('set.reset');
    reset.addEventListener('click', () => {
      resetBinds();
      render();
    });
    root.appendChild(reset);
  }
  render();
  return root;
}
