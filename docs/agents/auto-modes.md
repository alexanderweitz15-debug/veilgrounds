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
