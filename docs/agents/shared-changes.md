# Shared-file change proposals

Format: date, agent, file, change, reason, status (proposed / approved / merged + commit).


## 2026-10-16 · Agent B · B1 ward stealth (snapshot types, additive)

Status: proposed (on branch sim/b-mechanics). Affects: brain team (A1-A3, reads Snapshot), C (minimap), D (render).

1. `src/sim/snapshot.ts` (B, additive):
   - `SnapEntity.stealth?: true` on stealthed units (today: Schleierwards). Own team: hidden from the enemy unless
     revealed. Enemy team: the entity is in the view only because it is revealed (enemy Siegelward within 450,
     Suchfeuer, 3 s after Spaehfrucht / Nyx R) - attackable (3 autos), should get its own minimap symbol.
   - `SnapObject.stealth?: true` on stealthed ground objects (Nyx seeds, Grimald traps). Enemy objects now appear
     when revealed (before: never); the hard-coded tag list `HIDDEN_OBJECT_TAGS` is gone.
   - `SimEvent` zone: `stealth?: true` (ability flag `stealth`, today Lysa E wire). Enemies get the zone event only
     under true sight (enemy Siegelward 450 / Suchfeuer) at placement, no longer by plain point vision.
   - Ability data: new flag value `stealth` in `AbilityData.flags` (schema.ts, validate.ts).
   - Siegelward reveal radius 900 -> 450 (AGENTS-PLAN B1 (a)); values moved to `src/data/wards.json` (new file).
   Brain impact: none required. Enemy Schleierwards were already absent from bot snapshots (verified: 4595 samples in
   a 20-min 10-bot game, the only 2 hits were legit Siegelward reveals). Bots that clear wards can key on
   `e.stealth && e.team !== me.team` for "revealed enemy ward".

2. Request for C, `src/ui/minimap.ts` (ward block, ~line 133): own symbol for revealed enemy Schleierwards.
   ```diff
              } else if (e.kind === Kind.Ward) {
                // player wards as small diamonds; jungle river vision (no e.ward) is not drawn
                if (!e.alive || !e.ward) continue;
   +            // revealed enemy Schleierward (stealth + enemy team): hollow diamond with an eye dot, enemy colour
   +            const revealed = e.stealth && e.team !== state.myTeam;
                const r = (e.ward === 'seal' ? 3.2 : 2.6) * d;
                ctx.fillStyle = e.ward === 'seal' ? (e.team === state.myTeam ? '#f2d36b' : '#ff8a5a') : col;
                ctx.beginPath();
                ctx.moveTo(x, y - r);
                ctx.lineTo(x + r, y);
                ctx.lineTo(x, y + r);
                ctx.lineTo(x - r, y);
                ctx.closePath();
   -            ctx.fill();
   +            if (revealed) {
   +              ctx.strokeStyle = col;
   +              ctx.lineWidth = 1.6 * d;
   +              ctx.stroke();
   +              ctx.beginPath();
   +              ctx.arc(x, y, 0.9 * d, 0, Math.PI * 2);
   +              ctx.fill();
   +              continue;
   +            }
   +            ctx.fill();
                ctx.lineWidth = 1 * d;
                ctx.stroke();
   ```
3. Request for D, `src/render/wards.ts`: own stealthed wards (`e.stealth && own`) drawn semi-transparent (LoL look:
   your stealth ward is translucent), revealed enemy ones with a reveal ring. Suggested: in `update`, after the
   `disabled` line: `const ghost = own && e.stealth; m.gemMat.opacity = disabled ? 0.35 : ghost ? 0.6 : 0.95;` and for
   `e.stealth && !own` set `m.ringMat.opacity = 0.9`. Same idea for `SnapObject.stealth` in render/groundObjects.ts.
