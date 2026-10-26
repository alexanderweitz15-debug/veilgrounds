# brain-lasthit report

Branch `brain/s-lasthit` (from origin/main). Stopped by lead before any code change.

- Done: read BRAIN-REWORK, a1.md, a1-handoff.md, src/ai/reflex/reflex.ts. No code or data changed, no runs.
- Baseline (a1.md, Gold new brain, 4 x 14 min): lane minions to 15:00 timing_miss 7.8 %, in_range_no_attack 6.0 %,
  window_collision small, last-hit by laner 28.5 %. Lane alone Gold 95.7, Iron 79.7, Challenger 101.3 CS / 10 min.
- Open: timing_miss + window_collision in 5v5 not worked on.
- Next 1: measure which timing_miss cases are bias (lastHitJitterMs, rolled once per plan in reflex.ts step 2) vs
  prediction error (predictWindows in lasthit.ts) vs attention (distracted cancels due plans).
- Next 2: check `margin()` / AIM_MAX = 4 and the `bias` clip for 5v5 only (stacked hits, tower shots); keep lane-alone
  Gold/Iron/Challenger inside a1.md gates (88 / 70 / 100).
- Separate branch `swarm/keybinds` (c2261f7) holds the finished keybind editor; report docs/agents/swarm-keybinds.md.
