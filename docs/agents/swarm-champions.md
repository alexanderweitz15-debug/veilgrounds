# Swarm: one new champion + new items per agent (user 23 Oct: "jeder Swarm-Agent soll einen neuen Champ bauen mit neuen Items")

After your current task is done and pushed, build ONE new champion with the concept assigned below, plus 1-2 NEW
items that fit it (a signature legendary for its class; optional component). Same branch, new commits.

Champion rules (follow exactly how `sev` is wired - grep 'sev' for every registry):
- src/data/champions/<id>.json + src/sim/champions/<id>.ts hooks, data/sim index, render kit/atlas, lobby lists,
  trainer pools, src/render/abilityMotifs.json row (4 distinct motifs), docs/champion-hooks.md entry, roster in
  docs/spec-champions.md, bot build line in src/ai/bot/builds.ts (additive), icons, de+en names/tooltips, painted sprite
  kit with idle/run/attack/cast and a silhouette that differs from every existing champion, ability visuals.
- Original German name in the roster's style + English id. Numbers in JSON, tuned against champions of the same role.
- Tests: kit test file (every ability + the unique mechanic), validate passes. Roster-count tests: do NOT hard-code a new
  total - make them count the data (other agents add champions in parallel).
- Items: use only existing ItemStat fields (agent G is extending the schema), check docs/IDEAS-FEEL-SHOP.md "Neue Items"
  and src/data/items.json to avoid duplicate names/effects, German name + en, passive via the existing item hook
  system, icon via the motif table, price by gold efficiency, add to the champion's bot build. Test for the passive.
- Registry merge conflicts with other agents are expected: keep your lines grouped and additive.

| Slug | Champion concept (role, body, unique mechanic) |
|---|---|
| champ-cavalry | (already a champion) + 1 item: spectral cavalry juggernaut item (move speed -> damage) |
| champ-support | (already a champion) + 1 item: enchanter item around shields/tethers |
| map-scale | Stone golem tank (top): throws boulders, raises short earth walls (terrain-like blockers that expire) |
| scenarios-macro | Chain-shadow assassin (jungle): hooks to enemies/walls, chains stack a mark that executes |
| dodge-metrics | Wind archer (ADC): wind arrows push enemy skillshots aside / slow them in flight |
| ability-texts | Mushroom hexer (mid control mage): spore fields that spread when enemies walk through them |
| voice-lines | Bard-like musician (support): notes collected on the map empower songs (heal/speed/stun) |
| pings | Giant crab warrior (top tank): shell stance toggles between armor fortress and fast sidestep |
| ui-polish | Fire smith (top bruiser): anvil hammer, forges temporary weapon upgrades mid-fight |
| keybinds | Blood mage (mid): spends HP instead of mana, heals back from damage dealt |
| scoreboard-bots | Owl seer (vision support): owls as mobile wards, reveal and mark enemies |
| summoners | Storm rider on a wolf (jungle): lightning chains between enemies, dismount when low |
| jungle-timers | Sand worm (jungle, non-human): burrows, travels underground, erupts with knock-up |
| tutorial | Puppeteer (mid): controls a separate puppet unit that casts copies of her spells |
| gfx-settings | Snow queen (mid/support): ice walls, frozen ground that slides enemies |
