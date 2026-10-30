# swarm/champ-bloodmage: Rovena Aderlass (blood mage, mid) - WIP checkpoint

Branch `swarm/champ-bloodmage` from origin/main 23c7f08. Agent stopped by the coordinator after the research phase.
**No code written yet.** Only this plan exists. No browser, vite server or node_modules junction was started.

## Research findings (so the next agent does not redo them)
- Wiring reference = commits 2404039 (fenna: data, hooks, builds, runePresets, abilityMotifs, tests) and 4e8a58a (fenna kit:
  src/render/champions/fenna.ts props, kits.ts `kit({...})`, motion.ts, casts.ts, fennaFx.ts, groundObjects.ts, item).
  `git show --stat <sha>` lists every file. Registries to touch (one line each): src/data/champions/index.ts,
  src/sim/champions/index.ts, src/ai/bot/builds.ts, src/render/champions/{kits,motion,casts}.ts (MS table + SPECS),
  src/render/abilityMotifs.json, src/data/runePresets.json, src/data/voiceLines.json, src/data/itemIcons.json,
  trainer pools (src/sim/trainer/scenarios.ts; vargrim appears there), docs/champion-hooks.md, docs/spec-champions.md,
  docs/agents/shared-changes.md. Do NOT touch championSprites.ts, sheets.ts, atlas.ts, particles.ts, fx.ts, audio, game.ts.
- `costType: "hp"` exists: abilities.ts pays `Hp.cur -= cost` at cast start, refunds on cancel, rejects the cast when
  `Hp.cur <= cost` (returns 'mana'). Bot `ready()` (src/ai/bot/combat.ts:26) already requires `hp > cost*2`.
  Validator (src/data/champions/validate.ts): `resource: "none"` needs `base.mana: 0`; `costType: none` needs cost 0.
  Renn is the only `resource: none` champion (copy his base block shape). Tooltip shows "HP" for hp costs.
- No engine hook gives "damage dealt" to the source. Plan: passive `modifyDamage` (non-auto only) heals via `healUnit`
  using `amount * mitigation(effectiveResist(sim, eid, target, type))` (exported from src/sim/damage.ts) as the estimate;
  mark it with a `ponytail:` comment. `modifyCast` may add `0.03 * maxHp` to the HP cost for slots 0..2 so the cost scales.
- `zone` abilities re-apply their generic effects every 1 s (4 resolutions for duration 3), so W needs no tick hook.
  `self` + `delay` makes a follow zone that resolves once (good for the R pulse). `ctx.dmgMult` set by a hook listed before
  the damage effect scales that damage (thessaly_r_execute_bonus). Marks: `{kind:'mark'}` effect + `hasBuff(sim,t,'mark',id)`.
- Tests that constrain the new kit: tests/motion.test.ts (MS table matches data; unique gait JSON, unique idle JSON,
  unique drag/asym/impact triple, cadence rule), tests/casts.test.ts (two different styles, both used; `self` abilities
  must use a SELF style: stomp/raise/ring/spin/slam), abilityMotifs.test.ts (4 distinct motifs), championData.test.ts
  and items/telegraph/botParams tests count the data (use `>=`, never hard-code a total).

## Design (decided, numbers are first guesses)
**Rovena Aderlass, "die Aderlasserin" / "the Bloodletter"**, id `rovena`, roles ["mid"], archetype `blood_mage`,
ranged 525, resource none (mana 0), hp 650 +108/lvl, regen 7, armor 24, mr 30, ms 335, projectile 1600, radius 65.
Tunables go in `src/data/champions/rovena.values.json` (like fenna.values.json): healChamp 0.25, healOther 0.10,
rushHpFrac 0.35, rushDmgMult 1.2, rushHealMult 1.5, rDrainMult 2.0, hpCostMaxHpFrac 0.03.
- Passive **Blutzoll / Bloodtithe** (`rovena_bloodtithe`): ability damage heals her for 25 % (champions) / 10 % (others).
  **Blutrausch / Bloodrush** below 35 % max HP: ability damage x1.2, heal-back x1.5. HUD badge `ready` while active,
  `visuals().aura = 4`.
- Q **Aderschnitt / Vein Cut**: skillshot_line 925, w70, speed 1800, cd 7-5, cost HP 35..55, magic 75..235 +0.6 AP,
  applies mark `rovena_blood` 4 s.
- W **Blutlache / Bloodpool**: zone r300 at 700, 3 s (4 ticks), cd 14-10, cost HP 50..90, per tick 18..58 +0.15 AP,
  slow 30 % 1.1 s.
- E **Blutfessel / Blood Shackle**: targeted 650, cd 16-12, cost HP 60..100, magic 60..200 +0.45 AP, slow 40 % 1.5 s.
  Hook `rovena_e_detonate` listed before the damage: target with `rovena_blood` mark takes x1.4 and is rooted 0.75 s
  (mark consumed).
- R **Blutflut / Bloodtide**: type `self`, radius 650, castTime 0.25, delay 0.35, cd 110/95/80, costType none cost 0,
  magic 150/225/300 +0.55 AP to all enemies in range, slow 30 % 1.5 s. Hook `rovena_r_drain` (listed first) sets
  `drainTick = sim.tick` so modifyDamage doubles the heal-back for that resolution ("drains blood from all nearby enemies").
- Render: kit via `kit({...})` in kits.ts with a new props file src/render/champions/rovena.ts: `thornCrown` (halo of 6
  curved bone thorns around the head = the 64 px silhouette), `bloodOrbs` (3 orbiting blood orbs, pulse on cast),
  `drips` (blood drops falling from the right hand); `cape` tattered crimson; female body like Fenna but H ~186, dark robe,
  crimson lining, hold `relaxed` or `blade` + `heldBlade` (small ritual curved knife), attack `flick` or `throw`.
  Motion: `rovena: G('stalk', 20, 8, 1.6, 0.16, 1.8, 0.03, 0.2, 0.6, {headBob:0.02, sway:1.05, drag:0.42, asym:0.04, impact:0.8})`,
  idle `I('sway', 1.0, 1.9, 0.05, {hands:1.8, sway:0.24, fps:2.9})`, MS 335. Casts `F('point','raise','abab')`.
  abilityMotifs row needs 4 distinct motifs (e.g. blade/ring/chain/moon-like; check the allowed list in the json).
- Ability visuals: optional `rovenaFx.ts` + 5 lines in groundObjects.ts (blood pool, drain ring) as fennaFx did.
- Bot: build file src/data/builds/rovena.json + BUILDS line; bot rule: do not cast hp-cost poke below ~35 % HP unless the
  target dies or the ability is R (see how sev/vargrim rules sit in src/ai/bot/combat.ts and docs/spec-bots.md).
- Items (existing ItemStat fields only; check src/data/items.json + docs/IDEAS-FEEL-SHOP.md for duplicates):
  legendary `blutkelch` / Bloodchalice (AP + max HP, passive: ability damage heals 10 % extra, doubled below 40 % HP)
  and optional component `aderglas` / Veinglass. German + English names, icon rows in src/data/itemIcons.json, price by
  gold efficiency (test: tests/goldEfficiency.test.ts), add to the bot build, passive test via the item hook system
  (src/sim/items/itemHooks.ts; fenna's `dusk_band` is the model).
- Tests to write: tests/rovena.test.ts (every ability resolves, HP cost paid and refunded on cancel, cast rejected at low
  HP, heal-back on ability hit but not on auto, Blutrausch bonus, E detonate root, R drain), `tests/rovenaKit.test.ts`
  (kit exists with props/animations, item price + passive). Run only touched tests plus championData, motion, casts,
  abilityMotifs, i18n, voiceLines, itemIcons, items, goldEfficiency; then `npx tsc --noEmit` once.
- Finish: one sandbox screenshot (close tab + vite server at once), delete node_modules junction
  (`(Get-Item <worktree>\node_modules).Delete()`), commit + push with the noreply email.

## Status
Done: research + design above. Not done: everything else.
