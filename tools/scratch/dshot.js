// Scratch (agent D): sandbox screenshot driver for the built game. Paste into the page (?bench) or, in dev,
// `await import('/tools/scratch/dshot.js')`. Needs tools/scratch/shotServer.mjs on port 4399.
// The browser pane is usually hidden: rAF is paused and timers are throttled, so waits yield through a MessageChannel
// and pump game frames (~60/s) themselves.
// window.__dsetup(champ) -> sandbox with that champion, level 18, no cooldowns, at (4600, 4600), dummy at +600 x.
// window.__dshot(name, cx, cy, seq) -> plays the cast sequence, focuses the camera on (cx, cy), saves the canvas.
const ch = new MessageChannel();
const queue = [];
ch.port1.onmessage = () => queue.shift()?.();
const tick = () => new Promise((r) => (queue.push(r), ch.port2.postMessage(0)));
let focus = null;
let lastFrame = 0;
/** Wait `ms`, rendering a frame every ~16 ms once the game runs. */
const w = async (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await tick();
    const now = performance.now();
    if (window.__vg && now - lastFrame >= 16) {
      lastFrame = now;
      if (focus) window.__vg.world.rig.focus(focus[0], focus[1]);
      window.__vg.frame(now);
    }
  }
};
const find = (sel, f) => [...document.querySelectorAll(sel)].find(f);
window.__dsetup = async (champ) => {
  for (let i = 0; i < 60 && !find('*', (e) => e.childElementCount === 0 && e.textContent.trim() === 'Sandbox'); i++) await w(250);
  const sb = find('*', (e) => e.childElementCount === 0 && e.textContent.trim() === 'Sandbox');
  sb.click();
  sb.parentElement.click();
  const re = new RegExp('^' + champ, 'i');
  for (let i = 0; i < 60 && !find('button.champ-card', (e) => re.test(e.title)); i++) await w(250);
  find('button.champ-card', (e) => re.test(e.title)).click();
  await w(300);
  find('button', (e) => /Spiel starten/.test(e.textContent)).click();
  for (let i = 0; i < 240 && !(window.__vg && window.__vg.state.snap && window.__vg.state.me()); i++) await w(250);
  const v = window.__vg;
  const s = (c) => v.link.send(c);
  s({ t: 'cheat', op: 'setLevel', value: 18 });
  s({ t: 'cheat', op: 'noCooldowns' });
  s({ t: 'cheat', op: 'teleport', x: 4600, y: 4600 });
  await w(700);
  const me = v.state.me();
  s({ t: 'cheat', op: 'spawnDummy', x: me.x + 600, y: me.y });
  await w(400);
  for (let i = 0; i < 5; i++) for (const sl of [3, 0, 1, 2]) s({ t: 'levelUp', slot: sl });
  await w(500);
  return v.state.snap.me.abilities.map((a) => a.rank);
};
/** seq: [slot, dx, dy, onDummy, waitMs][] (offsets from the dummy or from the champion). */
window.__dcast = async (seq) => {
  const v = window.__vg;
  const s = (c) => v.link.send(c);
  for (const [slot, dx, dy, onDummy, ms] of seq) {
    const me = v.state.me();
    const d = v.state.snap.entities.find((e) => e.kind === 9);
    s(onDummy && d ? { t: 'cast', slot, x: d.x + dx, y: d.y + dy, target: d.id } : { t: 'cast', slot, x: me.x + dx, y: me.y + dy });
    await w(ms);
  }
};
window.__dwait = w;
window.__dshot = async (name, cx, cy, seq) => {
  const v = window.__vg;
  focus = [cx, cy];
  await w(300);
  if (seq) await window.__dcast(seq);
  v.world.rig.focus(cx, cy);
  v.frame(performance.now());
  const url = v.world.canvas.toDataURL('image/jpeg', 0.9);
  focus = null;
  return (await fetch('http://localhost:4399/' + name, { method: 'POST', body: url })).text();
};
/** Tower shot: god mode, stand 500 in front of the nearest enemy tower, save a frame while a tower missile flies. */
window.__dtower = async (name) => {
  const v = window.__vg;
  const s = (c) => v.link.send(c);
  const me0 = v.state.me();
  const towers = v.state.snap.entities.filter((e) => e.kind === 6 && e.team !== me0.team && e.alive);
  const t = towers.sort((a, b) => Math.hypot(a.x - me0.x, a.y - me0.y) - Math.hypot(b.x - me0.x, b.y - me0.y))[0];
  s({ t: 'cheat', op: 'godMode' });
  s({ t: 'cheat', op: 'toggleMinions' });
  s({ t: 'cheat', op: 'teleport', x: t.x - 450, y: t.y - 250 });
  focus = [t.x - 250, t.y - 150];
  for (let i = 0; i < 400; i++) {
    await w(20);
    const p = v.state.snap.projectiles.find((q) => q.srcKind === 6 && Math.hypot(q.x - t.x, q.y - t.y) < 700);
    if (p && Math.hypot(p.x - t.x, p.y - t.y) > 220) break;
  }
  v.world.rig.focus(focus[0], focus[1]);
  v.frame(performance.now());
  const url = v.world.canvas.toDataURL('image/jpeg', 0.9);
  focus = null;
  return (await fetch('http://localhost:4399/' + name, { method: 'POST', body: url })).text();
};
export {};
