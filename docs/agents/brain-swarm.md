# Brain swarm (user 23 Oct: "das Gehirn ist immer noch Arsch" - 5 Sonnet agents join the bot brain)

Style rules for everyone: CAVEMAN (terse reports, exact numbers) + PONYTAIL (read first, reuse, shortest diff that
fully solves, no unrequested abstractions, `ponytail:` comment on deliberate shortcuts, one runnable check).

## Read first

docs/BRAIN-REWORK.md (binding spec, gates in §1/§11), docs/BRAIN-IST.md (old state), docs/agents/a1.md, a2.md, a3.md
(latest measurements and open items), docs/agents/plan-api.md, docs/agents/swarm-rules.md (resource rules), and
docs/BRAIN-LIVE.md (living log kept by `brain-doc`, read it before every work block).

## Current numbers (Gold, new brain = settings switch "Neues Bot-Gehirn" / `--brain=new`)

Laner CS/min@15 ~3.2 (gate 6.0), absence CS loss ~34 % (<= 15 %), recalls per laner ~5.4 per 15 min (LoL ~2-3;
mostly low HP), kills/game 13-16 (45-55), harass autos per laner by 14:00 12-14 (>= 40), first tower ~16-17 min or none
(<= 15), timing_miss ~8 % of lane minions. Laner damage taken: champions 57 %, caster minions 21 %, tower 7 %.

## Assignments (one branch each, from origin/main: `git fetch origin && git checkout -b brain/s-<area> origin/main`)

| Agent slug (old) | Area | Goal | Main files |
|---|---|---|---|
| voice-lines -> `brain-doc` | Documentation + measurement owner | keep docs/BRAIN-LIVE.md current: architecture map (who calls what), every agent's change with before/after numbers, open problems ranked by CS/kills impact, experiment log; run the shared baseline bot-sim after each merge; no gameplay code | docs/BRAIN-LIVE.md, tools/scratch |
| tutorial -> `brain-lane` | Lane presence + harass | laners meet on auto reach, harass budget used (>= 40 autos by 14:00) without more deaths; trading stance, stand point vs wave contact | src/ai/reflex/**, src/ai/bot/laning.ts |
| gfx-settings -> `brain-hp` | HP economy / absence | fewer low-HP trips: lose fewer trades (exchange estimate before trading), potions/regen use, farm under own tower at mid HP instead of walking home, back off at the right time | src/ai/bot/trade.ts, src/ai/exchange.ts, src/ai/bot/brain.ts retreat, src/ai/utility/value.ts recall/heal values |
| keybinds -> `brain-lasthit` | Last-hit execution | timing_miss + window_collision down (lasthit prediction, plan timing, pre-hit), lane-alone CS stays >= gate | src/ai/bot/lasthit.ts, src/ai/reflex/reflex.ts scheduler parts |
| scoreboard-bots -> `brain-fights` | Kills, skirmish, objectives | kills 45-55/game, first tower <= 15 min, conversion after won fights, ganks that arrive | src/ai/bot/teamfight.ts, teamai.ts, combat.ts, src/ai/ganks/**, src/ai/roams/**, src/ai/bot/macro.ts |

Overlap (reflex.ts: lane vs lasthit; brain.ts) - small commits, `git merge origin/main` often, announce file edits in
docs/BRAIN-LIVE.md "In Arbeit". The lead merges to main and also works on the brain (recall trips).

## Rules

- Every behaviour change only with the new brain on (botReflex/botUtility); the default game stays bit-identical (state
  hash seed 1 Gold 4 min vs main) - check before each push.
- Measure with `npm run bot-sim -- --brain=new --rank=gold --games=4 --minutes=15 --jobs=2 --variance=0` (max one run
  at a time per agent, background), compare with the same seeds before/after, write numbers into your report and
  BRAIN-LIVE.md. Values in src/data/bots/values.json or profiles, not in code. Every decision logged.
- Fog: no omniscience (tests/bots.test.ts, botPerception.test.ts green). Determinism tests green.
- Report: docs/agents/brain-<area>.md; final message terse.
