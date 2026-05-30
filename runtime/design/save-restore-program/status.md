# Save/Restore Program — Status

**Last updated:** 2026-05-29 run #5 (DEC-024..026 + four M6a
ship-gates closed in code: OP-017g + OP-018 + OP-021 + OP-027;
OP-030 re-verified on disk)
**Active milestone:** M6a — Drive `drive.appdata` PKCE + ephemeral access_token (4 new ship-gates closed this run; OP-017b remains as the last doc-only gate; rest land WITH the M6a OAuth code)
**Latest deploy hash:** (this run's commit; reported at push time)
**Branch:** main

## Session log (most recent first)

- **2026-05-29 run #5 (this run):** Highest-priority M6a gate
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

## Just shipped this run (5)

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

### IMMEDIATELY: Remaining gate before M6a OAuth code

- **🔴 OP-017b (UX placement / discovery / error matrix)** —
  doc + design work.  The last truly-blocking gate; the
  others (OP-020 / 022 / 023 / 024 / 030 opener-side) land
  WITH the M6a code per the run-#5 auth-strategy revision.

### Then — M6a OAuth code

Wire the shipped helpers (canonical-client-id,
oauth-state, cloud-push-consent) into:
- PKCE flow with `crypto.getRandomValues` for state +
  code_verifier.
- Per-flow UUID listener pattern (OP-020 wiring).
- Popup → callback → postMessage → opener →
  `verifyState` → token exchange.
- `redactOAuthError` helper + fuzz (OP-030 opener-side).
- 401/account-switch handlers (OP-022/023).
- APP popup-failure detector + full-page fallback
  (OP-024 / OP-015).
- Push: serialize SaveDocument → Drive appdata file;
  track Drive file_id in localStorage manifest.
- Pull: fetch → projectSaveForViewer → applyLoadedEvents.
- First-push consent dialog (wires DEFAULT_CONSENT_COPY
  + `hasAcknowledged` / `recordAcknowledgment`).
- Logout: revoke token (best-effort) + clear in-memory
  state.

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

None pending from this run.  Prior-run pending items
(OP-017g maintainer-doc location, OP-018 discovery hosting,
OP-024 APP test account) all answered + logged as
DEC-024/025/026.

Worth surfacing for next run:
1. **OP-017b — UX placement / discovery / error matrix.**
   The last "BEFORE M6a code" gate.  The work is a
   `ux-strategy.md` extension (§A10 + §A11 spec'd in
   `auth-strategy.md` draft 3; UX spec needs to absorb
   it).  Could be done in a single run; doesn't need
   product calls — just engineering + UX-routing.
2. **M6a OAuth registration trigger.**  The canonical
   `client_id` baseline ships as `'placeholder'` —
   `assertReadyForOAuth()` refuses initiation.  Flipping
   to `'verified'` requires the maintainer to register the
   verified Google OAuth app in Cloud Console.  Schedule
   that work before M6a code can ship the live cloud-sync
   surface.

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
- 🔴 M6a UX placement / discovery / errors (OP-017b) — BLOCKS.
- 🟡 M6a per-flow UUID listener wiring (OP-020) — lands with M6a code.
- 🟡 M6a mid-session 401 detection (OP-022) — lands with M6a code.
- 🟡 M6a account-switch detection (OP-023) — lands with M6a code.
- 🟡 M6a APP popup detection + fallback (OP-024) — lands with M6a code; UAT-deferred per DEC-026.
- 🟡 OP-030 opener-side redactor — lands with M6a code.
- 🔴 M6a Drive auth flow — code pending.

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
- Fork verification → `src/persistence.publish-fork.test.ts`
