// "Cast with indicator": the aim preview must handle every ability of every champion without throwing (it runs in
// the frame loop; an exception would freeze the game) and show/hide its meshes.
import { describe, expect, it } from 'vitest';
import { Fx } from '../src/render/fx';
import { ClientState } from '../src/game/state';
import { CHAMPION_DATA } from '../src/sim/champions';
import { Kind } from '../src/sim/types';
import type { Snapshot } from '../src/sim/snapshot';

function stateFor(champ: string): ClientState {
  const st = new ClientState();
  const snap = {
    tick: 10,
    time: 1,
    team: 0,
    entities: [{ id: 5, serial: 5, kind: Kind.Champion, team: 0, x: 8000, y: 8000, px: 8000, py: 8000, fx: 1, fy: 0, champ, radius: 60, alive: true }],
    projectiles: [],
    objects: [],
    me: { eid: 5, abilities: [0, 1, 2, 3].map((i) => ({ rank: i === 3 ? 1 : 3, cdLeft: 0 })) },
    events: [],
    audio: [],
    players: [],
  } as unknown as Snapshot;
  st.ingest(snap, 0);
  st.beginFrame(0);
  return st;
}

describe('aim preview', () => {
  it('every ability of every champion previews without throwing', () => {
    const fx = new Fx();
    for (const champ of Object.keys(CHAMPION_DATA)) {
      const st = stateFor(champ);
      for (const slot of [0, 1, 2, 3]) expect(() => fx.showAim(st, slot, { x: 8400, y: 8100 })).not.toThrow();
      fx.showAim(st, null, null);
    }
  });
});
