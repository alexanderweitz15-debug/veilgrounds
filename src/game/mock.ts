// Mock snapshot generator (developer tool): structures from map data, one champion following commands, an
// enemy champion, minion waves fighting in mid, projectiles, zones and the usual events. Lets render/HUD be
// tested before the real simulation systems exist. Not deterministic, not a sim: keep it dumb.
import { loadMap, LANES, type Pt } from '../sim/map';
import type { SnapEntity, SnapProjectile, Snapshot } from '../sim/snapshot';
import type { AbilityHud } from '../sim/systems/abilities';
import { Kind, type Command, type SimEvent } from '../sim/types';
import type { SimLink } from './link';
import { MIRA_ID } from './modes';

interface MUnit extends SnapEntity {
  tx: number;
  ty: number;
  speed: number;
  path: Pt[] | null;
  cd: number;
  vision: number;
}

interface MProj extends SnapProjectile {
  target: number;
  speed: number;
  life: number;
  dmg: number;
  src: number;
}

export function mockLink(): SimLink {
  const map = loadMap();
  let tick = 0;
  let paused = false;
  let nextId = 1;
  let serial = 1;
  const units: MUnit[] = [];
  const projs: MProj[] = [];
  let events: SimEvent[] = [];
  let gold = 500;
  let cs = 0;
  let level = 1;
  let xp = 0;
  const ranks = [0, 0, 0, 0];
  const cds = [0, 0, 0, 0, 0, 0];
  let recallAt = 0;

  const add = (kind: number, team: number, x: number, y: number, hp: number, radius: number, extra: Partial<MUnit> = {}): MUnit => {
    const u: MUnit = {
      id: nextId++, serial: serial++, kind, team, x, y, px: x, py: y, fx: team ? -0.7 : 0.7, fy: team ? -0.7 : 0.7,
      hp, maxHp: hp, shield: 0, mana: 0, maxMana: 0, radius, level: 0, champ: null, slot: -1, atkPhase: 0, atkTarget: -1,
      moving: false, alive: true, tx: x, ty: y, speed: 0, path: null, cd: 0, vision: 1100, ...extra,
    };
    units.push(u);
    return u;
  };

  for (const team of [0, 1]) {
    const s = map.sides[team]!;
    for (const l of LANES) {
      for (const p of s.towers[l]) add(Kind.Tower, team, p.x, p.y, 4000, 120, { vision: 1350 });
      add(Kind.Inhibitor, team, s.inhibitors[l].x, s.inhibitors[l].y, 3500, 160, { vision: 1000 });
    }
    for (const p of s.nexusTowers) add(Kind.Tower, team, p.x, p.y, 2700, 120, { vision: 1350 });
    add(Kind.Nexus, team, s.nexus.x, s.nexus.y, 5500, 250, { vision: 1000 });
  }
  const me = add(Kind.Champion, 0, 6000, 5600, 640, 65, { champ: MIRA_ID, slot: 0, level: 1, mana: 300, maxMana: 300, speed: 330, vision: 1200 });
  const foe = add(Kind.Champion, 1, 8600, 8800, 600, 65, { champ: 'vargr', slot: 5, level: 1, mana: 280, maxMana: 280, speed: 335, vision: 1200 });
  add(Kind.Dummy, 1, 6600, 5300, 1000, 65, { vision: 0 });

  const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
  const byId = (id: number): MUnit | undefined => units.find((u) => u.id === id && u.alive);
  const damage = (src: MUnit, dst: MUnit, amount: number, type: 'phys' | 'magic' | 'true' = 'phys'): void => {
    if (!dst.alive) return;
    dst.hp -= amount;
    events.push({ e: 'damage', src: src.id, dst: dst.id, amount, type, crit: Math.random() < 0.1 });
    if (dst.hp <= 0) {
      dst.alive = false;
      dst.hp = 0;
      events.push({ e: 'death', eid: dst.id, kind: dst.kind, team: dst.team, killer: src.id, x: dst.x, y: dst.y });
      if (src === me) {
        const g = dst.kind === Kind.MinionSiege ? 60 : 21;
        gold += g;
        cs++;
        xp += 60;
        events.push({ e: 'gold', eid: me.id, amount: g, x: dst.x, y: dst.y });
      }
    }
  };

  const spawnWave = (): void => {
    for (const team of [0, 1]) {
      const lane = map.sides[team]!.lanes.mid;
      const start = lane[0]!;
      const kinds: number[] = [Kind.MinionMelee, Kind.MinionMelee, Kind.MinionMelee, Kind.MinionCaster, Kind.MinionCaster, Kind.MinionCaster];
      if ((tick / 900) % 3 === 2) kinds.push(Kind.MinionSiege);
      if ((tick / 900) % 5 === 4) kinds.push(Kind.MinionSuper);
      kinds.forEach((k, i) => {
        const off = team ? 1 : -1;
        add(k, team, start.x + off * -i * 90 + 500 * (team ? -1 : 1), start.y + off * -i * 60 + 500 * (team ? -1 : 1), k === Kind.MinionSiege ? 900 : k === Kind.MinionSuper ? 1500 : k === Kind.MinionCaster ? 300 : 480, k === Kind.MinionSiege ? 65 : 48, {
          speed: 325, tx: lane[lane.length - 1]!.x, ty: lane[lane.length - 1]!.y,
        });
      });
    }
  };

  const walk = (u: MUnit, tx: number, ty: number): void => {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 5) {
      u.moving = false;
      return;
    }
    const s = Math.min(d, u.speed / 30);
    u.x += (dx / d) * s;
    u.y += (dy / d) * s;
    u.fx = dx / d;
    u.fy = dy / d;
    u.moving = true;
  };

  const ranged = (k: number): boolean => k === Kind.MinionCaster || k === Kind.MinionSiege || k === Kind.Champion || k === Kind.Tower;

  const attack = (u: MUnit, t: MUnit, range: number, dmg: number, period: number): boolean => {
    if (dist(u, t) > range + t.radius) return false;
    u.moving = false;
    u.fx = Math.sign(t.x - u.x) || 1;
    u.atkTarget = t.id;
    if (u.cd <= 0) {
      u.cd = period;
      u.atkPhase = 1;
      events.push({ e: 'attack', src: u.id, dst: t.id });
      if (ranged(u.kind)) projs.push({ id: nextId++, kind: 0, team: u.team, x: u.x, y: u.y, px: u.x, py: u.y, dx: 0, dy: 0, width: u.kind === Kind.Tower ? 40 : 20, target: t.id, speed: 1400, life: 90, dmg, src: u.id });
      else damage(u, t, dmg);
    } else if (u.cd < period - 8) u.atkPhase = 0;
    return true;
  };

  const command = (cmd: Command): void => {
    if (!me.alive && cmd.t !== 'cheat') return;
    switch (cmd.t) {
      case 'move':
      case 'attackMove':
        me.tx = cmd.x;
        me.ty = cmd.y;
        me.atkTarget = -1;
        recallAt = 0;
        break;
      case 'stop':
        me.tx = me.x;
        me.ty = me.y;
        me.atkTarget = -1;
        break;
      case 'attack':
        me.atkTarget = cmd.target;
        recallAt = 0;
        break;
      case 'cast': {
        if (cds[cmd.slot]! > 0) return;
        cds[cmd.slot] = [6, 10, 14, 80][cmd.slot]! * 30;
        events.push({ e: 'cast', src: me.id, slot: cmd.slot, x: cmd.x, y: cmd.y });
        const dx = cmd.x - me.x;
        const dy = cmd.y - me.y;
        const d = Math.hypot(dx, dy) || 1;
        if (cmd.slot === 1) events.push({ e: 'zone', src: me.id, team: 0, x: cmd.x, y: cmd.y, r: 250, start: tick, at: tick + 24 });
        else projs.push({ id: nextId++, kind: 1, team: 0, x: me.x, y: me.y, px: me.x, py: me.y, dx: dx / d, dy: dy / d, width: 70, target: -1, speed: 1800, life: 22, dmg: 90, src: me.id });
        break;
      }
      case 'spell':
        cds[4 + cmd.slot] = 300 * 30;
        break;
      case 'levelUp':
        if (ranks[cmd.slot]! < (cmd.slot === 3 ? 3 : 5)) ranks[cmd.slot]!++;
        break;
      case 'recall':
        recallAt = tick + 8 * 30;
        break;
      case 'cheat':
        if (cmd.op === 'teleport' && cmd.x !== undefined && cmd.y !== undefined) {
          me.x = me.px = me.tx = cmd.x;
          me.y = me.py = me.ty = cmd.y;
        } else if (cmd.op === 'refreshCd') cds.fill(0);
        else if (cmd.op === 'refreshHp') me.hp = me.maxHp;
        else if (cmd.op === 'gold') gold += 10000;
        else if (cmd.op === 'levelUp') xp += 280;
        break;
    }
  };

  const queued: Command[] = [];
  const step = (): void => {
    events = [];
    for (const c of queued.splice(0)) command(c);
    for (const u of units) {
      u.px = u.x;
      u.py = u.y;
      if (u.cd > 0) u.cd--;
    }
    if (tick % 900 === 30) spawnWave();
    for (let i = 0; i < cds.length; i++) if (cds[i]! > 0) cds[i]!--;
    if (xp >= 280 && level < 18) {
      xp -= 280;
      level++;
      me.level = level;
      events.push({ e: 'level', eid: me.id, level });
    }
    // champion
    if (me.alive) {
      const t = me.atkTarget >= 0 ? byId(me.atkTarget) : undefined;
      if (t) {
        if (!attack(me, t, 550, 55, 20)) walk(me, t.x, t.y);
      } else {
        me.atkTarget = -1;
        walk(me, me.tx, me.ty);
      }
      if (recallAt && tick >= recallAt) {
        const f = map.sides[0]!.fountain;
        me.x = me.px = me.tx = f.x;
        me.y = me.py = me.ty = f.y;
        recallAt = 0;
      }
      me.mana = Math.min(me.maxMana, me.mana + 0.3);
    }
    // enemy champion strolls and pokes with a skillshot / zone
    if (foe.alive) {
      const a = tick / 90;
      walk(foe, 8200 + Math.cos(a) * 500, 8200 + Math.sin(a) * 500);
      if (tick % 150 === 75 && dist(foe, me) < 1400) {
        const dx = me.x - foe.x;
        const dy = me.y - foe.y;
        const d = Math.hypot(dx, dy) || 1;
        events.push({ e: 'cast', src: foe.id, slot: 0, x: me.x, y: me.y });
        projs.push({ id: nextId++, kind: 1, team: 1, x: foe.x, y: foe.y, px: foe.x, py: foe.y, dx: dx / d, dy: dy / d, width: 80, target: -1, speed: 1500, life: 30, dmg: 80, src: foe.id });
      }
      if (tick % 210 === 0 && dist(foe, me) < 1500) events.push({ e: 'zone', src: foe.id, team: 1, x: me.x, y: me.y, r: 300, start: tick, at: tick + 36 });
    } else if (tick % 600 === 0) {
      foe.alive = true;
      foe.hp = foe.maxHp;
    }
    // minions + towers
    for (const u of units) {
      if (!u.alive || u === me || u === foe || u.kind === Kind.Dummy || u.kind === Kind.Inhibitor || u.kind === Kind.Nexus) continue;
      const isTower = u.kind === Kind.Tower;
      const range = isTower ? 775 : ranged(u.kind) ? 500 : 110;
      let best: MUnit | null = null;
      let bd = isTower ? range + 100 : 700;
      for (const o of units) {
        if (!o.alive || o.team === u.team || o.kind === Kind.Dummy || o.kind >= Kind.Tower) continue;
        const d = dist(u, o);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        if (!attack(u, best, range, isTower ? 150 : u.kind === Kind.MinionMelee ? 12 : 23, isTower ? 25 : 38) && !isTower) walk(u, best.x, best.y);
      } else if (!isTower) {
        u.atkTarget = -1;
        u.atkPhase = 0;
        walk(u, u.tx, u.ty);
      }
    }
    // projectiles
    for (const p of projs) {
      p.px = p.x;
      p.py = p.y;
      p.life--;
      if (p.kind === 0) {
        const t = byId(p.target);
        if (!t) {
          p.life = 0;
          continue;
        }
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const d = Math.hypot(dx, dy);
        p.dx = dx / (d || 1);
        p.dy = dy / (d || 1);
        if (d < p.speed / 30) {
          const src = byId(p.src) ?? me;
          damage(src, t, p.dmg);
          p.life = 0;
        } else {
          p.x += p.dx * (p.speed / 30);
          p.y += p.dy * (p.speed / 30);
        }
      } else {
        p.x += p.dx * (p.speed / 30);
        p.y += p.dy * (p.speed / 30);
        for (const u of units) {
          if (u.alive && u.team !== p.team && u.kind < Kind.Tower && dist(u, p) < u.radius + p.width / 2) {
            damage(byId(p.src) ?? me, u, p.dmg, 'magic');
            p.life = 0;
            break;
          }
        }
      }
    }
    for (let i = projs.length - 1; i >= 0; i--) if (projs[i]!.life <= 0) projs.splice(i, 1);
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i]!;
      if (!u.alive && u.kind !== Kind.Champion && u.kind < Kind.Tower) units.splice(i, 1);
    }
    if (me.alive && me.hp <= 0) me.alive = false;
    tick++;
  };

  const snapshot = (): Snapshot => {
    const mine = units.filter((u) => u.alive && u.team === 0);
    const visible = units.filter(
      (u) => u.team === 0 || u.kind >= Kind.Tower && u.kind <= Kind.Nexus || (u.alive && mine.some((m) => dist(m, u) <= m.vision)),
    );
    const ab = (id: string, i: number, max: number, cdTotal: number): AbilityHud => ({
      id, rank: ranks[i] ?? 1, maxRank: max, cdLeft: cds[i]! / 30, cdTotal, cost: 50, canLevel: i < 4 && ranks[i]! < max && ranks.reduce((a, b) => a + b, 0) < level,
    });
    return {
      tick,
      time: tick / 30,
      team: 0,
      entities: visible.map(({ tx: _tx, ty: _ty, speed: _s, path: _p, cd: _c, vision: _v, ...e }) => e),
      projectiles: projs.map(({ target: _t, speed: _s, life: _l, dmg: _d, src: _src, ...p }) => p),
      me: {
        eid: me.id, champ: MIRA_ID, level, xp, gold, cs, dead: !me.alive, respawnIn: me.alive ? 0 : 10, recallLeft: recallAt ? (recallAt - tick) / 30 : 0,
        abilities: [ab('pfeilhagel', 0, 5, 6), ab('lichtfalle', 1, 5, 10), ab('schritt', 2, 5, 14), ab('sternenschuss', 3, 3, 80), ab('sprung', 4, 1, 300), ab('heilen', 5, 1, 300)],
        stats: { ad: 55, ap: 0, armor: 24, mr: 30, as: 0.66, ms: 330, range: 550, crit: 0 },
        items: ['kurzschwert', 'trank', null, null, null, null, null], inFountain: false, marks: [],
      },
      events,
      players: [],
    };
  };

  const link: SimLink = {
    onSnap: null,
    send: (c) => queued.push(c),
    pause: (p) => {
      paused = p;
    },
    dispose: () => clearInterval(timer),
  };
  const timer = setInterval(() => {
    if (paused) return;
    step();
    link.onSnap?.(snapshot());
  }, 1000 / 30);
  return link;
}
