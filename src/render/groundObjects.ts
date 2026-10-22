// Ground objects from champion hooks: summons.ts records (Renn blades, Nyx seeds, Grimald traps) and hook visual
// objects (ChampionHooks.visuals: Isolde wire / dome / anchor, ...), plus the own champion's ability hints (Renn E
// rings on blades, Isolde E recast range). Team colour on the rim (own blue, enemy red), ability hue as fill.
// placeholder art: simple flat meshes, pooled per object key.
import * as THREE from 'three';
import type { ClientState } from '../game/state';
import type { SnapObject } from '../sim/snapshot';
import { REL } from './palette';
import { abilityHue, tagParticles } from './abilityTheme';
import type { Particles } from './particles';
import { drawSevObject } from './sevFx';

type Shape = NonNullable<SnapObject['shape']>;

/** Defaults for plain ground objects (no shape in the snapshot). */
const STYLE: Record<string, { hue: number | null; shape: Shape }> = {
  renn_blade: { hue: 220, shape: 'blade' },
  nyx_seed: { hue: 270, shape: 'disc' },
  grimald_trap: { hue: 35, shape: 'cross' },
};
const SLOT = { q: 0, w: 1, e: 2, r: 3 } as Record<string, number>;

const ring = (inner: number): THREE.BufferGeometry => new THREE.RingGeometry(inner, 1, 48).rotateX(-Math.PI / 2);
const GEO = {
  ring: ring(0.86),
  thin: ring(0.95),
  disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  blade: new THREE.BoxGeometry(1, 0.1, 0.2),
};
const arcCache = new Map<number, THREE.BufferGeometry>();
/** Timer arc (fraction 0..1 of a full ring, starting north, clockwise). */
function arcGeo(k: number): THREE.BufferGeometry {
  const q = Math.max(1, Math.round(k * 48));
  let g = arcCache.get(q);
  if (!g) arcCache.set(q, (g = new THREE.RingGeometry(0.72, 0.84, 48, 1, Math.PI / 2 - (q / 48) * Math.PI * 2, (q / 48) * Math.PI * 2).rotateX(-Math.PI / 2)));
  return g;
}

function mat(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
}

/** Pooled set of meshes for one object: fill, rim, two extra parts (cross bars, stem, timer). */
class View {
  readonly parts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  seen = 0;
  constructor(readonly group: THREE.Group) {}
  part(i: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    while (this.parts.length <= i) {
      const m = new THREE.Mesh(GEO.disc, mat());
      m.renderOrder = 3;
      this.group.add(m);
      this.parts.push(m);
    }
    const m = this.parts[i]!;
    m.visible = true;
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    return m;
  }
  hideFrom(i: number): void {
    for (let k = i; k < this.parts.length; k++) this.parts[k]!.visible = false;
  }
  dispose(): void {
    for (const m of this.parts) {
      this.group.remove(m);
      m.material.dispose();
    }
  }
}

function strip(m: THREE.Mesh, ax: number, ay: number, bx: number, by: number, w: number, h: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  m.geometry = GEO.plane;
  m.position.set((ax + bx) / 2, h, -(ay + by) / 2);
  m.scale.set(Math.max(0.01, Math.sqrt(dx * dx + dy * dy)), 1, Math.max(0.01, w));
  m.rotation.set(0, Math.atan2(dy, dx), 0);
}

function hueOf(o: SnapObject): number | null {
  if (o.hue !== undefined) return o.hue;
  const st = STYLE[o.tag];
  if (st) return st.hue;
  const [champ, key] = o.tag.split('_');
  const slot = key ? SLOT[key[0]!] : undefined;
  return champ && slot !== undefined ? abilityHue(champ, slot) : null;
}

export class GroundObjects {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, View>();
  private frame = 0;
  private lastNow = 0;
  /** D1b: ambient particles of hook objects in their ability's particle language (set by World). */
  particles: Particles | null = null;

  update(state: ClientState, now: number): void {
    const snap = state.snap;
    this.frame++;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    for (const o of snap?.objects ?? []) {
      this.draw(state, o, now);
      this.ambient(state, o, now, dt);
    }
    // own ability hints: rings where the ability can go (dim when not usable / out of reach)
    const me = state.me();
    (snap?.me?.hints ?? []).forEach((h, i) => {
      const v = this.view(`hint:${i}`);
      const ok = h.ok !== false;
      const col = ok ? '#8fe8ff' : '#7a8794';
      const pulse = ok ? 0.75 + 0.2 * Math.sin(now / 160) : 0.35;
      const r = v.part(0);
      r.geometry = GEO.thin;
      r.position.set(h.x, 5, -h.y);
      r.scale.setScalar(h.r);
      r.material.color.set(col);
      r.material.opacity = pulse;
      const f = v.part(1);
      f.geometry = GEO.disc;
      f.position.set(h.x, 4, -h.y);
      f.scale.setScalar(h.r);
      f.material.color.set(col);
      f.material.opacity = ok ? 0.08 : 0.03;
      if (h.link && ok && me) {
        strip(v.part(2), state.x(me), state.y(me), h.x, h.y, 6, 5);
        v.parts[2]!.material.color.set(col);
        v.parts[2]!.material.opacity = 0.35;
        v.hideFrom(3);
      } else v.hideFrom(2);
    });
    // ability self-buff auras (team rim + ability hue) and the empowered next auto (gold ring)
    for (const e of snap?.entities ?? []) {
      if (!e.alive || (!e.auras?.length && !e.emp)) continue;
      const v = this.view(`aura:${e.id}`);
      const x = state.x(e);
      const y = state.y(e);
      let n = 0;
      if (e.auras?.length) {
        const [champ, key] = e.auras[0]!.split('_');
        const slot = key ? SLOT[key[0]!] : undefined;
        const hue = champ && slot !== undefined ? abilityHue(champ, slot) : key?.startsWith('p') ? 48 : null; // passive: gold
        const m = v.part(n++);
        m.geometry = GEO.ring;
        m.position.set(x, 4, -y);
        m.scale.setScalar(e.radius + 22 + Math.sin(now / 220) * 4);
        m.material.color.set(hue === null ? (e.team === state.myTeam ? REL.ownShot : REL.enemyShot) : `hsl(${hue}, 80%, 62%)`);
        m.material.opacity = 0.7;
      }
      if (e.emp) {
        const m = v.part(n++);
        m.geometry = GEO.thin;
        m.position.set(x, 5, -y);
        m.scale.setScalar(e.radius + 34);
        m.material.color.set('#ffd36a');
        m.material.opacity = 0.65 + 0.3 * Math.sin(now / 120);
      }
      v.hideFrom(n);
    }
    for (const [k, v] of this.views) {
      if (v.seen === this.frame) continue;
      v.dispose();
      this.views.delete(k);
    }
  }

  /** Ambient particles: on the rim of rings/domes, inside discs, along lines/walls, at pins/blades/traps. */
  private ambient(state: ClientState, o: SnapObject, now: number, dt: number): void {
    const pk = this.particles ? tagParticles(o.tag) : null;
    if (!pk || !this.particles) return;
    const k = this.particles.kind(pk.kind);
    const hue = o.hue ?? pk.hue;
    const shape: Shape = o.shape ?? STYLE[o.tag]?.shape ?? 'ring';
    if (shape === 'line' || shape === 'wall') {
      const fol = o.follow !== undefined ? state.byId.get(o.follow) : undefined;
      const bx = fol ? state.x(fol) : o.x2 ?? o.x;
      const by = fol ? state.y(fol) : o.y2 ?? o.y;
      const len = Math.hypot(bx - o.x, by - o.y);
      const n = (k.ambient * Math.max(1, len / 100) * dt) / 2;
      for (let i = 0; i < 2; i++) {
        const t = Math.random();
        this.particles.emit(pk.kind, o.x + (bx - o.x) * t, o.y + (by - o.y) * t, shape === 'wall' ? 30 : 40, hue, n, now, undefined, 0.4);
      }
      return;
    }
    const area = shape === 'ring' || shape === 'dome' || shape === 'disc';
    const n = k.ambient * (area ? Math.max(1, o.r / 100) : 1) * dt;
    const a = Math.random() * Math.PI * 2;
    const rr = shape === 'disc' ? o.r * Math.sqrt(Math.random()) : area ? o.r : o.r * 0.4;
    this.particles.emit(pk.kind, o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr, 12, hue, n, now, undefined, 0.4);
  }

  private view(key: string): View {
    let v = this.views.get(key);
    if (!v) this.views.set(key, (v = new View(this.group)));
    v.seen = this.frame;
    return v;
  }

  private draw(state: ClientState, o: SnapObject, now: number): void {
    const v = this.view(o.key ?? `g${o.id}`);
    const team = o.team === state.myTeam ? REL.ownShot : REL.enemyShot;
    const h = hueOf(o);
    const fill = h === null ? team : `hsl(${h}, 75%, 62%)`;
    const shape: Shape = o.shape ?? STYLE[o.tag]?.shape ?? 'ring';
    let n = 0;
    const p = (): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => v.part(n++);
    const circle = (geo: THREE.BufferGeometry, r: number, col: string, a: number, y = 3): void => {
      const m = p();
      m.geometry = geo;
      m.position.set(o.x, y, -o.y);
      m.scale.setScalar(Math.max(1, r));
      m.material.color.set(col);
      m.material.opacity = a;
    };
    // Sev (agent E): distinct per-ability looks (src/render/sevFx.ts); unknown tags fall through to the shapes below
    if (o.tag.startsWith('sev_')) {
      const fol = o.follow !== undefined ? state.byId.get(o.follow) : undefined;
      const end = { x: fol ? state.x(fol) : o.x2 ?? o.x, y: fol ? state.y(fol) : o.y2 ?? o.y };
      if (drawSevObject(o, now, { part: p, disc: GEO.disc, ring: GEO.ring, thin: GEO.thin, strip, end })) return void v.hideFrom(n);
    }
    switch (shape) {
      case 'blade': {
        // floating blade + team ring on the ground
        const m = p();
        m.geometry = GEO.blade;
        m.position.set(o.x, 22 + Math.sin(now / 200 + o.id) * 4, -o.y);
        m.scale.set(80, 60, 80);
        m.rotation.set(0, (Math.abs(o.id) * 1.7) % Math.PI, 0);
        m.material.color.set(fill);
        m.material.opacity = 0.95;
        circle(GEO.ring, o.r + 10, team, 0.8);
        break;
      }
      case 'cross': {
        circle(GEO.ring, o.r, team, 0.7);
        for (const s of [1, -1]) {
          const m = p();
          const d = o.r * 0.6;
          strip(m, o.x - d, o.y - d * s, o.x + d, o.y + d * s, 14, 4);
          m.material.color.set(fill);
          m.material.opacity = 0.85;
        }
        break;
      }
      case 'line':
      case 'wall': {
        const fol = o.follow !== undefined ? state.byId.get(o.follow) : undefined;
        const bx = fol ? state.x(fol) : o.x2 ?? o.x;
        const by = fol ? state.y(fol) : o.y2 ?? o.y;
        const w = shape === 'wall' ? Math.max(30, o.r) : Math.max(6, o.r);
        const core = p();
        strip(core, o.x, o.y, bx, by, w, shape === 'wall' ? 6 : 40);
        core.material.color.set(fill);
        core.material.opacity = 0.95;
        const glow = p();
        strip(glow, o.x, o.y, bx, by, w * 3, 4);
        glow.material.color.set(team);
        glow.material.opacity = 0.3;
        circle(GEO.disc, 22, fill, 0.9, 5); // anchor
        break;
      }
      case 'dome':
        circle(GEO.disc, o.r, fill, 0.1);
        circle(GEO.ring, o.r, team, 0.85, 4);
        circle(GEO.thin, o.r * 1.02, fill, 0.6, 5);
        break;
      case 'pin':
        circle(GEO.disc, o.r * 0.5, fill, 0.9, 5);
        circle(GEO.ring, o.r, team, 0.85, 4);
        break;
      case 'disc':
        circle(GEO.disc, o.r, fill, 0.45);
        circle(GEO.ring, o.r, team, 0.8, 4);
        break;
      default:
        circle(GEO.disc, o.r, fill, 0.12);
        circle(GEO.ring, o.r, team, 0.85, 4);
    }
    // timer arc (remaining time) for objects with a known total
    if (o.left !== undefined && o.total && o.total > 0 && shape !== 'line') {
      const m = p();
      m.geometry = arcGeo(Math.min(1, Math.max(0, o.left / o.total)));
      m.position.set(o.x, 6, -o.y);
      m.scale.setScalar(Math.max(30, shape === 'dome' ? o.r : o.r + 20));
      m.material.color.set('#f4eed8');
      m.material.opacity = 0.75;
    }
    // B1 stealth: own stealthed objects (traps, seeds) translucent; revealed enemy ones get a pulsing reveal ring
    if (o.stealth && o.team === state.myTeam) for (let i = 0; i < n; i++) v.parts[i]!.material.opacity *= 0.55;
    else if (o.stealth) circle(GEO.thin, o.r + 26, team, 0.6 + 0.3 * Math.sin(now / 140), 6);
    v.hideFrom(n);
  }
}
