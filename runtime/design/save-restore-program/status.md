# Save/Restore Program — Status

**Last updated:** 2026-05-29 run #4 (DEC-016..023 + Phase A
GitHub-fork verification + M6a ship-gates OP-016 + OP-017 closed)
**Active milestone:** M6a — Drive `drive.appdata` PKCE + ephemeral access_token (2 of the 12 ship-gates remaining closed this run; 10 still open before code lands)
**Latest deploy hash:** (pending push this turn — see commit hash at end)
**Branch:** main

## Session log (most recent first)

- **2026-05-29 run #4 (this run):** Human delivered 7 product
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

## Just shipped this run (4)

### DEC-016..023 logged in `decisions.md` (8 new decisions)

- **DEC-016 — M6c re-ranked ahead of M6b** (account-loss
  durability dominates cross-session UX).
- **DEC-017 — Canonical client_id runtime-overridable +
  discovery doc** (confirms DEC-013 against build-time-only
  alternative).
- **DEC-018 — Worker token-exchange fallback blocks behind
  explicit DEC** (gated on CORS probe).
- **DEC-019 — M5 recently-played account-scoped by
  sha256(google_sub)** post-OAuth.
- **DEC-020 — Player-content first-push consent ceremony
  locked** (confirms DEC-011).
- **DEC-021 — M6b passphrase: PBKDF2-SHA256 ≥600k + 12-char
  floor + honest microcopy.**
- **DEC-022 — Layered M6 ship sequence M6a → M6c → M6b**
  (subsumes DEC-008).
- **DEC-023 — Threat model verbatim: zero attack surface from
  internet randos; malicious co-players out of scope** (the
  load-bearing prioritization rule).

### `open-problems.md` R4 re-triage

Every open OP tagged with `[R4: <class>, <verdict>]` per
DEC-023. Summary:
- 8 OPs stay P0/P1 under class 1 (internet randos).
- 8 OPs stay P1 under class 2 (accidental disclosure).
- 8 OPs stay P2 (doc / UI / limitation).
- 1 OP downgraded to P3 (OP-017h — only matters against
  malicious co-DM).
- 1 NEW OP added: OP-032 (M6b passphrase honest microcopy).

### Phase A — GitHub publish-and-fork verification

Verdict: **WORKS TODAY mechanically.** `src/persistence.publish-fork.test.ts`
ships 10 tests covering the 5 Phase A questions (Q1 clone+load,
Q2 partial event ranges, Q3 events that don't travel well,
Q4 publish-side scrub, Q5 repo layout).

Findings written to `design/save-restore-program/github-publish-fork-analysis.md`.
3 NEW OPs filed:
- **OP-033 (P1)** — M6c-A publish-side scrub helper +
  consent ceremony. Blocks M6c-A ship.
- **OP-034 (P2)** — M6c-A publish-time event-range
  truncation UX. Non-blocking; v1.1.
- **OP-035 (P2)** — M6c-A publish-side roster scrub.
  Non-blocking cosmetic.

### Phase B — Roadmap M6c split

`roadmap.md` M6c now splits into:
- **M6c-B (personal backup, ships FIRST under DEC-016).** Full
  DM-coord projection committed to private repo.
- **M6c-A (publish-and-fork, ships SECOND on same auth
  surface).** Sanitized non-coord projection committed to
  public repo; consumers fork via GitHub.

### M6a ship-gate: OAuth callback page (OP-017 BLOCKING → RESOLVED)

- `public/auth/google/callback.html` + `callback.js` —
  strict-CSP-friendly static page that postMessages
  `{source, code, state}` to the opener with explicit
  `targetOrigin = window.location.origin`. Validates
  `window.opener` before sending. Filters error responses to
  drop `error_description` (closes OP-030 PII leak risk).
- `public/_headers` — path-scoped CSP for
  `/auth/google/callback*` with
  `default-src 'none'; script-src 'self'; connect-src 'none'`.
- `scripts/golden-diff-callback.test.mjs` — 12 assertions
  enforcing SHA-256 golden hashes, no inline scripts, no
  remote refs, opener validation, explicit targetOrigin, CSP
  precedence in `_headers`.
- `src/test/integration/csp.test.ts` updated to parse the
  wildcard `/*` block specifically (callback CSP doesn't
  shadow it).

### M6a ship-gate: CORS probe (OP-016 BLOCKING → RESOLVED)

- `scripts/cors-probe-google-token.mjs` (run with
  `npm run cors-probe [-- --origin <origin>]`) verified live
  against `oauth2.googleapis.com/token`:
  - Preflight OPTIONS returns
    `Access-Control-Allow-Origin: <origin>` for
    `https://quire.pages.dev` AND `http://localhost:5173`.
  - POST with bogus payload returns
    `{error, error_description}` + 401 +
    `Access-Control-Allow-Origin: <origin>`.
- **Verdict: CORS OPEN.** M6a ships browser-side token
  exchange. **DEC-018 Worker fallback is NOT triggered;
  OP-019 closes by happy path.**

## Up next

### IMMEDIATELY: 10 remaining M6a ship-gates

Closed this run: OP-017, OP-016, OP-019. Remaining gates per
`auth-strategy.md` §"Ship layering":

- OP-017b (UX placement / discovery / error matrix).
- OP-017g (canonical client_id SRI + verified-app fingerprint).
- OP-018 (runtime-overridable client_id + discovery doc).
- OP-020 (two-tab OAuth race: per-flow UUID).
- OP-021 (state-nonce intent binding).
- OP-022 (mid-session 401 detection).
- OP-023 (account-switch detection via id_token sub).
- OP-024 (APP + WebAuthn-in-popup detection + fallback).
- OP-027 (player-content first-push consent ceremony).
- OP-030 (OAuth error PII redaction helper).

OP-026 (M5 recently-played account-scoping) is a follow-up
to M5 alongside M6a, not strictly a gate.

### Then — M6a OAuth code

PKCE flow, state-with-intent (DEC-012), per-flow UUID
(NEW-SEC-1), id_token sub binding (NEW-SEC-4), Drive REST
push/pull. Per `auth-strategy.md` draft 3.

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

## Decisions pending the human (SHORT LIST)

No new pending product calls from this run — the 7 from prior
run are now logged as DEC-016..022 and the threat-model
framing as DEC-023.

Worth surfacing for next run:
1. **OP-017g — Canonical client_id integrity (SRI + verified-
   app fingerprint).** P0 BLOCKING under DEC-023 class 1.
   Engineering work (build-time manifest, runtime
   verification) needs ops coordination on Cloudflare Pages
   deploy keys. Should the maintainer ops doc live in
   `design/save-restore-program/` or in a separate
   `ops/maintainer.md`?
2. **OP-018 — Discovery doc location.** `/.well-known/quire-oauth.json`
   spec'd per DEC-017 but the hosting story is uncovered:
   served by Cloudflare Pages, by a separate Worker, or by
   the same static host? Affects the canonical-client-id
   rotation timeline (CDN cache TTL).
3. **OP-024 — APP + WebAuthn-in-popup detection.**
   Implementation needs a real APP-enrolled account to verify
   the detector. Open question: does the user have an
   APP-enabled Google account we can test against, or do we
   need to file a "real-world APP test deferred to UAT"
   limitation?

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
- 🟢 M6a CORS probe (OP-016) — RESOLVED OPEN (run #4).
- 🟢 M6a callback-page CSP + golden-diff (OP-017) — SHIPPED (run #4).
- 🟢 GitHub publish-and-fork verified mechanical (run #4).
- 🟢 M6c roadmap split (M6c-A + M6c-B) (run #4).
- 🟢 Threat model framing (DEC-023) load-bearing across program.
- 🔴 M6a UX placement / discovery / errors (OP-017b) — BLOCKS.
- 🔴 M6a canonical-id integrity (OP-017g) — BLOCKS.
- 🔴 M6a runtime-overridable client_id (OP-018) — BLOCKS.
- 🔴 M6a two-tab race (OP-020) — BLOCKS.
- 🔴 M6a state-nonce intent binding (OP-021) — BLOCKS.
- 🔴 M6a mid-session 401 detection (OP-022) — BLOCKS.
- 🔴 M6a account-switch detection (OP-023) — BLOCKS.
- 🔴 M6a APP + WebAuthn popup detection (OP-024) — BLOCKS.
- 🔴 M6a player-content consent (OP-027) — BLOCKS.
- 🔴 M6a OAuth error PII redaction (OP-030) — BLOCKS.
- 🔴 M6a Drive auth flow — code pending.

## Where to find things

- Charter + invariants → `README.md`
- Milestone plan → `roadmap.md`
- Decisions → `decisions.md`
- Known issues → `open-problems.md`
- Test plan → `test-strategy.md`
- UX plan → `ux-strategy.md`
- Cloud-sync auth → `auth-strategy.md` (+ `auth-strategy-review.md`)
- GitHub publish-and-fork analysis →
  `github-publish-fork-analysis.md` (Phase A run #4)
- Sub-agent transcripts → `simulations/`
- CORS probe → `scripts/cors-probe-google-token.mjs`
  (`npm run cors-probe`)
- OAuth callback page → `public/auth/google/callback.{html,js}`
  (CSP in `public/_headers`)
- Callback golden-diff → `scripts/golden-diff-callback.test.mjs`
- Fork verification → `src/persistence.publish-fork.test.ts`
