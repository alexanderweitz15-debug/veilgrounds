// Live menu backdrop: the real map with a real headless sim (mid lane waves fighting under the Lichtwerk view),
// rendered by the game renderer. Shows the actual game instead of decorative art.
import { World } from '../render/world';
import { ClientState } from '../game/state';
import { createSim, step } from '../sim/sim';
import { buildSnapshot } from '../sim/snapshot';
import { Lane } from '../sim/types';
import { getMinionAtlas } from '../render/sheets';

const TICK_MS = 1000 / 30;

export function startMenuScene(canvas: HTMLCanvasElement): () => void {
  const sim = createSim({ seed: 7, mode: 'laneOnly', players: [], minionLanes: [Lane.Mid] });
  while (sim.tick < 30 * 100) step(sim); // fast-forward to 1:40 so the first waves meet
  const world = new World(canvas, sim.map);
  const state = new ClientState();
  let raf = 0;
  let acc = 0;
  let last = performance.now();
  let prev = last;
  let fx = 7600;
  let fy = 7600;
  world.rig.dist = 3300;
  const resize = (): void => world.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  window.addEventListener('resize', resize);
  // painted minion sprites like in the game (shared, cached per session: a later match loads faster). Started a moment
  // after the first frames so the menu shows up at once; placeholders until then.
  let disposed = false;
  const bake = window.setTimeout(() => {
    getMinionAtlas()
      .then((atlas) => {
        if (!disposed) world.setMinionAtlas(atlas);
      })
      .catch((e) => console.warn('menu: minion atlas failed, keeping placeholder sprites', e));
  }, 1200);

  const frame = (now: number): void => {
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      step(sim);
      state.ingest(buildSnapshot(sim, 0, -1), now);
    }
    // follow the wave front: the most advanced Lichtwerk minion (where the fighting happens)
    let tx = 7600;
    let ty = 7600;
    let best = -Infinity;
    for (const e of state.snap?.entities ?? []) {
      if (e.kind >= 2 && e.kind <= 5 && e.alive && e.team === 0 && e.x + e.y > best) {
        best = e.x + e.y;
        tx = e.x;
        ty = e.y;
      }
    }
    const k = Math.min(1, (now - prev) / 4000);
    prev = now;
    fx += (tx - fx) * k;
    fy += (ty - fy) * k;
    world.rig.focus(fx - 650, fy - 50); // action right of the mode list, above the news box
    state.beginFrame(now);
    world.frame(state, now, -1, false);
    canvas.classList.add('ready'); // first frame is on the canvas: fade it in over the placeholder gradient
  };
  const loop = (now: number): void => {
    frame(now);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  // dev / ?bench: step the backdrop synchronously (hidden tabs pause rAF)
  const hook = window as unknown as { __vgMenu?: unknown };
  if (import.meta.env.DEV || location.search.includes('bench')) hook.__vgMenu = { frame, world };
  return () => {
    disposed = true;
    window.clearTimeout(bake);
    delete hook.__vgMenu;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    world.dispose();
  };
}
