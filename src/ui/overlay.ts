// One 2D canvas over the WebGL canvas: health bars, floating damage numbers, gold popups, level-up text.
// A single canvas is far cheaper than ~100 DOM nodes moving every frame.
import type { ClientState } from '../game/state';
import type { World } from '../render/world';
import { Kind, type SimEvent } from '../sim/types';
import { REL } from '../render/palette';
import { settings } from '../settings';
import { t } from '../i18n';

interface Floater {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  t0: number;
  dur: number;
  drift: number;
}

const DMG_COLORS = { phys: '#ffb35c', magic: '#b98cff', true: '#ffffff' } as const;

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private floaters: Floater[] = [];
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor() {
    this.canvas.className = 'overlay2d';
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    const myEid = state.snap?.me?.eid ?? -1;
    if (ev.e === 'damage' && settings.damageNumbers) {
      if (ev.src !== myEid && ev.dst !== myEid) return;
      const d = state.byId.get(ev.dst);
      if (!d) return;
      const received = ev.dst === myEid;
      const amt = Math.round(ev.amount);
      if (amt <= 0) return;
      this.floaters.push({
        x: d.x, y: d.y, z: 160, text: ev.crit ? `${amt}!` : String(amt),
        color: received ? '#ff4b4b' : DMG_COLORS[ev.type], size: ev.crit ? 26 : received ? 17 : 20,
        t0: now, dur: 900, drift: (Math.random() - 0.5) * 40,
      });
    } else if (ev.e === 'gold' && ev.eid === myEid) {
      this.floaters.push({ x: ev.x, y: ev.y, z: 120, text: `+${Math.round(ev.amount)}`, color: '#ffd24a', size: 20, t0: now, dur: 1100, drift: 0 });
    } else if (ev.e === 'level' && ev.eid === myEid) {
      const me = state.byId.get(myEid);
      if (me) this.floaters.push({ x: me.x, y: me.y, z: 300, text: `${t('hud.level')} ${ev.level}!`, color: '#9ff0ff', size: 22, t0: now, dur: 1500, drift: 0 });
    }
  }

  draw(state: ClientState, world: World, now: number, hoverId: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const snap = state.snap;
    if (snap) {
      const myEid = snap.me?.eid ?? -1;
      for (const e of snap.entities) {
        if (!e.alive || e.maxHp <= 0) continue;
        const a = world.barAnchor(e, state.x(e), state.y(e));
        if (!a) continue;
        const champ = e.kind === Kind.Champion;
        const structure = e.kind >= Kind.Tower && e.kind <= Kind.Nexus;
        const dummy = e.kind === Kind.Dummy;
        const minion = !champ && !structure && !dummy;
        // minions only show a bar when damaged or hovered (less clutter, like LoL)
        if (minion && e.hp >= e.maxHp && e.id !== hoverId) continue;
        const color = e.id === myEid ? '#59d35a' : e.team === state.myTeam ? REL.ally : REL.enemy;
        const bw = champ ? 104 : structure ? 130 : dummy ? 104 : 54;
        const bh = champ ? 11 : structure ? 9 : dummy ? 10 : 5;
        const x = a.sx - bw / 2 + (champ ? 10 : 0);
        const y = a.sy - bh;
        const total = Math.max(e.maxHp, e.hp + e.shield);
        ctx.fillStyle = 'rgba(12,10,8,0.85)';
        ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4 + (champ ? 5 : 0));
        ctx.fillStyle = color;
        ctx.fillRect(x, y, (bw * e.hp) / total, bh);
        if (e.shield > 0) {
          ctx.fillStyle = '#e8eef2';
          ctx.fillRect(x + (bw * e.hp) / total, y, (bw * e.shield) / total, bh);
        }
        if (champ || dummy) {
          // 100-HP ticks
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          const step = e.maxHp > 3000 ? 1000 : 100;
          for (let v = step; v < e.maxHp; v += step) ctx.fillRect(x + (bw * v) / total, y, v % 1000 === 0 ? 2 : 1, bh * (v % 1000 === 0 ? 1 : 0.6));
        }
        if (champ) {
          if (e.maxMana > 0) {
            ctx.fillStyle = '#3a7bd5';
            ctx.fillRect(x, y + bh + 1, (bw * e.mana) / e.maxMana, 3);
          }
          ctx.fillStyle = 'rgba(12,10,8,0.9)';
          ctx.fillRect(x - 24, y - 4, 22, bh + 10);
          ctx.fillStyle = '#f1e6c8';
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(e.level), x - 13, y + bh / 2 + 2);
        }
        if (dummy) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${Math.ceil(e.hp)} / ${Math.round(e.maxHp)}`, a.sx, y - 4);
        }
      }
    }
    // floating texts
    const keep: Floater[] = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) continue;
      keep.push(f);
      const p = world.rig.project(f.x, f.y, f.z, this.w, this.h);
      if (p.behind) continue;
      const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.5 : 1.2 - Math.min(0.2, k);
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `800 ${Math.round(f.size * pop)}px system-ui, sans-serif`;
      const sx = p.sx + f.drift * k;
      const sy = p.sy - 50 * k;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,12,6,0.9)';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    this.floaters = keep;
  }
}
