// Visual cues for important sounds (Phase 6 accessibility, "Untertitel" for audio): drawn on the 2D overlay canvas.
// - off-screen team pings: arrow at the screen edge in the ping colour, with the ping name
// - danger: enemy champion casting off-screen near the player -> red edge arrow
// - "Unter Turmbeschuss": red screen-edge vignette + label while a tower shoots the player
// - captions for sounds without a visual (minion wave, tower plate, off-screen champion death)
// Toggle: settings.visualCues.
import type { ClientState } from '../game/state';
import type { World } from '../render/world';
import { Kind, type SimEvent } from '../sim/types';
import { REL } from '../render/palette';
import { settings, uiScaleFactor } from '../settings';
import { t } from '../i18n';
import { PING_COLOR } from './pingWheel';
import { PING_MS } from '../render/pings';
import { champName } from './names';

const TOWER_MS = 1600;
const DANGER_MS = 1400;
const CAPTION_MS = 3500;
/** Off-screen enemy casts closer than this (world units) to the player raise a danger arrow. */
const DANGER_RANGE = 2200;

export class VisualCues {
  private towerUntil = 0;
  private readonly danger = new Map<number, { x: number; y: number; at: number }>();
  private captions: { text: string; at: number }[] = [];

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    if (!settings.visualCues) return;
    const me = state.me();
    switch (ev.e) {
      case 'attack': {
        const s = state.byId.get(ev.src);
        if (me && ev.dst === me.id && s && (s.kind === Kind.Tower || s.kind === Kind.Nexus)) this.towerUntil = now + TOWER_MS;
        return;
      }
      case 'cast': {
        const s = state.byId.get(ev.src);
        if (!me || !s || s.kind !== Kind.Champion || s.team === state.myTeam) return;
        if (Math.hypot(s.x - me.x, s.y - me.y) < DANGER_RANGE) this.danger.set(s.id, { x: s.x, y: s.y, at: now });
        return;
      }
      case 'wave':
        if (ev.team === state.myTeam && ev.lane === 1) this.caption(t('cue.wave'), now);
        return;
      case 'plate':
        this.caption(t(ev.team === state.myTeam ? 'cue.plateLost' : 'cue.plateWon'), now);
        return;
      case 'death':
        if (ev.kind === Kind.Champion) {
          const v = state.byId.get(ev.eid);
          this.caption(t(ev.team === state.myTeam ? 'cue.allyDied' : 'cue.enemyDied', { name: champName(v?.champ ?? null) }), now);
        }
        return;
      default:
        return;
    }
  }

  private caption(text: string, now: number): void {
    this.captions.push({ text, at: now });
    if (this.captions.length > 4) this.captions.shift();
  }

  draw(ctx: CanvasRenderingContext2D, state: ClientState, world: World, w: number, h: number, now: number): void {
    if (!settings.visualCues) return;
    const ui = uiScaleFactor();
    // tower fire: red vignette + label
    if (now < this.towerUntil) {
      const a = Math.min(1, (this.towerUntil - now) / 400) * (settings.reduceMotion ? 0.7 : 0.55 + 0.25 * Math.sin(now / 90));
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, hexA(REL.enemy, 0.55 * a));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      this.label(ctx, t('cue.towerFire'), w / 2, h * 0.3, REL.enemy, 20 * ui);
    }
    // off-screen pings
    for (const p of state.pings) {
      const k = (now - p.at) / PING_MS;
      if (k >= 1) continue;
      this.edgeArrow(ctx, world, p.x, p.y, w, h, PING_COLOR[p.kind], 1 - k * 0.6, t(`ping.${p.kind}`), ui);
    }
    // off-screen enemy casts nearby
    for (const [id, d] of this.danger) {
      const k = (now - d.at) / DANGER_MS;
      if (k >= 1) {
        this.danger.delete(id);
        continue;
      }
      this.edgeArrow(ctx, world, d.x, d.y, w, h, REL.enemy, 1 - k, '!', ui);
    }
    // captions, bottom centre above the ability bar
    this.captions = this.captions.filter((c) => now - c.at < CAPTION_MS);
    let y = h - 175 * ui;
    for (let i = this.captions.length - 1; i >= 0; i--) {
      const c = this.captions[i]!;
      const k = (now - c.at) / CAPTION_MS;
      ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      this.label(ctx, `[${c.text}]`, w / 2, y, '#f1e6c8', 14 * ui);
      y -= 22 * ui;
    }
    ctx.globalAlpha = 1;
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number): void {
    ctx.font = `700 ${Math.round(size)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(8,7,6,0.78)';
    ctx.fillRect(x - tw / 2 - 8, y - size * 0.75, tw + 16, size * 1.5);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Arrow at the screen edge pointing at an off-screen world point (nothing when the point is on screen). */
  private edgeArrow(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, w: number, h: number, color: string, alpha: number, text: string, ui: number): void {
    const p = world.rig.project(x, y, 0, w, h);
    const m = 36 * ui;
    if (!p.behind && p.sx >= m && p.sx <= w - m && p.sy >= m && p.sy <= h - m) return;
    let dx = p.sx - w / 2;
    let dy = p.sy - h / 2;
    if (p.behind) (dx = -dx), (dy = -dy);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // intersect the ray from the centre with the inset screen rectangle
    const s = Math.min(Math.abs((w / 2 - m) / (dx || 1e-6)), Math.abs((h / 2 - m) / (dy || 1e-6)));
    const ax = w / 2 + dx * s;
    const ay = h / 2 + dy * s;
    const r = 16 * ui;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.75);
    ctx.lineTo(-r * 0.7, -r * 0.75);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(8,7,6,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    ctx.font = `700 ${Math.round(12 * ui)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8,7,6,0.95)';
    const lx = ax - dx * r * 2.2;
    const ly = ay - dy * r * 2.2;
    ctx.strokeText(text, lx, ly);
    ctx.fillStyle = color;
    ctx.fillText(text, lx, ly);
    ctx.globalAlpha = 1;
  }
}

/** '#rrggbb' + alpha -> rgba(). */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
