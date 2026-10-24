// Loading progress bar (DOM). Inline styles on purpose: used by the in-game loading cover and the classic loading
// screen, and the loader must not depend on a stylesheet that may still be loading.

export interface LoadingBar {
  root: HTMLElement;
  /** 0..1; values below the current one are ignored (a bar that jumps back looks broken) */
  set(k: number): void;
  /** current value 0..1 */
  value(): number;
}

export function createLoadingBar(width = 280): LoadingBar {
  const root = document.createElement('div');
  root.className = 'load-bar';
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  root.setAttribute('aria-valuenow', '0');
  root.style.cssText = `width:${width}px;max-width:80vw;height:8px;margin:8px auto 0;border-radius:4px;background:rgba(255,255,255,0.12);border:1px solid rgba(201,162,78,0.45);overflow:hidden;box-sizing:content-box`;
  const fill = document.createElement('div');
  fill.className = 'load-bar-fill';
  fill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#8a6a2c,#e2c070);transition:width 0.2s ease-out';
  root.appendChild(fill);
  let cur = 0;
  return {
    root,
    set(k) {
      const v = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
      if (v < cur) return;
      cur = v;
      const pct = Math.round(v * 100);
      fill.style.width = `${(v * 100).toFixed(1)}%`;
      root.setAttribute('aria-valuenow', String(pct));
    },
    value: () => cur,
  };
}
