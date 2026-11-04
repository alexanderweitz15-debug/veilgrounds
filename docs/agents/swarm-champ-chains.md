# swarm/champ-chains: chain-shadow assassin (jungle) - WIP checkpoint

Branch `swarm/champ-chains` (from origin/main 23c7f08). Agent stopped by the coordinator (5-agent limit) after research only.
NO code written yet. Nothing tested. No browser/server was started. node_modules junction deleted.

## Research done (so the next agent can start writing at once)

Registries to touch (pattern = `fenna` for kit-in-kits.ts, `vargrim` for trainer pools):
- `src/data/champions/<id>.json` (+ optional `<id>.values.json` like fenna.values.json) and import + entry in `src/data/champions/index.ts`.
- `src/sim/champions/<id>.ts` + import and `CHAMPION_HOOKS` entry in `src/sim/champions/index.ts`.
- `src/data/builds/<id>.json` (template `ad_assassin`, like kaelen) + import and BUILDS entry in `src/ai/bot/builds.ts`.
- `src/data/runePresets.json`: vargrim is the LAST block (LF, UTF-8 BOM, mojibake text): copy that block with a node text script, rename, change keystone/minor.
- `src/data/voiceLines.json` (keys pick, move1, move2, attack, ability, kill, death, recall; de+en) and `voiceLines` inside the champion json (pick, firstBlood, kill, death, recall, taunt).
- `src/render/abilityMotifs.json` champions row: 4 distinct motifs, e.g. `["hook",30],["chain",210],["dagger",...],["sword"/"claw"...]` (check tests/abilityMotifs.test.ts, glyph list is in the file).
- `src/render/champions/motion.ts`: `MS` table (value == base.ms) and `SPECS` entry with a UNIQUE gait json, idle json and unique drag/asym/impact triple (tests/motion.test.ts).
- `src/render/champions/casts.ts` `CAST_FAMILIES`: two different styles, both used; `self` abilities (W, E) must be in a self family (stomp/raise/ring/spin/slam). Plan: `F('lunge','spin','abba')` (Q thrown, W/E spin, R lunge).
- `src/render/champions/kits.ts`: `kit({...})` + props imported from a new `src/render/champions/chains.ts` (pattern: fenna.ts props; helpers in props.ts/props2.ts: `st.add`, `st.pts2`, `p.rope`, `p.line`, `ribbon`, `donut`, `aimW`, `madd`). Outfit supports `hood` (non-dark), `cape`, `pauldrons`. Props idea: `chainMantle` (chain loops across the shoulders/back, sway), `wristManacles` (cuffs + dangling links), `hookBlade` (hook-dagger on chain, extends on attack). tests/fennaKit.test.ts checks every champion has a kit.
- `src/sim/trainer/scenarios.ts`: add id to `JG` list (line ~71).
- Item: `src/data/items.json` (append), `src/data/itemIcons.json` (glyph must exist in src/ui/icons.ts ITEM_GLYPHS, e.g. `chainBall`/`doubleAxe`), hook in `src/sim/items/itemHooks.ts` (`ITEM_HOOKS`), add to bot build. Gold efficiency must be 85-115 % (`src/ui/goldEfficiency.ts`).
- Docs: `docs/champion-hooks.md`, roster in `docs/spec-champions.md`, `docs/agents/shared-changes.md` (heading with slug).
- Tests: `tests/championData.test.ts` hard-codes a list at line 11 (check; must count data, do not hard-code new total).

## Design decided (id `kerrin`, "Kerrin Fesselschatten", title de "die Kettenschattin" / en "the Chain Shade", jungle, archetype `chain_assassin`, melee, mana)
- Base (vs kaelen/vessa): hp 625/+104, mana 300/+36, ad 63/+3.3, armor 32/+4.3, mr 32/+2.05, as 0.67/+2.4, range 150, ms 345, windup 0.2, radius 65.
- Passive `kerrin_mal` "Kettenmal": ability hits on champions add a mark (max 3, 6 s, refresh); +4 % damage per mark from her (`modifyDamage`).
- Q "Hakenwurf" skillshot_line 900, w70, speed 1900, flag blocked_by_minions, cd 12..8: damage 60..200 (+0.7 bonusAd). Hit unit (champion/minion/monster) -> she leaps to it (`leapTo(sim,e,e,x,y,ticks)` from systems/abilities, lands at `landingPoint` beside it), champion hit adds a mark. Wall hook: in passive `onCast` slot 0 find her fresh projectile (`projectileSource(sim,e).slot===0`, `Proj.src`, `Proj.travelled==0`), ray-march `walkable(sim.map.nav,..)` along `Proj.dx/dy` in 20-unit steps, set `Proj.maxDist` to the first wall distance and remember the anchor in hook state; on hook phase `'expire'` leap over the wall to the first walkable point within 450 beyond it (else to the wall). Skip the leap when rooted.
- W "Kettenwirbel" self AoE r350 (castTime 0.2, movesWhileCasting false), cd 9..7: damage 50..170 (+0.6 bonusAd), slow 30 % 1.5 s, hook adds marks to champions hit (camp clear).
- E "Schattenfessel" `kerrin_e_next_auto` (castTime 0, movesWhileCasting true, duration 4, cd 14..10): self ms +25 % 2 s; empowered auto: damage 30..130 (+0.5 bonusAd) phys, root 0.6..1.0 s, +1 mark (see vargrim_e_next_auto for the phase pattern).
- R "Henkersketten" targeted 650, castTime 0.25, flags ['mobility'], cd 90/75/60: lunge to target, damage 120/200/280 (+0.9 bonusAd), then hook: if target has 3 marks and HP after the damage <= 18/24/30 % of max HP -> `dealDamage(sim,e,t,hp+shield+1,'true',{raw:true})` (execute); marks cleared either way. Thresholds in `kerrin.values.json`.
- Execute line on the enemy HP bar: add optional `exec?: number` (fraction of max HP) to `UnitMark` (src/sim/champions/hooks.ts) and `SnapMark` (src/sim/snapshot.ts, pass through at snapshot.ts ~line 616), draw a vertical line at `x + bw*exec*maxHp/total` in `src/ui/overlay.ts` (next to the `drawMarks` call, ~line 393); bright when n==max, dim otherwise; only when her R rank >= 1 (`champAbil(sim,eid).ranks[3]`). Marks go out via the hook `visuals()` (`marks: [{target,id:'kerrin_mal',n,max:3,left,exec}]`, read-only, use `peekState`). Optional visuals: `VisualObject` line with `follow` for the chain during a leap (tag `kerrin_chain`).
- Item: `fesselklinge` "Fesselklinge" / "Fetterblade", legendary, from klingenbrecher + kaltstahl, ~3000 G, stats ad 50, lethality 15, haste 15 (tune with goldEfficiency to 90-105 %), passive hook `fetter_blade` "Fesselbiss": +12 % damage to champions that are slowed, rooted, stunned or airborne (`modifyDamage` + `hasBuff`). Build: starter jaegerzahn, boots stiefel_hast, core fesselklinge, scharfrichterbeil, blutkrone, wallherz (vsAD wallherz earlier, vsAP sturmgewand).
- Tests to write: `tests/kerrin.test.ts` (use `tests/combat-helpers.ts` + `tests/itemHelpers.ts` `duel()`; for the wall hook block cells with `blockTerrain(sim, wallCells(...), ticks)` from src/sim/summons.ts since the sandbox spot has no walls): missingHooks, Q enemy hook, Q wall hook, marks stack/expire, +4 %/mark, W marks + slow, E root + mark, R execute below / no execute above / no execute without 3 marks, execute line value in snapshot marks, item passive + gold efficiency, jungle clear-time sanity (clear a camp from tests/jungle.test.ts helpers vs vessa/kaelen, must be within ~1.5x). Also run: championData, motion, casts, abilityMotifs, i18n, voiceLines, fennaKit (kit exists), validate.
- Do NOT edit championSprites.ts, sheets.ts, atlas.ts, particles, audio, game.ts beyond one-line registry additions. One sandbox screenshot at the end, close tab/server/headless Edge. Delete node_modules junction (`(Get-Item <wt>\node_modules).Delete()`).

## Rules reminder
Commits with `git -c user.email=224588801+alexanderweitz15-debug@users.noreply.github.com commit`, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, push `git push -u origin swarm/champ-chains`. Tests <= 2 min each, only touched files.
