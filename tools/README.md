# quire/tools

Standalone helpers that operate on a campaign directory. They are
campaign-agnostic: point them at any directory containing `campaign.json`.

## `npc-sheets.py`

Renders printable NPC character sheets from `characters/npcs/*.json`. NPCs carry
no stats in play, so these are prose sheets — who the person is, how they sound,
their signature beats, and what the DM is holding.

```sh
# every NPC in the campaign, DM copy
python3 quire/tools/npc-sheets.py path/to/campaign -o npc-sheets.pdf

# one NPC (--only works in any argument position)
python3 quire/tools/npc-sheets.py path/to/campaign -o reyes.pdf --only daniel-reyes

# safe to hand to a player: drops dmNotes entirely
python3 quire/tools/npc-sheets.py path/to/campaign -o npcs.pdf --no-dm-notes
```

**`dmNotes` often carries the campaign's biggest spoilers.** It renders in a
visually distinct block that cannot be mistaken for the rest of the sheet, and
the footer states whether a copy is a *DM copy* or *player-safe*. Use
`--no-dm-notes` for anything a player may see.

`{{pc:N}}` tokens are left as-is unless `--pc-names FILE` is given, where FILE is
JSON mapping slot number to a name (or to an object with a `pc` key). That is how
a private printable copy gets real names without those names entering the
repository.

Output is `.pdf` (needs Chrome or Chromium on PATH) or `.html`.

Unknown fields render automatically, so adding a field to an NPC JSON does not
require touching this script. Each NPC starts on a new page when printed.
