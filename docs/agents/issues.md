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
