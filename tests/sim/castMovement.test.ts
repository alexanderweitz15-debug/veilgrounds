// B2 (AGENTS-PLAN §4): abilities that wrongly stop movement. Every ability has movesWhileCasting + an explicit castTime
// (data). Per ability: the champion walks 600 units and casts at 300. movesWhileCasting: it keeps walking through the
// wind-up and arrives as without the cast (or earlier: speed buffs). Otherwise it stands still for the wind-up (channels:
// the whole channel) and arrives that much later. Dashes/blinks relocate, so for them only the wind-up walk is checked.
// Audit table: docs/ability-cast-audit.md.
import { describe, expect, it } from 'vitest';
import { step } from '../../src/sim/sim';
import { sec, type Command, type PlayerSetup } from '../../src/sim/types';
import { CHAMPION_DATA, championData } from '../../src/sim/champions';
import { champAbil, isDisplacing, levelAbility } from '../../src/sim/systems/abilities';
import { spawnDummy } from '../../src/sim/systems/champions';
import { SUMMONERS } from '../../src/sim/summoners';
import { addBuff } from '../../src/sim/buffs';
import { rv } from '../../src/sim/systems/abilities';
import { CX, CY, makeSim, place } from '../combat-helpers';

const player = (slot: number, champion: string): PlayerSetup => ({ slot, team: slot < 5 ? 0 : 1, champion, role: 'mid', summoners: ['sprung', 'geist'], isHuman: true });
const START = { x: CX - 300, y: CY };
const DEST = { x: CX + 300, y: CY };
const FOE = { x: CX + 150, y: CY + 220 };
const ALLY = { x: CX + 150, y: CY - 220 };

interface Run {
  /** Tick the champion stood at DEST (path done). */
  arrival: number;
  /** Ticks the wind-up lasted (champAbil().cast set). */
  windup: number;
  /** Units walked during the wind-up. */
  walked: number;
  /** Walking speed right before the cast. */
  ms: number;
  cast: boolean;
  relocated: boolean;
  /** Fastest walking speed after the wind-up (speed buffs from the cast or a passive, e.g. Seraphyne). */
  msAfter: number;
}

function run(champ: string, slot: number | null): Run {
  const sim = makeSim({ players: [player(0, champ), player(1, 'mira')] });
  const m = sim.slots[0]!;
  const ally = sim.slots[1]!;
  sim.c.Champ.level[m] = 18;
  sim.c.Champ.skillPoints[m] = 18;
  if (slot !== null) levelAbility(sim, m, slot);
  place(sim, m, START.x, START.y);
  place(sim, ally, ALLY.x, ALLY.y);
  const foe = spawnDummy(sim, FOE.x, FOE.y, 1);
  if (champ === 'sev') addBuff(sim, foe, { kind: 'mark', id: 'sev_nachbild', src: m, ticks: sec(30) }); // Sev R needs a Nachbild target
  step(sim);
  sim.c.Mana.cur[m] = sim.c.Mana.max[m]!;
  const go = (c?: Command): void => step(sim, c ? [{ slot: 0, cmd: c }] : []);
  go({ t: 'move', x: DEST.x, y: DEST.y });
  for (let i = 0; i < sec(5) && sim.c.Pos.x[m]! < CX; i++) go();
  const ms = sim.c.Stats.ms[m]!;
  const out: Run = { arrival: -1, windup: 0, walked: 0, ms, cast: false, relocated: false, msAfter: 0 };
  if (slot !== null) {
    const ab = championData(champ).abilities[slot]!;
    const ally_ = ab.flags?.includes('ally_target');
    const tgt = ab.type === 'targeted' ? (ally_ ? ally : -1) : -1;
    const p = ally_ ? ALLY : FOE;
    const x0 = sim.c.Pos.x[m]!;
    go({ t: 'cast', slot: slot as 0 | 1 | 2 | 3, x: p.x, y: p.y, ...(tgt >= 0 ? { target: tgt } : {}) });
    out.cast = sim.events.some((e) => e.e === 'cast' && e.src === m);
    let last = x0;
    while (champAbil(sim, m).cast !== null && out.windup < sec(2)) {
      out.windup++;
      last = sim.c.Pos.x[m]!;
      go();
    }
    if (out.windup > 0) out.windup++; // the cast tick itself
    out.walked = last - x0;
  }
  for (let i = 0; i < sec(10); i++) {
    if (isDisplacing(sim, m)) out.relocated = true;
    out.msAfter = Math.max(out.msAfter, sim.c.Stats.ms[m]!);
    if (sim.c.Move.mode[m] === 0 && Math.hypot(sim.c.Pos.x[m]! - DEST.x, sim.c.Pos.y[m]! - DEST.y) < 5) {
      out.arrival = sim.tick;
      break;
    }
    go();
  }
  return out;
}

const RELOCATES = new Set(['dash', 'blink']);

describe('B2 movesWhileCasting data', () => {
  it('every ability and summoner has movesWhileCasting and an explicit castTime', () => {
    for (const [id, d] of Object.entries(CHAMPION_DATA)) {
      for (const ab of d.abilities) {
        expect([id, ab.id, typeof ab.movesWhileCasting]).toEqual([id, ab.id, 'boolean']);
        expect([id, ab.id, typeof ab.castTime]).toEqual([id, ab.id, 'number']);
      }
    }
    for (const s of SUMMONERS) expect([s.id, typeof s.movesWhileCasting, typeof s.castTime]).toEqual([s.id, 'boolean', 'number']);
    expect(SUMMONERS.find((s) => s.id === 'teleport')!.movesWhileCasting).toBe(false);
  });
});

describe('B2 walk 600, cast at 300: arrival time per ability', () => {
  const base = new Map<string, Run>();
  for (const champ of Object.keys(CHAMPION_DATA).sort()) {
    it(champ, () => {
      if (!base.has(champ)) base.set(champ, run(champ, null));
      const b = base.get(champ)!;
      expect(b.arrival).toBeGreaterThan(0);
      const rows: string[] = [];
      for (const slot of [0, 1, 2, 3]) {
        const ab = championData(champ).abilities[slot]!;
        const r = run(champ, slot);
        const tag = `${ab.id} moves=${ab.movesWhileCasting} windup=${r.windup} walked=${r.walked.toFixed(0)} arrival=${r.arrival - b.arrival}`;
        rows.push(tag);
        expect([tag, r.cast]).toEqual([tag, true]);
        const moving = r.windup > 1 ? r.walked >= 0.6 * (r.ms / 30) * (r.windup - 1) : true;
        if (ab.movesWhileCasting) {
          expect([tag, moving]).toEqual([tag, true]);
          if (!RELOCATES.has(ab.type) && !r.relocated) expect([tag, r.arrival - b.arrival <= 1]).toEqual([tag, true]);
        } else {
          expect([tag, Math.abs(r.walked) <= 1]).toEqual([tag, true]);
          const channel = ab.flags?.includes('channel') ? sec(rv(ab.duration, 1)) : 0;
          // a speed buff after the cast (Oda R, Seraphyne passive) makes up time: then only the stand-still is checked
          if (!r.relocated && r.windup > 0 && r.msAfter <= r.ms + 0.5) expect([tag, r.arrival - b.arrival >= r.windup + channel - 2]).toEqual([tag, true]);
        }
      }
      // B2_AUDIT=1 prints the rows of docs/ability-cast-audit.md
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.B2_AUDIT) console.log(rows.join('\n'));
    });
  }
});
