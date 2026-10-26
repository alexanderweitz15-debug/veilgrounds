// Per-kind ping animation (pure maths, no three.js): every ping kind reads differently at a glance - danger shakes and
// sends fast shock rings outwards, "back" pulls its rings inwards and drops the badge, help beats like a heart, focus
// and objective spin, missing/question sway, vision breathes slowly, ok pops once and stays calm.
import type { PingKind } from '../sim/types';

export const PING_MS = 3000;

type IconMotion = 'shake' | 'bob' | 'spin' | 'pulse' | 'sway' | 'drop' | 'pop' | 'breathe';

export interface PingStyle {
  /** Shock rings in the first 1.5 s: period in ms (0 = none) and direction. */
  waveMs: number;
  inward: boolean;
  icon: IconMotion;
  /** Light beam over the ping. */
  beam: boolean;
  /** Ground ring breathing amplitude (0 = static). */
  breathe: number;
}

export const PING_STYLE: Record<PingKind, PingStyle> = {
  alert: { waveMs: 450, inward: false, icon: 'shake', beam: true, breathe: 0.08 },
  danger: { waveMs: 330, inward: false, icon: 'shake', beam: true, breathe: 0.12 },
  onMyWay: { waveMs: 600, inward: true, icon: 'bob', beam: true, breathe: 0.05 },
  back: { waveMs: 500, inward: true, icon: 'drop', beam: false, breathe: 0.06 },
  missing: { waveMs: 700, inward: false, icon: 'sway', beam: false, breathe: 0.04 },
  vision: { waveMs: 900, inward: false, icon: 'breathe', beam: false, breathe: 0.03 },
  help: { waveMs: 380, inward: false, icon: 'pulse', beam: true, breathe: 0.1 },
  group: { waveMs: 750, inward: true, icon: 'bob', beam: true, breathe: 0.05 },
  focus: { waveMs: 0, inward: false, icon: 'spin', beam: true, breathe: 0.06 },
  objective: { waveMs: 800, inward: false, icon: 'spin', beam: true, breathe: 0.05 },
  ok: { waveMs: 0, inward: false, icon: 'pop', beam: false, breathe: 0 },
  question: { waveMs: 700, inward: false, icon: 'sway', beam: false, breathe: 0.04 },
  myBad: { waveMs: 0, inward: false, icon: 'pop', beam: false, breathe: 0 },
};

export interface PingFrame {
  /** 1 while the ping lives, then fading to 0 over its last 30 %. */
  fade: number;
  ringScale: number;
  waveOn: boolean;
  /** Shock ring radius (map units) and opacity. */
  waveR: number;
  waveOpacity: number;
  beamScale: number;
  iconDy: number;
  iconScale: number;
  /** Badge rotation in radians. */
  iconRot: number;
}

/** Animation state of a ping `ms` after it appeared; `calm` (reduce motion) keeps the badge still and skips rings. */
export function pingFrame(kind: PingKind, ms: number, calm: boolean): PingFrame {
  const st = PING_STYLE[kind];
  const age = ms / PING_MS;
  const fade = age < 0.7 ? 1 : Math.max(0, 1 - (age - 0.7) / 0.3);
  const pop = Math.min(1, ms / 160);
  const ringScale = (0.6 + 0.4 * pop) * (calm ? 1 : 1 + st.breathe * Math.sin(ms / 110));
  const waveOn = !calm && st.waveMs > 0 && ms < 1500;
  const wk = st.waveMs > 0 ? (ms % st.waveMs) / st.waveMs : 0;
  const waveR = st.inward ? 500 - 380 * wk : 120 + 380 * wk;
  const waveOpacity = waveOn ? 0.9 * (st.inward ? wk : 1 - wk) : 0;
  let dy = 0;
  let scale = 1;
  let rot = 0;
  if (!calm) {
    switch (st.icon) {
      case 'shake':
        dy = Math.sin(ms / 220) * 14;
        rot = ms < 900 ? Math.sin(ms / 40) * 0.2 * (1 - ms / 900) : 0;
        scale = 1 + 0.05 * Math.sin(ms / 110);
        break;
      case 'bob':
        dy = Math.sin(ms / 180) * 30;
        break;
      case 'drop':
        dy = -((ms % 700) / 700) * 80 + 40;
        break;
      case 'spin':
        rot = ms / 450;
        dy = Math.sin(ms / 260) * 10;
        break;
      case 'pulse': {
        const b = ms % 800; // heartbeat: two quick beats then rest
        scale = 1 + 0.22 * (Math.exp(-((b - 60) ** 2) / 1800) + 0.7 * Math.exp(-((b - 260) ** 2) / 1800));
        break;
      }
      case 'sway':
        rot = Math.sin(ms / 170) * 0.35;
        dy = Math.sin(ms / 340) * 8;
        break;
      case 'breathe':
        scale = 1 + 0.18 * Math.sin(ms / 300);
        break;
      case 'pop':
        scale = 1 + 0.35 * Math.exp(-ms / 140);
        break;
    }
  }
  return {
    fade,
    ringScale,
    waveOn,
    waveR,
    waveOpacity,
    beamScale: st.beam ? Math.max(0.01, 1 - age * 1.2) : 0.01,
    iconDy: dy,
    iconScale: (0.5 + 0.5 * pop) * scale,
    iconRot: rot,
  };
}
