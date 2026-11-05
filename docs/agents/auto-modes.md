# auto/modes log

Scope change (lead, mid-task): after ARAM no more modes; work moves to bot brain + game feel (see "Brain" below).

## Idea list
| idea | why | status |
|---|---|---|
| `SimConfig.rules` knob set (src/sim/rules.ts, data in src/data/gameModes.json) | one mechanism for ARAM, URF, custom lobby options; no per-mode sim forks | shipped |
| ARAM-lite on the classic map: mid-only waves, no jungle, no recall, start level 3 / 1400 gold, faster waves, random distinct champions, all bots lane mid | cheapest playable ARAM; reuses classic structures (mid push opens nexus towers) | shipped |
| URF: haste +100, mana cost x0.3, mana regen +300 %, respawn x0.5, double passive gold | LoL-like chaos mode, pure rules | shipped |
| Dedicated one-lane ARAM map (tools/genAramMap.mjs, loadMap(id)), health relics, snowball summoner, reroll | real ARAM feel (walls seal the lane) | not done, plan in docs/agents/feat-aram.md (origin/feat/aram) |
| Custom game options in lobby (start gold/level/respawn) | `rules` already carries them, only UI missing | open |
| Duel 1v1/2v2, One-for-All, Nexus-Blitz events | variety | dropped by scope change |

## Shipped
- Rules wired in: economy (start gold/level, noRecall, respawn, passive gold), waves (interval, midOnly), jungle (noJungle), inventory.bonusStats (haste, mana regen), abilities (mana cost).
- `variantConfig(id, rank, seed, humanPick?)` in src/game/modes.ts; main menu entries ARAM / URF (de/en).
- Test: tests/variants.test.ts (roster, rules, 4-min headless bot game per variant).

## Open
- Reroll UI, relics, real ARAM map. Screenshot not taken yet.
- Full `npm test`: 145 files / 1822 tests green with the variants change.

## Brain (after scope change) - baseline, gold, default brain, post 5ed26b9
- tools/scratch/objs.ts counted epics by event name and always printed 0. Fixed: it sums the jungle-state tallies now.
  Real numbers, 20 min, seeds 2+3: Leviathan 1.5, Kesselbrut 2.5 per game, Schleierwaechter 0, kills 31.5, towers 3.0.
  Seed 1: kills 20, towers 5. Objectives are taken; the gap is Schleierwaechter, never taken by minute 20.
- tools/scratch/still.ts, 8 min, seed 1: still 19.6 % (windup 5.1 / attack-other 7.9 / idle 6.6). Long stands are
  jungler camp clears and minion last-hits; true idle stretches are rare. Not a worthwhile target.
- Next candidates (not started): baron decision (`take_objective` schleierwaechter, teamai.ts), gank arrival metric.
