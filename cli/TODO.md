# Quire CLI — TODO

Tracking work for the `quire` CLI (`quire/cli/`).

## Lint coverage gaps (P1)

Documented in `quire/design/authoring.md`. The conventions exist; the linter doesn't yet enforce them.

- DM-only banner check: files under `dm/` and `design/DM-ONLY/` must open with a GitHub `[!CAUTION]` alert block.
- Scene-body links to `dm/` files: catch content leaks before publish.
- Required scene frontmatter: every scene in `episodes/<NNN>/scenes/` must have YAML frontmatter that validates against `schema/v0/scene.schema.json`.
- NPC promotion candidates: names in `dm/npcs.md` referenced from 3+ scenes warrant promotion to `characters/npcs/<id>.json`.
- DM-only inline blockquote convention (TBD): if a convention like `> [!DM]` is adopted, both the linter and the runtime renderer need to implement stripping for player view.

## DM editor app (P0 future)

The runtime today is read-only for campaign content (it edits session state, not campaign files). The user's plan is for a DM-facing web app that:

- Edits campaign material in-browser (via OAuth to GitHub, or local filesystem when self-hosted)
- Enforces frontmatter conventions at write time
- Surfaces lint warnings inline
- Handles `dm/` vs public placement decisions
- Manages `quire encrypt-dm` / `decrypt-dm` flows transparently

This is its own project — pin the scope and revisit when there's bandwidth.
