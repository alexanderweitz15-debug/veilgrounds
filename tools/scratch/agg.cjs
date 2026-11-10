// Aggregates bot-sim CSV output (file arg): laner CS loss by cause as % of lane minions, per role.
const fs = require('fs');
const L = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const hi = L.findIndex((l) => l.startsWith('game,seed'));
const H = L[hi].split(',');
const rows = L.slice(hi + 1).filter((l) => /^\d+,\d+,/.test(l)).map((l) => l.split(','));
const col = (n) => H.indexOf(n);
const causes = H.filter((h) => /^loss_/.test(h));
const agg = {};
for (const r of rows) {
  const role = r[col('role')];
  if (role === 'jungle' || role === 'support') continue;
  const a = (agg[role] ??= { n: 0, lm: 0, lc: 0, kills: 0, deaths: 0, min: 0, c: {} });
  a.n++; a.lm += +r[col('laneMinions')]; a.lc += +r[col('laneCs')]; a.kills += +r[col('kills')]; a.deaths += +r[col('deaths')]; a.min += +r[col('gameMin')];
  for (const c of causes) a.c[c] = (a.c[c] || 0) + +r[col(c)];
}
const tot = { lm: 0, lc: 0, c: {}, min: 0, n: 0 };
for (const [role, a] of Object.entries(agg)) {
  tot.lm += a.lm; tot.lc += a.lc; tot.min += a.min; tot.n += a.n;
  for (const c of causes) tot.c[c] = (tot.c[c] || 0) + a.c[c];
  console.log(role.padEnd(5), `csShare ${(100 * a.lc / a.lm).toFixed(0)}%  cs/min ${(a.lc / a.min).toFixed(2)}`, causes.map((c) => `${c.slice(5)} ${(100 * a.c[c] / a.lm).toFixed(0)}`).join(' '));
}
console.log('ALL  ', `csShare ${(100 * tot.lc / tot.lm).toFixed(0)}%  laneCs/min ${(tot.lc / tot.min).toFixed(2)}`, causes.map((c) => `${c.slice(5)} ${(100 * tot.c[c] / tot.lm).toFixed(0)}`).join(' '));
