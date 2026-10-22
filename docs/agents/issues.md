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

Fixed by B on sim/b-mechanics (2026-10-19): `useItem` emits `{ e: 'castFail', src, slot, reason, item: true }`
(reason cooldown / cc / target; slot = inventory slot).

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
## 2026-10-19 · B · bots never use the top laner's unlocked Teleport (B4) · medium · brain team (A2 macro)

Sim side done (sim/b-mechanics): after 1500 lane-minion gold the lobby top laner gets Teleport as summoner slot 2
(`PlayerHud.abilities[6]`, id 'teleport'; command `{ t: 'spell', slot: 2, x, y }` onto an own tower, or minion/ward
after 10:00; event `tpUnlocked` to the own team). Bots only look at abilities[4] / [5] (brain.ts, laning.ts). Wanted
(AGENTS-PLAN B4): lane return after a recall, and bot-lane fights once ahead in gold.

## 2026-10-22 · E · src/ai · Sev Fassung 3 bot rules (replaces the Fassung 2 list above) · brain team (A2)

1. R choice: send `{ t: 'ultChoice', choice }` when R is learned (or before); without it the sim picks from
   `botUltChoice` [4,3,3] deterministically. Suggestion: Amaterasu vs tanks/healers, Susanoo when behind/brawling,
   Tsukuyomi vs squishy carries.
2. Q fakes from Platin against recognised dodge patterns (recast Q within its 0.4 s wind-up).
3. E Bannblick: cast when the target faces Sev; enemy bots should turn away (move command away from Sev) during the
   0.4 s eye contact (gaze line object `sev_e_gaze`, cast event slot 2) - look-away counterplay.
4. W: use as escape (also while rooted) and as bait: the clone (pet tag `sev_decoy`, snapshot `look: 'sev'`) bursts
   when hit; from Gold, enemy bots should not waste abilities on it (below Gold 40 %).
5. Amaterasu (dot `sev_r1`, uncleansable, grievous): count the burn in `ExchangeEstimate`, no panic recall.
6. Tsukuyomi: the Sev bot is rooted 1.5 s while suppressing; only cast with allies near or on a low target
   (missing-health scaling).
7. Combos: E→Q→AA, Q→W→E, E→R→Q→AA. Gaze stacks (marks `sev_blick` n/3) at 2 -> next ability hit stuns.
