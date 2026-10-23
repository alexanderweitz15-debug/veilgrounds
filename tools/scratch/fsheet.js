// Scratch (agent F): contact sheets of baked-style frames, rendered with the atlas painter in the dev server page.
// In the page (vite dev): `await import('/tools/scratch/fsheet.js')`, then
//   __sheet(ids, ['run'], 'SE', 88, 'f-after-run.jpg', 'label')  -> POSTs the JPEG to tools/scratch/shotServer.mjs.
const M = await import('/src/render/champions/index.ts');
window.__M = M;
const post = async (name, c) => (await fetch('http://localhost:4399/' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) })).text();
window.__sheet = async (list, anims, dir, cell, name, label) => {
  const cols = anims.reduce((s, a) => s + Math.max(...list.map((id) => M.framesOf(id, a))), 0);
  const LW = 110;
  const c = document.createElement('canvas');
  c.width = LW + cols * cell;
  c.height = list.length * cell + 24;
  const g = c.getContext('2d');
  g.fillStyle = '#6b6f5e';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#eee';
  g.font = '13px sans-serif';
  g.fillText(label, 6, 16);
  const t0 = performance.now();
  let n = 0;
  for (let r = 0; r < list.length; r++) {
    const id = list[r];
    const y = 24 + r * cell;
    g.fillStyle = r % 2 ? '#62665a' : '#6b6f5e';
    g.fillRect(0, y, c.width, cell);
    g.fillStyle = '#f4f0e4';
    g.font = '12px sans-serif';
    g.fillText(id, 6, y + cell / 2);
    let x = LW;
    for (const a of anims) {
      const fn = Math.max(...list.map((i) => M.framesOf(i, a)));
      for (let f = 0; f < fn; f++) {
        if (f < M.framesOf(id, a)) {
          M.drawChampionFrame(g, id, a, dir, f, x, y, cell, 240);
          n++;
        }
        x += cell;
      }
      g.fillStyle = '#2a2a2a';
      g.fillRect(x - 1, y, 1, cell);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return [await post(name, c), n, Math.round(performance.now() - t0)];
};
export {};
