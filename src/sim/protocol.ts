// Main thread <-> sim worker messages.
import type { Snapshot } from './snapshot';
import type { Command, SimConfig } from './types';

export type ToWorker =
  | { type: 'start'; config: SimConfig; slot: number }
  | { type: 'cmd'; cmd: Command }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'getReplay' }
  /** F9 overlay: latest bot decision rows (answered with 'botDebug'). */
  | { type: 'getBotDebug' };

export type FromWorker =
  | { type: 'snap'; snap: Snapshot }
  | { type: 'replay'; replay: import('../replay/replay').Replay }
  | { type: 'botDebug'; tick: number; rows: import('../ai/log').BotDebugRow[] };
