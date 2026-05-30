# Open Problems

Bugs found but not yet fixed; questions awaiting human judgment. Each entry:
severity, evidence, hypothesis, owner, status.

Newest at top. When fixed, link to the commit and move to a separate
"resolved" section at the bottom.

---

## OP-016 — Cross-origin CORS for the token-exchange endpoint is unverified (BLOCKING)

**Severity:** P1 (blocks M6a ship).
**Evidence:** `auth-strategy-review.md` SEC-3.
`oauth2.googleapis.com/token` is documented as PKCE-CORS-compatible
for public clients, but real-world behavior varies. The browser
will fail with CORS errors if assumptions are wrong.
**Hypothesis:** Build a dev-only probe FIRST: hit token endpoint
with bogus code+verifier, assert JSON-error response (CORS open)
NOT CORS-blocked failure. If blocked, fall back to a Cloudflare
Worker as a token-exchange proxy.
**Owner:** save-restore lead.
**Status:** open. BLOCKS M6a implementation start.

---

## OP-015 — COOP/COEP headers + popup-blocker fallback for OAuth flow

**Severity:** P2 (popup-blocker breakage).
**Evidence:** `auth-strategy-review.md` PRV-1. Aggressive popup-
blockers (Firefox Strict mode, Safari ITP) can break the popup-
postMessage flow.
**Hypothesis:** Document Cross-Origin-Opener-Policy:
same-origin-allow-popups requirement. Build full-page-redirect
fallback when popup is blocked OR communication fails.
**Owner:** save-restore lead.
**Status:** open. Needs to land before M6a ships.

---

## OP-014 — Microcopy for OAuth-flow buttons must read as "leaving Quire"

**Severity:** P2 (UX-acceptance gating).
**Evidence:** `auth-strategy-review.md` UX-1. From the human's
mandate: the OAuth popup must feel like "I'm leaving Quire to talk
to Google", NOT "Quire is asking for my password."
**Hypothesis:** Button labeled "Back up to Drive" with microcopy
"You'll authenticate with Google. Quire never sees your password."
Defer final string to M8 in-fiction copy review.
**Owner:** save-restore lead (TTRPG-expert routing for M8).
**Status:** open. Visual review needed once M6a UI lands.

---

## OP-013 — Self-hoster override of OAuth client_id

**Severity:** P3 (deployment / trust model).
**Evidence:** `auth-strategy-review.md` ARC-3. Quire is a static
bundle that self-hosters deploy; one canonical client_id covers
the maintainer-hosted instance, but self-hosters need their own.
**Hypothesis:** Build-time env var (default canonical id) + runtime
config override. Document the trust trade-off.
**Owner:** save-restore lead.
**Status:** open. Needs design before M6a deploys publicly.

---

## OP-012 — Push UI must warn on shared-link destinations [SUPERSEDED by DEC-009]

**Severity:** P2 (firewall — civilized-peer disclosure model).
**Resolution:** DEC-009 defaulted Drive scope to `drive.appdata`
(hidden, unshareable). The share-link risk is gone for default
users. The opt-in `drive.file` path still needs the ACL-check
warning — re-scope this OP to "implement ACL check for opt-in
`drive.file` users" if/when we build that path.
**Status:** superseded; defer to opt-in-`drive.file` build.

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

## OP-010 — Cloud file format: full save vs append-only chunks [CLOSED by ARC-1 review 2026-05-29]

**Severity:** P2 (architecture choice with downstream UX impact).
**Resolution:** ARC-1 review settled on "same `SaveDocument`
format on both Drive and GitHub destinations" — runtime already
produces deterministic git-friendly JSON via `stringifySave`.
Git's line-level diff on the alphabetically-sorted per-event lines
handles the "small diff" property automatically. Format-per-
destination complexity dropped.

---

## OP-009 — Token persistence: re-auth per session vs encrypted refresh-token [RESOLVED by DEC-008 2026-05-29]

**Severity:** P1 (UX vs security trade-off).
**Resolution:** DEC-008 layered ship: M6a is ephemeral (re-auth per
session — strict C4). M6b adds passphrase-encrypted refresh_token in
IndexedDB. APP users degrade to M6a behavior automatically.

---

## OP-008 — GitHub auth shape: Device Flow vs PKCE; OAuth App vs GitHub App [RESOLVED by UX-2 + DEC-008 2026-05-29]

**Severity:** P2 (architecture choice).
**Resolution:** Device Flow chosen per UX-2 review (better fit for
DM-at-table ceremony — "open this URL on your phone, type the
code"). Public-repo only in v1; private-repo support deferred
(needs GitHub App registration). Lands as M6c per DEC-008.

---

## OP-007 — Google Drive OAuth flow under Advanced Protection Program [PARTIALLY RESOLVED 2026-05-29]

**Severity:** P1 (locked human constraint — must work under APP).
**Resolution:** PKCE + `drive.appdata` is on Google's APP-allowed
list (verified per Google docs as of draft 2). M6a (ephemeral, re-
auth every session) is explicitly APP-safe. M6b's passphrase-
encrypted refresh_token may be APP-revoked aggressively; in that
case M6b users on APP-enabled accounts degrade gracefully to M6a
behavior — the runtime detects refresh-token-revocation and re-
prompts for auth.
**Status:** partially resolved (M6a path locked). M6b APP-specific
behavior needs a real-world test once code lands.

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
