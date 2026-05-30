# Open Problems

Bugs found but not yet fixed; questions awaiting human judgment. Each entry:
severity, evidence, hypothesis, owner, status.

Newest at top. When fixed, link to the commit and move to a separate
"resolved" section at the bottom.

---

## OP-006 — GitHub-push and Drive-sync are implied but not built (HUMAN DECISION REQUIRED)

**Severity:** P1 (honesty / promise-keeping)
**Evidence:** No code path writes to GitHub for the event log; no Drive
adapter. UI copy and documentation reference durable-backup paths that
don't exist.
**Hypothesis:** Two choices: (a) build GitHub-push for the event log
(1–3 days) and skip Drive for now; (b) strip the implication and park
both on a roadmap. Drive sync is a 1–2 week project.
**Question for human:** Build or strip? Recommended default: **strip
+ park** — the engineering cost is real and the threat-model questions
(whose token? whose repo? does a player's event log push to the DM's
repo?) need design before code.
**Owner:** save-restore lead (proposal); human (decision).
**Status:** awaiting decision. M6 milestone.

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

## OP-004 — Coordinator-reclaim has no LWW determinism test under same-millisecond authorship

**Severity:** P2 (correctness, low probability)
**Evidence:** Architect finding #4. `coordinator-reclaim-race.spec.ts`
doesn't exist; the property is alluded to in the test plan but not pinned.
**Hypothesis:** Two reclaims authored at the same ts deterministically
break the tie by peerId (the existing LWW rule). Need a regression test
to keep this true under refactor.
**Owner:** save-restore lead (delegate to test-QA agent).
**Status:** queued for M4 (CI gate work).

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

## OP-001 — `applyEvent` does not broadcast (LIVE BUG)

**Severity:** P0 (breaks the user-stated promise)
**Evidence:** Architect finding #1. `Peer.applyEvent` at `core/peer.ts:158-171`
calls `this.log.apply(event)` and notifies, but never sends. Hub-forwarding
via `sync-response` only fires from `handleMessage`, not from local apply.
**Hypothesis:** Add a `propagate` flag (default `false` for the
load-restore case so we don't re-broadcast the WHOLE save on every load).
Actually wait — that's the opposite of what we want. The thread is: when a
peer loads its OWN save and then joins a session, its unique events MUST
reach the table. The pull-based sync-response from a NEW peer would carry
them IF the joining peer responds to other peers' sync-requests with its
log — which IT DOES via the existing `handleMessage` → `sync-request`
path. So is this a real bug or not? **Needs investigation in M3.**
**Owner:** save-restore lead.
**Status:** queued for M3 — must reproduce before fixing.
