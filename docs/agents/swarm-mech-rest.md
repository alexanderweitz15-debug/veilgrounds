# swarm/mech-rest (open items of mech-tower, mech-cc, mech-minions)

## Done
- **Tower data**: all numbers in `src/data/towers.json` (range, AS, radius, vision, tiers, inhibitor, nexus, plates, kill gold, fortification). `towers.ts` constants read it; exported names unchanged.
- **Plate gold 160** (LoL). docs/DECISIONS.md has no deliberate 120 (only BRAIN-REWORK used 120 as a bot-value note), so changed; bot value `gold.plate` in `src/data/bots/values.json` follows (test requires equality).
- **Fortification**: until 5:00 outer towers take 0.5 x damage (damage.ts, all sources, incl. true). The 0.5 is a tuned guess (LoL gives early outer towers extra resist; exact curve not public to me), set in `towers.json`.
- **Tower shot readability** (render only, fx.ts): bigger lance + halo; pulsing ring under the champion a visible enemy tower shoots (red = you, amber = ally); aggro line is shown also when an ally far away is under fire. Not screenshot-checked (no browser per rules).
- **Reinigen vs fear**: cleanses fear and is castable while feared (LoL). airborne/suppress/stasis still block it. Bot `cleanseStep` already covered fear (cc 3.5).
- **Dash vs CC**: an own ability dash now ends where it is on stun, fear, airborne, suppression, stasis (LoL). Root and slow do not stop it; `unstoppable` dashes are immune (via `canAttack`). Landing effect of the ability does not fire; `onDashEnd` hook does. Displacements (knockback, leap) are not touched. Checked per dash type: only one generic dash type exists in the sim (`type: 'dash'`), so no per-ability exceptions beyond the `unstoppable` flag.
- **Minion tiers**: new 4 turret attacking allied minion, 5 champion attacking allied minion; order 1 champ>champ, 2 minion>champ, 3 minion>minion, 4, 5, 6 nearest minion, 7 structure, 8 idle champion. LoL's "turret attacking allied champion" tier not added (not asked).
- **Super minions**: inhibitors exist. 1 super when this lane's enemy inhibitor is down, 2 when all three are down (`superCount`, counts in `minionWave.json`). Siege minion stays in the wave (LoL replaces cannon in some patches; unverified).

## Tests
- `tests/mechRest.test.ts` (new, 8, seeded): json drives constants + 160 g, fortification, Reinigen vs fear, stun/fear stop a dash and root does not, three minion tier cases, super count 0/1/2.
- Other results: see final message of the lead hand-off (filled below).

## Open
- Fortification factor and super-minion siege replacement are guesses; tune in json.
- Tower hit shot readability untested visually.
