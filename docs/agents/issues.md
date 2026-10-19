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

## 2026-10-19 · B · bots never use the top laner's unlocked Teleport (B4) · medium · brain team (A2 macro)

Sim side done (sim/b-mechanics): after 1500 lane-minion gold the lobby top laner gets Teleport as summoner slot 2
(`PlayerHud.abilities[6]`, id 'teleport'; command `{ t: 'spell', slot: 2, x, y }` onto an own tower, or minion/ward
after 10:00; event `tpUnlocked` to the own team). Bots only look at abilities[4] / [5] (brain.ts, laning.ts). Wanted
(AGENTS-PLAN B4): lane return after a recall, and bot-lane fights once ahead in gold.
