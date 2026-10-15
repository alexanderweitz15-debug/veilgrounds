// Client-side regression tests for the bug-hunt findings (pure logic; the DOM parts have no test environment here).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Snapshot } from '../src/sim/snapshot';
import { Kind, type SimEvent } from '../src/sim/types';
import { MatchStats } from '../src/game/matchStats';
import { ClientState, deathKillerChamp, deathVictimChamp } from '../src/game/state';
import { withClientSettings, trainerConfig } from '../src/game/modes';
import { disposeTree } from '../src/render/dispose';

const ME = 3;
const ENEMY = 7;

function snap(time: number, events: SimEvent[], entities: Partial<Snapshot['entities'][number]>[] = []): Snapshot {
  return {
    tick: time * 30,
    time,
    team: 0,
    entities: entities as Snapshot['entities'],
    projectiles: [],
    objects: [],
    me: { eid: ME, champ: 'mira', level: 1, xp: 0, gold: 500, cs: 0, dead: false, respawnIn: 0, items: [], itemCds: [], inFountain: false, marks: [], recallLeft: 0, abilities: [], stats: { ad: 0, ap: 0, armor: 0, mr: 0, as: 0, ms: 0, range: 0, crit: 0 } },
    events,
    players: [],
  };
}

const enemyChamp = { id: ENEMY, kind: Kind.Champion, team: 1, champ: 'brom', alive: true, x: 0, y: 0 };

describe('H4: the killing blow counts as champion damage in the post-game stats', () => {
  it('damage to a champion that died in the same tick (no longer in the snapshot) is champion damage', () => {
    const st = new MatchStats(null);
    st.ingest(snap(1, [], [enemyChamp]));
    st.ingest(snap(2, [
      { e: 'damage', src: ME, dst: ENEMY, amount: 120, type: 'phys' },
      { e: 'death', eid: ENEMY, kind: Kind.Champion, team: 1, killer: ME, x: 0, y: 0, champ: 'brom', killerChamp: 'mira', killerKind: Kind.Champion, killerTeam: 0 },
    ]));
    expect(st.summary().dealtChamp[0]).toBe(120);
  });

  it('also for a champion that was never seen before (only the death event names it)', () => {
    const st = new MatchStats(null);
    st.ingest(snap(2, [
      { e: 'damage', src: ME, dst: ENEMY, amount: 80, type: 'magic' },
      { e: 'death', eid: ENEMY, kind: Kind.Champion, team: 1, killer: ME, x: 0, y: 0, champ: 'brom' },
    ]));
    expect(st.summary().dealtChamp[0]).toBe(80);
  });
});

describe('H4: kill feed / announcer names come from the death event', () => {
  it('a dead enemy that is not in the snapshot is still named, the killer too', () => {
    const state = new ClientState();
    state.ingest(snap(1, []), 0);
    const ev = { e: 'death', eid: ENEMY, kind: Kind.Champion, team: 1, killer: -1, x: 0, y: 0, champ: 'brom', killerChamp: 'mira', killerKind: Kind.Champion, killerTeam: 0 } as const;
    expect(deathVictimChamp(ev, state)).toBe('brom');
    expect(deathKillerChamp(ev, state)).toBe('mira'); // killer eid fog-masked, name still known
    expect(deathKillerChamp({ ...ev, killerChamp: undefined, killerKind: Kind.Tower, killerTeam: 0 }, state)).toBeNull(); // executed
  });

  it('entity() falls back to the last seen unit (overlay damage number on the killing blow)', () => {
    const state = new ClientState();
    state.ingest(snap(1, [], [enemyChamp]), 0);
    state.ingest(snap(2, []), 33);
    expect(state.byId.get(ENEMY)).toBeUndefined();
    expect(state.entity(ENEMY)?.champ).toBe('brom');
  });
});

describe('M11: stats freeze when the match / trainer run is decided', () => {
  it('snapshots after gameOver do not change the summary', () => {
    const st = new MatchStats(null);
    st.ingest(snap(10, [{ e: 'gameOver', winner: 0 }]));
    st.ingest(snap(15, [{ e: 'damage', src: ME, dst: ENEMY, amount: 500, type: 'phys' }]));
    const s = st.summary();
    expect(s.duration).toBe(10);
    expect(s.winner).toBe(0);
    expect(s.dealtAll.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('snapshots after a finished trainer run do not change the summary', () => {
    const st = new MatchStats(null);
    const done = { ...snap(20, []), trainer: { kind: 'arena', time: 20, duration: 0, done: true, won: true, score: 1, grade: 'S', stats: [] } } as Snapshot;
    st.ingest(done);
    st.ingest({ ...snap(25, [{ e: 'damage', src: ME, dst: ENEMY, amount: 99, type: 'phys' }]), trainer: { ...done.trainer!, time: 25 } });
    expect(st.summary().duration).toBe(20);
    expect(st.summary().trainer?.time).toBe(20);
  });
});

describe('bot toxicity setting applies to every mode', () => {
  it('trainer / duel configs get the client setting; an explicit config value wins', () => {
    const cfg = trainerConfig({ mode: 'laneDuel', opts: {} }, { champion: 'mira', summoners: ['sprung', 'heilen'] }, 1);
    expect(cfg.botToxicity).toBeUndefined(); // the runner would default to toxic
    expect(withClientSettings(cfg, { botToxicity: false }).botToxicity).toBe(false);
    expect(withClientSettings({ ...cfg, botToxicity: true }, { botToxicity: false }).botToxicity).toBe(true);
  });
});

describe('M12: GPU resources are released', () => {
  it('disposeTree disposes geometries, materials, their textures, custom depth materials and instance buffers', () => {
    const disposed: string[] = [];
    const track = <T extends THREE.EventDispatcher<{ dispose: object }>>(o: T, name: string): T => {
      o.addEventListener('dispose', () => disposed.push(name));
      return o;
    };
    const tex = track(new THREE.Texture(), 'texture');
    const geo = track(new THREE.PlaneGeometry(1, 1), 'geometry');
    const mat = track(new THREE.MeshBasicMaterial({ map: tex }), 'material');
    const depth = track(new THREE.MeshDepthMaterial(), 'depth');
    const inst = track(new THREE.InstancedMesh(geo, mat, 4), 'instanced');
    inst.customDepthMaterial = depth;
    const uniTex = track(new THREE.Texture(), 'uniformTexture');
    const shader = track(new THREE.ShaderMaterial({ uniforms: { fog: { value: uniTex } } }), 'shader');
    const group = new THREE.Group();
    group.add(inst, new THREE.Mesh(geo, shader));
    disposeTree(group);
    expect(new Set(disposed)).toEqual(new Set(['texture', 'geometry', 'material', 'depth', 'instanced', 'uniformTexture', 'shader']));
    expect(disposed.filter((d) => d === 'geometry')).toHaveLength(1); // shared resources once
  });
});

describe('M10: the shop does not rebuild on every gold tick', () => {
  it('the layout key ignores gold; inventory / shop access / selection still rebuild', async () => {
    const { shopLayoutKey } = await import('../src/ui/shopLayout');
    const me = { champ: 'mira', items: [null, null, null, null, null, null, 'schleierward'], inFountain: true, dead: false };
    const k = shopLayoutKey({ ...me, gold: 500 } as typeof me, null, 'de');
    expect(shopLayoutKey({ ...me, gold: 512.5 } as typeof me, null, 'de')).toBe(k);
    expect(shopLayoutKey({ ...me, items: ['kurzschwert', ...me.items.slice(1)] }, null, 'de')).not.toBe(k);
    expect(shopLayoutKey({ ...me, inFountain: false }, null, 'de')).not.toBe(k);
    expect(shopLayoutKey(me, 'sturmbogen', 'de')).not.toBe(k);
  });
});
