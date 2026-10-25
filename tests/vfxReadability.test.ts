// A4 VFX: readability rules. Enemy telegraphs are drawn above every own / neutral effect (render order), keep a
// minimum rim alpha, wear the enemy colour on the rim, and the particles they get stay below them.
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { Fx } from '../src/render/fx';
import { ClientState } from '../src/game/state';
import { REL } from '../src/render/palette';
import { READ } from '../src/render/readability';
import { NON_ENEMY_ORDERS, RENDER_ORDER, coversEnemyTelegraph, telegraphOrder } from '../src/render/vfx/order';
import type { SimEvent } from '../src/sim/types';

type M = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

describe('draw-order rule', () => {
  it('enemy telegraphs sit above every non-enemy order, own telegraphs below the particles', () => {
    for (const o of NON_ENEMY_ORDERS) expect([o, coversEnemyTelegraph(o)]).toEqual([o, false]);
    expect(telegraphOrder(true, 'fill')).toBeGreaterThan(RENDER_ORDER.vfxAdditive);
    expect(telegraphOrder(true, 'rim')).toBeGreaterThan(telegraphOrder(true, 'fill'));
    expect(telegraphOrder(false, 'rim')).toBeLessThan(RENDER_ORDER.vfxNormal);
    expect(RENDER_ORDER.vfxNormal).toBeLessThan(RENDER_ORDER.vfxAdditive);
    expect(RENDER_ORDER.ping).toBeGreaterThan(RENDER_ORDER.enemyRim); // pings stay on top
  });

  it('the particle layers themselves are below the enemy telegraphs', () => {
    const fx = new Fx();
    for (const layer of fx.particles.group.children) expect(NON_ENEMY_ORDERS).toContain(layer.renderOrder);
  });
});

describe('Fx draws enemy telegraphs on top and keeps them readable', () => {
  const ent = (id: number, champ: string, team: number, x: number) => ({
    id, serial: 1, kind: 1, team, x, y: 1000, px: x, py: 1000, fx: 1, fy: 0, hp: 500, maxHp: 500, shield: 0, mana: 300, maxMana: 300,
    radius: 65, level: 18, champ, slot: id, atkPhase: 0, atkTarget: -1, moving: false, alive: true,
  });
  const run = (casts: SimEvent[], ticks: number[]): { fx: Fx; mark: () => M[] } => {
    const fx = new Fx();
    const state = new ClientState();
    const snap = (tick: number, events: SimEvent[]) => ({
      tick, time: tick / 30, team: 0, me: null, objects: [], players: [], events, projectiles: [],
      entities: [ent(1, 'brom', 0, 1000), ent(2, 'oleth', 1, 3000), ent(3, 'ilvane', 1, 5000), ent(4, 'wren', 1, 7000)],
    });
    ticks.forEach((tick, i) => {
      const s = snap(tick, i === 0 ? casts : []);
      const now = tick * (1000 / 30);
      for (const ev of state.ingest(s, now)) fx.onEvent(ev, state, now);
      state.alpha = 0.5;
      fx.update(state, now, false);
    });
    const meshes = (): M[] => fx.group.children.filter((c) => c.visible && (c as M).isMesh) as M[];
    return { fx, mark: meshes };
  };
  const ENEMY_CASTS: SimEvent[] = [
    { e: 'cast', src: 2, slot: 3, x: 3200, y: 1000, rank: 3 }, // oleth line zone
    { e: 'cast', src: 3, slot: 0, x: 6000, y: 1000, rank: 5 }, // ilvane line skillshot
    { e: 'cast', src: 4, slot: 2, x: 7300, y: 1000, rank: 5 }, // wren dash with radius (projected: approx rim)
  ];
  const OWN_CAST: SimEvent[] = [{ e: 'cast', src: 1, slot: 2, x: 1500, y: 1100, rank: 5 }];

  it('every visible enemy telegraph part is drawn above all other effect meshes', () => {
    const { mark } = run([...ENEMY_CASTS, ...OWN_CAST], [100, 103]);
    const visible = mark();
    const enemy = visible.filter((m) => m.userData.enemyTelegraph === true);
    const others = visible.filter((m) => m.userData.enemyTelegraph !== true && m.renderOrder < RENDER_ORDER.screen);
    expect(enemy.length).toBeGreaterThan(4);
    expect(others.length).toBeGreaterThan(2); // the own cone / cast pulse
    const minEnemy = Math.min(...enemy.map((m) => m.renderOrder));
    const maxOther = Math.max(...others.map((m) => m.renderOrder));
    expect(minEnemy).toBeGreaterThan(maxOther);
    for (const m of visible.filter((m) => m.userData.enemyTelegraph === false)) expect(m.renderOrder).toBeLessThan(RENDER_ORDER.enemyFill);
  });

  it('enemy rims wear the enemy colour and never drop below the minimum alpha (also dash projections)', () => {
    const { mark } = run(ENEMY_CASTS, [100, 103]);
    const rims = mark().filter((m) => m.userData.enemyTelegraph === true && m.renderOrder === RENDER_ORDER.enemyRim);
    expect(rims.length).toBeGreaterThan(2);
    const cols = new Set([REL.enemyShot.toLowerCase(), REL.enemy.toLowerCase()]);
    for (const m of rims) {
      expect(cols.has(`#${m.material.color.getHexString()}`)).toBe(true);
      expect(m.material.opacity).toBeGreaterThanOrEqual(READ.telegraph.enemyRimMin - 1e-9);
    }
  });

  it('own telegraphs keep the own colour and the low order', () => {
    const { mark } = run(OWN_CAST, [100, 103]);
    const own = mark().filter((m) => m.userData.enemyTelegraph === false);
    expect(own.length).toBeGreaterThan(0);
    for (const m of own) {
      expect(m.renderOrder).toBeLessThan(RENDER_ORDER.vfxNormal);
      expect(`#${m.material.color.getHexString()}`).toBe(REL.ownShot.toLowerCase());
    }
  });

  it('warning sparks appear along enemy telegraphs only, in the telegraph class (below the rim)', () => {
    const own = run(OWN_CAST, [100, 101, 102, 103, 104, 105, 106]);
    expect(own.fx.particles.vfx.liveByClass().telegraph).toBe(0);
    const enemy = run(ENEMY_CASTS, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    expect(enemy.fx.particles.vfx.liveByClass().telegraph).toBeGreaterThan(0);
  });
});
