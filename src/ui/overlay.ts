// One 2D canvas over the WebGL canvas: health bars, floating damage numbers, gold popups, level-up text.
// A single canvas is far cheaper than ~100 DOM nodes moving every frame.
import type { ClientState } from '../game/state';
import type { SnapEntity } from '../sim/snapshot';
import type { World } from '../render/world';
import { Kind, type SimEvent } from '../sim/types';
import { REL } from '../render/palette';
import { settings } from '../settings';
import { t } from '../i18n';
import { champName, variantName } from './names';
import { VisualCues } from './cues';
import { barLayout, barLift } from './hpBarGeom';
import { stackBars, type BarRect } from '../render/barLayout';
import { drawCcGlyph } from '../render/ccGlyphs';
import { pickBody, type PickView } from '../input/picking';

/** Hover highlight colour: attack colour on anything hostile, ally / own colour otherwise. */
function hoverColor(state: ClientState, e: SnapEntity): string {
  if (e.id === (state.snap?.me?.eid ?? -1)) return REL.me;
  return e.team === state.myTeam ? REL.ally : REL.attackClick;
}

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

/** CC bits (src/sim/buffs.ts CC_BIT; not imported to keep the sim out of the UI bundle), strongest first. */
const CC_ORDER: [number, string, string][] = [
  [128, 'stasis', '#f2f2f2'],
  [64, 'suppress', '#f0d24a'],
  [16, 'airborne', '#f0d24a'],
  [1, 'stun', '#f0d24a'],
  [256, 'fear', '#c8582e'],
  [2, 'root', '#e09a4a'],
  [8, 'silence', '#b98cff'],
  [32, 'blind', '#a8a8a8'],
  [4, 'slow', '#8fd0ff'],
];
/** HP-bar damage trail: hold the lost chunk, then drain at this rate (ms for a full bar). */
const TRAIL_HOLD_MS = 350;
const TRAIL_DRAIN_MS = 900;
const DMG_COLORS = { phys: '#ffb35c', magic: '#b98cff', true: '#ffffff' } as const;

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private floaters: Floater[] = [];
  /** Per-eid damage trail of the HP bars (eid reuse: reset when unseen for 1 s). */
  private readonly trail = new Map<number, { hp: number; shown: number; at: number; seen: number }>();
  private lastDraw = 0;
  /** Own CC timer: total length seen when the current CC (ccEnd) started. */
  private readonly ccTimer = new Map<number, { end: number; total: number }>();
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Phase 6: visual cues for important sounds (off-screen pings, tower fire, captions). */
  private readonly cues = new VisualCues();

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
    this.cues.onEvent(ev, state, now);
    const myEid = state.snap?.me?.eid ?? -1;
    if (ev.e === 'damage' && settings.damageNumbers) {
      if (ev.src !== myEid && ev.dst !== myEid) return;
      // the killing blow's target already left the snapshot: fall back to where it was last seen
      const d = state.entity(ev.dst);
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

  /** Small outlined name label, bottom-centred at (x, y). */
  /**
   * Crowd control above the HP bar (LoL: status text over the unit): strongest effect as a coloured chip; the own
   * champion also gets a draining CC timer bar under its HP bar.
   */
  private drawCc(e: SnapEntity, x: number, y: number, bw: number, bh: number, champ: boolean, mine: boolean, tick: number): void {
    const mask = e.cc ?? 0;
    const hit = CC_ORDER.find(([bit]) => mask & bit);
    if (!hit) return;
    const [, key, color] = hit;
    const text = key === 'slow' ? `${t('cc.slow')} ${Math.round(e.slow ?? 0)} %` : t(`cc.${key}`);
    const ctx = this.ctx;
    ctx.font = `700 ${champ ? 12 : 10}px system-ui, sans-serif`;
    // D2: one symbol per CC type (shape, not only colour) left of the text
    const icon = champ ? 14 : 10;
    const w = ctx.measureText(text).width + 10 + icon + 2;
    const cy = champ ? y - 32 : y - 14;
    ctx.fillStyle = 'rgba(12,10,8,0.85)';
    ctx.fillRect(x + bw / 2 - w / 2, cy - 8, w, 16);
    ctx.fillStyle = color;
    ctx.fillRect(x + bw / 2 - w / 2, cy + 6, w, 2);
    drawCcGlyph(ctx, key, x + bw / 2 - w / 2 + 5 + icon / 2, cy - 1, icon, color, settings.reduceMotion ? 0 : performance.now());
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + bw / 2 + (icon + 2) / 2, cy);
    if (mine && e.ccEnd !== undefined && e.ccEnd > tick) {
      let tm = this.ccTimer.get(e.id);
      if (!tm || tm.end !== e.ccEnd) this.ccTimer.set(e.id, (tm = { end: e.ccEnd, total: Math.max(1, e.ccEnd - tick) }));
      ctx.fillStyle = 'rgba(12,10,8,0.85)';
      ctx.fillRect(x, y + bh + 5, bw, 4);
      ctx.fillStyle = color;
      ctx.fillRect(x, y + bh + 5, (bw * (e.ccEnd - tick)) / tm.total, 4);
    }
  }

  /**
   * Marks / stacks on the unit (right of the bar: pips n/max, or a diamond with the stack count) and the empowered
   * next auto (golden spark left of the bar).
   */
  private drawMarks(e: SnapEntity, x: number, y: number, bw: number, bh: number): void {
    const ctx = this.ctx;
    let mx = x + bw + 6;
    const cy = y + bh / 2;
    for (const m of e.marks ?? []) {
      if (m.max && m.max <= 6) {
        for (let i = 0; i < m.max; i++) {
          ctx.fillStyle = 'rgba(12,10,8,0.9)';
          ctx.fillRect(mx - 1, cy - 5, 8, 10);
          ctx.fillStyle = i < (m.n ?? 0) ? (m.n === m.max ? '#ff6a4a' : '#ffd36a') : '#3a3229';
          ctx.fillRect(mx, cy - 4, 6, 8);
          mx += 8;
        }
        mx += 4;
        continue;
      }
      if (m.id === 'sev_w' || m.id === 'sev_nachbild') {
        // Sev: black ember (black flame, copper core) / Nachbild (copper ring with a dark centre)
        ctx.save();
        ctx.translate(mx + 7, cy);
        ctx.fillStyle = 'rgba(12,10,8,0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        if (m.id === 'sev_w') {
          ctx.fillStyle = '#17121a';
          ctx.beginPath();
          ctx.moveTo(0, -9);
          ctx.quadraticCurveTo(6, -2, 5, 3);
          ctx.quadraticCurveTo(0, 8, -5, 3);
          ctx.quadraticCurveTo(-6, -3, 0, -9);
          ctx.fill();
          ctx.fillStyle = '#ff7a3c';
          ctx.beginPath();
          ctx.arc(0, 2, 2.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#c8582e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        mx += 18;
        continue;
      }
      ctx.save();
      ctx.translate(mx + 7, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(12,10,8,0.9)';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#c99bff';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
      if (m.n !== undefined && m.n > 1) {
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1b1612';
        ctx.fillText(String(m.n), mx + 7, cy + 1);
      }
      mx += 18;
    }
    if (e.emp) {
      ctx.fillStyle = 'rgba(255, 211, 106, 0.95)';
      ctx.beginPath();
      const sx = x - 32;
      ctx.moveTo(sx, cy - 7);
      ctx.lineTo(sx + 3, cy - 2);
      ctx.lineTo(sx + 8, cy);
      ctx.lineTo(sx + 3, cy + 2);
      ctx.lineTo(sx, cy + 7);
      ctx.lineTo(sx - 3, cy + 2);
      ctx.lineTo(sx - 8, cy);
      ctx.lineTo(sx - 3, cy - 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Hover highlight (C8): the front arc of the hovered unit's ground ring, drawn from the same body the picker
   * (src/input/picking.ts) tests, so the highlighted unit is the one a click hits. The bar frame follows in draw().
   */
  private drawHover(state: ClientState, world: World, e: SnapEntity): void {
    const view: PickView = {
      project: (x, y, z) => world.rig.project(x, y, z, this.w, this.h),
      barAnchor: (u, x, y) => world.barAnchor(u, x, y),
    };
    const b = pickBody(state, view, e);
    if (!b) return;
    const ctx = this.ctx;
    const rx = b.core * 1.2;
    const ry = rx / b.squash;
    ctx.beginPath();
    ctx.ellipse(b.foot.sx, b.foot.sy, rx, ry, 0, 0.04 * Math.PI, 0.96 * Math.PI);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(10,8,6,0.7)';
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = hoverColor(state, e);
    ctx.stroke();
  }

  private label(text: string, x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(12,10,8,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  draw(state: ClientState, world: World, now: number, hoverId: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const snap = state.snap;
    const dt = Math.min(100, now - this.lastDraw);
    this.lastDraw = now;
    if (this.trail.size > 400) for (const [id, tr] of this.trail) if (now - tr.seen > 2000) this.trail.delete(id);
    if (snap) {
      const myEid = snap.me?.eid ?? -1;
      const hc = settings.highContrast;
      // D2 bar stacking: minion / monster bars that would overlap an already placed bar move up (champions,
      // structures and the dummy stay). The picker reads the same lifts (barLift). Deviation from D's proposal: the
      // hovered bar is not pinned, otherwise hovering a lifted bar drops it away from the cursor (hover flicker).
      const rects: BarRect[] = [];
      for (const e of snap.entities) {
        if (!e.alive || e.maxHp <= 0) continue;
        const a = world.barAnchor(e, state.x(e), state.y(e));
        const l = a && barLayout(e, a.sx, a.sy);
        if (l) rects.push({ id: e.id, x: l.x, y: l.y, w: l.bw, h: l.bh, fixed: l.champ || l.structure || l.dummy });
      }
      barLift.clear();
      for (const [id, dy] of stackBars(rects)) if (dy) barLift.set(id, dy);
      for (const e of snap.entities) {
        if (!e.alive || e.maxHp <= 0) continue;
        const a = world.barAnchor(e, state.x(e), state.y(e));
        if (!a) continue;
        if (e.id === hoverId) this.drawHover(state, world, e);
        const lay = barLayout(e, a.sx, a.sy + (barLift.get(e.id) ?? 0));
        if (!lay) {
          // plants (1 HP): no bar, only the name while hovered
          // name + effect ("Windfrucht · Tempo"); honey pieces are drawn small and need no label
          if (e.kind === Kind.Plant && e.variant !== 'honigstueck') this.label(`${variantName(e.variant, e.kind)} · ${t(`plant.hint.${e.variant}`)}`, a.sx, a.sy - 2, '#f3e6c4');
          continue;
        }
        const { champ, dummy, monster, bw, bh, x, y } = lay;
        const color = e.id === myEid ? REL.meBar : monster ? '#d8a64a' : e.team === state.myTeam ? REL.ally : REL.enemy;
        const total = Math.max(e.maxHp, e.hp + e.shield);
        ctx.fillStyle = 'rgba(12,10,8,0.85)';
        ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4 + (champ ? 5 : 0));
        // damage trail (LoL): the HP just lost stays as a pale chunk for a moment, then drains to the new value
        let tr = this.trail.get(e.id);
        if (!tr || now - tr.seen > 1000) this.trail.set(e.id, (tr = { hp: e.hp, shown: e.hp, at: 0, seen: now }));
        if (e.hp < tr.hp) tr.at = now; // new damage: hold the chunk again
        if (e.hp > tr.shown) tr.shown = e.hp; // heal
        if (now - tr.at > TRAIL_HOLD_MS) tr.shown = Math.max(e.hp, tr.shown - (e.maxHp * dt) / TRAIL_DRAIN_MS);
        tr.hp = e.hp;
        tr.seen = now;
        if (tr.shown > e.hp) {
          ctx.fillStyle = 'rgba(245,232,200,0.85)';
          ctx.fillRect(x + (bw * e.hp) / total, y, (bw * (tr.shown - e.hp)) / total, bh);
        }
        ctx.fillStyle = color;
        ctx.fillRect(x, y, (bw * e.hp) / total, bh);
        if (e.shield > 0) {
          ctx.fillStyle = '#e8eef2';
          ctx.fillRect(x + (bw * e.hp) / total, y, (bw * e.shield) / total, bh);
        }
        if (hc) {
          // high contrast: white frame around every bar
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 1, y - 1, bw + 2, bh + 2);
        }
        if (e.id === hoverId) {
          // hovered (= what a click hits): bright frame around the whole bar
          ctx.strokeStyle = hoverColor(state, e);
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 3.5, y - 3.5, bw + 7, bh + 7 + (champ ? 5 : 0));
        }
        if ((champ || dummy) && settings.hpBarStyle !== 'plain') {
          // 100-HP ticks (setting hpBarStyle: segmented = LoL, thousands = only every 1000 HP, plain = none)
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          // LoL: thin tick every 100 HP, thick one every 1000 (thin ones dropped only when they would merge)
          const thin = settings.hpBarStyle !== 'thousands' && (bw * 100) / total >= 2.5;
          for (let v = 100; v < e.maxHp; v += 100) {
            const k = v % 1000 === 0;
            if (k || thin) ctx.fillRect(x + (bw * v) / total, y, k ? 2 : 1, bh * (k ? 1 : 0.6));
          }
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
          // name label (Agent H)
          const name = champName(e.look ?? e.champ);
          ctx.font = '600 12px system-ui, sans-serif';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(12,10,8,0.9)';
          ctx.strokeText(name, x + bw / 2, y - 5);
          ctx.fillStyle = e.team === state.myTeam ? REL.allyText : REL.enemyText;
          ctx.fillText(name, x + bw / 2, y - 5);
        }
        if (monster && e.id === hoverId) this.label(variantName(e.variant, e.kind), a.sx, y - 5, '#f3e6c4');
        if (e.cc) this.drawCc(e, x, y, bw, bh, champ, e.id === myEid, snap.tick);
        if (e.marks?.length || e.emp) this.drawMarks(e, x, y, bw, bh);
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
      const pop = settings.reduceMotion ? 1 : k < 0.12 ? 0.7 + (k / 0.12) * 0.5 : 1.2 - Math.min(0.2, k);
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
    if (snap) this.cues.draw(ctx, state, world, this.w, this.h, now);
  }
}
