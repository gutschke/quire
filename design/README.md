# Quire design notes

This directory holds the canonical design documents for the Quire framework. Read them in roughly this order:

1. **[architecture.md](architecture.md)** — what Quire is, how the runtime is split from content, how the play app reaches campaigns and AI providers, and how it stays safe in a fork ecosystem.
2. **[rules-schema.md](rules-schema.md)** — engine-side contract for what a campaign's rules declare. (The canonical v0.1 ruleset itself — stats, resolution, harm, stress, magic-tier adjudication, advancement — moved 2026-05-22 to the Underleaf campaign repo at [`underleaf/world/rules.md`](https://github.com/gutschke/underleaf/blob/main/world/rules.md) since rules ARE policy. See `quire/runtime/design/engine-vs-campaign-boundary.md`.)
3. **[schemas.md](schemas.md)** — the schema philosophy (hints, not gates), the versioning policy, and what to expect from `quire/schema/`.
4. **[security.md](security.md)** — threat model, what the canonical-origin trust anchor buys, what it doesn't, and what forkers need to know.
5. **[authoring.md](authoring.md)** — conventions for writing Quire campaigns: public vs DM-only, scene file structure, NPC quick-references, stakes menus, pacing files, and what NOT to do.

None of these documents describe a specific campaign. Sample-campaign-specific design — including the narrative arc, antagonist, and world cosmology of [Underleaf](https://github.com/gutschke/underleaf) — lives in that repository, much of it under a `design/DM-ONLY/` folder that players should not browse.

These documents will land progressively during phase 0. Empty stubs are marked with the date they were created and a brief outline of what they will become.
