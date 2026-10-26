# swarm/jungle-timers

Client-only jungle tracking. No sim changes.

## Built
- `src/game/jungleTracker.ts`: `JungleTracker` (14 camps: 6 per side + 2 river scuttlers; epics stay with `ObjectiveTracker`), `campLabel`, `inVision`, `campSites`.
- `src/ui/jungleTrackerPanel.ts` + `jungleTracker.css`: "Jungle-Tracker" panel (own side / enemy side / river), toggle button above the minimap, "show estimate" checkbox.
- Minimap timer layer (`minimap.ts`), world-space labels at the camps (`overlay.ts`), i18n `jungle.*`.
- Wiring: `ClientState.jungle`, `Hud` (see shared-changes.md).

## Rules (fog-safe)
Input is only the team snapshot; `snapshot.teamEvents` already drops camp kills in the fog (only kills in vision or by an own champion arrive) and monsters outside vision are not in `entities`.
- cleared: all members seen dying, or at least one death with the camp centre in own vision and no member left -> exact timer `death tick + CAMPS[id].respawn` (matches the sim `spawnAt`, checked in a sim test).
- empty: camp centre in vision (conservative: 300 inside the vision circle, radii as in `render/fog.ts`), no monster, no kill seen -> only an upper bound `now + respawn`, shown `~m:ss`.
- up: monsters seen alive (last known state, age shown in the panel). unknown: `?` (never seen, or timer ran out unseen).
- pending: countdown to the first spawn from `CAMPS[id].first` (public schedule, like the match clock).
- estimate (option, default off, localStorage): enemy jungler (`PlayerSetup.role === 'jungle'`) seen within 1500 of a camp out of vision -> `~m:ss?` in orange, assumes 25 s clear time + respawn. Never overrides an observation; any later sighting of the monsters removes it.

## Decisions
- A visible death whose last member was chased out of sight counts as cleared if the camp centre is in vision (3 s grace after the last death).
- Tracker only enabled for mode 'classic'.
- Panel state and estimate option in localStorage, not settings.ts (no shared registry edit); no hotkey.

## Tests
`npx vitest run tests/jungleTracker.test.ts` (11 tests): first spawn, full clear, partial clear without vision, fog case (no timer), empty bound, scuttlers, estimate, real-sim timing + fog kill.

## Open
- No browser check (rules). Panel layout above the minimap unverified visually.
- Next from swarm-champions.md: sand worm (jungle) champion.
