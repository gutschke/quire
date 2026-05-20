# Quire

Browser-based TTRPG framework for collaborative interactive storytelling.

> **Status: in development.** Phase 0 (schemas + CLI + sample-campaign skeleton) has not yet started. This README is a placeholder.

## What this is

Quire is the runtime: a static-deployed web app that hosts the play experience. Campaigns are separate content repositories that the runtime loads at play time. The architecture splits *runtime* (this repo) from *content* (campaign repos) so that forks can publish their own campaigns without having to maintain their own runtime.

- Canonical play app: <https://play.quire.games> (not yet live)
- Sample campaign: [gutschke/underleaf](https://github.com/gutschke/underleaf)

## Design

Quire is built for in-person, story-first play around a shared table, with optional online sessions over WebRTC. Sessions with zero dice rolls are valid; mechanics exist to support the DM and inject randomness when randomness serves the story, never to encourage mechanical farming.

Magic-system mechanics, AI prep tooling, the security model, and the canonical schemas are all locked in design memory and will land here as documentation during phase 0.

## License

Code in this repository: MIT (see [LICENSE](LICENSE)).

Campaign content lives in separate repositories under their own licenses, typically CC-BY-SA 4.0.
