# Swarm rules (20 Sonnet feature agents, 2026-10-23)

You are one of 20 parallel Sonnet feature agents of Veilgrounds (browser 5v5 MOBA vs bots, LoL-like training game;
German UI, English code; TypeScript strict, Vite, Vitest, Three.js render with painted 2D sprites, deterministic 30 Hz
sim in a worker). Five more agents run at the same time: F (champion animations, src/render/champions/**,
championSprites.ts), G (shop/items/runes + feel fixes), S1 (profile, allchat, surrender, death recap), S2 (replay
browser, bot error list), S3 (load time, telegraph setting). Read docs/agents/orchestration.md and, for your area,
the relevant docs (docs/spec-champions.md, docs/FEATURE-GAP.md, docs/IDEAS-FEEL-SHOP.md, docs/DECISIONS.md).

## The machine is shared - resource rules (the user complained about RAM)

- 25 agents share 8 CPU cores and 32 GB RAM. Be frugal:
  - Run only the test files you touched: `npx vitest run tests/<file>`. Never the full suite (the lead runs it).
  - `npx tsc --noEmit` at most a few times (it takes ~1 GB); run it before each push, not after every edit.
  - No `npm run bot-sim`, no `npx vite build`, no `vite preview`, no browser - unless your task says so explicitly.
    If your task needs screenshots, take them once at the end, then close the tab and stop the server immediately
    (a game left running in a tab spawns minions forever).
- Every tool call must finish in under ~3 minutes; anything longer goes to run_in_background.

## Git and files

- Work only in your worktree. First command: `git checkout -b swarm/<your-slug>` (slug given in your task).
- Commits: `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com commit`, message ends with a
  blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Push after every commit:
  `git push -u origin swarm/<your-slug>`. Never push to main; the lead merges.
- node_modules: create a junction once (PowerShell
  `New-Item -ItemType Junction -Path <worktree>\node_modules -Target C:\Users\Alex\Documents\Moba\node_modules`) and
  delete it before you finish with `(Get-Item <worktree>\node_modules).Delete()` - never Remove-Item -Recurse on it.
- Stay inside the files your task lists. Shared registries (champion index files, i18n de/en.json, settings.ts,
  main.ts menu hooks, snapshot types) only additively - a few lines - and list every such edit in
  docs/agents/shared-changes.md under a heading with your slug.
- Use Edit/Write for code (shell heredocs eat backslashes; many files are CRLF).
- Determinism: sim code uses only the seeded rng; replay/determinism tests stay green.
- Values and texts in JSON / i18n (de + en, same keys - a test checks it), not in code.

## Report

- docs/agents/swarm-<slug>.md: what you built, files, tests run (with results), open items, decisions you made.
  Commit + push it at the end.
- Final message to the lead: 5-10 lines, English: done / not done, branch head commit, tests, anything the lead must
  decide or merge carefully.
