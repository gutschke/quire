# Schemas

## Philosophy

Quire's content schemas are **hints, not gates.** The only required fields on any record are `name` and `$schemaVersion`. Everything else is optional. The validator emits warnings, never blocks.

The reason is design discipline: the moment NPCs require structured fields, DMs start *filling fields* instead of telling stories. Freeform Markdown is the primary medium for character notes, backstory, scenes, and lore. Structured fields exist for things the runtime actually consumes — HP if you are tracking it, AC if you are rolling against it, an `arc` link if the storyboard view wants to render relationships.

This makes the schemas more like *recommended structure* than enforced contracts. Forks may add fields freely; older content still validates because new fields are additive.

## Versioning

Every record carries `$schemaVersion` in SemVer (`MAJOR.MINOR.PATCH`). The runtime ships all historical validators and codemods.

- **Patch** — pure additions to optional fields. No code change needed in the runtime; older content continues to validate against newer schemas.
- **Minor** — additive fields that may affect rendering. Runtime degrades gracefully when older content omits them.
- **Major** — renames or removals. The runtime ships codemods to convert older majors to current; CLI `quire migrate` rewrites a repo to the current major. Runtime can read older majors via in-memory codemod but **never auto-writes the repo**.

The sample campaign Underleaf locks to the current major. Forks that diverge from upstream can run their own codemod paths as long as they include the codemod files in their own `schema/codemods/`.

## Codemod policy

Codemods live in `quire/schema/codemods/<from>-<to>/` and are **pure functions** — given old JSON, return new JSON. They are versioned in-repo. Every major bump ships with golden-file tests under `schema/codemods/<from>-<to>/*.{in,out}.json`. Without those tests the registry rots within a year.

## Record types (v0.1)

The framework defines schemas for these record types. Each is described in its own JSON Schema file under `quire/schema/v0/`:

- `campaign.json` — campaign manifest: name, schema version, license, IP/copyright, default-AI-provider hints, signaling overrides
- `pc` — player character (one file per PC)
- `npc` — non-player character (one file per NPC)
- `bestiary` — generic threat / creature / antagonist
- `item` — equipment, artifacts, foci
- `spell` — spells, rituals, named magical patterns (note: in Underleaf, spells are emergent rather than catalogued)
- `episode` — an episode arc; references scenes, hooks, and DM-only beats
- `scene` — a single scene of an episode; primarily Markdown
- `session-log` — a post-session DM summary

In addition, sessions carry `events.jsonl` (the append-only event log) and `snapshot.json` (state pointer at session start). These are not formal schemas but have a structure the runtime expects.

## What goes in a record

A representative `pc` record might look like:

```json
{
  "$schemaVersion": "0.1.0",
  "name": "Jules Aria Halloway",
  "alignment": "neutral-good",
  "stats": { "str": 0, "dex": 1, "con": 0, "int": 2, "wis": 1, "cha": 1 },
  "skills": ["Knowledge", "Tech"],
  "tags": ["ICU nurse", "raised in Bremen", "amateur photographer"],
  "harm": 0,
  "stress": 0,
  "foci": [
    { "name": "grandmother's wedding band", "domain": "identity", "condition": "intact" }
  ],
  "backstory": "<freeform Markdown>"
}
```

Of these, only `name` and `$schemaVersion` are required. A perfectly valid minimal `pc` is:

```json
{
  "$schemaVersion": "0.1.0",
  "name": "Jules"
}
```

The runtime renders whatever it finds; missing fields become empty cells or are simply omitted from view.
