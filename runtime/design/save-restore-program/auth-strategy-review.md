# Auth Strategy — Self-Review (Security + UX)

**Status:** 🟡 Draft 1 reviewer pass (2026-05-29, same session as
draft 1). Tagging issues against `auth-strategy.md` v1.

**Reviewer transparency.** The mandate called for spawning OAuth/web-
security architect, privacy/threat reviewer, adversarial save-format
reviewer, and TTRPG/UX validator as separate sub-agents. The current
harness gives me skill primitives (Skill tool for frontend-design,
verify, simplify, review) but no spawn-sub-agent tool, so this pass
is the program lead acting as the reviewer with relevant domain
knowledge. The shape mirrors the consultant brief: pretend-you're-X,
look at each clause, find the gaps, propose specific fixes. Where the
review touches material where I lack confidence, I flag it for a
human review pass.

Issues are tagged:
- [SEC] OAuth / web-security architect concern
- [PRV] Privacy / threat-model concern
- [ADV] Adversarial save-format concern
- [UX] TTRPG/UX validator concern
- [ARC] Architecture / implementation concern

Each issue: claim, evidence, severity (P0/P1/P2), fix proposal.

---

## [SEC-1] PKCE redirect URI binding is the strongest defense — make it explicit (P1)

**Claim.** The draft hand-waves "PKCE protects us" in the A1 token-loss
scenarios. The real protection is the binding of `code_verifier` to
`redirect_uri` at token exchange: `oauth2.googleapis.com/token`
requires `redirect_uri` to EXACTLY match what was registered AND what
was in the original `/auth` request. An attacker who steals the auth
code from URL params still needs the matching `code_verifier` (held
in sessionStorage) AND the matching `redirect_uri` registered to the
attacker's client_id. Without all three: useless.

**Fix.** Document this explicitly in A1 step 8: "the token endpoint
binds `code_verifier` ⊕ `redirect_uri` ⊕ `client_id` ⊕ `code`; loss
of any one to an attacker means the exchange fails."

**Also:** make the registered redirect_uri an EXACT match (no
wildcards). Google's OAuth console allows multiple exact URIs per
app; that's the right config.

---

## [SEC-2] sessionStorage in cross-origin OAuth popup is non-trivial (P1)

**Claim.** The draft says "store `code_verifier` in sessionStorage."
But sessionStorage is per-window. When the OAuth popup completes and
postMessages back to the opener, the opener (which has the
code_verifier) is a DIFFERENT window. The popup itself cannot directly
read the opener's sessionStorage.

The flow has to be: opener generates code_verifier, stores it in
opener's sessionStorage, opens popup with code_challenge only. Popup
receives auth code from Google's redirect, postMessages `{code, state}`
to opener. Opener reads code_verifier from its own sessionStorage,
calls /token with code + code_verifier. This works IF:
- The callback page is on OUR origin (so postMessage targeting is
  trustworthy via `event.origin === window.location.origin`).
- We validate `event.source === popup` before reading.
- We validate `state` matches what we stashed.

**Fix.** A1 needs explicit "opener owns the code_verifier;
popup is just a redirect-catcher" framing. Step 7's "TINY static page
that postMessages" needs:
- Validate the auth response is from the expected origin (Google).
- postMessage with explicit `targetOrigin = our origin` (NOT `*`).
- Opener validates `event.origin`, `event.source`, AND the state nonce.

---

## [SEC-3] Token endpoint CORS: verify before commit (P1)

**Claim.** The draft assumes
`oauth2.googleapis.com/token` is CORS-permitted for PKCE public clients.
Per Google's docs (https://developers.google.com/identity/protocols/oauth2/web-server)
this IS supported for public clients with PKCE — but only since 2024
for some flows. The browser will fail with CORS errors if assumptions
are wrong.

**Fix.** Build a dev-only probe FIRST: call the token endpoint with a
deliberately bogus code+verifier, assert we get a JSON error response
(meaning CORS is open) NOT a CORS-blocked failure. If CORS blocks us,
fall back to a tiny Cloudflare Worker as a token-exchange proxy
(adds infra but unblocks the design).

Document this as OQ11: "Verify CORS allows token-exchange from our
origin." Block M6 implementation until verified.

---

## [SEC-4] No mention of token revocation on logout (P2)

**Claim.** The draft has no "logout" or "revoke access" flow.
Google's `oauth2.revoke` endpoint exists; using it on explicit
DM-initiated logout reduces the window in which a stolen
access_token is useful.

**Fix.** Add an A9 section: "When the DM clicks 'Disconnect Drive',
call `https://oauth2.googleapis.com/revoke?token=<access_token>`
and clear in-memory state. Best-effort; revocation can fail silently."

---

## [SEC-5] state nonce generation must be cryptographically strong (P1)

**Claim.** The draft doesn't specify how the `state` nonce is
generated. If it's `Math.random()`, an attacker who can guess state
can forge CSRF.

**Fix.** Use `crypto.getRandomValues(new Uint8Array(32))` and
base64url-encode. Same for `code_verifier` (PKCE spec requires
43-128 chars, 256 bits of entropy is standard).

---

## [PRV-1] OAuth popup vs full-page redirect — privacy implications (P2)

**Claim.** The draft mandates popup. Popup-blockers are aggressive
on some browsers (Firefox Strict mode, Safari ITP). If the popup
opens but is blocked from communicating with the opener (cross-
origin isolation, COOP=same-origin-allow-popups), the postMessage
contract breaks silently.

**Fix.** Document the COOP/COEP requirements explicitly. Quire
should set `Cross-Origin-Opener-Policy: same-origin-allow-popups`
on the main page so we don't lose `window.opener` to the popup.
Test on Safari ITP enabled.

Fallback: if popup is blocked OR communication fails, fall back to
full-page redirect using `sessionStorage` to preserve the user's
"I clicked Push to Drive" intent across the redirect cycle. Requires
loadPath-on-load logic that's not currently in the design — call
this out as A1.5.

---

## [PRV-2] What does Google see during the OAuth handshake? (P3 — for documentation)

**Claim.** During OAuth, Google sees the user's IP, the referring
URL (our origin), the requested scopes, and the consent grant. This
is normal Google behavior for any third-party OAuth app — but it's
worth documenting for users who care.

**Fix.** Add a "Privacy" section to user-facing docs (not in this
file). Make clear: "Quire never sees your Google password. Google
sees that you're using Quire and which Drive files we touch."

---

## [ADV-1] Cleartext save on Drive — share-link risk is real (P1)

**Claim.** The draft acknowledges in A6 that cleartext + accidental
share-link exposes the save. But the proposed fix in OP-012 ("warn
on shared destinations") relies on a Drive ACL query that may not be
real-time accurate (eventual consistency, share-link active vs
revoked, etc).

**Counter-fix proposals (any of, prioritized):**

1. **Default to `drive.appdata`** (the hidden per-app folder, per
   A2 alternative). The user CAN'T share it because they can't see
   it in their Drive UI. PRO: eliminates the share-link risk entirely.
   CON: opaque to the user (no manual recovery via Drive UI).

2. **Default to `drive.file` + a file name pattern** like
   `.quire-private-<slug>.json` (leading dot — hidden in many Drive
   UIs). Less robust than appdata; the user can still share if
   they go looking.

3. **Defer the share-warning to "ACL check on every push"**: before
   uploading, GET the file's permissions; if anything other than
   `[{type:"user", role:"owner", emailAddress:<user>}]`, refuse with
   "This file is shared. Disconnect sharing in Drive first, then
   retry." Aggressive — could frustrate legit shared-DM workflows.

**Recommended:** Start with (1) `drive.appdata`. The DM never needs
to see the JSON; the runtime knows where it is. Document the trade-
off and revisit if a real user needs manual recovery.

---

## [ADV-2] Drive file revision_id is not a security token (P2)

**Claim.** The draft proposes using `revision_id` for optimistic
concurrency. That's correct as a concurrency token but doesn't
prevent a malicious peer (out-of-threat-model) from racing to write.
Inside our threat model (civilized peers), this is fine — but be
explicit that this is NOT a defense against adversarial co-DMs.

**Fix.** Note in A7 that conflict resolution is a UX feature, not
a security feature. Adversarial multi-DM is out of scope per the
locked threat model.

---

## [ADV-3] GitHub Device Flow — code phishing (P2)

**Claim.** Device Flow shows the user a code like "AB12-CDEF" and
tells them to type it at `github.com/login/device`. An attacker who
controls the DM's table laptop screen (or a co-located adversary)
could see the code and complete authentication on their own device,
binding the OAuth grant to their session. Real for in-person
adversaries.

**Fix.** Display the code with a clear "DO NOT SHARE THIS CODE WITH
ANYONE — IF YOU DIDN'T REQUEST IT, IGNORE IT" framing. This is the
GitHub spec's recommended UX. Add to A4 implementation notes.

---

## [UX-1] OAuth popup feels like a system trust prompt — that's the goal (P1)

**Claim.** From the mandate: "does the OAuth popup feel like 'I'm
leaving Quire to go talk to Google' or 'Quire is asking for my
password'? The latter is unacceptable." A well-designed Google OAuth
popup unambiguously communicates "you are on accounts.google.com" —
URL bar visible, Google branding, the user's actual signed-in account.

**Validation.** The popup should:
- Open as a fresh tab/window (browser chrome visible, including URL).
- Land on `accounts.google.com/o/oauth2/v2/auth` (verify in code review).
- Show the user's logged-in Google identity at the top.
- Show our app name + the consent strings ("Quire wants to: create,
  see, edit, and delete only the specific Drive files you use with
  this app").

**Risk to mitigate.** Our launching button must not LOOK like an
in-app password prompt. "Push to my Drive" button labeled clearly,
with a "what happens next" microcopy: "You'll authenticate with
Google. Quire never sees your password."

**Fix.** Add A10 section: "Button copy + microcopy patterns." Defer
the exact strings to the in-fiction copy review at M8.

---

## [UX-2] DM at the table — Device Flow's "open your phone" beats popup (P2)

**Claim.** Quire's DM is typically at a table with their laptop in
DM-mode (notes open, scene shown). Asking them to handle a popup
takes them OUT of the game flow — they have to leave the table
mentally.

GitHub Device Flow's "open github.com/login/device on your phone"
is actually a BETTER fit: the DM uses a device they're not currently
DM-ing on, the table doesn't see the auth dance, the laptop screen
stays on-game.

**Counter-claim.** But the DM's PHONE may not be where their GitHub
session is. And switching devices is slower than a popup.

**Recommendation.** Ship Device Flow as default (per draft A4) for
GitHub. For Drive, popup is the only realistic option (Drive doesn't
have a device-flow). Document the trade-off.

---

## [UX-3] Re-auth every session — UX-unacceptable for weekly DM (P1)

**Claim.** A DM running a weekly campaign would re-auth EVERY week.
Even with biometric / passkey shortcut, that's friction-by-design.
For comparison: GitHub Desktop, GitKraken, etc. all persist tokens.

**Recommendation.** OQ1 should resolve as: build the refresh-token
path with WebCrypto-encrypted IndexedDB. UX accepts "type your Quire
passphrase to unlock cloud sync" once per device per ~30 days. Falls
back to strict-no-creds for APP users.

This means OP-009 (Token persistence) should LEAN toward
"build it, but layered: ephemeral by default, opt-in passphrase mode
for the persist-across-sessions experience."

**Fix.** Adjust DEC-007 to be more specific: token persistence is
opt-in via passphrase, off by default. Plan layered ship: M6a is
ephemeral-only; M6b is passphrase-opt-in.

---

## [UX-4] Cloud is not the durability layer DMs expect; cloud is "backup" (P2)

**Claim.** The mandate framing positions cloud as "the durability
layer when all browsers evict." But DMs don't think about eviction
— they think about backup. "What if my laptop dies?" not "what if
localStorage purges?"

**Counter-claim.** The technical reality is the same; the framing
matters for UX copy.

**Fix.** User-facing copy should say "Back up to Drive" not "Sync
to Drive." Sync implies bidirectional + automatic; backup is one-
directional + on-demand. Matches the manual-push model exactly.

---

## [ARC-1] Cloud file = full save vs append-only chunks — the architect's call (P2)

**Claim.** OP-010 / OQ6 is genuinely architectural. Some thoughts:
- A full materialized save is what the runtime ALREADY writes (every
  localStorage save is a full SaveDocument). Cheapest to ship.
- An append-only chunked log is the GitHub-pattern from
  the original honest-scope discussion (git is purpose-built for this).
- Drive vs GitHub may want DIFFERENT formats: Drive = full save (no
  git semantics), GitHub = chunked / committed.

**Recommendation.**
- Drive: full save (single file, version_id for OCC). Matches Drive's
  native model. Simpler diff story (no diff; replace).
- GitHub: full save committed to a configured path
  (`saves/<campaign-slug>.json`). Git already de-diffs at the line
  level when the save is alphabetically-sorted + per-event lines
  (which it is — `stringifySave` is deterministic + git-friendly per
  the existing tests).

So: SAME FORMAT for both destinations. Different orchestration.
Closes OP-010 with low risk.

---

## [ARC-2] Multi-DM concurrent push — pull-rebase-push works but needs UX (P2)

**Claim.** A7 proposes pull-rebase-push. Mechanically correct because
the event log is CRDT-mergeable. UX-wise: the second DM who pushes
needs to be told "we merged your changes with co-DM Y's; please
verify."

**Fix.** Implementation note for A7: after a merge-on-push, surface a
diff summary in the DM-only operational view ("Co-DM Y added N events
since your last pull"). Defer the actual conflict-UI to a follow-up
because the underlying merge is automatic.

---

## [ARC-3] OAuth app registration is a maintenance burden (P3)

**Claim.** The draft assumes one Google OAuth app + one GitHub OAuth
app, registered by "the maintainer." Who's the maintainer? Quire
isn't a hosted service today; it's a static bundle the DM serves.
Multiple deployments → multiple OAuth apps → multiple client_ids.

**Fix.** Document the deployment model explicitly:
- Quire-the-project ships with a DEFAULT OAuth client_id pointing
  at canonical redirect URIs (gutschke.github.io, the Cloudflare
  pages-dev URL, localhost:5173).
- Self-hosters register their own OAuth app + override via build-time
  config or runtime env.
- Document the security trade-off: the canonical client_id is on a
  trust-the-maintainer footing. Self-hosters who don't trust the
  maintainer override.

This affects A8 — make the "one OAuth app for all deployments" a
default-but-overrideable design.

---

## Summary of issues to feed back into auth-strategy.md v2

| Tag | Severity | Issue | Action |
|---|---|---|---|
| SEC-1 | P1 | PKCE binding mechanism not explicit | Document in A1 step 8 |
| SEC-2 | P1 | sessionStorage cross-window flow needs clarity | Rewrite A1 step 7 |
| SEC-3 | P1 | Token endpoint CORS unverified | Add OQ11 + dev-probe before ship |
| SEC-4 | P2 | No revocation/logout flow | Add A9 |
| SEC-5 | P1 | state nonce + code_verifier RNG unspecified | Document crypto.getRandomValues |
| PRV-1 | P2 | Popup blockers + COOP | Document headers + fallback path |
| PRV-2 | P3 | What Google sees | Doc for users (out of scope here) |
| ADV-1 | P1 | Cleartext share-link risk | Default to drive.appdata |
| ADV-2 | P2 | revision_id is not a security token | Note in A7 |
| ADV-3 | P2 | Device Flow code phishing | UX warning in A4 |
| UX-1 | P1 | Popup must feel like leaving Quire | Add A10 + microcopy |
| UX-2 | P2 | Device Flow is good for table DMs | Confirm A4 default |
| UX-3 | P1 | Re-auth-every-session is UX-unacceptable | Adjust DEC-007; M6 layered |
| UX-4 | P2 | "Backup" not "Sync" framing | Copy guidance for M8 |
| ARC-1 | P2 | Same save format for Drive + GitHub | Close OP-010 |
| ARC-2 | P2 | Merge UX on multi-DM push | Implementation note |
| ARC-3 | P3 | OAuth app registration model | Document deployment model |

The biggest design shifts this review prompts:
1. Default to `drive.appdata` (ADV-1) — eliminates a P1 leak path.
2. Layer the M6 ship: M6a ephemeral / M6b passphrase-protected
   refresh tokens (UX-3) — escapes the "re-auth weekly" rejection.
3. Verify CORS empirically BEFORE building (SEC-3) — blocks design.
4. Same save format on Drive + GitHub (ARC-1) — kills a complexity
   dimension we don't need.

A follow-up commit will revise `auth-strategy.md` to v2 with these
incorporated. For this turn, the review stands as the artifact for
the human's eyes before another design pass.
