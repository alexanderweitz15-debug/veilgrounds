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
