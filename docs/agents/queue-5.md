# Agent queue (user 30 Oct: max 5 Sonnet agents at once, they do all tasks)

Running (keep): integrate/next-level, swarm/champ-adc, fix/sim-bughunt, fix/ui-bughunt, brain/s-fluid (bots stand too much).

Paused with a WIP checkpoint on their branch (start a new agent from the branch + its report when a slot frees, in this order):
1. swarm/champ-golem (stone golem top, earth walls)
2. swarm/champ-chains (chain-shadow jungle assassin)
3. feat/tooltips (live-number ability/item tooltips)
4. swarm/training-hud
5. feat/progression (rank ladder LP, missions, mastery)
6. art/hook-visuals (ROADMAP ability audit visuals)
7. balance/champions (bot-sim win rates, data-only tuning)
8. swarm/mech-vision
9. swarm/a11y
10. feat/aram (Nebelbruecke mode)
11. swarm/champ-bloodmage, swarm/champ-sandworm
12. perf/sim-tick

Every agent prompt: first /caveman:caveman + /ponytail:ponytail, docs/agents/swarm-rules.md, noreply email, small pushed commits,
kill headless Edge + vite servers + sandbox tabs, delete node_modules junction.
After integrate/next-level lands: brain gates (CS/min, kills, harass; higher rank must win clearly).
