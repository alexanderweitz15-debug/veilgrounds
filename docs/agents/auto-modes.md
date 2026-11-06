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

## Real ARAM (round 2)
- One-lane map is derived, not authored (src/sim/aramMap.ts): classic map + two wall triangles + nav cells with
  |x - y| > 1500 blocked (map.ts nav/pathfinding untouched). `MapData.activeLanes = ['mid']`: towers.ts skips top/bot
  structures and the nexus-tower protection counts mid inhibitor only. Camps/plants/bushes outside removed.
  `mapFor(config)` in sim, bot runner, ghost, Game; fresh copy per call (summons edit the nav grid).
- Health relics (src/sim/systems/relics.ts): 4 honey-piece look-alikes on the lane (heal 30 % HP + mana, 45 s respawn,
  spots in gameModes.json). Bots use them through the existing honey-piece leaf: 33 pickups in a 14-min bot game.
- Snowball: summoner `schneeball` (targeted, 900 range, 60-160 true damage + 40 % slow 1.5 s, 80 s cd); the ARAM human
  gets Flash + Snowball. Simplified: a hit, not a skillshot. Bots do not cast it.
- Reroll: src/ui/aramSelect.ts (one reroll, re-rolls the whole roster). Dev shortcut `?play=aram` / `?play=urf`.
- Bot game, gold, 14 min, seed 2: 79 kills (5.6/min), 1 tower, no winner yet (tools/scratch/aram.ts). Test file
  tests/variants.test.ts (+ map walkability nexus to nexus, side lanes walled, structures mid-only, relic heal/respawn).
- npm test: 157 files / 1956 tests green. Screenshot: browser check showed the corridor on the minimap, level 3 / 1476 gold HUD.
- Not done: the ground art is still the classic painting under the new walls (dev paints at runtime; shipped bake is by size).

## Brain measurements, round 2 (default brain, gold, after lead's 66e4127; no brain code changed)
- Baron is no longer a gap: tools/scratch/objs.ts (now detects the baron buff), 32-min cap, seeds 2/3/4: Schleierwaechter
  taken in 3/3 games (seed 1 not: one "gather" at the pit, game ended at 27 min). Per game: Leviathan 3-4, Kesselbrut 2,
  towers 10-16, kills 32-56, games end 26.6-29.9 min.
- CS/min, 10 min, seeds 1+2 (tools/scratch/cspm.ts): top 2.67, adc 2.43, mid 1.90, jungle 1.33, support 0.38, all 1.74.
  Lane-alone Gold is 9.6 CS/min (brain-lasthit.md), so last-hit skill is fine; presence is the gap.
- Who kills lane minions, 10 min seed 1 (tools/scratch/csshare.ts): 631 deaths, champions 21 %, minions 54 %, towers 25 %.
- Laner time 10 min seed 1 (tools/scratch/farmtime.ts, mid/top/adc, from 1:40): dead 2 %, fountain 8 %, within 900 of an
  enemy minion 39 %, elsewhere 51 %. Next step for whoever owns laning: split "elsewhere" into walking to lane / roam /
  group / waiting behind own tower, then fix the biggest piece. Not started, so no blind tuning.
- tools/scratch/lanePresence.ts prints nothing (stale); farmtime.ts replaces it.

## Open
- Custom game options UI.
- Full `npm test`: 145 files / 1822 tests green with the variants change.

## Brain (after scope change) - baseline, gold, default brain, post 5ed26b9
- tools/scratch/objs.ts counted epics by event name and always printed 0. Fixed: it sums the jungle-state tallies now.
  Real numbers, 20 min, seeds 2+3: Leviathan 1.5, Kesselbrut 2.5 per game, Schleierwaechter 0, kills 31.5, towers 3.0.
  Seed 1: kills 20, towers 5. Objectives are taken; the gap is Schleierwaechter, never taken by minute 20.
- tools/scratch/still.ts, 8 min, seed 1: still 19.6 % (windup 5.1 / attack-other 7.9 / idle 6.6). Long stands are
  jungler camp clears and minion last-hits; true idle stretches are rare. Not a worthwhile target.
- Next candidates (not started): baron decision (`take_objective` schleierwaechter, teamai.ts), gank arrival metric.
