# Auth Strategy — Cloud Sync (M6)

**Status:** 🟡 Draft 2 (2026-05-29 — self-reviewed by program lead).
See `auth-strategy-review.md` for the issue log feeding this revision.

**Draft history:**
- Draft 1 (2026-05-29 mid-session): captured human's locked
  constraints, proposed PKCE-based architecture, ten open questions.
- Draft 2 (2026-05-29 later): incorporated SEC/PRV/ADV/UX/ARC review
  findings. Key shifts: default to `drive.appdata` (closes share-
  link leak path), layered M6 ship (ephemeral-first, passphrase-opt-
  in for refresh tokens), CORS probe blocks ship, same save format
  for Drive + GitHub.

The human made the OP-006 call (2026-05-29 mid-session): **build cloud sync**.
Constraints they gave us (verbatim, then decomposed):

> Aim for a workflow that automatically syncs distributed state across all
> team members' browsers, but offers the DM to sync to cloud-based
> architectures. It's OK to require user action to push/pull to/from cloud
> services. OAuth-based workflows would be ideal. We don't want a situation
> where the DM has to enter credentials into their browser; instead we
> ideally want them to log into the third party and then push directly from
> the browser to the third party without credentials having to be shared.
> The more limited the credentials and who has access to them, the less risk
> of them getting abused (intentionally or accidentally). This warrants
> bringing in security consultants for a proper design, and then running the
> final choice by the UX expert to evaluate user acceptance. Ideally, this
> architecture should work, even if the user has enabled enhanced security
> on their Google profile.

## Decomposed constraints (LOCKED)

| # | Constraint | Implication |
|---|---|---|
| C1 | Browser-to-browser is already the default | Cloud is the DM-initiated **durability** layer for "all browsers evicted". Don't touch the P2P live-session path. |
| C2 | DM-initiated, manual is acceptable | A "Push to my Drive" / "Pull from my Drive" button is fine. No background daemon required. |
| C3 | OAuth-based | No API keys, no PATs typed into the browser. |
| C4 | No credentials in the browser | No long-lived secrets persist in `localStorage`/`IndexedDB` in clear. The user authenticates with the third party; we receive an ephemeral token. |
| C5 | Minimum scope | `drive.file` (per-app file access, NOT whole Drive). GitHub: single repo (`public_repo` or fine-grained PAT-scope-equivalent OAuth). |
| C6 | Works under Google Advanced Protection Program (APP) | APP allows OAuth web apps with appropriate scopes but blocks less-secure-app access and certain refresh-token reuse patterns. We must verify the chosen flow runs under APP; if not, surface the trade-off in `decisions.md`. |

## Non-goals (out of scope for M6)

- Background sync. The user clicks "Push" / "Pull"; nothing happens passively.
- End-to-end encryption of the saved JSON. The cloud destination is the
  user's own Drive / GitHub account; today's threat model accepts that
  Google or GitHub can read the file. (Revisit if the program scope ever
  expands to "DM doesn't trust the cloud provider".)
- Multi-DM concurrent push without conflict UX. Two DMs pushing same file
  needs a defined resolution; we'll start with last-writer-warns and
  defer real branch-divergence merge to a follow-up.
- Player-side cloud push. Only the DM pushes to cloud; players sync via
  WebRTC during the live session. (Players CAN download manual saves;
  that already works.)

## Draft architecture (FOR REVIEW)

### A1. Google Drive — auth flow

**Proposed:** OAuth 2.0 Authorization Code with PKCE, public-client flow, no
client secret. Static SPA-friendly. Redirect URI = our origin's
`/auth/google/callback` (Cloudflare-hosted in prod; `localhost:5173` in
dev).

```
1. User clicks "Push to Drive".
2. SPA generates `code_verifier` + `code_challenge` (PKCE S256).
3. SPA stores `code_verifier` in sessionStorage (NOT localStorage — wiped
   when the tab closes; reduces token-theft window).
4. SPA opens a popup (NOT a full-page redirect — preserves in-memory
   session state) to:
     https://accounts.google.com/o/oauth2/v2/auth?
       client_id=<our-public-client-id>
       &redirect_uri=<our-callback>
       &response_type=code
       &scope=https://www.googleapis.com/auth/drive.file
       &code_challenge=<S256(code_verifier)>
       &code_challenge_method=S256
       &state=<random-anti-csrf>
       &prompt=select_account
5. User authenticates with Google (THIS is where the credentials live —
   in Google's domain, not ours). User consents to "Quire wants to
   create / read / update / delete files it creates in your Drive."
6. Google redirects popup to <our-callback>?code=...&state=...
7. Our callback page is a TINY static page that postMessages the auth
   code back to the SPA-opener and closes itself.
8. SPA verifies state, exchanges code+code_verifier for an access_token
   directly with https://oauth2.googleapis.com/token (CORS-permitted for
   PKCE public clients).
9. SPA holds access_token in JS memory (NOT localStorage).
10. SPA uses the token to Drive REST API for upload/download.
11. When the tab closes, the token is gone. Next session = re-auth.
```

**Trade-off (C4 vs UX):** Strict "no creds in browser" → re-auth every
session. That's a click + biometric every time the DM opens Quire. Is
that acceptable to the UX expert? **OPEN QUESTION 1.**

**Alternative path:** persist a `refresh_token` in IndexedDB encrypted
with a WebCrypto-derived key bound to a user passphrase. Punts the
"where do creds live" problem to "where does the passphrase live" — and
the answer is "in the user's head", not in storage. Worth UX validation
because it can change "re-auth every session" to "type passphrase once
per device per <refresh-token-TTL>". **OPEN QUESTION 2.**

### A2. Google Drive — scope (REVISED to default to `drive.appdata`)

**Draft 2 revision (per ADV-1 review):** Default scope is now
`drive.appdata` — the hidden per-app folder Google maintains
behind the user's Drive UI.

`drive.appdata` semantics:
- App can create / read / write / delete files in a per-app
  hidden folder.
- The user does NOT see this folder in their Drive UI.
- The folder is OWNED by the user but accessible ONLY to our app.
- Cannot be shared (no share-link risk — closes ADV-1 P1 leak path).

`drive.file` is the documented alternative for users who want manual
recovery via the Drive UI. We offer it as an opt-in setting ("Save
to a visible Drive file instead") with a warning about share-link
risk.

**Trade-off:** `drive.appdata` is opaque to the DM (no manual
recovery via Drive's UI). Mitigation: the DM-only operational view
exposes a "Download backup" button that fetches the appdata file and
streams it as a regular download — the DM can keep a copy on their
hard drive if they want manual recovery.

**Why this is now locked-in:** ADV-1 (share-link leak risk) is a P1
threat under the civilized-peer model — DMs accidentally clicking
"Anyone with link can view" on a Drive UI is plausible and
unrecoverable once it happens. Defaulting to appdata eliminates the
risk class entirely.

### A3. Google Advanced Protection Program compat

APP-enrolled users:
- Cannot use refresh tokens with re-prompting suppressed.
- Cannot grant "less secure app" access (irrelevant — OAuth is the
  secure path).
- May require additional confirmation steps in the OAuth consent UI.

PKCE web-app flow with `scope=drive.file` is on Google's allowed list
for APP users (verified per Google's [Advanced Protection docs](https://support.google.com/accounts/answer/7539956)
as of authoring date; security reviewer should re-verify).

**The implication for refresh tokens:** APP users may get
`refresh_token` revoked aggressively, or denied the offline access scope.
Our design must DEGRADE to "re-auth per session" gracefully — which is
the strict-C4 path anyway. The refresh-token alternative (OPEN
QUESTION 2) becomes "for non-APP users; APP users re-auth every time."

### A4. GitHub — auth flow

GitHub has two viable options for SPAs:

**Option G1: OAuth Device Flow.**
- DM clicks "Push to GitHub".
- SPA hits `https://github.com/login/device/code` → gets `user_code`,
  `device_code`, `verification_uri`.
- SPA shows the user: "Go to https://github.com/login/device and enter
  AB12-CDEF" — and starts polling `/login/oauth/access_token`.
- User completes auth on github.com (or on their phone).
- Polling completes with an `access_token`.
- PRO: no redirect URI to register. PRO: works on locked-down browsers.
  PRO: user can complete on a different device (matches "DM is on the
  shared table laptop, doesn't want to log in here").
- CON: extra step — user reads a code, switches tab.

**Option G2: OAuth Authorization Code (PKCE).**
- Same shape as Google. Needs a registered OAuth app with redirect URI.
- GitHub supports PKCE for OAuth apps as of 2024.
- PRO: faster — one popup, done.
- CON: harder to maintain across prod/staging/dev redirect URIs.

**Proposed default:** Device Flow (G1). Quire is a TTRPG cockpit; the
DM is typically at a table with their laptop in "do not disturb" mode.
Asking them to "open this URL on your phone, type AB12-CDEF" is a more
natural ceremony than a popup. It also dodges the redirect-URI proliferation
problem and works identically across dev/staging/prod. **UX expert
should validate this take.** **OPEN QUESTION 4.**

### A5. GitHub — scope

Minimum-viable scopes:
- `public_repo` for public campaign repos.
- `repo` for private campaign repos (FULL read/write across all the
  user's repos — uncomfortably broad).

Fine-grained personal access tokens scope to a single repo, but GitHub
OAuth apps cannot request fine-grained scope per repo. The right answer
for private repos is **the user installs a GitHub App** which CAN scope
per-repo. That's a heavier registration story (we'd host a GitHub App,
users install it on a repo) and is probably the right long-term answer
— but for v1, **public-only** is acceptable, given Quire campaigns are
typically hosted in the Underleaf-style public-content repo pattern.
**Defer private-repo support to v1.1; document the limitation.**

### A6. Save format on cloud (LOCKED draft 2)

Per ARC-1: SAME save format for Drive + GitHub destinations. The
runtime already produces git-friendly deterministic JSON via
`stringifySave` (alphabetically-sorted keys, per-event lines) — this
format works equally well as a single file on Drive or a committed
file on GitHub. No format-per-destination complexity.

- The DM's save = the DM-coord projection (full event log, DM-only
  events included). It's the DM's own Drive / repo; they're saving their
  own DM material. Acceptable per current threat model (the DM is on the
  trusted side of the firewall; Google / GitHub the company are NOT in
  the threat model as adversaries).
- The PLAYER'S save (if we ever let players push) would be the player-
  scrubbed projection — already firewall-clean. But we're deferring
  player-side push, so this doesn't matter in v1.
- The save file is **cleartext JSON** on the cloud destination. With
  `drive.appdata` as the default (per A2 draft 2), the file is not
  shareable through Drive's UI — closes the ADV-1 P1 share-link leak
  path. For opt-in `drive.file` users, a push-time ACL check warns
  before writing to a shared file (per OP-012).

### A7. Conflict resolution (two DMs, one file)

Two DMs (e.g. co-DM and primary DM) push to the same Drive file
concurrently:

- The save format is event-log shaped. The CRDT merge layer already
  knows how to union two divergent event logs into one converged log.
- The PUSH operation should: (a) PULL the current cloud file first;
  (b) merge incoming with local; (c) push the merged result. This is
  standard "fetch + rebase + push" with no surprises.
- The pre-condition: each push must check the Drive file's `revision_id`
  (Drive supports this via `If-Match` headers or `properties` field).
  If the revision changed since we last pulled, refuse the push, force
  a pull-and-merge first.
- This is essentially `git pull --rebase` semantics, automated for the
  user.
- **OPEN QUESTION 6:** is the cloud file the **full materialized save**
  (one big JSON) or **append-only chunks** (the GitHub-as-event-log
  paradigm)? Full save: simpler, lossy on simultaneous writes. Chunks:
  smaller diffs, plays well with branch-divergence, but harder to "open
  in a text editor and read."

### A8. Redirect URIs and OAuth app registration

Quire is served from multiple origins:
- `https://quire.<userdomain>.pages.dev` (Cloudflare Pages prod).
- `https://staging.<...>.pages.dev` (staging).
- `http://localhost:5173` (dev server).

Each needs a registered redirect URI in the Google OAuth app config.

**Proposed:** ONE OAuth app (Google) registered with ALL THREE redirect
URIs. Justification: same trust boundary (the maintainer), same scope,
same client_id. Token issued to localhost cannot be used from prod
because the redirect URI was localhost — Google validates this.

Maintenance: when we deploy a new origin (new Cloudflare branch
preview), it does NOT need OAuth support in dev. Only prod + staging +
localhost.

Document this in the project README + setup docs.

## Token threat model (FOR ADVERSARIAL REVIEWER)

What's the worst an attacker can do with each artifact?

| Artifact | Lifetime | Where stored | Worst-case attacker capability |
|---|---|---|---|
| Google access_token | ~60 min | JS memory (in-tab) | While valid: full `drive.file` scope — can list, read, modify, delete the Quire-created files the DM has touched. Cannot access other Drive files. |
| Google refresh_token (if used) | until revoked | IndexedDB encrypted w/ user passphrase | Without passphrase: useless. With passphrase: same capability as access_token, recurringly. |
| code_verifier | <1 min (during exchange) | sessionStorage | Without redirect_uri match + state + code: useless. |
| state nonce | <1 min | sessionStorage | CSRF defense; loss = CSRF risk. |
| GitHub access_token | until revoked | JS memory (in-tab) | Within scope: list/read/write configured repo. |
| Drive file ID | persistent | localStorage (campaign manifest) | Knowing a file ID does NOT grant access; Drive checks owner + acl. |

**Token-loss scenarios to think through (for security reviewer):**
1. User closes tab mid-OAuth (between step 4 and step 8 above). What state
   is left in storage? Anything sensitive?
2. User's machine is compromised; attacker reads sessionStorage. Has
   anything sensitive landed there?
3. Attacker controls the redirect URL (e.g. via a DNS hijack on the
   Cloudflare zone). What can they do with the auth code? (PKCE protects
   us here: without code_verifier they can't redeem.)
4. User installs a malicious browser extension. What's the blast radius
   for access_token in JS memory?
5. User accidentally pastes the URL containing the auth code into a chat
   (auth code leaks). Without code_verifier, the auth code is useless.

## Open questions — RESOLVED in draft 2

| # | Question | Resolution |
|---|---|---|
| OQ1 | Re-auth every session UX-acceptable? | NO (UX-3). Layered ship: M6a = ephemeral, M6b = passphrase-opt-in refresh tokens. |
| OQ2 | Refresh-token storage: WebCrypto + passphrase? | YES, M6b only. Salted-hash passphrase → AES-GCM-256 key → encrypt refresh_token → IndexedDB. |
| OQ3 | `drive.file` vs `drive.appdata`? | `drive.appdata` default, `drive.file` opt-in (ADV-1). |
| OQ4 | GitHub Device Flow vs PKCE? | Device Flow default per UX-2; PKCE as fallback for self-host. |
| OQ5 | Share-link warning UI? | Only for opt-in `drive.file` users (OP-012). `drive.appdata` users can't share. |
| OQ6 | Full save vs chunks? | Full save, same format Drive + GitHub (ARC-1). |
| OQ7 | Multi-DM concurrent push? | Pull-rebase-push; surface merge summary in DM-only operational view (ARC-2). |
| OQ8 | OAuth callback page? | Tiny static page on OUR origin; postMessage with explicit targetOrigin (SEC-2). |
| OQ9 | Access_token theft blast radius? | `drive.appdata` scope only (no other Drive access); 60-min TTL. Documented in token threat model. |
| OQ10 | APP compat? | PKCE + drive.appdata is APP-compatible. Re-auth-every-session mode (M6a) WORKS for APP users; M6b passphrase mode degrades to re-auth for APP users. |

## Open questions — NEW in draft 2

| # | Question | Routed to |
|---|---|---|
| OQ11 | Verify token endpoint CORS is open for PKCE public-client from our origin (SEC-3). | Dev probe, BLOCKING ship. |
| OQ12 | COOP / COEP headers on Quire's prod origin compatible with OAuth popup? (PRV-1) | Verify in deployment config. |
| OQ13 | Self-hoster OAuth-app override mechanism (ARC-3) — build-time env or runtime config? | Architect. |

## What's locked (after draft 2 self-review)

- OAuth flow MUST use PKCE (S256) — no implicit grant, no client_secret in the SPA.
- Scopes MUST be minimum-viable: **`drive.appdata`** (default) or
  `drive.file` (opt-in) for Google; `public_repo` for GitHub v1.
- Access tokens MUST NOT persist to localStorage/IndexedDB
  unencrypted. M6a: in-memory only. M6b: refresh_token encrypted
  with passphrase-derived AES-GCM-256 key, in IndexedDB.
- The user authenticates on the **third party's domain**, never types
  third-party credentials into Quire.
- The save document on the cloud destination is the same `SaveDocument`
  format the rest of the runtime understands — no new file format.
- `state` nonce + PKCE `code_verifier` MUST come from
  `crypto.getRandomValues` (256+ bits entropy each). See SEC-5.
- postMessage to OAuth callback page MUST use explicit `targetOrigin`
  matching our origin (NOT `*`); opener MUST validate `event.origin`,
  `event.source`, AND state nonce. See SEC-2.
- Default destination on Drive is `drive.appdata` (hidden); user
  cannot accidentally share it. See ADV-1.

## Ship layering (REVISED in draft 2)

- **M6a (first ship):** OAuth PKCE + `drive.appdata` + ephemeral
  access_token in JS memory. Re-auth per session (browser-tab
  lifetime).
- **M6b (follow-up):** Add passphrase-protected refresh_token in
  IndexedDB. UX: "Type your Quire passphrase to unlock cloud sync
  across sessions." APP users degrade to M6a behavior.
- **M6c (later):** GitHub Device Flow + same `drive.appdata`-shape
  save committed to a configured GitHub path.
