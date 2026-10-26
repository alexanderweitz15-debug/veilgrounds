# Agent S1 handoff

- Branch `ui/s1-features` (origin). Done: 4.8. Next: 2.8 all chat, 2.10 surrender, 1.14 death recap ghost line.
- Screenshot tooling: scratchpad `s1/shot.mjs` (copy of c8/shot.mjs, CDP over headless Edge). Use own preview ports
  (4411+); 4391 may be taken by another agent's preview (strictPort failure is silent when started in background).
