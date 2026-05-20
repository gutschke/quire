# Quire

Browser-based TTRPG framework for collaborative interactive storytelling.

> **Status: in development.** Phase 0 (schemas + CLI + sample-campaign skeleton) is in progress. The play app does not exist yet. This README documents the design and the project layout; running code lands in later phases.

## What this is

Quire is a static-deployed web app that hosts a TTRPG play experience. Campaigns are separate content repositories that the runtime loads at play time. The split exists for safety and forking: a fork can publish a new campaign without operating a runtime, and the canonical runtime can be hardened in one place.

- Canonical play app: <https://play.quire.games> (not yet live)
- Sample campaign: [gutschke/underleaf](https://github.com/gutschke/underleaf)
- Forking model: see [`design/architecture.md`](design/architecture.md#three-forking-modes)

## Design

All design decisions are documented under [`design/`](design/):

- [Architecture](design/architecture.md) — runtime, content split, networking, AI, storage.
- [Rules reference](design/rules-reference.md) — the v0.1 ruleset the bundled play app supports.
- [Schemas](design/schemas.md) — schema philosophy (hints, not gates), versioning, codemods.
- [Security](design/security.md) — threat model, the canonical-origin trust anchor, AI broker invariants.

Reading those before browsing the code or contributing is the recommended path.

## Repository layout

```
design/        — canonical design docs (above)
schema/        — JSON schemas and codemods (phase 0)
cli/           — Node CLI: quire lint / encrypt-dm / decrypt-dm / migrate (phase 0)
runtime/       — the play app (phase 1+, not yet present)
```

## Looking for the sample campaign?

If you are or might become a *player* in the Underleaf campaign, please read its [README](https://github.com/gutschke/underleaf/blob/main/README.md) before browsing files in that repository. Some folders are deliberately marked DM-only and contain spoilers.

## License

Code in this repository: MIT (see [LICENSE](LICENSE)).

Campaign content typically uses CC-BY-SA 4.0; see individual campaign repositories.

## Status of phase 0

Tracking what has landed and what is still missing:

- [x] Repos created on GitHub, canonical domain registered
- [x] Design memory mirrored into [`design/`](design/)
- [x] JSON schemas for all record types (v0.1) under [`schema/v0/`](schema/v0/)
- [x] Codemod registry skeleton under [`schema/codemods/`](schema/codemods/) (no codemods yet — v0.1 is the first major)
- [x] CLI skeleton ([`cli/`](cli/)) — `quire lint` works; `encrypt-dm`, `decrypt-dm`, `migrate` are documented stubs
- [x] Underleaf scaffold with DM-only spoiler-safe structure ([gutschke/underleaf](https://github.com/gutschke/underleaf))
- [x] Full JSON Schema validation in `quire lint` via Ajv
- [x] Encryption pipeline (`quire encrypt-dm` / `decrypt-dm`) with Argon2id KDF + XSalsa20-Poly1305
- [x] Play-app runtime scaffold under [`runtime/`](runtime/) (Vite + TypeScript + Lit; builds to ~7 KB gzip)
- [ ] Cloudflare Pages deployment at `play.quire.games`
- [ ] Campaign loader: parse `?campaign=` URL, fetch and validate manifest
- [ ] Reference-shelf UI: episode outline + cmd-K search + inline edit
- [ ] First playable round-trip
