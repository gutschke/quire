# Save/Restore Program — Status

**Last updated:** 2026-05-29 end-of-session (M1 + M2 + M3 shipped)
**Active milestone:** M4 — Restore-drill CI (next)
**Latest deploy hash:** build 99c837c
**Branch:** main (origin up to date)

## Session log (most recent first)

- **2026-05-29 (this session):** M0 docs + M1 firewall + M2 tab-close + M3 re-broadcast. Three pushes to origin/main. 12 new tests; all 2584 pass; typecheck clean.

## Just shipped

### M1 — Firewall: leaks sealed + self-completing tripwire (DONE)

- Map-blob unrevealed label leak sealed via reveal-mask scrubber.
- `causedByResponseId` scrubbed from `pc-create` + `pc-edit` for non-coord saves.
- `EVENT_KINDS_NO_SCRUB_NEEDED` + lint forces explicit per-kind decision.
- 40-seed save-path firewall fuzz — SAVE-STREAM companion to `state.firewall-fuzz`.

### M2 — Tab-close durability (DONE)

- `AutosaveController` listens for `visibilitychange === 'hidden'` and flushes pending saves synchronously. Closes the 1.5s data-loss window on tab-close.
- `hostDisconnected()` cancel-on-route-change preserved (distinct from tab-close).
- 6 new unit tests pin the contract.

### M3 — Restore re-broadcast (DONE)

The architect's claim WAS REAL — in the 3-peer case. Reproduction
test (`peer.restore-rebroadcast.test.ts`):
- 2-peer scenario: pull from new joiner catches up, no bug.
- 3-peer scenario: bob+carol connect first, alice joins with empty
  log, on-connect sync-request → alice responds empty, THEN alice
  loads saved events. Pre-fix bob+carol never see them. ←  THE BUG.

Fix: `Peer.applyEvent(event, { propagate = true })` now forwards
newly-applied events via `forwardShareToOthers` (sync-response,
hub-forwarding). Opt-out preserved for the `regenerateCode` path.
Sync-response chosen over `share` because restored events may have
been authored by other peers' prior sessions (R2.1 impersonation
defense would reject those over `share`).

Tasks #420, #421, #422, #423 marked complete.

All 2584 vitest tests pass. TypeScript clean.

## Up next

### M4 — Restore-drill CI (NEXT)

Promote three currently-e2e-only assertions to fast unit tests +
add a nightly restore-drill: 1-second deterministic seed → 100-event
soak → save → restore → byte-identical (modulo savedAt) + 0
unknownKinds + convergence.

Likely 2-3 commits:
1. Test harness for byte-identical roundtrip (modulo savedAt).
2. Soak-100-event drill as a unit test.
3. Promote cross-week save-load-continue + branch-divergence-merge
   from e2e to vitest.

### M5 — Discoverability (after M4)

- `navigator.storage.persist()` request on first session-write.
- Resume prompt: scene + PCs + digest headline.
- Recently-played list on no-campaign landing.
- DM-only soft-warn on eviction (silent-player firewall enforced).

### M6 — Honest scope (after M5)

Decision pending the human (OP-006).

### M7 — Simulated playtest

### M8 — UAT readiness

## Decisions pending the human

- **OP-006 — Build OR strip GitHub-push + Drive sync.** Recommended
  default: strip + park as M6 roadmap. The threat-model questions
  (whose token? whose repo? does a player's event log push to the
  DM's repo?) need a design pass before code.

## Health summary

- 🟢 Living docs bootstrapped.
- 🟢 Firewall leaks sealed (M1 shipped).
- 🟢 Self-completing scrubber registry (M1 shipped).
- 🟢 Save-path taint fuzz (M1 shipped).
- 🟢 Tab-close durability (M2 shipped).
- 🟢 "Any party member can continue" promise — REAL (M3 shipped).
- 🔴 Browser-eviction handling — no `navigator.storage.persist()`, M5 pending.
- 🟡 e2e-only critical-path coverage — M4 next.
- 🔴 Honest scope — GitHub-push + Drive sync implied but not built. Human decision required.

## Where to find things

- Charter + invariants → `README.md`
- Milestone plan → `roadmap.md`
- Decisions → `decisions.md`
- Known issues → `open-problems.md`
- Test plan → `test-strategy.md`
- UX plan → `ux-strategy.md`
- Sub-agent transcripts → `simulations/`
