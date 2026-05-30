# Save/Restore Program — Status

**Last updated:** 2026-05-29 (M2 shipped)
**Active milestone:** M3 — Restore re-broadcast (next; needs reproduction)

## Just shipped

### M1 — Firewall: leaks sealed + self-completing tripwire (DONE)

- Map-blob unrevealed label leak sealed via reveal-mask scrubber.
- `causedByResponseId` scrubbed from `pc-create` + `pc-edit` for non-coord saves.
- `EVENT_KINDS_NO_SCRUB_NEEDED` + lint forces explicit per-kind decision.
- 40-seed save-path firewall fuzz lands as the SAVE-STREAM companion to `state.firewall-fuzz`.

### M2 — Tab-close durability (DONE)

- `AutosaveController` now listens for `visibilitychange === 'hidden'` and flushes synchronously if a save is pending. Closes the 1.5s data-loss window on tab-close (Architect finding #5, Test-QA finding #2).
- Used `visibilitychange` not `beforeunload` per DEC-004 (mobile + bfcache reliability).
- `hostDisconnected()` cancel-on-route-change behavior preserved (distinct from tab-close); doc commented inline.
- 6 new unit tests pin: listener registered, listener removed, flush on hidden, no-op on visible, no-op when nothing pending, no double-write after flush.

Tasks #420, #421, #422 marked complete.

All 2578 vitest tests pass. TypeScript clean.

## Up next

### M3 — Restore re-broadcast (NEXT, needs reproduction first)

Architect finding #1: `Peer.applyEvent` does not share re-applied
events. The hypothesis is that a player who restores their autosave
and joins a fresh session has their unique events silently never
propagate to the table.

**BUT** the architect-claim deserves verification — Peer's
constructor pulls a `sync-request` from every already-connected peer
on join, which makes the NEW peer the asker. If the new peer responds
to other peers' sync-requests with its full log (which it does via
`handleMessage` → `since(clock)` → `sync-response`), the restored
events WOULD propagate through the existing path.

Plan for M3:
1. Write an integration test that constructs the architect's scenario
   (peer A loads N events from save → peer A joins a fresh
   transport with peers B and C → assert B and C see all N events).
2. If the test PASSES, the architect finding is invalidated. Update
   `open-problems.md` OP-001 to RESOLVED-AS-NOT-A-BUG. Move on.
3. If the test FAILS, dig in: which event is dropped? Why does
   sync-response not carry it? Then patch with the minimum-blast-
   radius fix.

This is the most rigorous path because the architect's claim doesn't
match my reading of the protocol, and the "trust but verify" memory
applies.

### M4, M5, M6, M7, M8 — see roadmap.md.

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
- 🟡 "Any party member can continue" — M3 reproduction needed before patch.
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
