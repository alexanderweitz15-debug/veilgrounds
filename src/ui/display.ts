// Applies the display/accessibility settings that live outside a single widget: HUD scale (CSS --ui), colour-blind
// palette (REL, ping colours, CSS --blue/--red), reduce motion and high contrast (classes on <html>).
// Installed once at startup; re-applied on every settings change and on window resize (auto UI scale).
import './a11y.css';
import { onSettingsChange, settings, uiScaleFactor } from '../settings';
import { applyColorMode, REL } from '../render/palette';
import { PING_COLOR } from './pingWheel';
import type { PingKind } from '../sim/types';

const BASE_PING: Record<PingKind, string> = { ...PING_COLOR };

export function applyDisplaySettings(): void {
  const root = document.documentElement;
  root.style.setProperty('--ui', uiScaleFactor().toFixed(3));
  applyColorMode(settings.colorMode);
  Object.assign(PING_COLOR, BASE_PING);
  if (settings.colorMode !== 'normal') {
    // team-semantic pings follow the relation palette; green "safe" pings move off the red-green axis
    PING_COLOR.danger = PING_COLOR.focus = REL.enemy;
    PING_COLOR.onMyWay = PING_COLOR.help = REL.ally;
    if (settings.colorMode !== 'tritanopia') PING_COLOR.vision = PING_COLOR.ok = '#bfe4ff';
  }
  root.style.setProperty('--blue', REL.ally);
  root.style.setProperty('--red', REL.enemy);
  root.classList.toggle('reduce-motion', settings.reduceMotion);
  root.classList.toggle('high-contrast', settings.highContrast);
}

let installed = false;
export function installDisplaySettings(): void {
  applyDisplaySettings();
  if (installed) return;
  installed = true;
  onSettingsChange(applyDisplaySettings);
  window.addEventListener('resize', () => {
    if (settings.uiScaleAuto) document.documentElement.style.setProperty('--ui', uiScaleFactor().toFixed(3));
  });
}
