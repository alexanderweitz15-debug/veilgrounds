# swarm-mech-cc (queue item 11) - partial, wrapped up on lead request

## Audit src/sim/buffs.ts vs LoL
Already LoL-like: tenacity shortens all CC except airborne/suppress (stasis not CC); separate sources run in parallel (own buff each), `ccState.until` = longest; only strongest slow applies (`strongestSlow`); stun/airborne/suppress/stasis block move+attack+cast, fear blocks attack+cast+move-away, silence only casts, root only moves; `channelBroken` ends channels on root/fear/stun/airborne/suppress/stasis/silence; Reinigen cleanses slow/blind/root/silence/stun, never airborne/suppress/stasis, not `uncleansable` buffs (Sev Amaterasu); unstoppable ignores CC except suppress; structures immune.

## Fixed
- Same-source CC re-apply with shorter duration shortened the running CC -> now max(until) (buffs.ts addBuff).
- CC duration bar over heads only for own champion -> now every unit with CC (overlay.ts drawCc).

## Tests
tests/mechCc.test.ts (5, seeded): tenacity vs airborne, parallel/longest + no shortening, strongest slow, state flags, Reinigen vs stun/airborne. Pass (2.3 s run).

## Open (not done)
- Reinigen does not cleanse fear (and is blocked while feared); LoL allows both. Needs decision.
- No QSS-like item exists, so "airborne cleansable only by QSS" has no source yet.
- Dash/leap interruption by CC: abilities.ts blocks new casts; running dashes use airborne self-buff (displace API) - not verified that stun mid-dash stops an ability dash.
- Distinct sprite animation states per CC (stun/fear/root/silence/taunt/suppress) and taunt kind: not done; only airborne lift + glyphs exist (render/units.ts, ccGlyphs.ts). Taunt CC kind does not exist in sim.
- tsc clean. tests/replay.test.ts: vitest worker crashed ("Worker exited unexpectedly", environment, not an assertion) - lead must run determinism suite.
