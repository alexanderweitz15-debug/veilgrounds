# Agent E - new champion Sev Aschenblick (status)

Branch: `champ/e-sev` (on main e0f40bb). Spec (user, verbatim): `docs/champions/sev.md`.
History: started as "Itachi"; the user replaced it with Sev (Fassung 2) before any code existed. No Itachi files,
names or branches remain.

## Done (commits on champ/e-sev)
| Commit | What |
|---|---|
| c310e23 | spec `docs/champions/sev.md` |
| 068d755 | `src/data/champions/sev.json`, `src/sim/champions/sev.ts`, registry lines, build `src/data/builds/sev.json`, rune presets, motif row, `tests/sev.test.ts`; sim extensions: CC `fear`, `Buff.uncleansable`, `ChampionHooks.targetOk`, `PassiveHook.onPetDamaged`, pet helpers; i18n `cc.fear`; roster counts 26 -> 27; combo harness fake step |
| bfa425b | sprite kit (`src/render/champions/sev.ts` props + kit entry + Hold `palm`); `tools/botSim.ts --champion=<id>`; `tools/scratch/sevCasts.ts` |
| 4f29a96 | decoy looks like Sev: snapshot `look`/level, champion sprite + fake champion bar |
| cc48f6c | docs: `docs/champion-hooks.md` (Sev section, 107 hooks / 26 champions), `docs/spec-champions.md` roster #27 + roles, shared-changes, bot wishes in issues.md |
| 46f0929 | `tests/sim/castMovement.test.ts`: dummy gets a Nachbild so Sev R can be cast |
| c4476d4 | overlay: black-ember / Nachbild glyphs next to the HP bar; e.md + handoff |
| 8279a7f | merge origin/main c15e402 (conflicts in buffs/damage/snapshot + docs resolved keeping both sides); champ/e-sev now contains main and fast-forwards |
| (last) | visuals: no duplicate Nachbild mark (the snapshot already lists champion-prefixed mark buffs); screenshots |

### Kit as implemented (numbers in sev.json; hook constants at the top of sev.ts)
- Passive Nachbild: every ability hit marks 3 s (`mark` buff `sev_nachbild`); autos on marked enemies +10-30 (+15 % AP)
  magic and extend his ember by 0.5 s (cap 8 s total). Enemy ability hits on his decoy mark the attacker.
- Q Glutblick: line 950, width 60, wind-up 0.4 s; recast during the wind-up = fake (refund, 2 s CD).
- W Schwarzglut: targeted 650: dot 4 s + grievous 40 %, both `uncleansable`; jumps once (300) when the target dies
  (any killer); on his own decoy: decoy lives 4 s and burns enemies within 250 for 50 %.
- E Trugbild: blink 450, decoy pet at the start for 2.5 s with Sev's HP/mana (fake bar), 0 AD autos at Sev's target.
- R Augenbann: needs a Nachbild target (otherwise the cast fails 'target'); 0.5 s wind-up = eye contact (lost sight
  cancels, refund, 2 s CD); 1.5 s fear (tenacity applies) + 50 % slow + reveal; end damage, x1.5 with ember.
- Fear CC: no attacks/casts/summoners (Reinigen too), breaks channels/recall/Teleport, unit walks away from the source
  (movement pre-pass), ccLevel 3.5 (between root 3 and stun 4), CC_BIT 256, HUD label "Verängstigt"/"Feared".

### Tests
- `tests/sev.test.ts` (16): hooks exported, Q hit + Nachbild, Q fake, W dot/grievous/uncleansable vs Reinigen, W jump
  once, W on decoy, E blink + decoy + lifetime, decoy snapshot look, decoy ability vs auto mark, passive bonus +
  ember extension, R needs Nachbild, R fear/flee/locks/ccLevel/+50 % ember, tenacity, lost sight cancels, determinism.
- Full `npx vitest run` (under heavy CPU load): 886 passed, 2 failed -> castMovement/sev fixed in 46f0929 (re-run
  green); `tests/brainReflex.test.ts` "reflex logic < 0.05 ms per bot and tick" failed on time budget (test took 239 s
  while 4+ agents shared the CPU; timing test, not related to Sev) - re-run it alone on a quiet machine.
- `npx tsc --noEmit`: clean.

### Screenshots (1280x720, `npx vite build` + `vite preview --port 5392`, headless Edge, no console errors)
`docs/ist/e-sev-lobby.jpg` (classic lobby, Sev card + ability icons), `e-sev-ingame-idle.jpg`, `e-sev-q.jpg` (Q wind-up
telegraph), `e-sev-w.jpg` (ember + Nachbild glyphs on the dummy), `e-sev-e-decoy.jpg` (Sev + decoy with fake champion
bar), `e-sev-r.jpg` (fear: ring, three phantoms, "Verängstigt"). Lobby shot is from the dev server run (same code).
Sprite close-ups were checked in the stylelab (`window.__champSheet`).

### Bot games (gold, 15 min, Sev in blue mid; tools/scratch/sevCasts.ts)
| seed | Sev casts Q/W/E/R | fear s | Sev cs / k-d / dmg to champs | enemy mid |
|---|---|---|---|---|
| 1 | 14/6/2/0 | 0 | 42 / 1-1 / 1570 | Ilvane 56 / 1-1 / 1460 |
| 2 | 16/9/7/3 | 4.4 | 35 / 4-1 / 4735 | Kaelen 35 / 1-3 / 2763 |
Bots play him without crashes and cast every ability (R only when a Nachbild is up). Bots never fake Q (no brain logic).
Official run `npm run bot-sim -- --rank=gold --games=2 --minutes=15 --champion=sev`: exit 0, same numbers (deterministic).
Build: `npx vite build` green (one earlier run under heavy load printed "error during build" without details; the
re-run on the same tree passed in 3m42s).

## Open items (exact next steps)
1. **Balance decision on the ember jump** (spec "Einwand"): 2 games are too few. Run
   `npx tsx tools/scratch/sevCasts.ts 10 20 gold` (and platinum) and compare Sev's damage to champions with the other
   mids; if Sev is clearly ahead, drop the jump (set `JUMP_RANGE` use off: remove the jump block in `tickEmbers`) or
   lower W to 16/26/36/46/56. Current proposal: keep the jump until the brain team's Sev logic exists (bots do not yet
   play around the ember either).
2. **Black-ember visual on burning units**: today the ember shows as a mark (pips/diamond over the HP bar) and the
   burning decoy as an orange disc (`sev_w_decoy`, hue 14). Wanted: black flame tongues with a copper core on the
   unit (render, agent D area: a per-mark effect in `src/render/groundObjects.ts` or `fx.ts` keyed on mark id `sev_w`).
3. **Augenbann phantoms**: drawn as three generic pins + a ring (`sev_r_phantom`, `sev_r_bann`). Better: three
   translucent Sev sprites around the target, only on the feared player's client, plus a dark vignette for him.
4. **Ability sounds**: none per champion yet (check `src/audio` for per-champion cues).
5. **Fear icon**: overlay CC chip uses the generic label; a fear glyph for `src/ui/icons.ts` would help.
6. **Bot rules / build line**: see docs/agents/issues.md (2026-10-19 E entry): `BUILDS` line in src/ai/bot/builds.ts
   (stopgap in tools/botSim.ts), Q fakes, decoy rules, ember in ExchangeEstimate, fear in escape node, R only on
   marked targets.
7. `docs/ability-cast-audit.md` rows for sev_q..sev_r (B2 audit, optional; `B2_AUDIT=1` prints them).
8. Trainer scenarios: add `'sev'` to the MID / JG pools in `src/sim/trainer/scenarios.ts` once bots handle him.
9. Encyclopedia/showcase pick Sev up automatically from CHAMPION_DATA (not checked visually).

## Shared-file edits
All listed with commits in `docs/agents/shared-changes.md` (2026-10-19 · E entry).

## DECISIONS proposals
- Fear = CcKind `fear` between root and stun (ccLevel 3.5), tenacity applies, locks every summoner incl. Reinigen,
  forced walk away from the source in the movement system.
- `Buff.uncleansable`: every cleanse must skip it (Reinigen does; Ferris/Oda only cleanse slows - Sev's R slow is
  marked uncleansable too).
- Decoy pets: tag suffix `_decoy` makes the snapshot report `look` = owner's champion; render/HUD treat it as that
  champion (sprite + champion bar + name).
- `ChampionHooks.targetOk` for champion-specific target rules (narrow or widen), `PassiveHook.onPetDamaged`.
