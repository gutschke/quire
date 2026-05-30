# Save/Restore Program — Status

**Last updated:** 2026-05-29 run #7 (DEC-028 split M6a into
M6a-FS [NEW, ships first] + M6a-OAuth [run #6 work]; M6a-FS
engine layer + `<backups-card>` Lit region SHIPPED with 99
new tests; host integration deferred to run #8)
**Active milestone:** M6a-FS — File System Access API path
(engine layer + UI region complete; host wiring into
`quire-app.ts` deferred to run #8 per OP-036 / OP-038)
**Latest deploy hash:** see end-of-turn (will be the run #7 push)
**Branch:** main

## Session log (most recent first)

- **2026-05-29 run #7 (this run):** Human raised barrier-to-
  entry bar.  Verbatim: *"a google cloud project is acceptable,
  but it would be even better if a dm could sync to their
  consumer google drive without requiring a google project.
  much lower barrier to entry that way."*  Clarifying read: the
  File System Access API removes EVEN the maintainer's OAuth
  app registration — the DM picks a folder; OS-level sync tool
  uploads.  Logged DEC-028 (M6a-FS ships ahead of M6a-OAuth).

  **Engine layer SHIPPED (Piece 1):**

  - `src/auth/fs-api-availability.ts` (16 tests) — feature
    detection.  Typed verdict carries `reason` field so the UI
    surfaces browser-specific copy: `safari` / `firefox` /
    `mobile` / `no-api`.  Mobile wins over Safari/Firefox in
    the verdict (OS-level sync model is load-bearing).

  - `src/auth/fs-api-handle-store.ts` (19 tests) — IndexedDB
    persistence of `FileSystemDirectoryHandle`.  Per-campaign
    handle records + permission lifecycle (probe → request).
    `probeWritePermission` is cheap + side-effect-free (called
    on every push); `requestWritePermission` requires user
    gesture.

  - `src/auth/fs-api-cloud-push.ts` (37 tests) — the
    orchestration layer.  `FsApiCloudPush` class with
    `connectFolder` / `pushCampaignToFolder` /
    `pullCampaignFromFolder` / `listSavesInFolder` /
    `disconnectFolder` / `getConnectedFolderState` /
    `requestPermissionForCampaign`.  File-naming
    convention: `<campaign-slug>.quire-save.json` at folder
    root.  Multi-campaign: ONE folder, file-per-campaign.
    Read-before-write conflict detection bails with
    `'conflict'` if external lastModified > our baseline.

  - `cloud-push-consent.ts` extended: `'fs-api'` added to
    `ConsentDestination` union + `DEFAULT_CONSENT_COPY_FS_API`
    spec exported (clarifies Quire does NOT speak to any cloud
    provider; the OS-level sync tool is the one talking to the
    cloud).  Per-destination independence preserved per
    DEC-020.  8 new tests.

  **UI region SHIPPED (Piece 2 partial):**

  - `src/ui/regions/backups-card.ts` (19 tests) — Lit
    `<backups-card>` element.  States:
    - DM gate (`renderForDm=false` → empty DOM defense-in-
      depth on the silent-player firewall).
    - Unavailable (4 reasons → 4 distinct copy strings).
    - Disconnected ("Connect a folder" + sync-tool examples).
    - Connected (folder name + last-push + Push/Pull/
      Disconnect).
    - Chip state machine (busy / success / error) with
      conflict + permission-revoked copy.
    Picker call replaced via dependency boundary;
    Playwright-untestable (real user gesture + native dialog)
    out of scope per mandate.

  **UI host integration DEFERRED to run #8:**

  - OP-038 (NEW): wire `<backups-card>` into `quire-app.ts`
    DM-only render path.  The DM operational view per §A10-B
    doesn't yet exist as a discrete surface in
    `quire-app.ts`; run #8 picks between (a) adding a DM-only
    "Backups" card to the existing renderCampaign path or (b)
    standing up the operational view as a separate surface
    + embed the card inside it.  (a) ships M6a-FS user-
    visible faster; (b) aligns with longer-term arch.
  - OP-037 (NEW): session-digest chip surface (§A10-A).
    Deferred; rides along OP-038 host work.
  - OP-036 (NEW): host event handler for `backups-push-
    request` — calls `serializeSession` + `stringifySave` +
    `pushCampaignToFolder`, hands result back via
    `applyPushResult`.  Deferred; rides along OP-038.

  **Doc updates SHIPPED (Piece 3):**

  - `decisions.md` DEC-028 logged (verbatim human input +
    M6a-FS-first ordering rationale).
  - `auth-strategy.md` new top-level §FS (12 subsections at
    §A-equivalent depth: feature detection, handle
    persistence, permission lifecycle, file-naming
    convention, conflict handling, consent ledger reuse,
    threat model walk per DEC-023, disconnect / revocation,
    §A* applicability matrix, M6a-OAuth co-existence,
    cross-device handoff variant, test inventory).
  - `roadmap.md` updated to reflect M6a-FS → M6a-OAuth →
    M6c → M6b order.
  - `maintainer-ops.md` new §8.5 (M6a-FS requires no
    maintainer setup; flipping live = code change + deploy,
    not external registration; file-naming convention,
    multi-campaign layout, permission lifecycle, conflict
    behavior all documented for user-report triage).
  - `ux-strategy.md` §A10-B got M6a-FS variant (folder name
    surfaces instead of account email; FS-API-specific
    affordances).  §A11 got M6a-FS probe-shape variant
    (`listSavesInFolder` on the connected folder; no Drive
    REST list call).
  - `open-problems.md` filed OP-036/037/038 (run #8
    host-integration follow-ups).

  Tests: 2856 + 2 skipped = 2858 (up from 2777 baseline at
  d7778c2; +81 new).  Typecheck clean.  No credentials in
  diff (audit clean).
- **2026-05-29 run #6 (prior run):** Closed OP-017b — last doc
  gate before M6a code.  Three new ux-strategy.md sections
  shipped: §A10 (placement: session-digest chip primary +
  DM operational view discovery surface; setup-wizard
  explicitly rejected per prime directive), §A11 (cross-device
  pull-on-discovery probe + Load/Start-fresh prompt per
  DEC-015), §A12 (5-row error matrix: popup-blocked /
  user-denied / network-failure / account-mismatch /
  app-blocked).  Then started M6a OAuth orchestration code:
  `src/auth/oauth-orchestrator.ts` (PKCE flow lifecycle with
  injectable popup; typed ConnectGoogleResult with 7 failure
  reasons mapping to §A12 rows; no-throw-past-
  assertReadyForOAuth contract; access_token is
  JS-memory-only per DEC-007 C4) + `src/auth/drive-api.ts`
  (one method: uploadAppdata create+update against
  drive.appdata; multipart/related; If-Match propagation;
  typed failure reasons including OP-022 unauthorized routing
  + OP-011 precondition-failed for pull-rebase-push).  Stopped
  after orchestrator + one Drive method per the run-#6
  mandate's stop-condition guidance: one solid layer
  closes the "click → file in drive.appdata" mechanical
  chain.  Tests: 2777 (2775 passed + 2 skipped), up from
  2729 baseline (+48).  Typecheck clean, build clean.
- **2026-05-29 run #5 (prior run):** Highest-priority M6a gate
  shipped — canonical client_id integrity + runtime override +
  discovery doc (OP-017g + OP-018, P0 under DEC-023 class 1).
  State-nonce intent-binding logic shipped (OP-021, P1, the
  CSRF + wrong-campaign-write defense). Player-content
  first-push consent ledger shipped (OP-027, P1, the
  firewall-ethos surface). DEC-024..026 logged. Maintainer-ops
  runbook landed at `design/save-restore-program/maintainer-ops.md`
  per DEC-024. Re-verified OP-030 (callback-side `error_description`
  strip is in the run #4 ship + covered by the golden-diff). Tests:
  2727 (2725 passed + 2 skipped), up from 2651 baseline (+76).
  Typecheck clean, build clean (well-known doc copies to
  `dist/.well-known/quire-oauth.json`).
- **2026-05-29 run #4 (prior run):** Human delivered 7 product
  calls verbatim accepted, plus a new threat-model framing
  (DEC-023) and a new use case (GitHub-as-publish-and-fork).
  Logged 8 new decisions (DEC-016 through DEC-023), re-triaged
  every open problem under DEC-023's three-class framing,
  verified GitHub publish-and-fork is mechanically possible
  today (10-test verification matrix), split M6c into M6c-A
  (publish-and-fork) + M6c-B (personal backup) and re-ranked
  per DEC-016 / DEC-022 (M6a → M6c → M6b), shipped the OAuth
  callback page + golden-diff CI (OP-017 BLOCKING closed), ran
  the CORS probe live and confirmed `oauth2.googleapis.com/token`
  is CORS-open from quire.pages.dev + localhost (OP-016 +
  OP-019 BLOCKING closed; Worker fallback not triggered, DEC-018
  inert by happy path). 12 ship-gates → 10 remaining before
  M6a code can land. Tests: 2651 (2649 passed + 2 skipped),
  up from 2629 baseline (+22). Typecheck clean, build clean.
- **2026-05-29 session 3 (prior run):** Independent consultant
  pass (4 reports x 9-10 findings = 33 new findings) folded
  in. NEW-ADV-1/2 fix shipped (commit `a7dedac`). Draft-3
  auth strategy + 14 new OPs + 6 new decisions
  (DEC-010..DEC-015).
- **2026-05-29 session 2:** M4 restore-drill ship + M5
  recently-played + persist + M6 auth-strategy.md draft 1+2 +
  self-review.
- **2026-05-29 session 1:** M0 docs + M1 firewall + M2
  tab-close + M3 re-broadcast.

## Just shipped this run (6)

### OP-017b — UX placement / discovery / error matrix (LAST doc gate)

- **`ux-strategy.md` §A10 "Cloud-sync placement + first-encounter
  discovery"** — locked two placement surfaces, deferred a
  third, explicitly rejected a fourth:
  - **PRIMARY: session-digest chip.**  Renders at session-close
    behind the digest's existing DM-only conditional.
    Microcopy preserves silent-player firewall.  This is the
    moment the DM *understands* backup value — also the
    natural anchor for the first-push consent ceremony
    (OP-027 / DEC-020).
  - **DISCOVERY: DM operational view "Backups" section.**
    Always-rendered when the view is open; surfaces account
    email (NEW-SEC-4 mismatch defense), connection state,
    push staleness.  Wires Disconnect Drive →
    `withdrawAcknowledgment` + best-effort token revoke.
  - **DEFERRED: recently-played row badge.**  The
    consultant's third surface, depends on the §A11 probe
    being live.  Track under M6a-UI follow-up.
  - **REJECTED: setup-wizard / first-launch ceremony.**
    Admin-before-play violation.  The DM should never
    encounter cloud sync before they're ready to use it.
- **`ux-strategy.md` §A11 "Cross-device handoff discovery"** —
  probe specced.  Trigger: empty local state + Drive
  connected on this device.  Probe shape: one
  `drive-api.listAppdata` call with `name = quire-<campaignId>.json`
  filter.  Surfacing: `[Load it]` (default) `[Start fresh]`
  prompt per DEC-015 — NEVER auto-load.  Anti-pattern callout
  against ambiguous "maybe-backup" copy.  If Drive isn't
  connected, the landing shows existing "no save found" UI
  with an additional `[Check Drive for backups]` one-liner —
  click triggers OAuth, then probe runs.
- **`ux-strategy.md` §A12 "Error UX matrix"** — five-row table
  pinning detection signal → placeholder copy → recovery
  action for each NEW-UX-3 failure mode.  Six error-surface
  principles lock the shape:
  1. Local safety stated first (DM doesn't panic).
  2. Single primary action per error.
  3. Silent-player firewall: errors render only on DM surface.
  4. Modal vs. non-modal rule based on flow lifecycle.
  5. No exception-to-string for OAuth errors; unknown maps to
     network-failure (most innocuous bucket).
  6. Recovery actions share orchestrator entry points so the
     matrix is testable as state transitions.

  Final wording deferred to M8 (TTRPG-craft owns in-fiction
  copy per `ux-strategy.md`'s existing pattern).

### M6a OAuth orchestrator — `src/auth/oauth-orchestrator.ts`

- `OAuthOrchestrator.connectGoogle({campaignId, intent,
  fileRev})` composes the run-#5 primitives into one PKCE
  flow:
  - `assertReadyForOAuth(GOOGLE)` precheck (placeholder → typed
    `not-configured` failure; popup not opened, session store
    untouched).
  - `freshFlowId` + `freshSessionSecret` mint per-flow
    identifiers (OP-020).
  - PKCE S256: `freshCodeVerifier` from `random.randomBytes(32)`
    base64url-encoded; `code_challenge = base64url(SHA-256(verifier))`
    via `crypto.subtle.digest`.
  - `mintState` produces the intent-bound state envelope per
    DEC-012.
  - Popup is injectable (`OAuthPopup` interface) returning
    `OAuthPopupResult` union (`message` / `popup-blocked` /
    `popup-closed`).  Production wires `window.open` + per-flow
    listener; tests inject synthetic events.
  - Token exchange via injectable `FetchLike`; parses Google's
    token response; decodes `id_token` payload for `sub`
    (DEC-019 + NEW-SEC-4); asserts granted scope contains
    `drive.appdata` (defense-in-depth scope check).
  - Returns typed `ConnectGoogleResult` with 7 failure
    reasons mapped to §A12 rows.
  - `error_description` from Google's token-endpoint error
    body is NEVER propagated (OP-030 PII strip).
  - access_token is JS-memory-only per DEC-007 C4 — the
    `OAuthSessionStore` only ever sees the per-flow HMAC
    secret, wiped on every exit path.

- 28 unit tests in `oauth-orchestrator.test.ts`:
  - Gate check (placeholder baseline → not-configured).
  - Happy path (token + sub + expires_in + scope assertion).
  - Auth URL composition (every PKCE param verified).
  - env-override client_id (self-host path per DEC-013).
  - Popup timeout propagation.
  - Per-flow secret wiped on success AND on every failure
    path.
  - Each failure branch wired correctly.
  - `state-rejected` carries verifier-side subcode
    (bad-signature, campaign-mismatch).
  - Audit test: access_token never lands in session store.
  - `parseCallbackMessage` shape validator: 7 cases including
    rejecting code-without-state and orphan-state-without-code.

### Drive REST `uploadAppdata` — `src/auth/drive-api.ts`

- `uploadAppdata({accessToken, fileName, body, fileId?,
  ifMatchRevisionId?}, fetchImpl)` against the
  `drive.appdata` space.  Create (POST + `appDataFolder`
  parent in metadata) vs. update (PATCH + no parent change)
  keyed on `fileId` presence.  `If-Match` propagation for
  the pull-rebase-push concurrency lane (DEC-016 / OP-011).
- 7-reason typed failure enum: `unauthorized` (401 → OP-022
  routing), `forbidden` (403), `not-found` (404),
  `precondition-failed` (412 → caller pulls-rebases-pushes),
  `network-failure` (fetch reject / 5xx), `malformed-response`
  (200 but bad body), `quota-exceeded` (403 with
  `quotaExceeded`/`userRateLimitExceeded` reason hint).
- Drive error message strings NEVER appear in the typed
  result (OP-030 — Drive 401 bodies can carry user email
  PII).  Only the small fixed-vocabulary `error.code` enum
  rides on `errorCode`.
- 20 unit tests in `drive-api.test.ts`:
  - Happy create (POST, Bearer auth, multipart body shape,
    `appDataFolder` parent in metadata).
  - Happy update (PATCH, no parent change, If-Match
    propagation).
  - Each HTTP error → its typed reason (8 cases).
  - PII strip audit (401 with email in error.message → result
    JSON does not contain the email).
  - Request-shape invariants (Content-Type multipart, fields=
    selector).
  - `isRetryable` predicate (network + quota only).

### Why we stopped here (architectural note)

The run-#6 mandate said: "STOP after the orchestrator + one
Drive API method + their tests" if Piece 2 trends too large.
The orchestrator + uploadAppdata together close the
mechanical chain "click → file in drive.appdata" — one solid
layer.  The caller layer (cloud-push.ts) + the remaining
two Drive methods (downloadAppdata, listAppdata) is the
NEXT natural unit; building it now would have meant a
larger diff at the same architectural seam without an
intermediate ship.

Next-up natural ship is cloud-push.ts (the DM-facing
orchestration: wires hasAcknowledged / recordAcknowledgment +
orchestrator + drive-api), then the §A11 probe (which
depends on listAppdata), then the UI surfaces (§A10
chip + operational view section).

## Prior run shipped (5)

### DEC-024..026 logged in `decisions.md`

- **DEC-024 — Maintainer ops doc colocated with save-restore-
  program** (answers OP-017g maintainer-doc location question;
  promote to top-level `ops/` once a second ops doc lands).
- **DEC-025 — Well-known discovery doc hosted as Cloudflare
  Pages static asset** (answers OP-018 hosting question;
  CDN-cache TTL of ~1-5 min documented).
- **DEC-026 — APP+WebAuthn-in-popup verification deferred to
  UAT** (answers OP-024 real-account-availability question;
  detector + fallback ships in M6a code, live walk-through
  parks until M8).

### M6a ship-gate: OP-017g + OP-018 — Canonical client_id integrity (P0, highest-priority)

- `src/auth/canonical-client-id.ts` — build-time embedded
  baseline.  Exports `GOOGLE` + `GITHUB` constants with
  `status` ('verified' / 'placeholder' / 'unavailable'),
  `clientId`, `consentAppNameFingerprint` (SHA-256 hex of
  app-name-as-shown-in-consent), `allowDiscoveryOverride`
  (false in v1).  `assertReadyForOAuth()` hard-stops on
  placeholder; `resolveClientId()` honors env-override >
  baseline > placeholder precedence so self-hosters pass
  `QUIRE_OAUTH_CLIENT_ID_GOOGLE` at build time.
- `public/.well-known/quire-oauth.json` — CDN discovery doc
  served by Cloudflare Pages.  Hint-only in v1 (the runtime
  trusts the embedded baseline by default); hooks present
  for future discovery-driven rotation.  Placeholder values
  today; replaced when the maintainer registers the real
  OAuth app.
- `scripts/golden-diff-canonical-client-id.test.mjs` — pins
  SHA-256 hashes of BOTH the TS baseline AND the JSON
  discovery doc, plus structural assertions (exports
  present, JSON shape valid, status vocabulary limited,
  fingerprint 64 hex chars).  Same pattern as the callback-
  page golden-diff (OP-017).  CLI mode (`--update`) for
  intentional rotation.
- `design/save-restore-program/maintainer-ops.md` — full
  rotation runbook (when + how + don't-do-this list),
  self-hoster override paths (env var / query param /
  campaign manifest), incident-response cheat sheet ("Google
  revoked our app" / "suspected compromise" / "Cloudflare
  deploy compromised"), UAT-deferred limitations list.
- `auth-strategy.md §A10` rewritten: items 1-3 of the
  original spec are now CODE; SRI dropped (Vite chunk-split
  bundles + Cloudflare Pages deploy-key trust boundary
  duplicates the protection without closing the actual
  attack vector); maintainer-ops + branch-protection are
  documented in the new ops doc.

### M6a ship-gate: OP-021 — State nonce intent binding (P1, CSRF + wrong-campaign-write defense)

- `src/auth/oauth-state.ts` — pure helper module:
  - `mintState({payload, secret, now, random?, hmac?})` produces
    `{envelope, stateParam}` with HMAC over the intent-binding
    fields (nonce, intent, campaignId, fileRev, ts, flowId).
  - `verifyState({stateParam, ctx})` total verification:
    base64url + JSON shape + intent vocabulary + freshness
    (10-min window, 60s future-skew tolerance) + flowId match
    (OP-020) + campaignId match (DEC-012) + constant-time HMAC
    compare.  Returns `{ok, reason}` so the UX matrix can
    branch per reason.
  - `signingMessage()` — stable serializer used by both mint
    + verify.
  - `freshSessionSecret()` (32 bytes) + `freshFlowId()` (UUID
    8-4-4-4-12 hex shape) — Web Crypto primitives.
  - `webCryptoHmacSha256Hex` + `webCryptoRandom` — production
    HMAC + RNG; both pluggable for tests.
- `src/auth/oauth-state.test.ts` — 26 unit tests covering:
  round trip (push + connect-with-null-fileRev), tamper
  rejection (per-tab secret mismatch + per-field forge),
  freshness window (stale + future-skew + boundary), two-tab
  race (flowId mismatch), two-flow race (campaignId
  mismatch), malformed input (non-base64 / non-JSON /
  missing fields / unknown intent), signingMessage stability,
  fresh-secret entropy, fresh-flowId UUID shape.

### M6a ship-gate: OP-027 — Player-content first-push consent ledger (P1, firewall-ethos)

- `src/auth/cloud-push-consent.ts` — pure consent ledger:
  - `ConsentDestination` union: `google-drive-appdata`,
    `google-drive-file`, `github-private`, `github-public`.
    Per DEC-020, each destination is a separate custody
    transfer.
  - `hasAcknowledged(storage, campaignId, destination)` —
    fail-closed lookup (re-prompts on missing / corrupt
    JSON / unknown version / mismatched campaignId or
    destination in the record / non-numeric acknowledgedAt).
  - `recordAcknowledgment(storage, campaignId, destination,
    now)` — idempotent write.
  - `withdrawAcknowledgment(storage, campaignId,
    destination)` — hooks into OP-029 "Disconnect → Erase".
  - `browserLocalStorageConsentStorage()` (production) +
    `inMemoryConsentStorage()` (tests).
  - `DEFAULT_CONSENT_COPY` — engineering-language
    placeholder copy spec; final wording replaced at M8 per
    `ux-strategy.md`.
- `src/auth/cloud-push-consent.test.ts` — 19 unit tests
  covering: storage key encoding, fresh-storage round trip,
  per-campaign + per-destination independence,
  idempotency, withdrawal, six fail-closed defenses,
  semantic-spec smoke check on DEFAULT_CONSENT_COPY.

### OP-030 re-verified on disk

`public/auth/google/callback.js:73-77` parses
`error_description` from the Google redirect but explicitly
does NOT forward it via postMessage (only the `error` enum is
forwarded).  Comment block names OP-030.  Golden-diff
fingerprints the file so future PR can't silently regress.
Opener-side `redactOAuthError` lands with M6a OAuth code.

## Up next

### IMMEDIATELY (run #8): M6a-FS host integration

Closes OP-036 + OP-037 + OP-038.  Three pieces:

1. **Pick the embed surface.**  Either (a) add a DM-only
   "Backups" card to the existing campaign render path in
   `quire-app.ts` (cheapest; ships M6a-FS user-visible) OR
   (b) stand up the operational view as a discrete surface
   (longer-term arch alignment).  Recommend (a) for run #8.
2. **Wire the `backups-push-request` event handler.**  Build
   a fresh save via `serializeSession` + `stringifySave`,
   call `pushCampaignToFolder`, hand back via
   `applyPushResult`.  Same for `backups-pull-request`.
3. **Wire the consent dialog component.**  The card calls
   `requestConsent(campaignId)` — host needs a Lit dialog
   that renders `DEFAULT_CONSENT_COPY_FS_API` (or whatever
   M8 TTRPG-craft replaces it with) and resolves the
   promise.

Optional follow-ons for run #8 if time:
- Session-digest chip surface (§A10-A) — embed `<backups-card>`-
  in-mini-form below the digest body.
- Cross-device probe (§FS.11) — on landing with empty local
  state + folder connected, call `listSavesInFolder` and
  surface `[Load it] [Start fresh]`.

### IMMEDIATELY-AFTER (run #9?): M6a-OAuth resumption

Picks up the run #6 OAuth orchestrator + Drive uploadAppdata
work.  Adds:
- `cloud-push.ts` (DM-facing orchestration analogous to
  `fs-api-cloud-push.ts` but on top of OAuth + Drive REST).
- Remaining Drive methods (`downloadAppdata`,
  `listAppdata`).
- `<backups-card>` extension to render a parallel "My
  Drive" line alongside "My folder" (multi-destination
  rendering).
- Maintainer-side: register the verified Google OAuth app
  + flip `GOOGLE.status` from `'placeholder'` to
  `'verified'` in `canonical-client-id.ts`.

### Original "next" plan (pre-run-#7): cloud-push.ts (DM-facing orchestration)

Wires the run-#6 orchestrator + Drive client + run-#5
consent ledger into:
- `pushCampaignToDrive({campaignId, saveDocument})`:
  consult consent ledger → `connectGoogle({intent:'push'})`
  → `uploadAppdata({...stringifySave(saveDocument)})` →
  return typed result.
- `pullCampaignFromDrive({campaignId})`: needs
  `downloadAppdata` (next Drive method).
- Per-flow listener wiring (OP-020): hook `window.open` +
  `addEventListener('message', filter-by-flowId, then
  removeEventListener)` per popup.  Production seam for the
  `OAuthPopup` interface.
- sessionStorage-backed `OAuthSessionStore` adapter (the
  in-memory one in `oauth-orchestrator.ts` is test-only).
- `redactOAuthError` helper + fuzz (OP-030 opener-side).
- 401-detection wrapper around drive-api calls
  (OP-022): bubble `unauthorized` to a "Re-connect Drive"
  chip surface.
- Cached id_token.sub for account-switch detection
  (OP-023 / NEW-SEC-4): compare on every re-auth.
- APP popup-failure detector + full-page fallback
  (OP-024 / OP-015): if popup closes within 2s OR posts
  `security_key_required`, fall back to full-page redirect.

### Then — Remaining Drive methods + §A11 probe

- `drive-api.downloadAppdata({accessToken, fileId})` for
  pull.
- `drive-api.listAppdata({accessToken, query})` for the
  §A11 cross-device probe.
- §A11 probe wiring at campaign-landing.

### Then — M6a UI surfaces (§A10)

- Session-digest chip ("Back up tonight's session to my
  Drive?").
- DM operational view "Backups" section.
- Error-matrix UI rendering (§A12).
- First-push consent dialog (wires `DEFAULT_CONSENT_COPY` +
  `hasAcknowledged` / `recordAcknowledgment`).
- Logout: revoke token (best-effort) + clear in-memory
  state.

### Maintainer prerequisite — register the real Google OAuth app

`GOOGLE.status` is still `'placeholder'` in
`canonical-client-id.ts`.  Until the maintainer registers
the verified OAuth app + flips the baseline,
`assertReadyForOAuth(GOOGLE)` refuses every flow, so the UI
surfaces will render in a "Cloud sync is not yet available
in this build" state.  See `maintainer-ops.md` for the
checklist.

### Then — M6c-B (personal backup, DEC-016 priority)

GitHub Device Flow + private-repo push of full
DM-coord projection.

### Then — M6c-A (publish-and-fork)

Same auth surface as M6c-B + publish-side scrub helper
(OP-033) + first-publish consent ceremony.

### Then — M6b (passphrase-encrypted refresh_token)

Per DEC-021: PBKDF2-SHA256 ≥600k + AES-GCM-256 +
12-char passphrase floor + honest microcopy.

### M5 follow-up (task #429)

Enrich resume prompt with scene title + PC names + session
digest headline. Deferred this run.

### M7 — Simulated playtest

### M8 — UAT readiness

Per DEC-026 + `ux-strategy.md` additions: UAT covers
APP-enrolled-account WebAuthn walkthrough + Cloudflare CDN
TTL empirical pinning + TTRPG-craft consent-dialog copy.

## Decisions pending the human (SHORT LIST)

None pending from this run.  No new product calls needed —
Piece 1 (UX matrix) was engineering-level (the locked
DEC-015 / DEC-026 / firewall-ethos + prime directive
constraints were sufficient framing).  Piece 2 (orchestrator
+ Drive method) was pure engineering against the run-#5
locked design.

Still pending (carry-over):
1. **M6a OAuth registration trigger.**  The canonical
   `client_id` baseline ships as `'placeholder'` —
   `assertReadyForOAuth()` refuses initiation.  Flipping
   to `'verified'` requires the maintainer to register the
   verified Google OAuth app in Cloud Console (see
   `maintainer-ops.md`).  This is a maintainer task, NOT a
   program lead task — DO NOT flip the status in code.
   Schedule before M6a UI lands so the runtime can
   actually serve cloud sync end-to-end.

## Health summary

- 🟢 Living docs bootstrapped.
- 🟢 Firewall leaks sealed (M1).
- 🟢 Self-completing scrubber registry (M1).
- 🟢 Save-path taint fuzz (M1).
- 🟢 Tab-close durability (M2).
- 🟢 "Any party member can continue" — REAL (M3).
- 🟢 Restore-drill CI gates byte-identical + soak + LWW (M4).
- 🟢 Recently-played landing list (M5-partial).
- 🟢 navigator.storage.persist() requested on first save (M5).
- 🟡 Resume-prompt enrichment — deferred (M5 follow-up #429).
- 🟡 Eviction soft-warn (DM-only) — TODO (M5).
- 🟡 M5 cross-tab privacy (OP-026) — patch alongside M6a.
- 🟢 Restore-side firewall (NEW-ADV-1) — SHIPPED `a7dedac`.
- 🟢 Rebroadcast firewall (NEW-ADV-2) — SHIPPED `a7dedac`.
- 🟢 Honest scope — cloud sync designed (M6 draft 3).
- 🟢 M6a CORS probe (OP-016) — RESOLVED (run #4).
- 🟢 M6a callback-page CSP + golden-diff (OP-017) — SHIPPED (run #4).
- 🟢 M6a canonical-id integrity (OP-017g) — SHIPPED (run #5).
- 🟢 M6a runtime-overridable client_id (OP-018) — SHIPPED (run #5).
- 🟢 M6a state-nonce intent binding logic (OP-021) — SHIPPED (run #5).
- 🟢 M6a player-content consent logic (OP-027) — SHIPPED (run #5).
- 🟢 OP-030 PII strip (callback-side) — RE-VERIFIED (run #5).
- 🟢 GitHub publish-and-fork verified mechanical (run #4).
- 🟢 M6c roadmap split (M6c-A + M6c-B) (run #4).
- 🟢 Threat model framing (DEC-023) load-bearing across program.
- 🟢 M6a UX placement / discovery / errors (OP-017b) — SHIPPED (run #6).
- 🟢 M6a-OAuth orchestrator (PKCE + state + intent) — SHIPPED (run #6).
- 🟢 M6a-OAuth Drive uploadAppdata (create + update + If-Match) — SHIPPED (run #6).
- 🟢 M6a-FS feature detection (`fs-api-availability.ts`) — SHIPPED (run #7).
- 🟢 M6a-FS handle store (`fs-api-handle-store.ts`) — SHIPPED (run #7).
- 🟢 M6a-FS cloud-push orchestrator (`fs-api-cloud-push.ts`) — SHIPPED (run #7).
- 🟢 M6a-FS consent ledger extension (`'fs-api'` destination) — SHIPPED (run #7).
- 🟢 M6a-FS UI region (`<backups-card>`) — SHIPPED (run #7).
- 🟡 M6a-FS host integration (OP-036/037/038) — NEXT (run #8).
- 🟡 M6a-OAuth cloud-push.ts (DM-facing orchestration) — AFTER M6a-FS host wiring.
- 🟡 M6a-OAuth per-flow UUID listener wiring (OP-020) — lands with cloud-push.ts.
- 🟡 M6a-OAuth mid-session 401 detection (OP-022) — lands with cloud-push.ts.
- 🟡 M6a-OAuth account-switch detection (OP-023) — lands with cloud-push.ts.
- 🟡 M6a-OAuth APP popup detection + fallback (OP-024) — lands with cloud-push.ts; UAT-deferred per DEC-026.
- 🟡 OP-030 opener-side redactor — lands with cloud-push.ts.
- 🟡 Drive downloadAppdata + listAppdata — lands with §A11 probe.
- 🟡 M6a-OAuth UI surfaces (§A10 chip + operational view + consent dialog + error matrix renderer) — extends `<backups-card>` with a parallel Drive line.
- 🟡 Maintainer task: register verified Google OAuth app + flip `GOOGLE.status` from `'placeholder'` to `'verified'` — required for M6a-OAuth only; M6a-FS goes live without it.

## Where to find things

- Charter + invariants → `README.md`
- Milestone plan → `roadmap.md`
- Decisions → `decisions.md`
- Known issues → `open-problems.md`
- Test plan → `test-strategy.md`
- UX plan → `ux-strategy.md`
- Cloud-sync auth → `auth-strategy.md` (+ `auth-strategy-review.md`)
- **Maintainer ops (run #5 NEW)** → `maintainer-ops.md`
- GitHub publish-and-fork analysis →
  `github-publish-fork-analysis.md` (Phase A run #4)
- Sub-agent transcripts → `simulations/`
- CORS probe → `scripts/cors-probe-google-token.mjs`
  (`npm run cors-probe`)
- OAuth callback page → `public/auth/google/callback.{html,js}`
  (CSP in `public/_headers`)
- Callback golden-diff → `scripts/golden-diff-callback.test.mjs`
- **Canonical client_id baseline (run #5 NEW)** →
  `src/auth/canonical-client-id.ts`
- **Discovery doc (run #5 NEW)** →
  `public/.well-known/quire-oauth.json`
- **Canonical client_id golden-diff (run #5 NEW)** →
  `scripts/golden-diff-canonical-client-id.test.mjs`
- **OAuth state helpers (run #5 NEW)** →
  `src/auth/oauth-state.ts`
- **Cloud-push consent ledger (run #5 NEW)** →
  `src/auth/cloud-push-consent.ts`
- **OAuth orchestrator (run #6)** →
  `src/auth/oauth-orchestrator.ts` (+ test file)
- **Drive REST client (run #6)** →
  `src/auth/drive-api.ts` (uploadAppdata; download + list
  to follow) (+ test file)
- **M6a-FS feature detection (run #7 NEW)** →
  `src/auth/fs-api-availability.ts` (+ test file)
- **M6a-FS handle store (run #7 NEW)** →
  `src/auth/fs-api-handle-store.ts` (+ test file)
- **M6a-FS cloud-push orchestrator (run #7 NEW)** →
  `src/auth/fs-api-cloud-push.ts` (+ test file)
- **M6a-FS Backups card UI region (run #7 NEW)** →
  `src/ui/regions/backups-card.ts` (+ test file)
- Fork verification → `src/persistence.publish-fork.test.ts`
