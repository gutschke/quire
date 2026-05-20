# Schemas v0

This directory holds the JSON Schemas (draft 2020-12) for Quire's content records. They describe the recognized shape of each record type; they do not constrain what a campaign can contain.

## Philosophy

Schemas are **hints, not gates.** The only required fields on any record are `$schemaVersion` and `name`. Everything else is optional, and additional fields beyond those defined here are explicitly allowed (`additionalProperties: true` on every record).

The schema validator emits warnings about unrecognized fields and out-of-range values but never refuses to load content. This is by design — the moment authoring requires filling structured fields, DMs start filling fields instead of telling stories. Freeform Markdown is the primary medium; structured fields are for things the runtime actually consumes.

## Files

- `campaign.schema.json` — manifest at the campaign root.
- `pc.schema.json` — player character.
- `npc.schema.json` — non-player character.
- `bestiary.schema.json` — creature / threat / antagonist that recurs across scenes.
- `item.schema.json` — object: mundane equipment, artifact, focus candidate.
- `spell.schema.json` — documented spell or pattern. In Underleaf, spells are emergent records rather than a known list.
- `episode.schema.json` — episode arc with scene references.
- `scene.schema.json` — single scene (usually authored as Markdown with frontmatter).
- `session-log.schema.json` — post-session summary.

## Versioning

Records carry `$schemaVersion` in SemVer. The current schema set is `0.1.0`.

Migrations between versions live under `quire/schema/codemods/`. See its README for the policy.

## Validating content

The `quire lint` CLI command validates a campaign repository against these schemas and reports warnings. It will be implemented in phase 0.

## Adding fields

Adding optional fields to v0.1.x is a patch-level change — no migration needed. Removing or renaming a field requires a new major and a codemod. See `quire/design/schemas.md`.
