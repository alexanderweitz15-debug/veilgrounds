// Rebindable keybinds. Stored by KeyboardEvent.code (physical position, layout independent), shown with the
// layout label where the browser exposes it (navigator.keyboard.getLayoutMap, Chromium). Note: on QWERTZ the
// default 'KeyY' (camera lock) is the key labelled Z, matching LoL's position-based defaults.
import { kvGet, kvSet } from '../store/kv';

export type Action =
  | 'stop' | 'attackMove'
  | 'q' | 'w' | 'e' | 'r'
  | 'd' | 'f' | 'tp'
  | 'recall' | 'centerCamera' | 'toggleCameraLock' | 'pause' | 'showRange'
  | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6' | 'trinket'
  | 'scoreboard' | 'debug' | 'shop'
  | 'pingWheel' | 'pingMissing' | 'pingQuestion';

export const DEFAULT_BINDS: Record<Action, string> = {
  stop: 'KeyS',
  attackMove: 'KeyA',
  q: 'KeyQ',
  w: 'KeyW',
  e: 'KeyE',
  r: 'KeyR',
  d: 'KeyD',
  f: 'KeyF',
  /** Third summoner slot: Teleport unlocked for the top laner after 1500 minion gold (B4). */
  tp: 'KeyT',
  recall: 'KeyB',
  centerCamera: 'Space',
  toggleCameraLock: 'KeyY',
  pause: 'F10',
  showRange: 'KeyC',
  item1: 'Digit1',
  item2: 'Digit2',
  item3: 'Digit3',
  item4: 'Digit5',
  item5: 'Digit6',
  item6: 'Digit7',
  trinket: 'Digit4',
  scoreboard: 'Tab',
  debug: 'F9',
  shop: 'KeyP',
  pingWheel: 'KeyG',
  pingMissing: 'KeyV',
  /** LoL '?' ping (no LoL default key; H is free here). */
  pingQuestion: 'KeyH',
};

export const ACTIONS = Object.keys(DEFAULT_BINDS) as Action[];

export const binds: Record<Action, string> = { ...DEFAULT_BINDS };
let layout: Map<string, string> | null = null;
let version = 0;
/** Bumped on every rebind/reset/load: views showing key labels (HUD) refresh when it changes. */
export const bindsVersion = (): number => version;

export async function loadBinds(): Promise<void> {
  const saved = await kvGet<Partial<Record<Action, string>>>('keybinds');
  if (saved) for (const a of ACTIONS) if (saved[a]) binds[a] = saved[a]!;
  version++;
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (kb) layout = await kb.getLayoutMap();
  } catch {
    layout = null;
  }
}

export function setBind(a: Action, code: string): void {
  // a key can only do one thing: unbind the previous owner
  for (const other of ACTIONS) if (other !== a && binds[other] === code) binds[other] = '';
  binds[a] = code;
  version++;
  void kvSet('keybinds', { ...binds });
}

/** Replace several binds at once (settings import); unlisted actions keep their key, conflicts unbind the older one. */
export function applyBinds(map: Partial<Record<Action, string>>): void {
  for (const a of ACTIONS) {
    const code = map[a];
    if (code === undefined) continue;
    for (const other of ACTIONS) if (other !== a && binds[other] === code && code) binds[other] = '';
    binds[a] = code;
  }
  version++;
  void kvSet('keybinds', { ...binds });
}

export function resetBinds(): void {
  Object.assign(binds, DEFAULT_BINDS);
  version++;
  void kvSet('keybinds', { ...binds });
}

export function actionFor(code: string): Action | null {
  for (const a of ACTIONS) if (binds[a] === code) return a;
  return null;
}

/** Human label for a key code ("Q", "Space", "F10"). */
export function keyLabel(code: string): string {
  if (!code) return '-';
  const l = layout?.get(code);
  if (l) return l.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  return code;
}
