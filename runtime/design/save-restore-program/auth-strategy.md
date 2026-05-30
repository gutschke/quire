# Auth Strategy — Cloud Sync (M6)

**Status:** 🟡 Draft 3 (2026-05-29 — incorporates independent
consultant pass: 4 reports x 9-10 findings each = 33 new findings
on top of draft 2's 16-finding self-review).

See `auth-strategy-review.md` for the lead's draft-2 self-review
and `review-history/{security,privacy,ux,adversarial}-consultant-2026-05-29.md`
for the independent reviewers' draft-3 input.

**Draft 3 changes (from draft 2):**
- §A1 spec now binds OAuth `state` to user intent (NEW-SEC-2,
  DEC-012) AND uses a per-flow UUID listener pattern (NEW-SEC-1).
- §A1.5 NEW: popup-failure detection + full-page-redirect fallback
  (NEW-SEC-6 APP+WebAuthn, NEW-PRV-1 ETP partitioning).
- §A4 reconfirms Device Flow as default but adds "Use popup
  instead" fallback (NEW-UX-2 disagreement with UX-2).
- §A7 (callback page) NEW: strict CSP + golden-diff CI
  (NEW-ADV-8).
- §A8 (client_id) now spec'd as runtime-overridable from day one
  (DEC-013, supersedes ARC-3 / OP-013).
- §A9 NEW: token revocation on logout + 401-detection auto-prompt
  + account-switch detection (NEW-SEC-3, NEW-SEC-4).
- §A10 NEW: SRI + supply-chain integrity (NEW-ADV-5).
- §A11 NEW: Error UX matrix (NEW-UX-3).
- §A12 NEW: Cross-device pull-on-discovery (NEW-UX-2, DEC-015).
- §A13 NEW: "What's saved" disclosure + first-push consent
  acknowledgment (NEW-PRV-4, DEC-011; NEW-ADV-4).
- §A14 NEW: Co-DM identity / per-DM-appdata (NEW-UX-4, DEC-014).
- §A15 NEW: Account-loss durability + GitHub-as-recovery rank
  (NEW-ADV-3).
- §A6 expanded: M6b KDF specified (PBKDF2-SHA256, ≥600k iter,
  AES-GCM-256, passphrase ≥12) per NEW-SEC-7. Passphrase
  recovery semantics locked (NEW-UX-7).
- Restore-side firewall §B NEW: NEW-ADV-1/2 fix already shipped
  in commit `a7dedac` (DEC-010); documented here for the M6 reader.
- §C NEW: Privacy + cross-tab posture (M5 list scope to
  sha256(google_sub) per NEW-PRV-3 / OP-026).

## Draft history

- Draft 1 (2026-05-29 mid-session): captured human's locked
  constraints, proposed PKCE-based architecture, ten open questions.
- Draft 2 (2026-05-29 later): incorporated SEC/PRV/ADV/UX/ARC review
  findings from the lead's self-review. Key shifts: default to
  `drive.appdata` (closes share-link leak path), layered M6 ship
  (ephemeral-first, passphrase-opt-in for refresh tokens), CORS
  probe blocks ship, same save format for Drive + GitHub.
- Draft 3 (2026-05-29 evening): incorporated 33 findings from the
  independent consultant pass (security / privacy / UX / adversarial).
  NEW-ADV-1/2 shipped as code (`a7dedac`); rest documented as
  open problems + decisions, surfaced in this doc for the M6 reader.

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

## Ship layering (REVISED in draft 2; M6a gates expanded in draft 3)

- **M6a (first ship):** OAuth PKCE + `drive.appdata` + ephemeral
  access_token in JS memory. Re-auth per session (browser-tab
  lifetime).
- **M6b (follow-up):** Add passphrase-protected refresh_token in
  IndexedDB. UX: "Type your Quire passphrase to unlock cloud sync
  across sessions." APP users degrade to M6a behavior.
- **M6c (later):** GitHub Device Flow + same `drive.appdata`-shape
  save committed to a configured GitHub path.

**M6a ship gates (draft 3, status checked at PR time against
`open-problems.md`):**

CLOSED before M6a code:
- ✅ OP-016 (CORS probe) — run #4.
- ✅ OP-017 (callback-page CSP + golden-diff CI) — run #4.
- ✅ OP-017b (UX placement / discovery / error matrix) —
  run #6.
- ✅ OP-017g (canonical client_id integrity) — run #5.
- ✅ OP-018 (runtime-overridable client_id + discovery doc)
  — run #5.
- ✅ OP-019 (Worker fallback decision) — run #4 (not needed,
  CORS open).
- ✅ OP-021 (state-nonce intent binding, logic) — run #5.
- ✅ OP-027 (player-content consent ceremony, logic) — run #5.
- ✅ OP-030 (OAuth error PII strip, callback-side) — run #4.

PARTIALLY SHIPPED IN M6a CODE (run #6):
- ✅ Orchestrator core: PKCE + state envelope wiring +
  token exchange + id_token.sub extraction +
  drive.appdata scope assertion (`src/auth/oauth-orchestrator.ts`).
- ✅ Drive uploadAppdata (create + update + If-Match
  propagation) — `src/auth/drive-api.ts`.

LANDS WITH cloud-push.ts + UI (next run(s)):
- OP-020 (per-flow UUID listener lifecycle wiring — envelope
  carrier + flowId-match shipped run #5/#6; production
  popup wrapper lands with cloud-push.ts).
- OP-022 (mid-session 401 detection wrapper — surfaces
  `unauthorized` from drive-api as a "Re-connect Drive"
  chip).
- OP-023 (account-switch id_token `sub` cache + match
  using the run-#6 `idTokenSub` return field).
- OP-024 (APP + WebAuthn popup-failure detector + full-page
  fallback; UAT walk-through deferred per DEC-026).
- OP-030 (opener-side `redactOAuthError` + fuzz).
- §A11 cross-device probe (depends on
  `drive-api.listAppdata`).
- §A12 error-matrix UI rendering (consumes orchestrator's
  typed failure reasons).

NEW-ADV-1/2 (the apply-side + rebroadcast firewall) is **already
shipped** in commit `a7dedac` (DEC-010) and validated by
`persistence.restore-firewall-fuzz.test.ts`. It is not a gate; it
is a closed prerequisite.

NEW-PRV-3 (M5 recently-played cross-tab leak, OP-026) is **a
follow-up to M5** — not strictly M6a-blocking but ships ALONGSIDE
M6a since the fix uses the same OAuth-derived account hash.

## §B Restore-side firewall (SHIPPED `a7dedac`, DEC-010)

The independent adversarial review's NEW-ADV-1 found the 5th
breach in the render-gated-but-restore-not-gated firewall class:
the cloud-save load path didn't consult the LOADING peer's coord
status, so a returning ex-DM pulling their save while connected
as a player landed raw `scratch-note` / `ai-prompt` /
`caster-state-set` / `dmNotes` events in their local log AND
rebroadcast them to the table via DEC-005 applyEvent propagation.
NEW-ADV-2 caught the same leak from the broadcast side.

The fix is two complementary surfaces, both using the same
`PER_KIND_SCRUBBERS` + `PLAYER_SCOPE_STRIP_KINDS` SSOT:

1. **`projectSaveForViewer(doc, viewerIsCoord)`** in
   `persistence.ts` — the symmetric restore-side companion to
   `serializeSessionForViewer`. Called by `quire-app.loadFromString`
   with `viewerIsCoord=(sessionView.mode==='host')` before
   `applyLoadedEvents`. Host loads are no-op (auto-reclaim on
   next tick); guest loads strip DM-only events before they
   enter the log.

2. **`defaultRebroadcastFilter(event)`** in `persistence.ts` —
   the rebroadcast-side classifier wired into `Peer` via the
   constructor's `rebroadcastFilter` option (production seam in
   `session-controller.ts`). `Peer.forwardShareToOthers` runs
   every event through the filter before sending: DM-only kinds
   are dropped, partial-payloads are field-scrubbed.

Validated by `src/persistence.restore-firewall-fuzz.test.ts`
(11 tests planting sentinels in every DM-only kind + sub-field
surface; assertions cover the restore projection, the
rebroadcast filter, AND an end-to-end integration scenario).

The map-blob rebroadcast scrubber uses a conservative empty
reveal-mask (drops labels). The receiving peer re-materializes
the revealed state from its own log. A player who receives a
rebroadcast `map-blob-add` for a not-yet-revealed blob sees it
on their map without a label until the reveal fires.
Acceptable; documented in `defaultRebroadcastFilter`'s doc
comment as the conservative-safe choice.

## §C Privacy + cross-tab posture (NEW in draft 3)

Per NEW-PRV-3 + OP-026: M5's recently-played list lives in
`localStorage`, which is same-origin shared across all tabs +
profiles signed into the same OS user. Two distinct humans
sharing a laptop see each other's campaign slugs + timestamps.

**Plan:** Once OAuth runs, scope the recently-played list by
`sha256(google_sub)`. Two distinct Google users get disjoint
lists. Pure-local DMs (no OAuth) keep today's anonymous
behavior. This is a follow-up to M5 (commit `0ef07c3`); ships
alongside M6a because it depends on the OAuth-derived account
hash being available.

Per NEW-PRV-5 + OP-028: every save event carries the authoring
`peerId`. The same DM saving multiple campaigns embeds the same
`peerId` in every save — a cross-campaign re-identifier. A DM
who pushes a public campaign to GitHub (M6c) AND a private one
to Drive (M6a) is linkable to the same person without any other
identifier. Documented as a limitation; a peerId-rotation
primitive (per-campaign) is a follow-up. Surface the participant
ID in the DM-only operational view so a security-conscious DM
can rotate when creating a new campaign.

Per NEW-PRV-4 + DEC-011: the DM-coord cloud save contains every
player's authored content (chat, character drafts, bond notes,
intent statements). On first push per campaign, surface a
one-time DM-only acknowledgment dialog. Silent-player-firewall
preserved: players are NOT notified; the DM is educated.

Per NEW-PRV-9 + OP-031: `drive.appdata` semantics need
verified citation — Google's documented behavior is "orphaned
but not deleted" on revoke, and TOS reserves the right to scan
all Drive content (regardless of folder visibility). Update
docs before M6a public ship; DM-only "Disconnect → Erase"
action handles the revoke-cleanup gap.

## §A11 Error UX matrix (NEW in draft 3, NEW-UX-3)

Five failure modes need designed copy. Final strings deferred to
M8 in-fiction review (per `ux-strategy.md`); the matrix below
is the engineering spec for which states each handler must cover.

| Failure | Detection | Copy spec |
|---|---|---|
| Popup blocked | 3s timeout w/o postMessage | "Your browser blocked the Drive popup. [Try again in this tab]" → full-page redirect (OP-015) |
| User denies consent | OAuth error `access_denied` | "You didn't grant access. Quire saves locally for now. [Try again]" — no shame |
| Network failure | fetch reject | "Couldn't reach Google. Your session is safe locally. [Retry]" |
| Account mismatch | id_token `sub` mismatch (NEW-SEC-4) | At consent: "Backing up as: markus@gmail.com. [Wrong account?]" — surface BEFORE file write |
| APP-blocked refresh | `invalid_grant` on refresh | First auth: "Heads-up: your Google account asks for fresh sign-in each session." |

## §A12 Cross-device pull-on-discovery (NEW in draft 3, NEW-UX-2 / DEC-015)

When the DM lands on a campaign URL with no local state AND has
connected Drive, Quire probes `drive.appdata` for a file matching
the campaignId. If found, surface "[Load it] [Start fresh]" with
Load as the default. NEVER auto-load silently — surprise restore
is worse than missing backup.

Probe cost: one Drive REST call per campaign landing where Drive
is connected. ~200ms median; budgeted as part of page render.

## §A13 "What's saved" disclosure + first-push consent (NEW in draft 3)

Two surfaces, both DM-only (silent-player-firewall):

1. **What's saved.** Per NEW-ADV-4 + OP-017f: a permanent
   "What's in your Drive backup" doc lists the kinds + fields
   that ride along (AI-prompts, npc-pins, bond-ratify.dmNotes,
   chargen-pack-deliver, etc.). Surface as a "What's saved?"
   link from the operational view.
2. **First-push consent.** Per NEW-PRV-4 + DEC-011: one-time
   per campaign, "You are uploading the full table's content
   (including your players' chat, character drafts, and bond
   notes) to YOUR Google Drive. [Acknowledge]" Persists to
   `localStorage`; re-prompted on campaign-id change.

## §A14 Co-DM identity / per-DM-appdata (NEW in draft 3, DEC-014)

Each co-DM connects their OWN Drive account and pushes to their
own `drive.appdata`. Pull-on-discovery (§A12) probes whichever
co-DM is signed in. Shared canonical ownership is deferred to
M6c (GitHub naturally shares).

Documented limitation: if BOTH co-DMs lose access to their
Google accounts, no backup survives. Mitigated by M6c sequencing
(see §A15).

## §A15 Account-loss durability (NEW in draft 3, NEW-ADV-3)

`drive.appdata` is structurally irrecoverable if the DM's Google
account dies (suspended / billed-out / hostile-reset). Quire's
"durable campaign" promise has a single point of failure on the
DM's Google account.

Mitigations (choose ≥1; tracked as OP-017e):

1. Mandatory local-disk copy on each cloud push (auto-fire the
   "Download backup" action from the operational view).
2. Promote `drive.file` opt-in to "the recoverability path" in
   docs (not just a footnote).
3. Re-rank M6c (GitHub) ahead of M6b. A GitHub-hosted save
   survives the DM's Google account.

Re-ranking M6c is the cleanest answer; pending product call.
Until then, mitigation (1) — auto-download on push — is the
backstop.

## §A9 Token lifecycle (REVISED in draft 3)

Beyond logout / revoke, three lifecycle paths need handling:

1. **Mid-session 401 detection (NEW-SEC-3 / OP-022).** Drive
   REST calls wrap a 401/403 handler that clears in-memory
   token + surfaces a non-modal "Re-connect Drive" chip with
   immediate re-auth on click. Same pattern for `invalid_grant`
   on M6b refresh-token redemption (signals APP-revoked or
   user-revoked → drop encrypted IndexedDB blob too).
2. **Account-switch detection (NEW-SEC-4 / OP-023).** Cache the
   `sub` from the id_token at first auth. On every refresh OR
   re-auth, verify the returned `sub` matches the cached one.
   Mismatch → refuse with "You're now signed into a different
   Google account; existing campaign saves won't be visible.
   Sign back into <email> or start a new connection."
3. **APP + WebAuthn-in-popup (NEW-SEC-6 / OP-024).** Detect
   popup-close-without-message in <2s OR error
   `security_key_required` → trigger the full-page redirect
   fallback (§A1.5).

## §A1.5 Popup-failure fallback (NEW in draft 3)

Per NEW-SEC-6 + NEW-PRV-1 + OP-015: popup contexts can fail for
multiple reasons (popup-blockers, browser ETP / storage
partitioning, APP WebAuthn ceremony incompatible with
`same-origin-allow-popups`).

Detection: any of (a) popup closes within 2s without
postMessage; (b) postMessage carries `security_key_required` or
similar error; (c) sessionStorage from the popup is empty on
return (storage-partitioning hint).

Fallback: full-page redirect using the SAME PKCE flow. State
preserved via `sessionStorage` keyed by per-flow UUID (OP-020).
On return, the page loads, detects `?code=…&state=…` in URL,
re-validates state + intent + flow UUID, redeems with the
preserved `code_verifier`.

Test matrix: Chrome stable, Firefox Strict, Safari ITP, Brave
Aggressive (NEW-PRV-1).

## §A10 Supply-chain integrity (REVISED run #5, NEW-ADV-5 / OP-017g)

The shipped `client_id` is a security primitive. An attacker
who compromises Quire's Cloudflare Pages deploy OR npm package
OR Underleaf-hosted bundle can swap it for theirs and read every
prior Quire save the user pushes (Google's per-app isolation is
keyed on the creating client_id).

**Run #5 ship (this milestone):** items 1-3 below are now
LANDED as code + docs.  Item 4 is documented in
`maintainer-ops.md` (DEC-024) and remains the maintainer's
ongoing responsibility.

Defenses:

1. **Build-time embedded baseline.**  `src/auth/canonical-client-id.ts`
   carries the canonical `client_id` + a SHA-256 fingerprint of
   the consent-screen-displayed app name + a `status` flag
   (`'verified' | 'placeholder' | 'unavailable'`).  The runtime
   trusts this baseline by default and refuses to initiate
   OAuth against a `'placeholder'` status (the placeholder is
   the M6a code-ship checkpoint — flipping `GOOGLE.status` to
   `'verified'` is the moment cloud sync goes live).
2. **Golden-diff CI.**  `scripts/golden-diff-canonical-client-id.test.mjs`
   pins SHA-256 hashes of both `src/auth/canonical-client-id.ts`
   AND `public/.well-known/quire-oauth.json`.  Any change without
   updating the hashes in the same PR fails the build — the same
   pattern as the callback-page golden-diff (OP-017).  This is
   the supply-chain defense against an attacker slipping a
   client_id swap past code review.
3. **Discovery doc.**  `public/.well-known/quire-oauth.json`
   serves as the per-deploy hint the runtime fetches at first
   OAuth use.  Per DEC-025, hosting is Cloudflare Pages static
   asset (CDN cache TTL ~1-5 min for emergency rotation).  Per
   DEC-013 / DEC-017, the discovery doc is a HINT — the runtime
   still trusts the embedded baseline by default; the discovery
   doc CAN propose a different client_id (rotation channel) but
   the runtime refuses to act on the proposal unless the
   baseline's per-entry `allowDiscoveryOverride` is `true`
   (v1 ships closed; the hook is in place for future incident
   response).
4. **Maintainer-ops runbook.**  `maintainer-ops.md` (DEC-024)
   documents the rotation runbook, self-hoster override paths
   (env var / query param / campaign-manifest), incident-response
   cheat sheet (revoke / rotate / re-pivot), and Cloudflare Pages
   deploy-key + branch-protection requirements.

**Self-hoster override:** three paths, all documented in
`maintainer-ops.md` §5.  Build-time env var
(`QUIRE_OAUTH_CLIENT_ID_GOOGLE`) is the recommended path
(reproducible build, deploy-audit trail).  Query parameter and
campaign-manifest paths are spec'd for v1+ but not consumed by
the runtime in v1 — placeholder hooks per DEC-013.

**Why no Subresource Integrity (SRI) on the bundle:**  SRI
binds a `<script src>` hash at the source-document level, but
Vite emits chunk-split bundles whose hashes are computed at
build time and embedded in the index.html.  Cloudflare Pages
already delivers integrity via the build-pipeline trust
boundary (deploy-key + branch-protection); adding SRI on top
duplicates the protection without closing the supply-chain
attack vector (an attacker who can swap `canonical-client-id.ts`
can also swap the SRI hash).  Revisit if the threat model
introduces a third-party CDN.

## §A7 OAuth callback page (REVISED in draft 3, NEW-ADV-8 / OP-017)

The callback page is the most security-critical static page in
the deploy. Per NEW-ADV-8:

1. **Strict CSP:** `default-src 'none'; script-src 'self';
   style-src 'self'; connect-src 'self'`. NO inline scripts.
2. **Parsing:** `URLSearchParams` ONLY. postMessage payload is
   `{ code, state, flowId }` — never the raw URL. flowId is a
   sanity check (OP-020); opener re-validates.
3. **state at callback:** sanity-check the embedded HMAC at the
   callback as defense in depth (opener re-verifies on receipt).
4. **CI audit:** the file is golden-diff'd against a checked-in
   snapshot. Any change without explicit sign-off fails the
   build. The CSP header is deploy-time-asserted by a test that
   GETs the deployed URL and checks the header.

## §A4 GitHub Device Flow (REVISED in draft 3)

Per NEW-UX-2 disagreement: Device Flow is correct for the at-
table DM but breaks for first-time setup when the DM is alone
on a laptop with no phone handy. Default: Device Flow. Fallback
link in the UI: "Use a popup instead" → switches to the GitHub
PKCE OAuth flow (G2 in §A4).

## §A1 OAuth flow state (REVISED in draft 3, NEW-SEC-1 / NEW-SEC-2)

The state-of-the-flow management gets explicit listener
lifecycle + intent binding:

1. **Per-flow UUID.** Every "Push to Drive" / "Pull from Drive"
   click mints a new UUID. `sessionStorage` keys are
   `quire.oauth.flow.<uuid>.{verifier,state,intent}` —
   not a single well-known key.
2. **Listener scoped to flow.** `window.addEventListener('message',
   handler)` added at `window.open`; removed on popup-close OR
   onmessage-success. Listener body validates
   `event.data.flowId === my.flowId` BEFORE redeeming the code.
3. **Intent embedded in state.** Per DEC-012: `state =
   base64url({nonce, intent, campaignId, fileRev, ts, flowId})`
   plus HMAC over intent fields using a per-tab session secret.
4. **Stale-state defense.** `ts` within 10 minutes; otherwise
   refuse with "Sign-in took too long; try again."

This closes NEW-SEC-1 (two-tab race) and NEW-SEC-2 (intent
binding). Civilized-peer threat model accepts campaign-id in
URL-bar history.

---

## §FS Non-OAuth path: File System Access API (NEW run #7, DEC-028)

The File System Access API path (M6a-FS) gives the DM cloud
durability with ZERO Quire-side infrastructure: no OAuth, no
client_id, no Cloudflare proxy, no Google project, no
maintainer-app registration.  The DM picks a folder; Quire
writes the save file there; the user's existing desktop sync
client (Google Drive Desktop, Dropbox, OneDrive, iCloud Drive,
…) uploads it to whichever cloud the DM already pays for.

This section is the §A-depth specification for M6a-FS, sibling
to §A1-A15 which spec the OAuth Drive path.

### §FS.1 Feature detection (`src/auth/fs-api-availability.ts`)

The structural test: `typeof window.showDirectoryPicker ===
'function'`.  Anything else falls back to a typed verdict:

| Verdict | Detection | UI surface |
|---|---|---|
| `{available: true}` | API present + not mobile | render M6a-FS surfaces |
| `{available: false, reason: 'safari'}` | Safari UA + API missing | "isn't available in Safari yet" copy |
| `{available: false, reason: 'firefox'}` | Firefox UA + API missing | "isn't available in Firefox yet" copy |
| `{available: false, reason: 'mobile'}` | Android/iPhone/iPad UA | "not available on mobile" copy |
| `{available: false, reason: 'no-api'}` | API missing, unknown UA | "isn't available in this browser yet" copy |

Mobile wins over Safari/Firefox in the verdict because the
OS-level sync model (Drive Desktop / Dropbox client) is the
load-bearing prerequisite and isn't running on phones.
UA-sniff is best-effort; if it misclassifies a niche browser,
the verdict downgrades gracefully to `'no-api'`.

The verdict carries a stable `reason` field so the
operational-view "Backups" card can render the right "try X
instead" message — not because we want to enumerate every
browser but because the DM deserves to know whether to switch
browsers (Safari → Chrome) or wait for OAuth Drive (mobile).

### §FS.2 Handle persistence (`src/auth/fs-api-handle-store.ts`)

Folder handles obtained from `showDirectoryPicker` are
structured-cloneable.  Browsers persist them across tab close
AND browser restart when stored in IndexedDB — and ONLY
IndexedDB.  `localStorage` can't hold them; `sessionStorage`
discards them at tab close.  Without IndexedDB persistence the
DM re-picks the folder every session — kills the value.

Schema: one object store `handles` keyed on `campaignId`.
Each record carries:
- The folder handle (live object — never JSON-stringified).
- `displayName` (the folder name at connect time).
- `connectedAt`, `lastPushedAt` (staleness chip data).
- `lastObservedModifiedMs` (conflict-detection baseline).

Multi-campaign layout: ONE folder, file-per-campaign.  The DM
picks (e.g.) `Google Drive/Quire/` once and connects multiple
campaigns to the same handle; each campaign's record has its
own accounting.  See §FS.4 for the file-naming convention.

### §FS.3 Permission lifecycle

Even with the handle persisted, the browser does NOT
automatically re-grant write access on tab reload — privacy
defense by design.  The lifecycle:

1. First call: `showDirectoryPicker` — user picks; permission
   is granted for THIS tab.
2. Store the handle in IndexedDB.
3. Tab closes; user reopens; we read the handle.  Permission
   has rolled back to `'prompt'` (sometimes `'denied'` if the
   user revoked it in browser settings).
4. Before each write, we call
   `handle.queryPermission({mode: 'readwrite'})`.
   - `'granted'` → proceed.
   - `'prompt'` → require a user gesture next; on click, call
     `requestPermission({mode: 'readwrite'})`.
   - `'denied'` → render "Reconnect folder"; click triggers
     the request path; if still denied, surface "Your browser
     is blocking this folder — pick a new folder or reset the
     permission in settings."

Two implications:

- **We CANNOT silently auto-push in the background after a
  fresh tab open.**  The first push of a session requires a
  deliberate click.  Same UX shape as the OAuth "Sign in to
  push" click — the click IS the consent.
- **Revoked vs never-granted is structurally
  indistinguishable** once permission rolls back.  Callers
  treat them the same: surface the reconnect chip, request on
  the next gesture.

### §FS.4 File-naming convention

`<campaign-slug>.quire-save.json` at the top level of the
chosen folder.  Examples:

- Campaign id `gutschke/underleaf@main` → `gutschke-underleaf-main.quire-save.json`
- Campaign id `weird/test@v1.0` → `weird-test-v1.0.quire-save.json`

Sanitization rules (`sanitizeCampaignSlug` in
`fs-api-cloud-push.ts`):

1. Lowercase.
2. Replace anything that's NOT `[a-z0-9._-]` with `-`.
3. Collapse runs of `-` into a single `-`.
4. Trim leading/trailing `-`.
5. Truncate to 64 chars.
6. Fall back to `campaign` if the result is empty.

Documented in `maintainer-ops.md` so users hunting for the
file by hand (or in the desktop sync client's web UI) know
the naming convention.

### §FS.5 Conflict handling (read-before-write)

Before each push: read the file's current `lastModified`.  If
it's newer than `lastObservedModifiedMs` from the previous
push or pull, the file was modified externally — desktop sync
pulled a newer copy from cloud (another device wrote first).
Surface `{ok: false, reason: 'conflict'}` so the caller shows
a "Pull, merge, then push" prompt, analogous to §A7's
pull-rebase-push for OAuth Drive.

The runtime's existing CRDT merge handles the actual
reconciliation (LWW, sum-of-clock ordering); the FS-API layer
detects the conflict and bails before clobbering.

### §FS.6 Consent ledger reuse (`cloud-push-consent.ts`)

The save is the full DM-coord projection (every player's
content, including chat / character drafts / bond notes).
Players didn't directly authorize "my words leaving the
table for the DM's folder."  Per DEC-011 + DEC-020, the
one-time per-campaign DM-only acknowledgment ceremony applies.

Run #7 adds `'fs-api'` to `ConsentDestination` union.  Per
DEC-020 each destination is a SEPARATE custody transfer:
acknowledging FS-API does NOT acknowledge Drive-appdata or
GitHub.  A separate copy spec (`DEFAULT_CONSENT_COPY_FS_API`)
adapts the wording — the destination is "YOUR folder" rather
than "YOUR Drive," and the body clarifies that Quire does
NOT speak to any cloud provider directly (the OS-level sync
tool is the one talking to the cloud, not us).

Silent-player firewall preserved: the dialog is DM-only;
players are NOT notified.

### §FS.7 Threat model (DEC-023 walk)

**Class 1 — Internet randos / external attackers — ZERO surface goal.**

The FS-API path has NO network surface.  The folder handle is
per-origin; no other site can reach it (browser's same-origin
policy on FileSystemDirectoryHandle).  We never expose the
handle to anything we don't control.

- **No token to steal.**  M6a-OAuth's access_token,
  refresh_token, id_token are all N/A on this path — no
  OAuth flow, no tokens.
- **No third-party data flow we authorize.**  Quire writes to
  the folder.  The desktop sync client (a process the user
  installed before we ever existed) does the upload.  We
  authorize NOTHING on the user's behalf with any cloud
  provider.
- **Supply-chain attack surface is `showDirectoryPicker` itself.**
  An attacker who compromised the Quire bundle could request
  a folder picker pointed at a sensitive directory and read
  its contents.  Mitigations: the bundle is on Cloudflare
  Pages (same trust boundary as the OAuth callback golden-diff
  — DEC-025); the user-gesture requirement prevents drive-by
  picker pops; the folder-pick is a deliberate user choice
  with visible OS-level dialog.  Compromise scope == compromise
  scope for OAuth Drive but DIFFERENT (the attacker would
  exfiltrate locally rather than authorize a cloud read).
- **CDN-cache rotation lag (DEC-025) is N/A.**  No discovery
  doc to invalidate; the bundle change is the change.

**Class 2 — Accidental disclosure between trusted teammates.**

Same firewall ethos as M6a-OAuth:

- The save IS the DM-coord projection (full event log, DM-only
  events included).  Restore-side firewall §B applies if a
  player ever loads the file — `projectSaveForViewer` strips
  before applying.
- DEC-009's `drive.appdata` "no share-link UI" rationale is
  N/A — there's no Drive UI to accidentally share from.  BUT
  the DM CAN share the folder via their OS file manager (drag
  to a shared Dropbox folder, change Drive permissions to
  "Anyone with link can view," etc.).  This is the same
  attack surface as M6a-OAuth + `drive.file`.  The
  player-content consent ceremony (DEC-011 / OP-027 / §FS.6
  above) covers the disclosure from the DM's awareness side;
  the technical defense (file lives in DM's folder, players
  don't see it) is the same as Drive's.
- The first-push consent ceremony triggers on first push to a
  folder per campaign (the `hasAcknowledged` check inside
  `connectFolder` enforces this — no consent → no connect).

**Class 3 — Malicious co-players.**  Out of scope per DEC-023.

### §FS.8 Disconnect / revocation

Two paths:

1. **DM clicks "Disconnect" in the Backups card.**
   `disconnectFolder` drops the handle record from IndexedDB
   and calls `withdrawAcknowledgment` on the consent ledger.
   Future pushes for this campaign go back through the connect
   ceremony.  DOES NOT delete the save file from the folder —
   the DM can still open it via their file browser.
2. **User revokes permission in browser settings.**  Next
   `queryPermission` returns `'denied'`; the card surfaces
   the reconnect path.  If `requestPermission` returns
   `'denied'`, the card surfaces "pick a new folder" — the
   handle is structurally still in IndexedDB but Quire can't
   use it.

Stronger "Disconnect → Erase" semantics (delete the save file
on disconnect, per OP-029) are out of M6a-FS scope.

### §FS.9 What §A* sections from M6a-OAuth carry over vs. are N/A

| §A subsection | M6a-FS status |
|---|---|
| §A1 OAuth flow state | N/A — no OAuth |
| §A1.5 popup fallback | N/A — no popup |
| §A2 Drive scope | N/A — no scope; `readwrite` is folder-level |
| §A3 Advanced Protection | N/A — no Google auth |
| §A4 GitHub Device Flow | N/A — M6c surface |
| §A6 Save format | SAME — `stringifySave` output unchanged |
| §A7 callback page | N/A — no callback |
| §A8 client_id | N/A — no OAuth client |
| §A9 token lifecycle | N/A — no tokens |
| §A10 supply-chain | PARTIAL — bundle integrity matters (DEC-025), no `client_id` to pin |
| §A11 error UX matrix | INSPIRES — §FS analog covers `permission-revoked`, `conflict`, `cancelled` (see backups-card error chip) |
| §A12 cross-device pull | DIFFERENT — `listSavesInFolder` reads the connected folder rather than a Drive REST list |
| §A13 first-push consent | SHARED — same ledger, destination `'fs-api'`, DEFAULT_CONSENT_COPY_FS_API |
| §A14 co-DM identity | SAME structural model — each co-DM connects their OWN folder; M6c-B GitHub remains the canonical shared backup |
| §A15 account-loss durability | DIFFERENT — folder lives on the DM's disk; if the desktop sync client is connected to multi-cloud, durability inherits from the sync tool, NOT from any account Quire knows about |
| §B restore-side firewall | UNCHANGED — same `projectSaveForViewer` runs on load |
| §C cross-tab privacy | INHERITS — recently-played list scope is unchanged |

### §FS.10 Co-existence with M6a-OAuth

Once M6a-OAuth ships, a DM can have both connected for the
same campaign — folder + Drive — as parallel destinations.
The backups-card surface today renders ONE card; multi-
destination rendering is a UX decision deferred until
M6a-OAuth is live.  Engine-side: the consent ledger is
already per-destination (DEC-020), so the data model is
ready.

### §FS.11 Cross-device handoff (§A11 / DEC-015 analog)

The OAuth path's §A11 probe (one `listAppdata` call with
campaign-id filter) becomes, on M6a-FS:

- IF a folder is connected on THIS device → call
  `listSavesInFolder`; if a matching `.quire-save.json`
  exists, surface the §A11 `[Load it] [Start fresh]`
  prompt.
- IF NO folder is connected on this device → surface the
  existing "no local state" UI plus a `[Connect a folder
  to look for backups]` affordance.

Importantly: the FS-API can't probe ACROSS DEVICES (the
folder handle is per-origin per-device).  The DM has to
re-connect the folder on the new device first — but once
they do, the saved file is there waiting.

### §FS.12 Tests

Engine tests (run #7 ship):

- `fs-api-availability.test.ts` — 16 tests: API present /
  missing × {Chrome, Edge, Safari, Firefox, mobile} matrix +
  Chromium-Safari-token exclusion + SSR fallback.
- `fs-api-handle-store.test.ts` — 19 tests: in-memory
  round-trip + multi-campaign independence + permission
  lifecycle (granted / prompt / denied / revoked /
  re-granted) + defensive paths (queryPermission throws,
  requestPermission throws).
- `fs-api-cloud-push.test.ts` — 37 tests: feature gate +
  connect happy path + consent gate + permission denied +
  push (new file + overwrite + conflict) + pull (happy /
  not-found / not-connected) + list (filter to suffix) +
  disconnect (handle drop + consent withdrawal + file
  preserved) + multi-campaign file layout + permission
  lifecycle through the orchestrator + getConnectedFolderState.
- `cloud-push-consent.test.ts` — extended with 8 new tests
  covering the `'fs-api'` destination round-trip, sibling
  independence from `'google-drive-appdata'`, and the
  `DEFAULT_CONSENT_COPY_FS_API` semantic spec.

UI tests (run #7 ship):

- `backups-card.test.ts` — 19 tests: DM gate + feature gate
  (all four unavailable reasons) + disconnected state + connect
  happy path + consent cancel → no state change + push event
  dispatch + applyPushResult success/conflict/permission-revoked
  → chip + disconnect → chip success.

The picker call itself (`showDirectoryPicker`) is
Playwright-untestable (requires a real user gesture + native
dialog).  We stub it at the `FsApiCloudPush.picker`
dependency boundary.

---

**End of draft 3 + §FS run #7 addendum.** Open questions that
still need human judgment are surfaced at end-of-turn (see
status.md).
