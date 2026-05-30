# Save/Restore Program Decisions

Append-only. Never edit a prior entry — supersede with a new entry that
references the prior. Format:

```
## DEC-NNN — title (YYYY-MM-DD)

**Decision:** ...
**Why:** ...
**Alternatives:** ...
**Tradeoffs:** ...
**Revisit if:** ...
```

---

## DEC-001 — Charter the save/restore program (2026-05-29)

**Decision:** Spin up `design/save-restore-program/` as the program's living
doc set. Roadmap M0–M8 published. The 2026-05-29 four-expert review's
findings are the seed backlog; future findings get logged here.

**Why:** Save/restore was being shipped piecemeal across many other features.
The four-expert review surfaced a live firewall leak, a broken "any party
member can continue" promise, and a silent-eviction UX failure — none of
which has a single owner. The program structure gives the work an owner-of-
record and a continuity mechanism for cross-session work.

**Alternatives:**
- Add tasks to the global backlog without a doc set. Rejected: the
  cross-cutting decisions (honest-scope, in-fiction copy, durability model)
  need a single home, not 8 backlog tickets pointing at each other.
- Extend the existing `multi-session-test-plan.md`. Rejected: that doc is
  test-strategy-shaped, not program-shaped, and predates the broader scope.

**Tradeoffs:** Adds another doc set the engineer must keep up to date.
Mitigation: `status.md` is the single resumption-entry-point.

**Revisit if:** Save/restore feels solved and the doc set goes stale (then
collapse into a single `runtime/design/save-restore.md` post-mortem).

---

## DEC-004 — Tab-close uses `visibilitychange === 'hidden'`, NOT `beforeunload` (2026-05-29)

**Decision:** `AutosaveController` listens for `visibilitychange` on
`document`. When `visibilityState === 'hidden'` AND a save is pending,
flush synchronously. The legacy `hostDisconnected()` cancel-on-route-
change behavior is preserved (distinct path; legitimate unmount
during slug navigation).

**Why:**
- `beforeunload` is suppressed on mobile Safari and during
  `pagehide`-triggered bfcache eviction. Saves there are silently
  lost.
- `visibilitychange → hidden` fires reliably across desktop + mobile
  and is the WHATWG Page Lifecycle recommendation.
- Synchronous `localStorage.setItem` inside a `visibilitychange`
  handler is durable — the browser has not yet released the page.
- `pagehide` ALSO fires but only on real unloads. `visibilitychange`
  fires on background-tab-too, which is the common DM case (alt-tab
  to GitHub for scene markdown). Saving more aggressively is fine —
  it's a single localStorage write, debounced internally by checking
  `this.timer === null` before doing work.

**Alternatives:**
- `beforeunload` alone — rejected per above.
- Both `beforeunload` + `visibilitychange` — rejected: double-write
  in some browsers, no durability gain.
- Make `hostDisconnected()` flush instead of cancel — rejected:
  route-change-during-typing should NOT fire a save, and the Lit
  lifecycle calls `hostDisconnected` for both tab-close AND
  route-change without distinguishing them.

**Tradeoffs:** Saving on tab-background increases localStorage write
frequency in DM workflows that frequently alt-tab. Mitigation: the
in-flight-pending check (`timer === null` short-circuit) means we
only write when there's an actual buffered change. Real cost:
near-zero.

**Revisit if:** A reproducible test shows a tab-close path where
`visibilitychange` does NOT fire (mobile Safari freeze, OS-level
tab-kill) — then add `pagehide` as a second signal.

---

## DEC-003 — Scrubber gets a precomputed reveal-mask via `ScrubContext` (2026-05-29)

**Decision:** `EventScrubber` signature is now `(event, ctx) => …`
where `ctx.revealedMapBlobs` is a precomputed `Set` of
`${scenePath}\0${blobId}` keys for blobs revealed at the end of the log.
Built once per `serializeSessionForViewer` call.

**Why:** `map-blob-add` / `map-blob-move` need to know whether to keep
the label, and the answer depends on the FUTURE `map-blob-reveal`
events in the same log. The materializer for map blobs is a no-op stub
today (M3a/M6 future), so we can't reuse `state.mapBlobReveals`. The
context object generalizes for the next cross-event scrub we'll write.

**Alternatives:**
- Always strip `label` from `map-blob-add`. Rejected: revealed blobs
  carry their label from the original `map-blob-add` event in the
  materializer; stripping the label here means revealed blobs would
  re-materialize with empty labels on the player side, breaking the
  player-visible-map promise.
- Two-pass on `serializeSessionForViewer` (compute, then rewrite).
  Rejected: this IS that approach, but cleaner expressed as a
  per-scrubber decision rather than a special-case after-pass.
- Compute reveal-mask lazily inside the scrubber. Rejected: O(n²) for
  no reason. Precompute once.

**Tradeoffs:** Every scrubber signature is now `(event, ctx)` even when
unused. Mitigation: existing scrubbers accept a second optional
parameter naturally.

**Revisit if:** Another cross-event scrub needs a different precomputed
fact (then add a second field to `ScrubContext`).

---

## DEC-002 — M1 fixes both Adversarial #1 (map-blob payload) AND #2 (causedByResponseId) in one commit (2026-05-29)

**Decision:** Bundle the two field-granularity scrubber additions into a
single M1 ship because they share the same scrubber-registry mechanism and
the same test infrastructure.

**Why:** The `PER_KIND_SCRUBBERS` registry is the cleanest place for both.
Shipping them together means one new self-completing tripwire (Adversarial
#3) covers both. Splitting would double the design overhead for negligible
risk reduction.

**Alternatives:**
- Two separate commits. Rejected: needless ceremony.
- Defer #2 because it's "latent today." Rejected: latent-today is exactly
  when an audit-trail field gets quietly added downstream; the cheap fix
  now precludes the regression.

**Tradeoffs:** One slightly larger commit. Mitigation: tests cover each
case independently so bisect still works.

**Revisit if:** The two fixes pull in different directions during
implementation (then split).
