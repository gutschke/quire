# Save/Restore Program — Status

**Last updated:** 2026-05-29 (M0 bootstrap + M1 in flight)
**Active milestone:** M1 — Firewall: seal known leaks + self-completing tripwire

## In-progress

### M1 — Firewall (claimed task #421 + #420)
Bundling four Adversarial findings into one ship:
1. `map-blob-add` payload labels for unrevealed blobs leak to non-coord saves. Adding a per-kind scrubber that drops `label` (and any other free-form text fields the payload may carry) when the blob is unrevealed at save time.
2. `causedByResponseId` survives `pc-create` / `pc-edit` scrubbers. Adding to both registry entries.
3. Make `PER_KIND_SCRUBBERS` self-completing — a lint that complains when a player-visible kind ships without an explicit `pass` / `scrubber` decision.
4. Save-path taint fuzz (#420) — companion to `state.firewall-fuzz` over `serializeSessionForViewer`.

Tests-first. Expect 4 commits: hostile tests, scrubber additions, self-completing lint, taint fuzz.

## Up next

- **M2 — Tab-close durability.** Probably 1 commit (flush in `visibilitychange === 'hidden'`).
- **M3 — Restore re-broadcast.** First reproduce the bug; the OP-001 analysis suggests the existing sync-pull may already cover this in some topologies. Need a 3-peer integration test before patching.

## Decisions pending the human

- **OP-006 — Build OR strip GitHub-push + Drive sync.** Recommended default: strip + park as M6 roadmap. Drive sync is 1–2 weeks; the threat-model questions need a design pass first.

## Health summary

- 🟢 Living docs bootstrapped.
- 🟡 Real firewall leak (map-blob unrevealed labels) — fix in flight.
- 🔴 "Any party member can continue" promise — broken, M3 work pending verification.
- 🔴 Browser-eviction handling — no `navigator.storage.persist()`, M5 work pending.
- 🟡 e2e-only critical-path coverage — M4 work pending.
- 🔴 Honest scope — GitHub-push + Drive sync implied but not built. Human decision required.

## Where to find things

- Charter + invariants → `README.md`
- Milestone plan → `roadmap.md`
- Decisions → `decisions.md`
- Known issues → `open-problems.md`
- Test plan → `test-strategy.md`
- UX plan → `ux-strategy.md`
- Sub-agent transcripts → `simulations/`
