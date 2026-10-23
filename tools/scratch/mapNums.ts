import { loadMap } from '../../src/sim/map';
const m = loadMap();
const [b, r] = m.sides;
const d = (a: { x: number; y: number }, c: { x: number; y: number }): number => Math.round(Math.hypot(a.x - c.x, a.y - c.y));
console.log('size', m.size, 'nexus-nexus', d(b.nexus, r.nexus), 'fountain-nexus', d(b.fountain, b.nexus), 'fountain r', b.fountain.r);
for (const l of ['top', 'mid', 'bot'] as const) {
  const t = b.towers[l];
  const rt = r.towers[l];
  let s = 0;
  const p = b.lanes[l];
  for (let i = 1; i < p.length; i++) s += d(p[i - 1]!, p[i]!);
  console.log(l, 'outer-outer', d(t[0]!, rt[0]!), 'spacing', d(t[0]!, t[1]!), d(t[1]!, t[2]!), 'lane len', s);
}
