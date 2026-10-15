// Live menu backdrop: the real map with a real headless sim (mid lane waves fighting under the Lichtwerk view),
// rendered by the game renderer. Shows the actual game instead of decorative art.
import { World } from '../render/world';
import { ClientState } from '../game/state';
import { createSim, step } from '../sim/sim';
import { buildSnapshot } from '../sim/snapshot';
import { Lane } from '../sim/types';

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

  const loop = (now: number): void => {
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
    world.rig.focus(fx - 1000, fy + 250); // action right of the mode list
    state.beginFrame(now);
    world.frame(state, now, -1, false);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    world.dispose();
  };
}
