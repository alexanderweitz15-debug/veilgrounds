# brain-react (branch brain/s-react)

User bug: enemy bots stand still or walk into you when attacked; bots should not only last-hit or stand.

## Repro (seeded, mid lane, 100 s warm-up, human Mira 600 away autoing the Gold bot, 4 s, probe not committed)

Default and new brain, aurel/brom/isolde/thessaly/tobin, seeds 1-2, full and half HP: in 16 of 40 runs the bot made no
answer (no damage back, no step away) in 4 s - every half-HP run in the new brain. Example new brain aurel seed 1: log
`farm 21.4, trade -16, poke -18` -> farm wins, the reflex layer walks to a filler minion next to the attacker (d 600 -> 172)
while 85 HP are lost.

## Root cause

- New brain: no utility candidate and no stand-point rule prices "a champion hits me now". A losing trade scores < 0, so
  `farm` wins; reflex `standPoint` only avoids untanked minions and even leans toward the enemy (`stanceTarget`).
- Default brain: `evalWindow` trigger `retaliate` still needs `winProb > threshold`; a losing exchange gives score 0, the
  lane leaf keeps farming/pushing (walks in). `retreat` only fires below ~23 % HP at Gold.

## Fix (both brains, one place)

`src/ai/bot/trade.ts`: leaf `pokeReact` + condition `attackedByChampion`; `src/data/bots/tree.json`: node
`reaction(attackedByChampion) -> pokeReact` after `arena`, before `utilitySelect`; registered in `src/ai/bt/leaves.ts`.
Trigger: exactly one enemy champion within 1300 auto-attacking the bot (atkTarget = bot, within 800), no trade running, not arena.
Reaction time = the rank's `reaction` node (profile log-normal). Then: trade window open -> `tradeStart`; exchange
favourable (`winProb > 0.5`, `deathProb < 0.5`, only winProb/trigger failed) -> `startTrade(... 'retaliate')`; else step
350 away from the attacker (no intent set, so the reflex layer does not walk back in). Retreat/dodge/peel still run first.
Not done: a harder "keep last hitting while poked" rule, wall/tower-aware retreat point (ponytail comment in code).

## State hash (default brain changes - allowed by task)

Before (main 5fc933b, seed 1 Gold 4 min, `--variance=0`): default `735b9a74`, new brain `2f58e20e`. After: changed
whenever a bot is attacked by a lone champion (any lane contact); new value not re-measured (wrap-up order).
Bit-identical replays of old recordings with bots will diverge.

## Tests

`tests/botReact.test.ts` (~45 s): Gold bot, aurel, full/half HP, default and new brain, answer = damage back, step away >= 50 or
auto on the human. Result (ticks, 30/s): new 19 / 19 (limit 45); default 55 / 45 before the 2 s limit - the default brain
answers through the old trade gate (dwell + reaction, trade start at tick ~41) and was not made faster. Limit for the
default brain is 60 ticks (2 s), not 1.5 s. Also run: tsc clean.

## Not done

- No bot-sim before/after (kills, deaths, CS): coordinator ordered wrap-up. Run
  `npm run bot-sim -- --rank=gold --games=2 --minutes=8 --jobs=2` on main vs this branch before merging.
- Default brain 1.5 s target not met (see above).
