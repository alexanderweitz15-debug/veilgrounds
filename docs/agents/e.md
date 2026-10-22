# Agent E - Sev Aschenblick (status)

Branch: `champ/e-sev`. Spec: `docs/champions/sev.md` (Fassung 3 on top, Fassung 2 kept below it).

## History
- Itachi (first prompt) -> dropped before code. Fassung 2 ("das Auge, das brennt und täuscht") shipped to main
  (fear CC, uncleansable, decoy with fake HP bar). User feedback: "zu langweilig, sieht nicht aus wie Itachi" ->
  Fassung 3 (Itachi-inspired, R choice). Then: "Itachi braucht eine bessere AoE-Ability" -> bigger Q/W AoE.
- Fassung 2 balance (archived): 8 gold + 6 platinum bot games, Sev dealt about as much damage to champions as the
  enemy mid (gold avg 3132 vs 3005, platinum 2627 vs 3216); the ember jump fired ~1/game for ~100-130 burn ->
  jump was kept. Fassung 2 also added: Sev rows in docs/ability-cast-audit.md, Sev in the trainer MID/JG pools
  (fallback), encyclopedia screenshots (docs/ist/e-sev-encyclopedia*.jpg), a fizzle sound for fake casts.

## Fassung 3 - done
| Commit | What |
|---|---|
| ba18be0 | spec Fassung 3 |
| d089dc0 | kit + R choice engine + client lookups + choice cards (`src/ui/ultChoice.ts`) + tests |
| f71b883 | new look (long black hair, low ponytail, front strands, red three-blade eyes, tear troughs, crimson-lined high-collar cloak, crow-feather marks, three-ring necklace, crows circling + a crow over the palm), per-ability ground FX (`src/render/sevFx.ts`), Tsukuyomi red-black screen tint |
| e93f32c | stronger AoE (user feedback): Q explosion radius 300 + 2 s burning ground with a flame ring, W crow storm radius 350 |
| 97831b2 | docs: champion-hooks (Sev section, 110 hooks), roster entry, shared-changes, bot rules (issues.md) |
| (merges) | origin/main 9ed4070 and 660c54e merged without conflicts |

### Kit (numbers in `src/data/champions/sev.json`)
- Passive Rabenblick: Gaze stacks (3 max, 6 s) from ability hits on champions; at 3: 0.75 s genjutsu stun, 12 s per target.
- Q Feuerball: 0.4 s wind-up, line 900 (width 90, speed 1300), explodes on first unit or at max range, radius 300
  80/125/170/215/260 (+70 % AP), burning ground 2 s 25/40/55/70/85 (+15 % AP)/s; fake recast (refund, 2 s CD).
- W Krähendoppel: blink 400, castable while rooted (`root_ok`), crow clone with fake HP bar at the start, enemy homing
  projectiles switch to it; bursts after 1.5 s or when hit: radius 350, 70/110/150/190/230 (+60 % AP), 35 % slow 1.5 s.
- E Bannblick: targeted 650, 0.4 s eye contact (gaze line telegraph): stun 1.25 s if the target faces Sev, else 40 % slow.
- R: choice at the first point (cards above the ability bar, keys 1/2/3; permanent; bots: `botUltChoice` [4,3,3]):
  Amaterasu (5 s uncleansable black flames 40/60/80 +12 % AP +1.5 % target max HP per s, grievous, jump once 400),
  Susanoo (6 s shield 250/400/550 +80 % AP, slow immunity, sweeping autos, one 1000-long sword thrust),
  Tsukuyomi (500, 1.5 s suppression, Sev rooted, 150/225/300 +50 % AP +25 % missing HP, red-black tint).

### Tests
- `tests/sev.test.ts` (15): hooks, passive genjutsu + cooldown, Q hit/expire explosions + burning ground, Q fake,
  W blink while rooted / not stunned + clone look, burst on timer and on hit, projectile substitution, E facing rule,
  R choice permanence + not castable before, bot pick deterministic and weighted, Amaterasu (uncleansable, jump once),
  Susanoo (shield, slow immunity, sweep, single thrust), Tsukuyomi (suppress, root, tint mark, missing-HP scaling),
  determinism for each ult.
- Touched suites green: championData, abilityMotifs, botParams, items, telegraph (smoke test needs a quiet CPU: 5 s
  timeout on the dynamic import), combos, replay, sideMirror, snapshot, castMovement, summonersWards, i18n,
  abilityVisuals, aimPreview, abilities, scenarios, spriteTiming. tsc clean.

### Screenshots (dev server, 1280x720, docs/ist/)
e-sev3-choice-cards, e-sev3-idle, e-sev3-q-windup, e-sev3-q-fire (300 flame ring), e-sev3-e-gaze, e-sev3-w-clone,
e-sev3-w-burst, e-sev3-r-amaterasu, e-sev3-r-susanoo, e-sev3-r-susanoo-thrust, e-sev3-r-tsukuyomi.

## Open items
1. Balance vs other mids: `tools/balance.ts` does not exist in the repo; numbers come from bot games
   (`npx tsx tools/scratch/sevCasts.ts <games> <min> <rank> <seed>`). See the balance section below.
2. Brain team (A2): ult choice, Q fakes, look-away vs E, clone rules, Amaterasu in ExchangeEstimate, Tsukuyomi
   timing (docs/agents/issues.md, 2026-10-22 entry). `BUILDS.sev` is in src/ai/bot/builds.ts now.
3. The fear CC from Fassung 2 stays in the engine (unused by Sev now; documented in buffs.ts) - B may keep or drop it.
4. Passive icon: chosen by keyword rules (flame); a table entry for passives would let it show an eye.
5. Final screenshots from a `vite build` + preview run (dev-server shots are the same code).

## Shared-file edits
`docs/agents/shared-changes.md`: 2026-10-19 (Fassung 2) and 2026-10-22 (Fassung 3) E entries with commits.
