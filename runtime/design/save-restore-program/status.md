# Save/Restore Program — Status

**Last updated:** 2026-05-29 (M1 shipped)
**Active milestone:** M2 — Tab-close durability (next)

## Just shipped

### M1 — Firewall: leaks sealed + self-completing tripwire (DONE)

Single commit closed Adversarial findings #1, #2, #3, #4 from the
2026-05-29 four-expert review:

- **Map-blob payload scrub** — `map-blob-add` and `map-blob-move`
  events now drop the `label` field when the blob is UNREVEALED at
  save time. Keep it when revealed (player already saw the label at
  the table). Reveal-mask precomputed via the new
  `ScrubContext` hook. Test: `persistence.hostile.test.ts` 4 cases.
- **`causedByResponseId` scrub** — drops the AI-provenance tracer
  from `pc-create` + `pc-edit` for non-coord saves. Coord keeps it
  for audit. Tests: 3 cases.
- **Self-completing scrubber registry** — `EVENT_KINDS_NO_SCRUB_NEEDED`
  + lint in `persistence.coverage.test.ts`. Every player-visible kind
  is now classified explicitly; a new kind without a decision trips
  CI. Tests: 3 lint cases.
- **Save-path taint fuzz** — `persistence.firewall-fuzz.test.ts` is
  the SAVE-STREAM companion to `state.firewall-fuzz.test.ts`. 40
  seeded scenarios x 4 non-coord viewers x ~12 sentinel-planting
  payload shapes. 0 sentinels survive. Positive-control test
  ensures revealed labels survive (catches over-strip).

Tasks #420 and #421 marked complete.

All 2572 vitest tests pass. TypeScript compiles clean.

## Up next

### M2 — Tab-close durability (NEXT)

Architect finding #5 + Test-QA finding #2: the 1.5s autosave debounce
window is structurally lost on tab-close.
`AutosaveController.hostDisconnected()` cancels pending saves rather
than flushing.

Plan:
1. Add `visibilitychange` listener that triggers `performNow()` when
   `document.visibilityState === 'hidden'` AND a save is pending.
2. Keep `hostDisconnected()` cancel-on-route-change semantics (those
   are legitimate unmounts during navigation; a half-typed save
   shouldn't fire during a slug change).
3. Test: synthesized `visibilitychange → hidden` after an unflushed
   change writes localStorage before the test returns.

### M3 — Restore re-broadcast

Architect finding #1. Will FIRST reproduce in an integration test
before patching — there's an open question (OP-001) about whether the
existing sync-pull path already covers some topologies. Don't fix
what doesn't break.

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
- 🟡 Tab-close durability — M2 next.
- 🔴 "Any party member can continue" promise — M3 work pending verification.
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
