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

## DEC-015 — Cross-device cloud discovery is pull-on-discovery, never auto-load (2026-05-29)

**Decision:** When a DM lands on a campaign URL with no local
state AND has connected Drive, Quire probes `drive.appdata` for
a file matching the campaignId. If found, surface "[Load it]
[Start fresh]" — Load is the default action. NEVER auto-load
silently.

**Why:** NEW-UX-2 framed the failure mode: DM on tablet next
week with empty localStorage doesn't know the cloud backup
exists; starts a fresh save; the next push destroys last week's
events (pull-rebase-push can't rebase empty). Auto-load would
solve discoverability but violates "no surprise restore" — a
DM intending a fresh start should never have last week's events
silently replayed.

**Alternatives:**
- Auto-load when local is empty. Rejected: silent restore is
  worse than missing backup; surprises the DM.
- No probe — DM must manually click "Pull from Drive." Rejected:
  per NEW-UX-2 this is the failure mode itself.

**Tradeoffs:** Probe runs on every cold landing where Drive is
connected. Drive API call cost is one HEAD per campaignId;
acceptable. Surface delay (~200ms median) is part of the page
render budget.

**Revisit if:** A DM reports the prompt is intrusive on repeat
visits; cache the probe result with a freshness window.

---

## DEC-014 — Co-DM Drive ownership is per-DM-appdata for M6a; shared model deferred to M6c (2026-05-29)

**Decision:** Each co-DM connects their OWN Drive account and
pushes to their own `drive.appdata`. Pull-on-discovery (DEC-015)
probes whichever co-DM is currently signed in. Shared canonical
ownership is deferred to M6c (GitHub naturally shares via
co-author commits on the same repo).

**Why:** NEW-UX-4 identified the gap; per-DM-Drive is the
simplest M6a model with no shared-state coordination. Designated-
backup-DM and shared-Drive ownership models require additional
ceremony (manifest events, ratification) that's M6c-shaped.

**Alternatives:**
- Designated backup-DM with hand-off recorded in manifest event.
  Rejected for v1: extra UI surface + edge cases around primary-
  DM-loss recovery exactly when we need backup most.
- Shared Drive folder via `drive.file`. Rejected: re-introduces
  the ADV-1 share-link risk DEC-009 defaults closed.

**Tradeoffs:** Co-DMs each hold an independent backup; the CRDT
merge layer handles divergence at restore time. Documented
limitation: if BOTH co-DMs lose access to their accounts, no
backup survives. Mitigated by M6c (GitHub) sequencing.

**Revisit if:** Real co-DM workflows surface a need for a
canonical shared backup; promote M6c or design a shared-Drive
mechanism.

---

## DEC-013 — Default to runtime-overridable `client_id` from day one (2026-05-29)

**Decision:** Quire ships with a canonical client_id PLUS three
override mechanisms from day one:
1. Build-time env var (`QUIRE_OAUTH_CLIENT_ID`) for self-hosters.
2. Runtime query parameter (`?clientId=...`) for emergency
   discovery rotation.
3. Campaign-manifest field (`oauth.clientId`) for per-campaign
   override.

Plus a discovery-document fetch at `/.well-known/quire-oauth.json`
that returns the current canonical client_id + a status flag.
If status is `unavailable`, surface "client_id unavailable —
self-host or wait for fix" graceful-degradation banner.

**Why:** NEW-SEC-5 framed the incident-response gap: if the
canonical client_id is compromised (or revoked by Google, or
abuse-rate-limited), rotation requires every DM to fetch a new
bundle. Cloudflare Pages CDN cache lag means hours of degraded
state. NEW-ADV-5 framed the supply-chain integrity angle: the
shipped client_id is a security primitive an attacker who
compromises the deploy can swap.

Subsumes OP-013 (self-hoster override) — the same mechanism
serves both incident-response rotation AND self-hosters.

**Alternatives:**
- Build-time only override. Rejected per NEW-SEC-5: a DM whose
  client_id was rotated must wait for a new deploy + cache
  invalidation; minutes-to-hours of unavailable backups.
- Canonical-only (no override). Rejected: single point of
  failure on the maintainer's OAuth app.

**Tradeoffs:** Three override paths is more surface to test +
document. Mitigation: query-param override is hidden behind a
documented incident-response procedure ("emergency rotation");
campaign-manifest override is opt-in per campaign; env-var
override is documented in the self-hoster setup guide.

**Revisit if:** Override usage becomes a vector for tricking
DMs into auth-ing to a malicious client_id (then add a "you
are using a non-canonical client_id" warning banner).

---

## DEC-012 — `state` nonce binds intent, not just CSRF (2026-05-29)

**Decision:** The OAuth `state` parameter encodes the user's
INTENT alongside the CSRF nonce:

```
state = base64url({
  nonce: <crypto.getRandomValues 256-bit>,
  intent: 'push' | 'pull' | 'connect',
  campaignId: '<owner>/<repo>@<ref>',
  fileRev: '<drive-revision-id> | null',
  ts: <ms-epoch>,
  flowId: '<per-flow-uuid>'
})
```

Plus an HMAC over the intent fields using a per-tab session
secret (generated at first `state` mint, stored in sessionStorage).
On OAuth return:
1. Verify HMAC (defends against tampering).
2. Verify `flowId` matches the listener's current flow (NEW-SEC-1).
3. Verify `campaignId` matches the currently-foregrounded
   campaign (NEW-SEC-2).
4. Verify `ts` is within 10 minutes (stale-state defense).

**Why:** NEW-SEC-2 framed the gap: classic OAuth `state` answers
"did this auth response correspond to MY request?" but NOT "and
that request was to push CAMPAIGN X." A two-flow race lets a
returning auth token write to the wrong campaign.

Civilized-peer threat model accepts `campaignId` landing in
URL-bar history (NOT a spoiler-relevant disclosure for Quire's
model). Confirmed by adversarial-routing per the security
consultant's hand-off.

**Alternatives:**
- Opaque `state` (today's draft). Rejected per NEW-SEC-2.
- Server-side intent storage. Rejected: would re-introduce a
  server component the no-server architecture excludes.

**Tradeoffs:** `state` becomes longer (~200 chars vs ~40). Still
well under URL length limits.

**Revisit if:** Campaign-id-in-URL-bar becomes a complaint
surface (re-evaluate the firewall classification).

---

## DEC-011 — Player content consent ceremony on first cloud push (2026-05-29)

**Decision:** On the first cloud push for a campaign, surface a
one-time DM-only acknowledgment dialog (silent-player-firewall
preserved — players are NOT notified):

> "You are uploading the full table's content (including your
> players' chat, character drafts, and bond notes) to YOUR
> Google Drive. Players can read what they have written to this
> campaign; they cannot see this Drive folder. [Acknowledge]"

The acknowledgment is per-campaign, persistent (`localStorage`),
re-prompted on campaign-id change or destination change.

**Why:** NEW-PRV-4 framed the gap: the DM-coord projection
contains every player's authored content (chat, character drafts,
bond notes, intent statements). Silent upload to the DM's Drive
violates Quire's firewall ethos ("never tell a player about a
thing they didn't consent to") in spirit — the player didn't
consent to their words leaving the table. Also surfaces GDPR-
adjacent concerns; the home-game safe harbor is unclear when
content includes adult/violent fiction.

**Alternatives:**
- Per-player opt-out UI. Rejected for v1: prime directive
  violation (admin before play). Deferred to v2 if a real DM
  raises it.
- No acknowledgment. Rejected: silent custody transfer of
  player content fails the firewall ethos test.

**Tradeoffs:** One extra click per campaign on first push.
Mitigation: the dialog is also the natural surface for the
NEW-ADV-4 "what's saved" disclosure (DEC-010 sibling).

**Revisit if:** A player surfaces objection to backed-up
content; promote per-player opt-out.

---

## DEC-010 — Restore + rebroadcast firewall is BOTH apply-side and broadcast-side (2026-05-29)

**Decision:** NEW-ADV-1 + NEW-ADV-2 closure shipped in
commit `a7dedac`. Two complementary surfaces:

1. **Apply-side projection.** `persistence.ts` exports
   `projectSaveForViewer(doc, viewerIsCoord)`, the symmetric
   restore-side companion to `serializeSessionForViewer`.
   `quire-app.loadFromString` calls it with
   `viewerIsCoord=(sessionView.mode==='host')` before applying.
   Host loads are a no-op projection (auto-reclaim on next tick);
   guest loads strip DM-only events from the save before they
   reach the local event log.

2. **Broadcast-side classifier.** `persistence.ts` exports
   `defaultRebroadcastFilter(event)`. `Peer` takes an optional
   `rebroadcastFilter` in its constructor options;
   `session-controller.ts` wires the default into production.
   `Peer.forwardShareToOthers` runs every event through the
   filter before sending — DM-only kinds dropped, partial-
   payloads field-scrubbed via the same `PER_KIND_SCRUBBERS`
   registry that the save-side projection uses.

**Why:** The independent adversarial consultant's NEW-ADV-1 is
the 5th breach in the render-gated-but-restore-not-gated class
(same class as #392/#393/#395 + M1 map-blob). NEW-ADV-2 is the
sister leak from DEC-005's auto-broadcast — even though
NEW-ADV-1's projection prevents DM-only events from ENTERING
the loading peer's log in the happy path, the broadcast filter
is the defense-in-depth net if that projection ever regresses
OR if a DM-only event reaches the log via a different path
(buggy peer, hostile save, future regression).

Both fixes use the SAME `PER_KIND_SCRUBBERS` + `PLAYER_SCOPE_STRIP_KINDS`
registry; no new firewall list. The SSOT keeps classification
load-bearing across save / load / rebroadcast surfaces.

**Why injected (not imported) for the Peer filter:** The
`core/` layer must not depend on `persistence.ts` (would
introduce a circular import). Dependency injection via the
constructor option keeps `core/peer.ts` clean and lets
`session-controller.ts` wire the production seam.

**Alternatives:**
- Hard-refuse a coord-projection save when the local peer is
  non-coord ("Reclaim coord first, then import."). Rejected:
  legitimately broken for the cross-week sick-DM-handoff case
  where the new coord LEGITIMATELY needs the prior DM's
  scratch-notes + AI-context.
- Move `PLAYER_SCOPE_STRIP_KINDS` into `core/` so peer.ts can
  import it directly. Rejected as a larger refactor; revisit if
  more controllers need the firewall registry.
- Skip the rebroadcast filter and rely on NEW-ADV-1 alone.
  Rejected: defense-in-depth; the SAME firewall regression
  pattern keeps recurring (#392/#393/#395/M1 + now NEW-ADV-1).
  The cost of the filter is one PER_KIND_SCRUBBERS lookup per
  rebroadcast call; negligible.

**Tradeoffs:** Map-blob payloads at rebroadcast time use a
conservative empty reveal-mask (drop labels). The receiving
peer re-materializes the revealed state from its own log. A
player who receives a rebroadcast `map-blob-add` for a
not-yet-revealed blob sees it appear on their map without a
label until the reveal fires. Acceptable; the alternative
(send the label, trust the receiver to strip on render) is
the exact regression class NEW-ADV-2 catches.

**Revisit if:** A real session shows the conservative reveal-
mask is too aggressive for legitimate map-blob workflows
(then teach the filter to compute the reveal-mask from the
receiving peer's log before sending).

---

## DEC-009 — Default Drive scope is `drive.appdata`, not `drive.file` (2026-05-29)

**Decision:** Cloud-sync to Google Drive defaults to the
`drive.appdata` scope (hidden per-app folder). `drive.file` is
available as an opt-in setting for users who want manual recovery
via Drive's UI.

**Why:** The ADV-1 review finding (in `auth-strategy-review.md`)
identified a P1 leak: a DM accidentally clicking "Anyone with link
can view" on their Drive UI exposes the cleartext save (DM-coord
projection includes DM-only events) to anyone with the link.
`drive.appdata` is not visible in the user's Drive UI and not
shareable — closes the leak path structurally rather than relying
on a runtime warning.

**Why opt-in `drive.file`:** Some users want a manual backup workflow
("if Quire breaks, I can grab the JSON from my Drive"). Offer it,
with a docs link explaining the share-link warning.

**Alternatives:**
- Default to `drive.file` with ACL-check warning. Rejected: the ACL
  query has eventual-consistency concerns and the warning relies on
  the DM reading it before clicking through.
- Don't offer `drive.file` at all. Rejected: removes a legitimate
  recovery path some users will value.

**Tradeoffs:** `drive.appdata` is opaque to the DM (no manual
inspection via Drive UI). Mitigation: DM-only operational view
exposes a "Download backup" button that fetches the appdata file
and saves it to local disk.

**Revisit if:** Google deprecates `drive.appdata` or imposes a
quota that hurts. (Currently quota is shared with Drive's main 15GB
free tier; not a problem for sub-1MB Quire saves.)

---

## DEC-008 — M6 ships in three layered stages: appdata-ephemeral → passphrase-refresh → GitHub (2026-05-29)

**Decision:** M6 splits into M6a/M6b/M6c.
- **M6a:** Google Drive `drive.appdata` + PKCE + ephemeral
  access_token in JS memory (re-auth per session).
- **M6b:** Add passphrase-encrypted refresh_token in IndexedDB for
  cross-session persistence. APP users degrade to M6a.
- **M6c:** GitHub Device Flow + same save format committed to a
  configured repo path.

**Why:** Per UX-3 review finding, "re-auth every session" is
UX-unacceptable for weekly DMs. But the strict-no-creds C4 constraint
also has real value (especially for APP users). The layered ship
gets us the SHIPPABLE-FROM-DAY-ONE M6a while the UX-acceptable
M6b lands as a follow-up. M6c is the GitHub path which is similar
mechanics but different ceremony — natural follow-up.

**Alternatives:**
- Single-shot ship of all three. Rejected: too much scope for one
  reviewable commit; review surface area is enormous.
- Skip M6c entirely. Rejected: Underleaf is already GitHub-hosted;
  the symmetry of "campaign content on GitHub, saves on GitHub
  too" is valuable.

**Tradeoffs:** M6a-only is the minimum-viable ship. DMs running M6a
will re-auth per session for the duration of M6b development.

**Revisit if:** M6a UX is acceptable enough that M6b is unnecessary.
(Polling DMs after a few sessions of M6a-only will tell us.)

---

## DEC-007 — Build cloud sync (M6); strict OAuth + no creds in browser is the floor (2026-05-29)

**Decision:** Build cloud sync per the human's mid-session OP-006 call.
Locked constraints in `auth-strategy.md`:
- OAuth-based (PKCE for SPAs; no client_secret in the browser).
- No long-lived secrets persist unencrypted in localStorage / IndexedDB.
- Minimum-viable scopes: `drive.file` (Google), `public_repo` v1
  (GitHub).
- Must degrade gracefully under Google Advanced Protection Program.
- DM-initiated, manual push/pull is acceptable (no background daemon).
- Browser-to-browser sync (WebRTC) remains the live-session default;
  cloud is the **durability layer** for "all browsers evicted."

**Why:** The human explicitly chose build-over-strip and gave the
architectural shape ("OAuth ideally, user logs into third party then
pushes from browser, no credential sharing, scope-minimal, APP-compat").
This converts OP-006 from a binary-choice question into a design-and-
ship effort with consultant review as gating.

**Alternatives:**
- Strip the implication (was the prior recommended-default). Rejected by
  the human; we now have specific design constraints to work against.
- Build without security review. Rejected: the constraints are tight
  enough (no creds, APP, minimum scope) that getting them wrong
  silently could expose user data in a way that's hard to reverse.

**Tradeoffs:** Real engineering cost (estimated 1-2 weeks per provider).
Mitigation: design first, ship second. Draft 1 of `auth-strategy.md`
captures the architecture in writing for consultant review BEFORE any
code lands.

**Revisit if:** A consultant surfaces a fundamental obstacle (e.g.
"`drive.file` doesn't actually persist across sessions the way we
think"). Then re-scope.

---

## DEC-006 — M4 ships drill tests as standard CI, not nightly (2026-05-29)

**Decision:** The M4 restore-drill tests live in
`src/persistence.restore-drill.test.ts` and run on every `npm test`
(every CI invocation). NOT moved to a separate nightly job.

**Why:** The original roadmap framed M4 as "nightly job" because the
e2e versions of these scenarios are slow. The in-memory transport
makes the unit-test version ~140ms wall-clock for all 12 tests —
effectively free. Nightly would just add another infra path to
maintain for no latency win.

**Alternatives:**
- Separate nightly workflow firing on a schedule. Rejected: pure
  overhead. `npm test` already runs these.
- Keep in e2e only. Rejected: CI skips e2e; regressions land silently.

**Tradeoffs:** A devloper running `npm test` pays ~140ms more per run.
Mitigation: trivial.

**Revisit if:** The drill grows to 100+ tests and wall-clock matters.
Then split into `test:drill` ↔ `test:fast` and run the drill nightly +
on tagged commits only.

---

## DEC-005 — `applyEvent` propagates via the `sync-response` gossip path by default (2026-05-29)

**Decision:** `Peer.applyEvent(event)` now forwards newly-applied
events to all connected peers using `forwardShareToOthers` (sync-
response, hub-forwarding path). Callers can opt out with
`{ propagate: false }`.

**Why:** The architect-claim reproduction
(`peer.restore-rebroadcast.test.ts`) showed the 3-peer race: bob+carol
are connected, alice joins, on-connect bob+carol sync-request alice
who responds with EMPTY (her log was just constructed), THEN alice
loads N events via applyEvent. Pre-fix those N events never reach
bob+carol — pull-only model leaves a permanent gap. Default-on
propagation closes it.

**Why sync-response not share:** The `share` envelope is rejected by
the R2.1 impersonation defense when `event.peerId !== from`. Restored
events may be authored by a PRIOR session's peers (e.g. "bob's log
was restored from alice's autosave"). `sync-response` is exempt by
design — gossip-forwarding inherently re-ships events authored by
others. Recipients dedup via the EventLog id check, so retries are
idempotent.

**Alternatives:**
- Always propagate (no opt-out). Rejected: the `regenerateCode` path
  in session-controller leaves the network + rejoins; propagating
  during the in-between window has nothing to broadcast to and
  generates wasted work later. The opt-out keeps the seam usable.
- Batch propagate (one sync-response with all loaded events). Future
  optimization. Today's per-event broadcast is O(N×P) but correct;
  recipients dedup. Real campaigns load <10k events from save,
  multiplied by <8 peers ≈ 80k message-sends. localStorage saves
  the day on per-message overhead. Revisit if profiling shows it
  matters.
- Make the loader call `Peer.append` to "re-author" each event.
  Rejected: that creates NEW event ids and breaks idempotency,
  defeats the LWW determinism, and double-counts every restored
  event for everyone who already had it.

**Tradeoffs:** A peer who restores from save fires N broadcasts. For
realistic N (<10k for a long campaign) this is acceptable. The
recipient dedup at EventLog.apply makes retries free.

**Revisit if:** A profiling pass shows the per-event broadcast is
a bottleneck for a real DM session. Then batch into chunks.

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
