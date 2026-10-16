// C4: chat command parser and minimap ping snapping.
import { describe, expect, it } from 'vitest';
import { matchPlayers, parseChat } from '../src/ui/chatCommands';
import { minimapPingFor } from '../src/game/minimapPing';
import { Kind, type PlayerSetup } from '../src/sim/types';
import type { SnapEntity } from '../src/sim/snapshot';

const P = (slot: number, team: 0 | 1, champion: string, name?: string): PlayerSetup => ({
  slot, team, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: slot === 0,
  ...(name ? { bot: { rank: 'gold', variance: 'normal', name } } : {}),
});
const PLAYERS = [P(0, 0, 'mira'), P(1, 0, 'brom', 'Kupfer_zahn'), P(5, 1, 'wren', 'xXFlashBogenXx'), P(6, 1, 'seraphyne', 'Sleepy Stab')];

describe('chat commands', () => {
  it('plain text is sent, commands are parsed', () => {
    expect(parseChat('  hi team ', PLAYERS, 0)).toEqual({ kind: 'send', text: 'hi team' });
    expect(parseChat('/help', PLAYERS, 0)).toEqual({ kind: 'help' });
    expect(parseChat('/ff', PLAYERS, 0)).toEqual({ kind: 'surrender' });
    expect(parseChat('/surrender', PLAYERS, 0)).toEqual({ kind: 'surrender' });
    expect(parseChat('/all gg', PLAYERS, 0)).toEqual({ kind: 'all', text: 'gg' });
    expect(parseChat('/dance', PLAYERS, 0)).toEqual({ kind: 'unknown', cmd: 'dance' });
  });

  it('mute matches bot names and champion names, never the own slot', () => {
    expect(parseChat('/mute kupfer', PLAYERS, 0)).toEqual({ kind: 'mute', slots: [1], on: true });
    expect(parseChat('/mute Wren', PLAYERS, 0)).toEqual({ kind: 'mute', slots: [5], on: true });
    expect(parseChat('/unmute sleepy stab', PLAYERS, 0)).toEqual({ kind: 'mute', slots: [6], on: false });
    expect(parseChat('/mute all', PLAYERS, 0)).toEqual({ kind: 'mute', slots: [1, 5, 6], on: true });
    expect(parseChat('/mute mira', PLAYERS, 0)).toMatchObject({ slots: [], unknown: 'mira' });
    expect(matchPlayers('', PLAYERS, 0)).toEqual([]);
  });
});

describe('minimap ping snapping', () => {
  const ent = (id: number, kind: number, team: number, x: number, y: number, alive = true): SnapEntity => ({ id, kind, team, x, y, alive }) as SnapEntity;
  const ENTS = [ent(1, Kind.Tower, 1, 10000, 4000), ent(2, Kind.Tower, 0, 4000, 10000), ent(3, Kind.Inhibitor, 1, 12000, 3000, false)];
  const OBJ = [{ x: 10500, y: 5500 }];

  it('enemy structure -> focus with target, own structure -> danger at it', () => {
    expect(minimapPingFor(10200, 4100, ENTS, 0, OBJ)).toEqual({ kind: 'focus', x: 10000, y: 4000, target: 1 });
    expect(minimapPingFor(4100, 9900, ENTS, 0, OBJ)).toEqual({ kind: 'danger', x: 4000, y: 10000 });
  });

  it('objective pit -> objective; dead structures and empty ground -> danger at the cursor', () => {
    expect(minimapPingFor(10700, 5800, ENTS, 0, OBJ)).toEqual({ kind: 'objective', x: 10500, y: 5500 });
    expect(minimapPingFor(12050, 3050, ENTS, 0, OBJ)).toEqual({ kind: 'danger', x: 12050, y: 3050 });
  });
});
