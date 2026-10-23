// Rebindable keybinds. Stored by KeyboardEvent.code (physical position, layout independent), shown with the
// layout label where the browser exposes it (navigator.keyboard.getLayoutMap, Chromium). Note: on QWERTZ the
// default 'KeyY' (camera lock) is the key labelled Z, matching LoL's position-based defaults.
// Every action has a primary key (`binds`, read by the HUD) and an alternate key (`altBinds`); a key code belongs to at
// most one slot (binding it elsewhere takes it away and reports who lost it). Self-cast and level-up are modifiers
// (settings.selfCastMod / levelUpMod), resolved together with the key by resolveKey().
import { kvGet, kvSet } from '../store/kv';
import type { Settings } from '../settings';
import { isAbilityKey, isCastKey } from './castMode';

export type Action =
  | 'stop' | 'attackMove'
  | 'q' | 'w' | 'e' | 'r'
  | 'd' | 'f' | 'tp'
  | 'recall' | 'centerCamera' | 'toggleCameraLock' | 'pause' | 'showRange'
  | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6' | 'trinket'
  | 'scoreboard' | 'debug' | 'shop'
  | 'pingWheel' | 'pingMissing' | 'pingQuestion'
  | 'targetChampionsOnly';

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
  /** LoL "target champions only" (hold): hover, clicks and casts ignore everything but champions. */
  targetChampionsOnly: 'Backquote',
};

export const ACTIONS = Object.keys(DEFAULT_BINDS) as Action[];

/** 0 = primary key (shown on the HUD), 1 = alternate key. */
export type BindSlot = 0 | 1;
export const BIND_SLOTS: readonly BindSlot[] = [0, 1];
export interface BindRef { action: Action; slot: BindSlot }

const emptyTable = (): Record<Action, string> => Object.fromEntries(ACTIONS.map((a) => [a, ''])) as Record<Action, string>;
/** Alternates are empty by default (LoL ships none). */
export const DEFAULT_ALT_BINDS: Readonly<Record<Action, string>> = emptyTable();

export const binds: Record<Action, string> = { ...DEFAULT_BINDS };
export const altBinds: Record<Action, string> = emptyTable();
let layout: Map<string, string> | null = null;
let version = 0;
/** Bumped on every rebind/reset/load: views showing key labels (HUD) refresh when it changes. */
export const bindsVersion = (): number => version;

/** Keys that only act as modifiers (self-cast, level-up) or are hard-wired (menu, pause, chat): not bindable. */
export const MODIFIER_CODES: readonly string[] = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu'];
export const RESERVED_CODES: readonly string[] = ['Escape', 'Pause', 'Enter', 'NumpadEnter'];
export type BindCheck = 'ok' | 'reserved' | 'modifier';
export function checkBindCode(code: string): BindCheck {
  if (MODIFIER_CODES.includes(code)) return 'modifier';
  return RESERVED_CODES.includes(code) ? 'reserved' : 'ok';
}

const altId = (a: Action): string => `${a}:alt`;
/** Ids of the export map: an action id is the primary key, `<action>:alt` the alternate. */
export const BIND_IDS: readonly string[] = [...ACTIONS, ...ACTIONS.map(altId)];

export const bindAt = (a: Action, slot: BindSlot): string => (slot === 0 ? binds[a] : altBinds[a]);
const write = (a: Action, slot: BindSlot, code: string): void => {
  if (slot === 0) binds[a] = code;
  else altBinds[a] = code;
};

/** Invariant: no alternate without a primary (the HUD shows the primary) and no key twice on one action. */
function normalize(a: Action): void {
  if (!binds[a] && altBinds[a]) {
    binds[a] = altBinds[a];
    altBinds[a] = '';
  }
  if (binds[a] && binds[a] === altBinds[a]) altBinds[a] = '';
}

function persist(): void {
  version++;
  void kvSet('keybinds', { ...binds });
  void kvSet('keybindsAlt', { ...altBinds });
}

/** Every slot currently holding `code`. */
export function ownersOf(code: string): BindRef[] {
  const out: BindRef[] = [];
  if (!code) return out;
  for (const a of ACTIONS) for (const slot of BIND_SLOTS) if (bindAt(a, slot) === code) out.push({ action: a, slot });
  return out;
}

/** Keys held by more than one slot (cannot happen through setBind; shown as a warning for hand-edited data). */
export function findConflicts(): { code: string; owners: BindRef[] }[] {
  const seen = new Map<string, BindRef[]>();
  for (const a of ACTIONS) for (const slot of BIND_SLOTS) {
    const c = bindAt(a, slot);
    if (c) seen.set(c, [...(seen.get(c) ?? []), { action: a, slot }]);
  }
  return [...seen].filter(([, o]) => o.length > 1).map(([code, owners]) => ({ code, owners }));
}

export interface BindResult {
  ok: boolean;
  /** Why the key was refused (ok = false). */
  reason?: Exclude<BindCheck, 'ok'>;
  /** Slots of OTHER actions that held the key and lost it (conflict warning). */
  displaced: BindRef[];
}

function assign(a: Action, slot: BindSlot, code: string): BindResult {
  if (!code) {
    write(a, slot, '');
    normalize(a);
    return { ok: true, displaced: [] };
  }
  const check = checkBindCode(code);
  if (check !== 'ok') return { ok: false, reason: check, displaced: [] };
  if (slot === 1 && !binds[a]) slot = 0;
  const displaced: BindRef[] = [];
  for (const o of ownersOf(code)) {
    if (o.action === a && o.slot === slot) continue;
    write(o.action, o.slot, '');
    if (o.action !== a) displaced.push(o);
  }
  write(a, slot, code);
  for (const x of new Set([a, ...displaced.map((d) => d.action)])) normalize(x);
  return { ok: true, displaced };
}

/** Bind `code` as the primary (slot 0) or alternate (slot 1) key of `a`; '' unbinds. A key already used elsewhere moves. */
export function setBind(a: Action, code: string, slot: BindSlot = 0): BindResult {
  const r = assign(a, slot, code);
  if (r.ok) persist();
  return r;
}

export function clearBind(a: Action, slot: BindSlot): void {
  setBind(a, '', slot);
}

/** Keep the first holder of every key (primary keys before alternates, in action order); fixes hand-edited saves. */
export function sanitizeBinds(): void {
  const seen = new Set<string>();
  for (const slot of BIND_SLOTS) for (const a of ACTIONS) {
    const c = bindAt(a, slot);
    if (!c) continue;
    if (seen.has(c) || checkBindCode(c) !== 'ok') write(a, slot, '');
    else seen.add(c);
  }
  for (const a of ACTIONS) normalize(a);
}

export async function loadBinds(): Promise<void> {
  const saved = await kvGet<Partial<Record<Action, string>>>('keybinds');
  const savedAlt = await kvGet<Partial<Record<Action, string>>>('keybindsAlt');
  if (saved) for (const a of ACTIONS) if (typeof saved[a] === 'string') binds[a] = saved[a]!;
  if (savedAlt) for (const a of ACTIONS) if (typeof savedAlt[a] === 'string') altBinds[a] = savedAlt[a]!;
  sanitizeBinds();
  version++;
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (kb) layout = await kb.getLayoutMap();
  } catch {
    layout = null;
  }
}

/** The export / import map: primary keys by action id, non-empty alternates as `<action>:alt` (BIND_IDS). */
export function exportBindMap(): Record<Action, string> {
  const m: Record<string, string> = { ...binds };
  for (const a of ACTIONS) if (altBinds[a]) m[altId(a)] = altBinds[a];
  return m as Record<Action, string>;
}

/** Replace several binds at once (settings import); unlisted ids keep their key, conflicts unbind the older holder. */
export function applyBinds(map: Partial<Record<string, string>>): void {
  for (const a of ACTIONS) {
    for (const slot of BIND_SLOTS) {
      const code = map[slot === 0 ? a : altId(a)];
      if (code !== undefined) assign(a, slot, code);
    }
  }
  persist();
}

export function resetBinds(): void {
  Object.assign(binds, DEFAULT_BINDS);
  Object.assign(altBinds, DEFAULT_ALT_BINDS);
  persist();
}

/** Primary key first, then the alternate. */
export function actionFor(code: string): Action | null {
  if (!code) return null;
  for (const a of ACTIONS) if (binds[a] === code) return a;
  for (const a of ACTIONS) if (altBinds[a] === code) return a;
  return null;
}

// ---- modifiers (self-cast, level-up) ----

export type SelfCastMod = 'alt' | 'ctrl' | 'shift' | 'none';
/** ctrlOrShift: Ctrl (LoL default) or Shift; Ctrl+W/Q are browser shortcuts outside fullscreen, Shift always works. */
export type LevelUpMod = 'ctrlOrShift' | 'ctrl' | 'shift' | 'alt';
export const SELF_CAST_MODS: readonly SelfCastMod[] = ['alt', 'ctrl', 'shift', 'none'];
export const LEVEL_UP_MODS: readonly LevelUpMod[] = ['ctrlOrShift', 'ctrl', 'shift', 'alt'];
export interface KeyMods { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
export type ModConfig = Pick<Settings, 'selfCastMod' | 'levelUpMod'>;

export function modHeld(mod: SelfCastMod | LevelUpMod, e: KeyMods): boolean {
  switch (mod) {
    case 'alt': return e.altKey;
    case 'ctrl': return e.ctrlKey;
    case 'shift': return e.shiftKey;
    case 'ctrlOrShift': return e.ctrlKey || e.shiftKey;
    default: return false;
  }
}

/** True when one modifier press would mean both self-cast and level-up (level-up wins; the panel warns). */
export function modifierConflict(cfg: ModConfig): boolean {
  if (cfg.selfCastMod === 'none') return false;
  if (cfg.levelUpMod === 'ctrlOrShift') return cfg.selfCastMod === 'ctrl' || cfg.selfCastMod === 'shift';
  return cfg.selfCastMod === cfg.levelUpMod;
}

export interface KeyResolution {
  action: Action;
  /** Level-up modifier held on an ability key: levels the ability instead of casting it. */
  levelUp: boolean;
  /** Self-cast modifier held on an ability / summoner / item key: cast on the own champion. */
  selfCast: boolean;
}

/** Key event -> action + modifier meaning (the controller's dispatch entry). Null for an unbound key. */
export function resolveKey(e: { code: string } & KeyMods, cfg: ModConfig): KeyResolution | null {
  const action = actionFor(e.code);
  if (!action) return null;
  const levelUp = isAbilityKey(action) && modHeld(cfg.levelUpMod, e);
  const selfCast = !levelUp && isCastKey(action) && action !== 'trinket' && modHeld(cfg.selfCastMod, e);
  return { action, levelUp, selfCast };
}

// ---- presets ----

/** The LoL default layout (this game's defaults follow it; kept separate so they may diverge). */
export const LOL_LAYOUT: Readonly<Record<Action, string>> = { ...DEFAULT_BINDS };
/** Settings that belong to a layout: LoL levels up with Ctrl only and self-casts with Alt. */
export const LOL_PRESET_SETTINGS: ModConfig = { selfCastMod: 'alt', levelUpMod: 'ctrl' };
/** "Reset to defaults": keys, alternates, modifiers and per-key cast modes. */
export const RESET_SETTINGS: ModConfig & Pick<Settings, 'castModes'> = { selfCastMod: 'alt', levelUpMod: 'ctrlOrShift', castModes: {} };

/** Load the LoL layout: keys + empty alternates now, returns the settings patch for the caller (updateSettings). */
export function applyLolPreset(): ModConfig {
  Object.assign(binds, LOL_LAYOUT);
  Object.assign(altBinds, DEFAULT_ALT_BINDS);
  persist();
  return { ...LOL_PRESET_SETTINGS };
}

/** Reset keys and alternates now, returns the settings patch (modifiers, cast modes). */
export function applyDefaults(): ModConfig & Pick<Settings, 'castModes'> {
  resetBinds();
  return { ...RESET_SETTINGS, castModes: {} };
}

/** Human label for a key code ("Q", "Space", "F10"). */
export function keyLabel(code: string): string {
  if (!code) return '-';
  const l = layout?.get(code);
  if (l) return l.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'Backquote') return '`';
  return code;
}

