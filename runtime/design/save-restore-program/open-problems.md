# Open Problems

Bugs found but not yet fixed; questions awaiting human judgment. Each entry:
severity, evidence, hypothesis, owner, status.

Newest at top. When fixed, link to the commit and move to a separate
"resolved" section at the bottom.

---

## OP-012 — Push UI must warn on shared-link destinations

**Severity:** P2 (firewall — civilized-peer disclosure model).
**Evidence:** `auth-strategy.md` A6. If a DM pushes their full DM-coord
save to a Drive file that is shared "Anyone with the link can view",
the cleartext save is exposed to everyone with the link.
**Hypothesis:** Before the first push to a destination, query Drive
for the file's ACL. If anything other than "private to me", surface a
DM-only warning ("This file is shared with X. Push?"). Re-check on
ACL changes is best-effort.
**Owner:** save-restore lead (UX expert routing).
**Status:** open. Pending UX validation in M6.

---

## OP-011 — Multi-DM concurrent push: conflict UX

**Severity:** P3 (rare, multi-DM only).
**Evidence:** `auth-strategy.md` A7. Two DMs (co-DM and primary)
pushing to the same Drive file concurrently.
**Hypothesis:** Pull-rebase-push semantics using Drive's `revision_id`
as the optimistic concurrency token. The CRDT merge already exists at
the event-log layer; the cloud-sync layer just needs the orchestration.
**Owner:** save-restore lead (architecture routing).
**Status:** open. Pending architect review in M6.

---

## OP-010 — Cloud file format: full save vs append-only chunks

**Severity:** P2 (architecture choice with downstream UX impact).
**Evidence:** `auth-strategy.md` A1 / OQ6. Full materialized save is
simpler but produces large diffs and is lossy under simultaneous
writes; append-only chunks plays well with branch-divergence but is
harder to "open in a text editor and read."
**Hypothesis:** Default to full materialized save (matches current
`SaveDocument` format; user can grep for content). Defer chunked
mode if the diffs become a problem.
**Owner:** save-restore lead (architecture routing).
**Status:** open. Pending architect input in M6.

---

## OP-009 — Token persistence: re-auth per session vs encrypted refresh-token

**Severity:** P1 (UX vs security trade-off).
**Evidence:** `auth-strategy.md` A1 / OQ1+OQ2. Strict C4 ("no creds in
browser") means re-auth every Quire session. The alternative is a
passphrase-encrypted refresh-token in IndexedDB.
**Hypothesis:** Start with re-auth-every-session (strict C4). If UX
expert rules it unacceptable, design the WebCrypto-passphrase variant
as a follow-up. APP users get re-auth regardless.
**Owner:** save-restore lead (UX expert + security reviewer).
**Status:** open. Pending UX validation in M6.

---

## OP-008 — GitHub auth shape: Device Flow vs PKCE; OAuth App vs GitHub App

**Severity:** P2 (architecture choice).
**Evidence:** `auth-strategy.md` A4 / A5 / OQ4. Device Flow is more
natural at a TTRPG table (DM uses phone to authenticate); PKCE is
faster (one popup). Private repos need fine-grained scoping which
OAuth Apps can't provide (would need a GitHub App).
**Hypothesis:** Ship Device Flow + public-repo-only in v1. Document
private-repo as v1.1 follow-up requiring GitHub App registration.
**Owner:** save-restore lead (UX expert routing).
**Status:** open. Pending UX validation in M6.

---

## OP-007 — Google Drive OAuth flow under Advanced Protection Program

**Severity:** P1 (locked human constraint — must work under APP).
**Evidence:** `auth-strategy.md` A3 / OQ10. APP users have stricter
refresh-token rules and consent UI behavior.
**Hypothesis:** PKCE + `drive.file` scope is on Google's APP-allowed
list. Verify with the security reviewer that the proposed flow does
not trip APP gates (especially around refresh tokens). The strict-C4
"re-auth every session" path degrades gracefully under APP.
**Owner:** save-restore lead (security reviewer routing).
**Status:** open. Pending security review in M6.

---

## OP-006 — GitHub-push and Drive-sync are implied but not built [DECISION 2026-05-29: BUILD]

**Severity:** P1 (honesty / promise-keeping)
**Resolution:** Human made the call: **build cloud sync**. Constraints
locked: OAuth-based, no credentials in browser, must work under Google
APP. See `auth-strategy.md` for the draft architecture (draft 1
written this session, pending security consultants + UX validator).

Sub-problems now tracked separately:
- OP-007: OAuth flow design (Google Drive PKCE vs APP-compat). [open]
- OP-008: GitHub auth shape (Device Flow vs PKCE; OAuth App vs GitHub
  App for private-repo scoping). [open]
- OP-009: Token persistence — accept "re-auth per session" or build
  refresh-token + WebCrypto-passphrase encryption? [open, UX-routed]
- OP-010: Cloud file format — full materialized save vs append-only
  event-log chunks. [open, architecture]
- OP-011: Multi-DM concurrent push conflict UX. [open, architecture]
- OP-012: Push UI must warn on shared-link destinations. [open, UX +
  adversarial]

---

## OP-005 — Strip-on-restore is destructive, restore UX gives no warning

**Severity:** P2 (data-loss-on-import)
**Evidence:** Architect finding #3 (`persistence.ts:455-486`). A player's
save is stripped of DM-only events; if a DM loads that player's save, the
DM-only state is permanently gone unless the DM also has their own save to
merge.
**Hypothesis:** When restoring a non-coord save, surface "this save was
authored by a player viewer — DM-private state will be missing. Continue?"
Plus offer "merge with your own save" if one exists.
**Owner:** save-restore lead.
**Status:** parked for M5 (it's discoverability-shaped, not crash-shaped).

---

## OP-004 — Coordinator-reclaim has no LWW determinism test under same-millisecond authorship [RESOLVED 2026-05-29]

**Severity:** P2 (correctness, low probability)
**Resolution:** M4 commit. `persistence.restore-drill.test.ts` now
includes two LWW-determinism tests:
1. Concurrent `coordinator-claim` from two peers converges to the same
   coordinator across cross-replication (the realistic case — two
   peers each appending without seeing the other first).
2. The same convergence survives a save → restore byte-roundtrip.
The original "two events at same ts with same seq" formulation was
unreachable via the public API (EventLog rejects events whose id
doesn't match `peerId:seq`); the concurrent-append framing is the
real-world equivalent.

---

## OP-003 — `PER_KIND_SCRUBBERS` is hand-maintained [RESOLVED 2026-05-29]

**Severity:** P1 (firewall regression class)
**Resolution:** M1 commit landed `EVENT_KINDS_NO_SCRUB_NEEDED` + lint in
`persistence.coverage.test.ts`. Every player-visible kind must now be in
exactly one of the two sets. A new player-visible kind without an
explicit decision trips CI.

---

## OP-002 — Fuzz coverage is asymmetric [RESOLVED 2026-05-29]

**Severity:** P1 (firewall coverage gap)
**Resolution:** M1 commit landed `persistence.firewall-fuzz.test.ts` —
40 seeded scenarios across 12 payload shapes; 0 sentinels survive the
non-coord projection; positive-control test ensures revealed labels
are KEPT.

---

## OP-001 — `applyEvent` does not broadcast [RESOLVED 2026-05-29]

**Severity:** P0 (breaks the user-stated promise)
**Resolution:** Reproduced in
`src/core/peer.restore-rebroadcast.test.ts`. The 2-peer case
works (pull from new joiner), the 3-peer "alice restores AFTER
joining, bob+carol already connected" case FAILS pre-fix.
`applyEvent` now propagates via `forwardShareToOthers` (sync-response)
by default. Opt-out via `{ propagate: false }` preserved for the
session-controller `regenerateCode` path.
See DEC-005 for full rationale.
Commit: M3 ship.
