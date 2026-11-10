// Regenerates the per-champion lists in src/data/matchups.json from `classes` + `relations` (edit those by hand):
//   node tools/matchups/generate.mjs
// strong = champions of classes this champion's class beats, weak = champions of classes that beat it; same role first,
// then a stable hash order, three entries each. A new champion needs only a `classes` line (tests/matchups.test.ts checks).
import fs from 'node:fs';

const file = new URL('../../src/data/matchups.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = new URL('../../src/data/champions/', import.meta.url);
const roles = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json') || f.includes('values')) continue;
  const j = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
  roles[j.id] = j.roles[0];
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
const ids = Object.keys(roles).sort();
for (const id of ids) if (!data.classes[id]) throw new Error('no class for ' + id);
const rels = Object.entries(data.relations); // [key "a>b", {de,en}]
const pick = (id, cands) =>
  cands
    .sort((x, y) => (roles[y.id] === roles[id]) - (roles[x.id] === roles[id]) || hash(id + x.id) - hash(id + y.id))
    .slice(0, 3);
const out = {};
for (const id of ids) {
  const c = data.classes[id];
  const strong = [];
  const weak = [];
  for (const other of ids) {
    if (other === id) continue;
    const oc = data.classes[other];
    if (rels.some(([k]) => k === `${c}>${oc}`)) strong.push({ id: other, why: `${c}>${oc}` });
    if (rels.some(([k]) => k === `${oc}>${c}`)) weak.push({ id: other, why: `${oc}>${c}` });
  }
  out[id] = { strong: pick(id, strong), weak: pick(id, weak) };
}
data.champions = out;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('matchups for', ids.length, 'champions');
