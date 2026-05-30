# Save/Restore Program

**Status:** 🟡 Pre-alpha — M0 bootstrapped, M1 in-flight (2026-05-29)
**Program lead:** save/restore engineering rotation
**Charter origin:** 2026-05-29 four-expert review (Architect / Test-QA / TTRPG-UX / Adversarial)

## Mission

Bring Quire's campaign save/restore from a half-built primitive to product readiness, where
"product readiness" means a returning DM after 3–6 months can sit down, find their campaign,
load it, and the table can pick up where they left off — and the spoiler firewall holds
across every save destination.

## Locked invariants (do not violate)

1. **Spoiler firewall is the crown jewel.** DM-only data MUST NEVER reach a player projection or a player-saved artifact.
2. **Silent-player firewall.** Telling the player they hit a spoiler IS itself a spoiler. Player-facing warnings forbidden; soft-warn DM only.
3. **Threat model.** Civilized peers — defend against accidental DM disclosure + outsiders, NOT against a malicious co-player.
4. **TTRPG prime directive.** Game supports storytelling; mechanics in the background. Save/restore UI is in-fiction-supportive, not a files-and-folders admin.
5. **Engine vs campaign.** Save/restore is engine (`[E]`); the in-fiction copy is campaign (`[C]`) where it surfaces narrative voice.

## Success criteria

- A campaign continues correctly when ANY party member still has saved state — restored events propagate to the rest of the table on next session.
- Every save destination (localStorage autosave, manual file download, future GitHub-push, future Drive sync) upholds the spoiler firewall.
- Tab-close, browser eviction, mid-session crash, and OS reboot all leave the campaign recoverable.
- A returning DM with no prior knowledge can discover their campaign and resume it.
- The user-facing copy honors the prime directive (no "files and folders" framing).
- CI proves the restore path works — not just builds + unit tests.
- Honest scope: GitHub-push and Drive sync are either built or removed from user-facing copy.

## In scope

- Event-log save format (`SaveDocument`) — serialization, parsing, application.
- Per-viewer firewall scrubbing (`serializeSessionForViewer` + `PER_KIND_SCRUBBERS`).
- Local autosave (`AutosaveController` → `localStorage`).
- Manual file save / load.
- Resume UX (auto-load prompt, recently-played list).
- Re-broadcast on restore (so a restored peer's events reach the table).
- Durability (flush on tab-close, persistent-storage API, recovery from eviction).
- CI gate (nightly restore drill, byte-identical roundtrip, 0 unknownKinds).
- Honest scope for "where does my campaign live forever?" — decide and document.

## Out of scope (for now)

- Cryptographic signing of saves (would require ed25519 + key distribution; defer).
- Multi-table merging beyond the existing branch-divergence-merge flow.
- Schema downgrade (forward-only; bumping schema version requires DM consent UI).
- Save-format compression (today's autosaves are <1MB; revisit when this is real).

## Where to read next

- `roadmap.md` — milestone plan.
- `status.md` — current sprint snapshot. **Read this first when resuming.**
- `decisions.md` — append-only design decisions.
- `open-problems.md` — known issues without a fix yet.
- `test-strategy.md` — how each invariant is verified.
- `ux-strategy.md` — discoverability + workflow + in-fiction copy.
- `tried-and-rejected.md` — what failed and why.
- `simulations/` — focus-group, gameplay, data-loss exercises.

## Resumption ritual

1. `cd /home/markus/src/ttrpg/quire/runtime/`
2. Read `design/save-restore-program/status.md`.
3. Read `design/save-restore-program/open-problems.md`.
4. Read the last 14 days of `design/save-restore-program/decisions.md`.
5. `git status` + `git log --oneline -20`.
6. Resume the milestone marked in-progress. Finish any half-built work first.
