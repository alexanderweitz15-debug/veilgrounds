// Unit sprites: one InstancedMesh per (sprite, team) sharing one atlas + material. Visible quads lean back to
// face the camera; a second, colour-less instanced quad stands upright facing the sun and only casts the shadow.
import * as THREE from 'three';
import type { SnapEntity } from '../sim/snapshot';
import { Kind, isMinion as isMinionKind } from '../sim/types';
import type { ClientState } from '../game/state';
import { FlashGate, READ, airborneLift, dashLift, flashAmp } from './readability';
import { PITCH } from './camera';
import { REL } from './palette';
import { settings } from '../settings';
import { SPRITE_KEYS, SPRITE_SIZE, type Atlas, type SpriteKey } from './sprites';
import { MIRA_ID } from '../game/modes';
import { ChampionSprites, type SpriteBatchOptions } from './championSprites';
import { disposeTree } from './dispose';
import { champions } from '../data/champions';
import { minionId, MONSTER_SPRITE, type ChampionAtlas, type MinionKind } from './champions';

const CAPACITY: Record<SpriteKey, number> = { mira: 10, champ: 10, melee: 96, caster: 96, siege: 32, super: 32, dummy: 8, monster: 32 };
const FLASH_MS = 140;
const LUNGE_MS = 220;

interface Group {
  vis: THREE.InstancedMesh;
  cast: THREE.InstancedMesh;
  n: number;
}

const MINION_KIND: Partial<Record<number, MinionKind>> = {
  [Kind.MinionMelee]: 'melee',
  [Kind.MinionCaster]: 'caster',
  [Kind.MinionSiege]: 'siege',
  [Kind.MinionSuper]: 'super',
};
/** Minion sprites: kind + team baked into the minion atlas; ~60 on screen plus corpses. */
const MINION_BATCH: SpriteBatchOptions = {
  cap: 160,
  scaleFor: () => 1.2, // keeps minions ~0.55-0.6x a (scaled) champion
  ghosts: 48,
  corpseMs: 1300,
  idFor: (e, atlas) => {
    const kind = MINION_KIND[e.kind];
    if (!kind) return null;
    const id = minionId(kind, e.team);
    return atlas.frames[id] ? id : null;
  },
};

/** Jungle monsters and plants: one painted sprite per type (small camp members reuse their leader, scaled). */
const monsterSprite = (e: SnapEntity): { id: string; scale: number } | null =>
  (e.kind === Kind.Monster || e.kind === Kind.Plant) && e.variant ? (MONSTER_SPRITE[e.variant] ?? { id: e.variant, scale: 1 }) : null;
const EPIC_SCALE: Record<string, number> = { leviathan: 1.2, schleierwaechter: 1.15 };
const MONSTER_BATCH: SpriteBatchOptions = {
  cap: 40,
  ghosts: 16,
  corpseMs: 2600,
  dynAmp: 0.6,
  idFor: (e, atlas) => {
    const m = monsterSprite(e);
    return m && atlas.frames[m.id] ? m.id : null;
  },
  // F: drawn 1.3x like the champions (CHAMPION_SCALE), so the authored ratios in monsters.ts hold again (camps
  // 1.2-1.7x, buffs 2.7x a champion); the epics a little less so the pits still frame them. Sim radius unchanged.
  scaleFor: (e) => {
    const m = monsterSprite(e);
    return (m?.scale ?? 1) * (m && EPIC_SCALE[m.id] !== undefined ? EPIC_SCALE[m.id]! : 1.3);
  },
};

/** Ranged attackers recoil at the hit point instead of lunging. */
function isRanged(e: SnapEntity): boolean {
  if (e.kind === Kind.MinionCaster || e.kind === Kind.MinionSiege) return true;
  return e.kind === Kind.Champion && !!e.champ && champions[e.champ]?.attackType === 'ranged';
}

export function spriteKeyFor(e: SnapEntity): SpriteKey | null {
  switch (e.kind) {
    case Kind.Champion:
      return e.champ === MIRA_ID ? 'mira' : 'champ';
    case Kind.MinionMelee:
      return 'melee';
    case Kind.MinionCaster:
      return 'caster';
    case Kind.MinionSiege:
      return 'siege';
    case Kind.MinionSuper:
      return 'super';
    case Kind.Dummy:
      return 'dummy';
    case Kind.Monster:
    case Kind.Plant:
    case Kind.Pet: // placeholder art: pets (Hark, Corvin's keg) reuse the monster sprite, scaled by hitbox
      return 'monster';
    default:
      return null;
  }
}

export class Units {
  readonly group = new THREE.Group();
  private readonly groups = new Map<string, Group>();
  private readonly flashAt = new Map<number, number>();
  private readonly flashAmpOf = new Map<number, number>();
  private readonly flashGate = new FlashGate();
  /** Airborne (CC bit 16) start per unit serial: client time, sim tick and CC end tick. */
  private readonly airAt = new Map<number, { t0: number; tick0: number; end: number }>();
  /** Dash start position per unit serial (arc height from the dash length). */
  private readonly dashAt = new Map<number, { x: number; y: number }>();
  private readonly lungeAt = new Map<number, { t: number; dx: number; dy: number; armed: boolean }>();
  private readonly rings: THREE.InstancedMesh;
  private readonly qVis = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0));
  private readonly qCast: THREE.Quaternion;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  /** Animated champion sprites once their atlas is baked; until then champions use the placeholder sprite. */
  champs: ChampionSprites | null = null;
  /** Animated minion sprites (own atlas, same pipeline); placeholder sprites until baked. */
  minions: ChampionSprites | null = null;
  /** Jungle monsters + plants: [big, camp] atlases; placeholder blob until baked. */
  monsters: ChampionSprites[] = [];

  constructor(atlas: Atlas, sunDir: THREE.Vector3) {
    this.qCast = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(sunDir.x, sunDir.z), 0));
    const mat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    // invisible in the colour pass; the shadow pass copies map + alphaTest from this material into its depth material
    const castMat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    for (const key of SPRITE_KEYS) {
      for (const team of [0, 1]) {
        const [u0, v0, u1, v1] = atlas.uv(key, team);
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0, 0.5, 0);
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
        const vis = new THREE.InstancedMesh(geo, mat, CAPACITY[key]);
        vis.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        vis.setColorAt(0, new THREE.Color(1, 1, 1));
        vis.frustumCulled = false;
        vis.count = 0;
        const cast = new THREE.InstancedMesh(geo, castMat, CAPACITY[key]);
        cast.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        cast.castShadow = true;
        cast.frustumCulled = false;
        cast.count = 0;
        this.group.add(vis, cast);
        this.groups.set(`${key}:${team}`, { vis, cast, n: 0 });
      }
    }
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    this.rings = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      48,
    );
    this.rings.setColorAt(0, this.col);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 1;
    this.group.add(this.rings);
  }

  setChampionAtlas(atlas: ChampionAtlas): void {
    if (this.champs) {
      this.group.remove(this.champs.group);
      disposeTree(this.champs.group); // the replaced batch's texture/buffers would stay on the GPU
    }
    this.champs = new ChampionSprites(atlas, this.qVis, this.qCast);
    this.group.add(this.champs.group);
  }

  setMonsterAtlases(atlases: ChampionAtlas[]): void {
    for (const b of this.monsters) this.group.remove(b.group);
    this.monsters = atlases.map((a) => new ChampionSprites(a, this.qVis, this.qCast, MONSTER_BATCH));
    for (const b of this.monsters) this.group.add(b.group);
  }

  setMinionAtlas(atlas: ChampionAtlas): void {
    if (this.minions) {
      this.group.remove(this.minions.group);
      disposeTree(this.minions.group);
    }
    this.minions = new ChampionSprites(atlas, this.qVis, this.qCast, MINION_BATCH);
    this.group.add(this.minions.group);
  }

  /** Figure height above the feet for bars/picking, or null if not drawn by the animated sprite batches. */
  spriteHeight(e: SnapEntity): number | null {
    for (const b of [this.champs, this.minions, ...this.monsters]) {
      const id = b?.idFor(e);
      if (id) return b!.heightOf(id, e);
    }
    return null;
  }

  onDeath(eid: number, now: number): void {
    this.champs?.onDeath(eid, now);
    this.minions?.onDeath(eid, now);
    for (const b of this.monsters) b.onDeath(eid, now);
  }

  /**
   * Hit flash on damage. D2: at most one flash per unit per READ.hitFlash.minGapMs (DoT ticks and teamfight hits no
   * longer flicker), weaker on minions.
   */
  flash(serial: number, now: number, kind?: number): void {
    if (!this.flashGate.accept(serial, now)) return;
    this.flashAt.set(serial, now);
    this.flashAmpOf.set(serial, flashAmp(kind === Kind.Champion ? 'champion' : kind !== undefined && isMinionKind(kind) ? 'minion' : 'other', settings.reduceMotion));
  }

  /**
   * D2: sprite lift (world units). B5 snapshot progress: `air` (knock-up arc) and `dash` (dash / knockback / pull; the
   * arc height follows the length, estimated from the distance covered so far / progress). Fallback for snapshots
   * without `air` (old replays): the airborne CC bit with ccEnd.
   */
  private lift(state: ClientState, e: SnapEntity, now: number): number {
    if (e.air !== undefined) {
      this.dashAt.delete(e.serial);
      return airborneLift(e.air);
    }
    if (e.dash !== undefined) {
      let d = this.dashAt.get(e.serial);
      if (!d) this.dashAt.set(e.serial, (d = { x: e.px, y: e.py }));
      const moved = Math.hypot(state.x(e) - d.x, state.y(e) - d.y);
      return dashLift(e.dash, e.dash > 0.1 ? moved / e.dash : moved * 4);
    }
    this.dashAt.delete(e.serial);
    const cc = e.cc ?? 0;
    if (!(cc & 16)) {
      this.airAt.delete(e.serial);
      return 0;
    }
    let a = this.airAt.get(e.serial);
    const tick = (state.snap?.tick ?? 0) - 1 + state.alpha;
    if (!a) this.airAt.set(e.serial, (a = { t0: now, end: e.ccEnd ?? tick + 15, tick0: tick }));
    const total = Math.max(READ.airborne.minMs, ((a.end - a.tick0) * 1000) / 30);
    return airborneLift((now - a.t0) / total);
  }

  /**
   * An attack started toward (dx, dy): the body lunge (melee) or recoil (ranged) plays at the hit point, when the
   * wind-up ends (atkPhase 1 -> 2), together with the sprite's strike frame.
   */
  lunge(serial: number, dx: number, dy: number, now: number): void {
    const d = Math.hypot(dx, dy) || 1;
    this.lungeAt.set(serial, { t: now, dx: dx / d, dy: dy / d, armed: true });
  }

  /** Took damage from (sx, sy): hit flinch on the animated sprites. */
  hit(eid: number, now: number, sx: number, sy: number): void {
    this.champs?.onHit(eid, now, sx, sy);
    this.minions?.onHit(eid, now, sx, sy);
  }

  update(state: ClientState, now: number, hoverId: number): void {
    for (const g of this.groups.values()) g.n = 0;
    let rings = 0;
    const snap = state.snap;
    const myEid = snap?.me?.eid ?? -1;
    const tSec = now / 1000;
    const champs = this.champs;
    const minions = this.minions;
    // hit flash brightness (reduce motion: a faint tint instead of a white flash)
    const amp = flashAmp('other', settings.reduceMotion);
    champs?.begin();
    minions?.begin();
    for (const b of this.monsters) b.begin();
    if (snap) {
      for (const e of snap.entities) {
        if (!e.alive) continue;
        const key = spriteKeyFor(e);
        if (!key) continue;
        let batch = champs;
        let champId = champs ? champs.idFor(e) : null;
        if (!champId && minions) {
          batch = minions;
          champId = minions.idFor(e);
        }
        for (let i = 0; !champId && i < this.monsters.length; i++) {
          batch = this.monsters[i]!;
          champId = batch.idFor(e);
        }
        const g = this.groups.get(`${key}:${Math.min(1, e.team)}`)!;
        if (!champId && g.n >= g.vis.instanceMatrix.count) continue;
        let x = state.x(e);
        let y = state.y(e);
        // monsters scale with their hitbox (Agent H): small camp members ~0.6x, Schleierwächter ~1.8x
        const size = key === 'monster' ? SPRITE_SIZE.monster * Math.min(1.8, Math.max(0.6, e.radius / 90)) : SPRITE_SIZE[key];
        let bob = 0;
        let sx = 1;
        let sy = 1;
        if (e.moving) {
          bob = Math.abs(Math.sin(tSec * 9 + e.id)) * size * 0.04;
        } else {
          sy = 1 + Math.sin(tSec * 2.2 + e.id) * 0.012;
        }
        const l = this.lungeAt.get(e.serial);
        if (l) {
          if (l.armed) {
            // waiting for the hit point; a cancelled wind-up (back to idle) drops it
            if (e.atkPhase === 2) {
              l.armed = false;
              l.t = now;
            } else if (e.atkPhase === 0 || now - l.t > 2000) this.lungeAt.delete(e.serial);
          } else {
            const k = (now - l.t) / LUNGE_MS;
            if (k >= 1) this.lungeAt.delete(e.serial);
            else {
              // melee: snap forward with the strike; ranged: a short recoil as the shot leaves
              const amt = isRanged(e) ? -Math.sin(Math.min(1, k * 1.6) * Math.PI) * 9 : Math.sin(k * Math.PI) * 26 * (1 - k * 0.3);
              x += l.dx * amt;
              y += l.dy * amt;
            }
          }
        }
        if (e.atkPhase === 1) {
          sx = 1.06;
          sy *= 0.97;
        }
        if (champId) {
          let c = 1;
          const f = this.flashAt.get(e.serial);
          if (f !== undefined) {
            const k = (now - f) / FLASH_MS;
            if (k >= 1) this.flashAt.delete(e.serial);
            else c = 1 + (1 - k) * (this.flashAmpOf.get(e.serial) ?? amp);
          }
          if (e.id === hoverId) c *= 1.25;
          batch!.push(e, champId, x, y, c, now, this.lift(state, e, now));
          if ((e.kind === Kind.Champion || e.id === hoverId) && rings < 48) rings = this.ring(state, e, myEid, rings);
          continue;
        }
        const flip = e.fx < 0 ? -1 : 1;
        this.p.set(x, bob, -y);
        this.s.set(flip * size * sx, size * sy, 1);
        this.m.compose(this.p, this.qVis, this.s);
        g.vis.setMatrixAt(g.n, this.m);
        this.p.y = 0;
        this.s.set(flip * size * 0.8, size, 1);
        this.m.compose(this.p, this.qCast, this.s);
        g.cast.setMatrixAt(g.n, this.m);
        const f = this.flashAt.get(e.serial);
        let c = 1;
        if (f !== undefined) {
          const k = (now - f) / FLASH_MS;
          if (k >= 1) this.flashAt.delete(e.serial);
          else c = 1 + (1 - k) * (this.flashAmpOf.get(e.serial) ?? amp);
        }
        if (e.id === hoverId) c *= 1.25;
        this.col.setRGB(c, c, c);
        g.vis.setColorAt(g.n, this.col);
        g.n++;
        // ground ring: champions, the dummy and whatever is hovered
        if ((e.kind === Kind.Champion || e.kind === Kind.Dummy || e.id === hoverId) && rings < 48) rings = this.ring(state, e, myEid, rings);
      }
    }
    if (snap && champs) this.phantoms(state, champs, myEid, now);
    champs?.end(now);
    minions?.end(now);
    for (const b of this.monsters) b.end(now);
    for (const g of this.groups.values()) {
      g.vis.count = g.cast.count = g.n;
      g.vis.instanceMatrix.needsUpdate = true;
      g.cast.instanceMatrix.needsUpdate = true;
      if (g.vis.instanceColor) g.vis.instanceColor.needsUpdate = true;
    }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  /**
   * Sev R (Augenbann): only the feared player sees three shadowy Sev figures around himself (snapshot objects
   * `sev_r_phantom`, keyed `<sev eid>:ph<i>`, next to the `sev_r_bann` ring that follows the target). Dark, flickering
   * copies of Sev's sprite facing the victim; everyone else only sees the ring.
   */
  private phantoms(state: ClientState, champs: ChampionSprites, myEid: number, now: number): void {
    const objs = state.snap?.objects ?? [];
    for (const bann of objs) {
      if (bann.tag !== 'sev_r_bann' || bann.follow !== myEid) continue;
      // snapshot keys are `<tag>:<hook key>`, hook keys `<sev eid>:bann` / `<sev eid>:ph<i>`
      const ownerOf = (k: string | undefined, tag: string): string | undefined => (k?.startsWith(`${tag}:`) ? k.slice(tag.length + 1) : k)?.split(':')[0];
      const owner = ownerOf(bann.key, bann.tag);
      const me = state.byId.get(myEid);
      if (!me) continue;
      objs.forEach((o, i) => {
        if (o.tag !== 'sev_r_phantom' || ownerOf(o.key, o.tag) !== owner) return;
        const dx = state.x(me) - o.x;
        const dy = state.y(me) - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const fake = { id: -9000 - i, serial: -9000 - i, kind: Kind.Champion, champ: 'sev', team: 1 - state.myTeam, fx: dx / d, fy: dy / d, atkPhase: 0, moving: false, alive: true, radius: 65 } as unknown as SnapEntity;
        const id = champs.idFor(fake);
        if (!id) return;
        const flicker = 0.32 + 0.12 * Math.sin(now / 90 + i * 2.1);
        champs.push(fake, id, o.x, o.y, flicker, now);
      });
    }
  }

  private ring(state: ClientState, e: SnapEntity, myEid: number, i: number): number {
    const r = Math.max(e.radius, 40) * 1.5;
    this.p.set(state.x(e), 2, -state.y(e));
    this.s.set(r, r, r);
    this.m.compose(this.p, this.qFlat, this.s);
    this.rings.setMatrixAt(i, this.m);
    this.col.set(e.id === myEid ? REL.me : e.team === state.myTeam ? REL.ally : REL.enemy);
    this.rings.setColorAt(i, this.col);
    return i + 1;
  }
}
