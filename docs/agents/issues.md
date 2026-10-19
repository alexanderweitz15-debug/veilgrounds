# Issues found outside the reporter's area

Format: date, reporter, file, repro, severity, owner.

## 2026-10-16 · C · src/render/portraits.ts · portrait crops cut heads (FEATURE-GAP 4.5) · low · D

Repro: classic lobby, role mid/support, champion tiles of Ilvane and Seraphyne (IST-ZUSTAND §2): the head is cut at
the top of the square tile. `apply()` sets `backgroundPosition = 'center'` for every champion; the crop is made in
`portraitUrl()`. Fix belongs to the portrait renderer (per-champion head anchor or a higher crop window), not to the
lobby CSS. C did not touch it.

## 2026-10-16 · C · src/main.ts · no "Nochmal" after a classic game (FEATURE-GAP 4.7) · low · S/lead

`afterGame()` passes `onRetry` to `renderPostGame` only for trainer modes. One-line change (outside C's file list):
pass `() => afterGame(config, { ...r, retry: true })` for `classic` too. `renderPostGame` already shows the button
when `onRetry` is given.

## 2026-10-16 · C · src/sim (items) · no cast-fail message for item actives (FEATURE-GAP 1.15) · low · B

The sim emits `castFail` only for abilities; item actives that fail (cooldown, no target, out of range) are silent.
The HUD already shows any `castFail` reason it receives (`hud.ts onEvent`), so an event with the same shape for item
slots is enough.

## 2026-10-19 · E · src/ai · Sev Aschenblick bot rules (spec docs/champions/sev.md) · brain team (A1-A3)

E did not touch src/ai. Wishes for the brain team:
1. `src/ai/bot/builds.ts`: add `import sev from '../../data/builds/sev.json'` + `sev` in `BUILDS` (without it Sev bots in
   real matches have no build; tools/botSim.ts registers it at runtime as a stopgap).
2. Q fakes from Platin on against recognised dodge patterns (recast Q during its 0.4 s wind-up: `sev_q_fake_cancel`).
3. From Gold, bots do not use abilities on Sev's decoy (pet tag `sev_decoy`, snapshot `look: 'sev'`); below Gold they
   do 40 % of the time. Hitting it with an ability gives the bot a Nachbild (enables Sev's R).
4. Bots with Schwarzglut (dot id `sev_w`, uncleansable, grievous 40 %) do not panic-recall; count the remaining burn
   in `ExchangeEstimate`.
5. Fear (`fear` CC, `isFeared`, ccLevel 3.5) is treated like a stun in the escape node.
6. R needs a Nachbild target (`hasNachbild` in src/sim/champions/sev.ts), else the cast fails with 'target': cast R
   only on marked champions, best after W (+50 % damage with ember). Combos: W→Q→AA, E→Q(fake)→Q→W, W→R→Q→AA.
