// The one door pings leave the client through (wheel, hotkeys, Alt+click, minimap, HUD context pings): enforces the
// spam limit (src/game/pingLimiter.ts) and builds the sim command.
import type { Command } from '../sim/types';
import type { PingReq } from './contextPing';
import { PingLimiter } from './pingLimiter';

export class PingSender {
  private readonly limiter = new PingLimiter();

  constructor(
    private readonly send: (cmd: Command) => void,
    /** Called when a ping was refused by the limiter (seconds until pinging works again). */
    private readonly onLimited: (waitS: number) => void = () => {},
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Send a ping; false if the spam limit refused it. */
  ping(req: PingReq): boolean {
    const at = this.now();
    const r = this.limiter.try(at);
    if (r === 'tooFast') return false; // double click: silently one ping
    if (r === 'limited') {
      this.onLimited(this.limiter.waitS(at));
      return false;
    }
    const { kind, x, y, target, label } = req;
    this.send({ t: 'ping', kind, x, y, ...(target !== undefined ? { target } : {}), ...(label ? { label } : {}) });
    return true;
  }
}
