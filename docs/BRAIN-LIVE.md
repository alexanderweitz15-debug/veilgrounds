# Brain live log (owner: brain-doc)

Living document: architecture map, current numbers, who works on what, findings, experiment log. See docs/agents/brain-swarm.md.

## In Arbeit

## Zahlen (Gold, neues Gehirn)

## Befunde

## Experiment-Log

- brain-react (24 Oct): bot attacked by a lone champion stood/farmed or walked in (no utility candidate or stand rule for it). New tree node `pokeReact` (trade back if favourable, else step 350 away) in both brains, default-brain state hash changes; see docs/agents/brain-react.md. No bot-sim run yet.
- brain-recall (27 Oct): item recall with a big enemy wave just beyond vision and no own wave started the channel next to 13 minions (fog: unseen is not gone). `uRecall` now remembers a wave sighting for 5 s and keeps backing off (values.json `recall.waveMemoryS`); utilityRecall test limit back to 2. Bot-sim gold 2x8 min new brain: recalls/min 0.44 -> 0.47, CS/min 2.45 -> 2.61, deaths/game 0.70 -> 0.55 (noise level, no regression); see docs/agents/brain-recall.md.
