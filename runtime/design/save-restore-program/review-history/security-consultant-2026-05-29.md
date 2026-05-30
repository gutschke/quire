# Security/OAuth independent review — 2026-05-29

## Briefing received

Independent OAuth/web-security consultant pass on draft 2 of
`auth-strategy.md`. The program lead self-reviewed (16 findings,
SEC-1..5, PRV-1..2, ADV-1..3, UX-1..4, ARC-1..3) but is the same
brain that drafted, so the human asked for a fresh lens. Charter:
go AROUND the existing 16; probe OAuth race conditions, token
lifecycle anomalies, the Cloudflare Worker fallback's new surface,
single-point-of-failure on the canonical OAuth app, APP edge
cases, browser-isolation interactions, KDF specifics, state-nonce
intent binding, and save-format git-friendliness under realistic
DM/player conditions. Verify against the reviewer-playbook creed
(cite file:line, trace real paths, ship the regression). Output a
~1500-word report.

## Verdict

Draft 2's architecture is broadly sound, but it ships several
unstated assumptions that are individually small and collectively
load-bearing. The lead's self-review caught the obvious crypto
shape (PKCE, S256, drive.appdata) but missed multiple **flow-state
machine** bugs and underspecified the **passphrase KDF** in a way
that could land an M6b that's worse than no encryption at all.
Recommend: ship M6a after fixing NEW-SEC-1, NEW-SEC-2, NEW-SEC-3,
NEW-ARC-1. Block M6b until KDF (NEW-SEC-7) and intent binding
(NEW-SEC-4) are specified. Block any Worker fallback (NEW-ARC-2)
behind an explicit decision record.

## Found by this review (NOT in the lead's self-review)

### NEW-SEC-1 — Two-tab concurrent OAuth races overwrite `code_verifier` (P1)

**Claim.** `auth-strategy.md:69` says "SPA stores `code_verifier`
in sessionStorage." Two Quire tabs in the same browser do NOT
share sessionStorage (it's per-tab), so they don't collide there
— but each will write under the **same well-known key**. The
real collision is the `state` nonce check: tab A initiates, tab B
initiates, the user completes tab B's flow first; the popup's
postMessage from tab B's popup goes to **both opener tabs** (any
listener registered on the same origin via BroadcastChannel- or
window.opener-style relays), and tab A may accept tab B's `code`
because tab A's listener doesn't know `event.source !== mine`.
The lead's SEC-2 fix says "validate `event.source === popup`" —
but tab A's `popup` reference is tab A's own popup window, not
tab B's. Whether the check fires correctly depends on whether
tab B's popup is opened via `window.open` against tab A's opener
context (it isn't — each tab opens its own), so `event.source`
check DOES protect, IF the listener is scoped to that popup.
**The hidden bug:** the design doesn't say the message listener
is added/removed per-flow. A long-lived listener will accept any
postMessage from our origin, and `state` validation will still
pass IF both tabs minted the same nonce (they shouldn't, but a
re-mount on browser back-navigation can re-use it).

**Evidence.** `auth-strategy.md:67-94` does not specify listener
lifecycle. No file:line in code yet (M6a unimplemented).

**Why the lead missed it.** Self-review fixated on
single-tab popup→opener semantics. Two-tab is a workflow case,
not a crypto case.

**Fix proposal.** Spec: (a) listener added at `window.open`,
removed in popup-onclose or onmessage-success; (b) `code_verifier`
+ `state` keyed by a per-flow UUID (`quire.oauth.flow.<uuid>`),
not a single well-known key; (c) on popup return, opener
validates `event.data.flowId === my.flowId` before redeeming.

### NEW-SEC-2 — `state` nonce is not bound to the user's INTENT (P1)

**Claim.** SEC-5 says the nonce is CSRF defense; that's correct
for "did this auth response correspond to MY request?" but does
NOT bind "and that request was to push campaign X." A user
clicks "Push campaign X to Drive", a different code path fires
"Pull campaign Y from Drive" before the auth completes, both
flows mint their own nonces, but the SPA's "what was the user
trying to do" state is held in a single in-memory variable that
got overwritten. Token comes back, the wrong campaign gets
written.

**Evidence.** `auth-strategy.md:69-94` and the design's token-
threat-model table (line 269) treat `state` as an opaque CSRF
token, not an intent-bound capability.

**Why the lead missed it.** OAuth specs frame `state` as anti-
CSRF only. Quire's failure mode is application-level
(intent-pinning), not classic CSRF.

**Fix proposal.** Embed intent in `state`: `state =
base64url({nonce, intent:"push", campaignId, fileRev})` plus
HMAC over the intent fields using a per-tab session secret. On
return, redeem the intent server-side (in SPA), verify it
matches the user's currently-foregrounded campaign before
writing. Refuse with a clear error if intent has gone stale.

### NEW-SEC-3 — Consent withdrawal mid-session is silent in M6a (P2)

**Claim.** The DM grants Drive access at session start; an hour
in, they (or a security-conscious spouse) revoke Quire's access
at `myaccount.google.com/permissions`. The 60-min access token
still works in JS memory until expiry. Next push fails with a
401. The design has no detect-and-prompt path; the autosave
might silently fail and the DM only notices when "Backup to
Drive" stops working.

**Evidence.** `auth-strategy.md` has no "401 from Drive ⇒ prompt
re-auth" flow specified; A9 (SEC-4) covers explicit logout from
Quire, not external revocation.

**Why the lead missed it.** The token-loss table (line 269)
treats lifetimes as fixed numbers, not Google-controlled state.

**Fix proposal.** Drive REST calls wrap a 401/403 handler that
clears the in-memory token, surfaces a non-modal "Re-connect
Drive" chip, and offers immediate re-auth. Same pattern for
`invalid_grant` on refresh-token redemption in M6b — that
signals APP-revoked or user-revoked and MUST drop the encrypted
blob too.

### NEW-SEC-4 — Account-switch in another tab silently rebinds (P1)

**Claim.** The DM is signed into two Google accounts (work +
personal). They auth Quire with personal. Mid-session they
switch the default Google account in another tab. Next OAuth
prompt in Quire (refresh-token expiry, re-auth) silently
defaults to the work account — the popup may not show account
chooser if `prompt=select_account` isn't on EVERY auth request.

**Evidence.** `auth-strategy.md:81` has `prompt=select_account`
in the initial flow but the design doesn't say later refreshes
also force it. Refresh-token redemption doesn't touch the
account-chooser at all.

**Why the lead missed it.** Single-account mental model.

**Fix proposal.** Cache the `sub` (Google user id) from the
id_token at first auth. On every refresh OR re-auth, verify
returned `sub` matches; if not, refuse and surface "You're now
signed into a different Google account; existing campaign saves
won't be visible. Sign back into <email> or start a new
connection."

### NEW-SEC-5 — Self-hoster footing has no compromise-rotation path (P1)

**Claim.** `auth-strategy-review.md` ARC-3 picks "canonical
client_id + self-hoster override" but the design has NO plan for
"what if the canonical client_id is compromised, revoked by
Google, or rate-limit-banned by an abuser." Because the
client_id is baked into deployed static bundles, rotation
requires every DM to fetch a new bundle. Worse, Cloudflare Pages
CDN cache (per the user-memory entry `feedback_show_deploy_hash`)
means cache lag could leave compromised DMs running the old
client_id for hours.

**Evidence.** `open-problems.md:55-65` (OP-013) frames this as a
build-config question, not an incident-response question.

**Why the lead missed it.** Designed for the happy path; no
threat-model entry for "the maintainer's OAuth app is gone."

**Fix proposal.** (a) Ship a runtime-overridable client_id from
day one (env-var at build OR `?clientId=` query param OR
campaign-manifest field). (b) Add a "client_id is unavailable —
self-host or wait for fix" graceful-degradation banner driven by
a discovery-document fetch (`/.well-known/quire-oauth.json`).
(c) Document in `decisions.md` that the canonical client_id is
on the maintainer's threat-model dependency list.

### NEW-SEC-6 — APP blocks the popup flow in stricter configurations (P1)

**Claim.** Google APP enrolment doesn't just affect refresh
tokens — for certain consent-screen states it forces a
**full-page redirect with security-key challenge** that cannot
complete inside a popup (the security-key UA bind fails in some
popup contexts on Chrome/Edge for COOP=`same-origin-allow-popups`
because the WebAuthn ceremony needs top-frame). M6a will fail
HARD for these users, not "gracefully degrade to re-auth every
session" as A3 claims.

**Evidence.** `auth-strategy.md:137-153` claims APP "WORKS" for
M6a; that's true for the protocol but unverified for the WebAuthn
UX inside popup contexts.

**Why the lead missed it.** Confused "protocol permitted" with
"UX completes in our chosen window topology."

**Fix proposal.** Add a popup-failure detector (popup closes
without postMessage in <2s, or postMessage carries error
`security_key_required`) that triggers the PRV-1 full-page
redirect fallback. The OP-015 redirect-fallback work covers
popup-blockers but should be expanded to also catch APP
WebAuthn-in-popup failures.

### NEW-SEC-7 — M6b KDF is hand-wavy; PBKDF2 with weak iterations is worse than nothing (P0 for M6b)

**Claim.** DEC-008 / `auth-strategy.md:296` say "salted-hash
passphrase → AES-GCM-256 key" but don't specify:

1. **KDF algorithm.** `crypto.subtle` supports PBKDF2; Argon2id
   and scrypt are NOT in WebCrypto and would require a WASM
   library. Picking PBKDF2 is the only ship-now option but the
   design must say so.
2. **Iteration count.** OWASP 2026 floor for PBKDF2-SHA256 is
   ~600k iterations. If the dev sets 10k (the WebCrypto MDN
   example), a passphrase like "table7" cracks in seconds on
   GPU.
3. **Salt storage.** "Per-user" needs an answer: salt in
   IndexedDB alongside ciphertext is fine, BUT if the attacker
   has IndexedDB read access they have the salt; the security
   relies entirely on iteration cost.
4. **Passphrase length floor.** No minimum specified.
5. **Memory-hardness.** PBKDF2 isn't; an attacker with a GPU has
   a 100x advantage over the DM's CPU. This is the gap Argon2id
   exists to close. For Quire's threat model, acceptable IF the
   passphrase is high-entropy — but no UX guidance enforces that.

**Evidence.** `auth-strategy.md:296`, `decisions.md:82-110`.

**Why the lead missed it.** Wrote "WebCrypto-derived key" as if
that were one thing.

**Fix proposal.** Specify in DEC-008 supersession: PBKDF2-SHA256,
≥600,000 iterations (benchmarked to <1s on a 2020 mid-range
laptop), 16-byte random salt stored in IndexedDB alongside
ciphertext, AES-GCM-256 with 12-byte random IV per encryption,
passphrase ≥12 chars enforced in UI with strength estimator.
Document the GPU-asymmetry explicitly.

### NEW-ARC-1 — Save-format determinism breaks for git over CRLF / large files / non-UTF8 (P2)

**Claim.** ARC-1 / `auth-strategy.md:201` says "same save format
works for Drive + GitHub." Three failure modes:

1. **Line endings.** `stringifySave` at
   `/home/markus/src/ttrpg/quire/runtime/src/persistence.ts:757`
   delegates to `stableStringify` which emits `\n` only (verified
   at `persistence.ts:940-942` — `formatValue` writes `\n`). A DM
   on Windows pushing through native git (not the SPA-direct
   API) could see `autocrlf=true` rewrite to `\r\n`, blowing
   byte-identical roundtrip. Direct REST push avoids this; native
   git in a self-hoster workflow does NOT.
2. **>1MB files.** `autosave-controller.ts:20-22` documents an
   internal 4MB refuse ceiling for localStorage. GitHub doesn't
   refuse <100MB files via API, but >1MB hits PR-review
   degradation and >50MB triggers warnings. Long Underleaf
   campaigns will land there.
3. **Player push (A6 v1.1 hint).** The design defers player-side
   push but the auth-strategy review's #A6 line 217 says "if we
   ever let players push, scrubbed projection." That projection
   has DIFFERENT byte content than the DM-coord projection.
   Storing both as `saves/<slug>.json` on the same GitHub repo
   path causes per-commit churn that LOOKS like cross-DM merges
   but is actually projection drift.

**Evidence.** `persistence.ts:757,940-942`,
`autosave-controller.ts:20-22`,
`auth-strategy.md:201-220`.

**Why the lead missed it.** ARC-1 was framed as "is the format
deterministic?" not "does git, the filesystem, and multi-author
push preserve that determinism?"

**Fix proposal.** (a) Document that direct REST-API push is the
only supported v1 path; native `git push` from a checkout is
unsupported. (b) Player push (v1.1) MUST commit to a different
path (`saves/<slug>.player.json`) or be refused. (c) Add a save-
size warning at 1MB and a hard refuse at 10MB for the GitHub
destination.

### NEW-ARC-2 — Cloudflare Worker fallback expands the trust surface invisibly (P1)

**Claim.** SEC-3 says "if CORS blocks, fall back to a Cloudflare
Worker." That Worker becomes a man-in-the-middle that sees every
auth code + verifier + client_secret-equivalent flowing through.
The design has zero spec for: who hosts it, what it logs,
whether it stores anything, what the incident response is if
it's compromised, and crucially — **it materially changes the
threat model** because now there IS a server-side component the
DM must trust.

**Evidence.** `auth-strategy-review.md:88-92`,
`open-problems.md:11-23` (OP-016).

**Why the lead missed it.** Treated it as a tactical CORS
workaround.

**Fix proposal.** Block the Worker path behind an explicit
decision record. If CORS does block (verify first per OP-016),
either: (a) accept user-typed-code device-flow-style for Drive
too (uglier UX but no proxy), (b) host the Worker with a
PUBLISHED no-log policy + open-source code + reproducible
build, AND only proxy the `/token` endpoint (not arbitrary
Drive calls), AND verify it never sees the
`code_verifier` (which the proxy needs to forward — so it DOES
see it; document this honestly).

### NEW-PRV-1 — Browser ETP / fingerprinting protection breaks postMessage popup (P2)

**Claim.** Firefox Strict ETP, Brave Shields aggressive, and
Safari 17+ all enforce stricter cross-window-message isolation
when the opener and popup are same-origin but the popup
navigated to a third-party origin (Google) and back. PRV-1
mentioned popup-blockers but not the
**Storage Partitioning + State Partitioning** category: the
popup's sessionStorage is partitioned per top-level site, and
on return-navigation to our origin it may NOT see the opener
context the way the design assumes.

**Evidence.** `auth-strategy.md:67-94` and the SEC-2 fix in
the review.

**Why the lead missed it.** PRV-1 framed as popup-blocker, not
storage-partitioning.

**Fix proposal.** Tested fallback: BroadcastChannel API in
addition to postMessage, since BroadcastChannel survives
partitioning differently. Document test matrix: Chrome stable,
Firefox Strict, Safari ITP, Brave Aggressive.

## Existing issues you agree with — and any you'd UPGRADE in severity

- **SEC-3 (CORS probe):** AGREE. UPGRADE to "blocks all of M6"
  including M6c, not just M6a. If the answer is "fall back to
  Worker," that decision affects every flow.
- **UX-3 (re-auth fatigue):** AGREE on the problem; DOWNGRADE
  the urgency of M6b. M6a + APP-style re-auth is a reasonable
  v1 if framed as "Quire re-asks Google every session like your
  bank does." See NEW-SEC-7 — shipping M6b badly is worse than
  shipping only M6a.
- **ADV-1 (drive.appdata):** AGREE strongly. The structural fix
  is the right call.
- **PRV-1 (COOP/popup):** AGREE; expand per NEW-PRV-1 and
  NEW-SEC-6.

## Existing issues you'd downgrade or reject

- **ADV-3 (Device Flow code phishing) at P2:** DOWNGRADE to P3.
  The civilized-peer threat model (per the user memory) doesn't
  cover co-located adversaries. Worth a UX note, not a P2 flag.
- **PRV-2 (what Google sees):** DOWNGRADE to "out-of-scope for
  threat model"; this is documentation work, not a design issue.
- **ARC-2 (multi-DM merge UX) at P2:** DOWNGRADE to P3; deferred
  by DEC-008 layering anyway, and conflict-resolution is a UX
  problem more than security.

## Open questions you want routed to other consultants

- **To the UX consultant:** does the M6b passphrase UX survive
  contact with the prime directive? "Type your Quire passphrase"
  is unambiguously meter-management; weigh it against M6a-only
  ship.
- **To the architect:** NEW-ARC-1's "REST API push is the only
  supported path" needs a self-hoster-policy decision — are
  we OK telling them "don't use native git"?
- **To the adversarial reviewer:** the firewall implications of
  `state`-as-intent (NEW-SEC-2). If the campaign-id in `state`
  leaks (URL-bar history, browser history sync to other devices),
  is that a spoiler-relevant disclosure? Almost certainly not,
  but should be explicitly cleared.
- **To the human:** NEW-SEC-5's self-hoster compromise-rotation
  path needs a product call — is "the canonical Quire client_id
  is single-point-of-failure" an acceptable v1 posture, or do
  we need the discovery-document escape hatch on day one?

## Final recommendation

Ship M6a after addressing NEW-SEC-1, NEW-SEC-2, NEW-SEC-3, and
NEW-ARC-1's REST-only clarification — these are days-of-work
fixes, not redesigns. **Block M6b** until NEW-SEC-7 (KDF spec)
lands as a superseding decision record; a bad KDF would harm
users worse than no encryption (false sense of security). **Block
the Worker fallback** (NEW-ARC-2) behind an explicit DEC-NNN; the
CORS probe (OP-016) is correctly blocking and the answer
"Worker" should not be a one-line review decision. NEW-SEC-5
(canonical-OAuth-compromise) can ship as M6.1 if we accept the
risk, but document it. NEW-SEC-6 (APP+WebAuthn-in-popup) MUST be
detected at runtime even if we don't fix it — silent failure for
APP users violates the locked C6 constraint.
