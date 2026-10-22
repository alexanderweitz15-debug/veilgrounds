// Sev (Aschenblick) bot rules, Fassung 3 (docs/agents/issues.md 2026-10-22, spec docs/champions/sev.md), utility flag
// only. Data in values.json `sev`; rank enters through rank curves.
//   1 R choice by the enemy composition (lobby knowledge): Amaterasu vs tanks / healers, Tsukuyomi vs squishy carries,
//     Susanoo when behind or brawling (sent before R is learned, otherwise the sim picks from botUltChoice).
//   2 Q fake (Platinum+ by rank curve): against a moving target the Q is recast inside its 0.4 s wind-up (the sim's
//     sev_q_fake_cancel: refund, 2 s cooldown) - the dodge is baited, the real Q follows.
//   3 Bannblick counterplay for enemy bots: during Sev's eye contact (gaze line `sev_e_gaze` following the bot) the
//     bot turns away (moves away from Sev), chance by rank curve.
//   6 Tsukuyomi (R choice 2) roots Sev while it suppresses: only with an ally near the target or on a low target.
// Not done (see docs/agents/a2.md): Amaterasu burn in the exchange estimate, decoy rules (bots already ignore pets),
// combo data (champion json, E's file).

import type { NodeCtx } from '../bt/types';
import type { BotStatic, SnapEntity } from '../bot/types';
import type { View } from '../bot/perception';
import { championData } from '../../sim/champions';
import { dst } from '../bot/geo';
import { hpPct } from '../bot/combat';
import { VALUES, rankCurve } from './values';

const S = VALUES.sev;
const sent = new WeakMap<object, boolean>();
const gazeRolled = new WeakMap<object, Map<string, boolean>>();

/** R choice index for this bot from the enemy line-up (or null when nothing to send). */
export function sevUltChoice(n: NodeCtx): number | null {
  const ch = n.ctx.champ;
  if (!ch.ultChoices || sent.get(n.mem) || n.v.self.ult !== undefined || n.v.me.level < S.chooseFromLevel) return null;
  const foes = n.ctx.players.filter((p) => p.team !== n.ctx.team).map((p) => championData(p.champion).archetype);
  const count = (re: string): number => foes.filter((a) => new RegExp(re).test(a)).length;
  const tanks = count(S.tankHealerArchetypes);
  const squishy = count(S.squishyArchetypes);
  const row = n.snap.players.find((r) => r.slot === n.ctx.slot);
  const behind = !!row && row.deaths - row.kills >= S.behindDeaths;
  const choice = behind ? S.choice.susanoo : tanks >= squishy ? S.choice.amaterasu : S.choice.tsukuyomi;
  sent.set(n.mem, true);
  n.out.push({ cmd: { t: 'ultChoice', choice: choice as 0 | 1 | 2 } });
  n.log('sev', `ult${choice}`, behind ? 'behind: Susanoo' : tanks >= squishy ? 'tanks / healers: Amaterasu' : 'squishy carries: Tsukuyomi', { tanks, squishy });
  return choice;
}

/** Enemy Sev's eye contact on this bot: turn away (move away from Sev) by rank chance. True = move issued. */
export function gazeTurnAway(n: NodeCtx): boolean {
  const me = n.v.self;
  const gaze = n.snap.objects.find((o) => o.tag === S.gazeTag && o.team !== n.ctx.team && o.follow === me.id);
  if (!gaze) return false;
  let rolled = gazeRolled.get(n.mem);
  if (!rolled) gazeRolled.set(n.mem, (rolled = new Map()));
  const key = gaze.key ?? `${gaze.x},${gaze.y}`;
  if (!rolled.has(key)) rolled.set(key, n.rng.chance(rankCurve(S.gazeTurnPct, n.ctx.params.skill) / 100));
  if (!rolled.get(key)) return false;
  const d = dst(gaze, me) || 1;
  const p = { x: me.x + ((me.x - gaze.x) / d) * S.turnAwayDist, y: me.y + ((me.y - gaze.y) / d) * S.turnAwayDist };
  n.out.push({ cmd: { t: 'move', x: Math.round(p.x), y: Math.round(p.y) } });
  n.mem.lastMove = null;
  n.log('sev', 'turn_away', 'Bannblick eye contact: look away', { dist: Math.round(d) });
  return true;
}

/** After a decision: a Sev Q cast at a moving target is followed by the fake recast inside the wind-up (rank curve). */
export function sevQFake(n: NodeCtx): void {
  if (n.ctx.champ.id !== 'sev') return;
  const q = n.out.find((a) => a.cmd.t === 'cast' && a.cmd.slot === 0 && !a.delay);
  const cmd = q?.cmd;
  if (!cmd || cmd.t !== 'cast') return;
  const t = n.v.enemies.find((e) => dst(e, { x: cmd.x, y: cmd.y }) < S.fakeTargetRadius);
  if (!t || (t.x === t.px && t.y === t.py)) return;
  if (!n.rng.chance(rankCurve(S.qFakePct, n.ctx.params.skill) / 100)) return;
  n.out.push({ cmd: { ...cmd }, delay: S.fakeDelayTicks });
  n.log('sev', 'q_fake', 'moving target: fake the Q inside the wind-up', { target: t.slot });
}

/** Tsukuyomi (chosen R index tsukuyomi) only with an ally near the target or on a low target. */
export function sevUltAllowed(v: View, ctx: BotStatic, t: SnapEntity): boolean {
  if (ctx.champ.id !== 'sev' || v.self.ult !== S.choice.tsukuyomi) return true;
  return hpPct(t) < S.tsukuyomiLowHp || v.allies.some((a) => dst(a, t) < S.tsukuyomiAllyRange);
}
