# swarm-mech-tower (wrapped up early on coordinator order)

Status: audit only + 1 test. No sim/data change. Not done: the LoL-difference fixes below.

## Audit: src/sim/systems/towers.ts vs LoL
Already matches LoL (existing tests in tests/towers.test.ts):
- Target priority: minions, then champions, then dummies; nearest first, ties by spawn serial.
- Switch at once to an enemy champion that hit an allied champion (victim within 1400 of tower, attacker in reach).
- Aggro drop when target leaves reach (canShoot) - new test: `drops the target when it leaves range; warming resets on a new target`.
- Warming: +40 % per consecutive champion shot, max +120 %, reset on target change.
- Damage ramp 170->320 (outer) over 20 min; plates 5 x 800 HP, 120 g, fall at 14:00 with -50 % armor.

## Open differences (not fixed)
1. Plate gold: LoL has ~160 g per plate (+ local gold); here 120 (PLATE_GOLD constant in code, not data json).
2. Fortification (early-game outer tower resist bonus) is not modelled.
3. Tower numbers are consts in towers.ts, not data json (task asked for json).
4. Tower shot readability (projectile + target line/indicator) not checked/changed; render side untouched.
5. No before/after measurement done.

## Tests
`npx vitest run tests/towers.test.ts`: 11 passed, new test passed alone. tsc not run (test-only change). No shared edits.
