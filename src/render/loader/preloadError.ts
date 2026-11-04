// "Failed to fetch dynamically imported module" after a deploy.
//
// Root cause: the game view, lobbies etc. are lazy chunks with content-hashed names (Vite code splitting). A tab that
// still runs the OLD build asks for an old chunk the server no longer has (GitHub Pages replaces the whole site on every
// deploy) and the service worker (public/sw.js: cache-first for hashed assets) only has the chunks that tab happened to
// load before. Vite fires `vite:preloadError` on window; without a handler the click on "Play" does nothing.
//
// Fix: one reload (the page itself is network-first, so it brings the new index.html with the new hashes). A
// sessionStorage timestamp stops reload loops: a second failure within RELOAD_WINDOW_MS shows a banner instead.
import { t } from '../../i18n';

export const RELOAD_KEY = 'veilgrounds.preloadReloadAt';
/** a second preload error within this time is not retried by reloading again */
export const RELOAD_WINDOW_MS = 60_000;

export interface PreloadErrorEnv {
  now(): number;
  /** throws when storage is unavailable */
  getFlag(): string | null;
  setFlag(v: string): void;
  reload(): void;
  /** shown when reloading did not help (or cannot be guarded) */
  showBanner(): void;
}

export type PreloadErrorAction = 'reload' | 'banner';

/** Decides and performs the reaction to one preload error. Pure given `env` (tests). */
export function onPreloadError(env: PreloadErrorEnv): PreloadErrorAction {
  let last: number;
  try {
    last = Number(env.getFlag() ?? 0) || 0;
    if (!(env.now() - last < RELOAD_WINDOW_MS)) {
      env.setFlag(String(env.now()));
      env.reload();
      return 'reload';
    }
  } catch {
    // storage blocked: reloading cannot be guarded against loops, so only tell the player
  }
  env.showBanner();
  return 'banner';
}

function banner(): void {
  if (document.getElementById('preload-error-banner')) return;
  const b = document.createElement('div');
  b.id = 'preload-error-banner';
  b.setAttribute('role', 'alert');
  b.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:10000;max-width:90vw;padding:10px 16px;border-radius:6px;background:#2a1e14;border:1px solid #c9a24e;color:#f2dfbd;font:600 14px sans-serif;display:flex;gap:12px;align-items:center';
  const msg = document.createElement('span');
  msg.textContent = t('error.newVersion');
  const btn = document.createElement('button');
  btn.textContent = t('error.reload');
  btn.style.cssText = 'cursor:pointer;padding:4px 10px;border-radius:4px;border:1px solid #c9a24e;background:#14110f;color:#f2dfbd;font:inherit';
  btn.addEventListener('click', () => location.reload());
  b.append(msg, btn);
  document.body.appendChild(b);
}

/** Registers the `vite:preloadError` handler (main.ts). The event is cancelled when it is handled by a reload. */
export function installPreloadErrorReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', (ev) => {
    console.warn('[loader] a code chunk failed to load (new deploy?)', (ev as Event & { payload?: unknown }).payload);
    const action = onPreloadError({
      now: () => Date.now(),
      getFlag: () => win.sessionStorage.getItem(RELOAD_KEY),
      setFlag: (v) => win.sessionStorage.setItem(RELOAD_KEY, v),
      reload: () => win.location.reload(),
      showBanner: banner,
    });
    if (action === 'reload') ev.preventDefault(); // the import promise stays pending; the page is replaced
  });
}
