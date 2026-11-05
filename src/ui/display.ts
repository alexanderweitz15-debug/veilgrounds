// Applies the display/accessibility settings that live outside a single widget: HUD scale (CSS --ui), colour-blind
// palette (REL, ping colours, CSS --blue/--red), reduce motion and high contrast (classes on <html>).
// Installed once at startup; re-applied on every settings change and on window resize (auto UI scale).
import './a11y.css';
import { onSettingsChange, settings, textScaleFactor, uiScaleFactor } from '../settings';
import { applyColorMode, pingColors, REL } from '../render/palette';
import { PING_COLOR } from './pingWheel';
import type { PingKind } from '../sim/types';

const BASE_PING: Record<PingKind, string> = { ...PING_COLOR };

export function applyDisplaySettings(): void {
  const root = document.documentElement;
  root.style.setProperty('--ui', uiScaleFactor().toFixed(3));
  root.style.setProperty('--txt', textScaleFactor().toFixed(3));
  applyColorMode(settings.colorMode);
  Object.assign(PING_COLOR, BASE_PING, pingColors(settings.colorMode));
  root.style.setProperty('--blue', REL.ally);
  root.style.setProperty('--red', REL.enemy);
  root.classList.toggle('reduce-motion', settings.reduceMotion);
  root.classList.toggle('high-contrast', settings.highContrast);
  // minimap size / side (C7): .minimap-wrap scales by --ui * --mm, html.minimap-left moves it (and the chat) over
  root.classList.toggle('minimap-left', !!settings.minimapLeft);
  fitMinimap();
}

/** Minimap frame size at scale 1 (280 px canvas + padding + border, style.css). */
const MINIMAP_PX = 294;
/** Gap kept between the minimap and the bottom HUD panel. */
const MINIMAP_GAP = 6;

/**
 * Largest minimap scale (relative to --ui) that does not overlap the centred bottom HUD panel; null = no limit.
 * Pure (tests): the bottom panel is centred, so each side has (viewport - panel) / 2.
 */
export function minimapFitScale(viewportW: number, bottomPanelW: number, ui: number): number | null {
  if (bottomPanelW <= 0 || ui <= 0) return null;
  return Math.max(0.5, ((viewportW - bottomPanelW) / 2 - MINIMAP_GAP) / (MINIMAP_PX * ui));
}

/**
 * --mm = the minimap size setting, capped so the minimap never covers the bottom HUD panel (C7). Re-run when the
 * HUD appears (Hud.applyScale), on resize and on every settings change.
 */
export function fitMinimap(): void {
  const root = document.documentElement;
  const want = (settings.minimapScale ?? 100) / 100;
  const bottom = document.querySelector('.hud-bottom');
  const fit = minimapFitScale(window.innerWidth, bottom ? bottom.getBoundingClientRect().width : 0, uiScaleFactor());
  root.style.setProperty('--mm', (fit === null ? want : Math.min(want, fit)).toFixed(3));
}

let installed = false;
export function installDisplaySettings(): void {
  applyDisplaySettings();
  if (installed) return;
  installed = true;
  onSettingsChange(applyDisplaySettings);
  window.addEventListener('resize', () => {
    if (settings.uiScaleAuto) document.documentElement.style.setProperty('--ui', uiScaleFactor().toFixed(3));
    fitMinimap();
  });
}
