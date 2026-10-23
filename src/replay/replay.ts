// Replays = config (incl. seed) + inputs per tick. Re-simulating reproduces the game bit for bit.
import { createSim, step, stateHash, type Sim } from '../sim/sim';
import { Kind, VARIANTS, type SimConfig, type TickInput } from '../sim/types';
import { PatternDetector, type PatternEvent } from '../stats/playerPatterns';

/** What happened, for the replay timeline (all champions, both teams: the recorder reads the full sim). */
export type MarkerKind = 'kill' | 'tower' | 'inhib' | 'nexus' | 'epic';

export interface ReplayMarker {
  tick: number;
  kind: MarkerKind;
  /** Team that scored it (killer's team; for structures the team that did NOT lose it). */
  team: number;
  /** kill: victim and killer slot (killer -1 = tower / minion / monster, an "execution"). */
  victim?: number;
  killer?: number;
  /** kill: champion ids; epic: monster type (leviathan, kesselbrut, schleierwaechter). */
  champ?: string;
  killerChamp?: string;
  x?: number;
  y?: number;
}

export interface Replay {
  version: 1;
  config: SimConfig;
  /** Sparse: tick -> inputs applied on that tick. */
  inputs: Record<number, TickInput[]>;
  ticks: number;
  /** State hash at the end, to verify reproduction. */
  hash: string;
  /** Bot decision log as NDJSON (src/ai/log.ts). Only the `error` and `attention` nodes are kept (src/stats/errorList.ts reads them). Not needed to re-simulate. */
  botLog?: string;
  /** Timeline markers (kills, structures, epic monsters), recorded live from the full sim. */
  markers?: ReplayMarker[];
  /** Slot of the human player (the pattern list belongs to this player). */
  humanSlot?: number;
  /** Winning team of a decided match (null: trainer run / not decided). */
  winner?: number | null;
  /** The player's mistake patterns (src/stats/playerPatterns.ts), detected live from the full sim. */
  player?: PatternEvent[];
}

/** Keeps only the decision-log lines the post-game error list needs (the full log is megabytes). */
export function slimBotLog(ndjson: string): string {
  const out: string[] = [];
  for (const line of ndjson.split('\n')) {
    if (line.includes('"node":"error"') || line.includes('"node":"attention"')) out.push(line);
  }
  return out.length ? out.join('\n') + '\n' : '';
}

export class Recorder {
  readonly inputs: Record<number, TickInput[]> = {};
  readonly markers: ReplayMarker[] = [];
  private readonly detector: PatternDetector | null;
  private readonly humanSlot: number;
  private last: TickInput[] = [];
  constructor(readonly config: SimConfig) {
    this.humanSlot = config.players.find((p) => p.isHuman)?.slot ?? -1;
    this.detector = this.humanSlot >= 0 ? new PatternDetector(this.humanSlot) : null;
  }
  record(tick: number, inputs: TickInput[]): void {
    this.last = inputs;
    if (inputs.length) this.inputs[tick] = inputs.map((i) => structuredClone(i));
  }
  /** Call after every step: reads the full sim (markers, pattern detector). Never writes to it. */
  observe(sim: Sim): void {
    const { Unit } = sim.c;
    const tick = sim.tick - 1;
    for (const ev of sim.events) {
      if (ev.e !== 'death') continue;
      if (ev.kind === Kind.Champion && ev.team <= 1) {
        const k = ev.killer >= 0 && Unit.kind[ev.killer] === Kind.Champion ? Unit.slot[ev.killer]! : -1;
        this.markers.push({ tick, kind: 'kill', team: ev.team === 0 ? 1 : 0, victim: Unit.slot[ev.eid]!, killer: k, ...(ev.champ ? { champ: ev.champ } : {}), ...(ev.killerChamp ? { killerChamp: ev.killerChamp } : {}), x: Math.round(ev.x), y: Math.round(ev.y) });
      } else if ((ev.kind === Kind.Tower || ev.kind === Kind.Inhibitor || ev.kind === Kind.Nexus) && ev.team <= 1) {
        this.markers.push({ tick, kind: ev.kind === Kind.Tower ? 'tower' : ev.kind === Kind.Inhibitor ? 'inhib' : 'nexus', team: ev.team === 0 ? 1 : 0, x: Math.round(ev.x), y: Math.round(ev.y) });
      } else if (ev.kind === Kind.Monster && ev.epic && (ev.killerTeam === 0 || ev.killerTeam === 1)) {
        this.markers.push({ tick, kind: 'epic', team: ev.killerTeam, champ: VARIANTS[Unit.variant[ev.eid]!] || 'epic', x: Math.round(ev.x), y: Math.round(ev.y) });
      }
    }
    this.detector?.observe(sim, this.last);
  }
  finish(sim: Sim, botLog?: string): Replay {
    const slim = botLog ? slimBotLog(botLog) : '';
    return {
      version: 1,
      config: this.config,
      inputs: this.inputs,
      ticks: sim.tick,
      hash: stateHash(sim),
      ...(slim ? { botLog: slim } : {}),
      markers: this.markers,
      winner: typeof sim.state.winner === 'number' ? sim.state.winner : null,
      ...(this.humanSlot >= 0 ? { humanSlot: this.humanSlot } : {}),
      ...(this.detector ? { player: this.detector.finish(sim) } : {}),
    };
  }
}

/** Re-run a replay headless. Optional callback per tick (for analysis or the replay viewer). */
export function playReplay(r: Replay, onTick?: (sim: Sim) => void, untilTick = r.ticks): Sim {
  const sim = createSim(structuredClone(r.config));
  while (sim.tick < untilTick) {
    step(sim, r.inputs[sim.tick] ?? []);
    onTick?.(sim);
  }
  return sim;
}
