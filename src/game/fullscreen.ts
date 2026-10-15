// Fullscreen + Keyboard Lock: the only way a web page may receive Ctrl+W/Q/T/N instead of the browser closing or
// opening tabs. Supported in Chromium (Chrome, Edge, Opera). Firefox/Safari: fullscreen only, Ctrl+W stays a
// browser shortcut (level-up modifier can be switched to Shift in settings). Holding Esc leaves fullscreen.
import { settings } from '../settings';

interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}
const keyboard = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export const keyboardLockSupported = (): boolean => typeof keyboard()?.lock === 'function';
export const isLocked = (): boolean => !!document.fullscreenElement && keyboardLockSupported();

/** Needs a user gesture (click/key). Returns true when fullscreen is active afterwards. */
export async function enterGameFullscreen(): Promise<boolean> {
  if (!settings.fullscreenLock) return false;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await keyboard()?.lock(); // all keys
    return true;
  } catch {
    return false; // no user gesture yet or blocked: caller retries on the next click
  }
}

export function exitGameFullscreen(): void {
  keyboard()?.unlock();
  if (document.fullscreenElement) void document.exitFullscreen();
}

/** While locked, swallow browser shortcuts so Ctrl+W levels up W instead of closing the tab. */
export function blockBrowserShortcuts(e: KeyboardEvent): void {
  if (isLocked() && (e.ctrlKey || e.metaKey) && e.code !== 'KeyC' && e.code !== 'KeyV') e.preventDefault();
}
