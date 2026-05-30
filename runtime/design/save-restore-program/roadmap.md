# Save/Restore Roadmap

Sequencing principle: **firewall leaks first** (real data exposed today), then
**correctness** (the "any party member can continue" promise is currently false),
then **durability** (data loss windows), then **discoverability + honest scope**.

## M0 — Living docs bootstrapped (DONE 2026-05-29)

Roadmap published, charter written, expert findings catalogued in this doc set.

## M1 — Firewall: seal known leaks + self-completing tripwire (DONE 2026-05-29)

**Adversarial findings 1 + 2 + 3 + 4 from the 2026-05-29 review.** Real data
leaks today through the save path. Highest-impact-per-LOC fix on the board.

DoD:
- `map-blob-add` payload labels for unrevealed blobs do NOT reach a non-coord save.
- `causedByResponseId` is scrubbed from `pc-create` and `pc-edit` for non-coord saves (latent leak today; closes ahead of future logging extensions).
- `PER_KIND_SCRUBBERS` becomes self-completing: any new event kind that carries DM-only sub-fields trips a CI lint if not registered (analogous to the existing kind-level lint in `persistence.coverage.test.ts`).
- Save-path taint fuzz (#420) lands — companion to `state.firewall-fuzz` for the SAVE STREAM.
- Tests prove the leak is fixed AND prove regression class can't silently recur.

## M2 — Tab-close durability (DONE 2026-05-29)

**Architect finding 5 + Test-QA finding 2.** The 1.5s autosave debounce window
is structurally lost on tab-close. `hostDisconnected()` actively cancels.

DoD:
- Flush-on-unload via `visibilitychange === 'hidden'` (the recommended modern
  signal, per WHATWG; `beforeunload` is unreliable on mobile).
- Decision: does `hostDisconnected()` still cancel? Probable YES (legitimate
  unmount during route change shouldn't write), but the flush path is separate
  from the host-disconnect path. Document in `decisions.md`.
- Test: a synthesized `visibilitychange → hidden` after an unflushed change
  writes localStorage before returning.

## M3 — Restore re-broadcast (DONE 2026-05-29)

**Architect finding 1.** `Peer.applyEvent` does not share re-applied events.
"Any party member can continue" is currently false; restored events stay local.

DoD:
- A player who restores their autosave and joins a fresh session has their
  unique events propagate to the rest of the table within one sync round.
- Unit test pinning `applyEvent` → broadcast behavior.
- 3-peer e2e: peer A restores save with N unique events; peers B and C
  see all N within bounded time.
- Care: don't re-broadcast events that came in via sync-response, that would
  break the existing hub-forwarding chain. Probable shape: `applyEvent(event, { propagate: true })`.

## M4 — Restore-drill CI (DONE 2026-05-29)

**Test-QA finding 5 + the in-progress backlog #425.** Critical-path
assertions live only in e2e, which CI skips by design.

Shipped: `src/persistence.restore-drill.test.ts` — 12 tests covering:
- ✅ Byte-identical roundtrip (modulo `savedAt`).
- ✅ 0 `unknownKinds` + 0 rejected on round-trip.
- ✅ 3-peer 100-event soak convergence.
- ✅ Cross-week save → load → continue (DM resumes session 2 with
  full session-1 chat; player2 sees it via gossip).
- ✅ Sick-DM handoff (different peerId hosts session 2).
- ✅ Branch-divergence merge — both A-then-B and B-then-A.
- ✅ LWW determinism under concurrent coord-claim (OP-004 closed).
- ✅ `npm run drill` script for local fast iteration.

Runs on every `npm test`, not nightly — the in-memory transport makes
the drill ~140ms wall-clock for all 12 tests.

## M5 — Discoverability

**TTRPG-UX findings 1 + 2 + 3.** Silent eviction is the highest-impact UX
failure; resume prompt anonymous; no cold-restore experience.

DoD:
- `navigator.storage.persist()` request on first session-write of a campaign.
- Resume prompt shows scene title + PC list + last-session digest headline.
- "Recently played" list on the no-campaign landing — last 5 campaigns with
  evidence in localStorage, in-fiction-supportive copy.
- (Silent-player firewall: if a player's autosave was evicted, NO warning;
  they just see a fresh-start UI. The DM gets a soft-warn at session-open if
  their own autosave is missing.)

## M6 — Cloud sync auth design (HUMAN MADE THE CALL: build it)

**Human decision 2026-05-29:** build cloud sync — DM-initiated, OAuth-
based, no credentials in the browser, must work under Google Advanced
Protection. Specs live in `auth-strategy.md` (drafts 1+2). Self-
reviewed in `auth-strategy-review.md` (no spawn-sub-agent tool in
this harness — program lead acted as consultant role).

Layered ship per DEC-008:

### M6a — Drive `drive.appdata` PKCE + ephemeral (FIRST)

- BLOCKED ON (gate expanded by independent consultant pass — see
  draft-3 `auth-strategy.md` "M6a ship gates"):
  - OP-016 (CORS probe).
  - OP-017 (callback-page CSP + golden-diff CI).
  - OP-017b (UX placement / discovery / error matrix).
  - OP-017g (canonical client_id SRI + verified-app fingerprint).
  - OP-018 (runtime-overridable client_id incident response).
  - OP-019 (CONDITIONAL on OP-016: Worker fallback decision).
  - OP-020 (two-tab OAuth race: per-flow UUID).
  - OP-021 (state-nonce intent binding).
  - OP-022 (mid-session 401 detection).
  - OP-023 (account-switch detection via id_token `sub`).
  - OP-024 (APP + WebAuthn-in-popup detection + fallback).
  - OP-027 (player-content first-push consent ceremony).
  - NOT a gate (already shipped `a7dedac`): NEW-ADV-1 / NEW-ADV-2.
- DoD:
  - PKCE S256 flow with `crypto.getRandomValues` for state +
    code_verifier.
  - State binds intent (DEC-012): `{nonce, intent, campaignId,
    fileRev, ts, flowId}` + HMAC.
  - Per-flow UUID listener pattern (OP-020).
  - Popup launches to `accounts.google.com/o/oauth2/v2/auth` with
    scope=`drive.appdata`, redirect_uri=our origin.
  - Popup-failure detection + full-page-redirect fallback
    (OP-015 / OP-024).
  - Callback page: strict CSP + golden-diff CI + postMessage
    `{code, state, flowId}` only (OP-017).
  - Opener exchanges code+verifier for access_token (in-memory only).
  - 401/account-switch handlers wired (OP-022/023).
  - Push: serialize SaveDocument → Drive appdata file (per-campaign
    file name); track Drive file_id in campaign manifest in
    localStorage.
  - Pull: fetch appdata file → parse → projectSaveForViewer →
    applyLoadedEvents (DEC-010, already shipped).
  - First-push consent dialog (DEC-011 / OP-027).
  - Logout: revoke token (best-effort) + clear in-memory state.
  - Tests: unit + integration; popup mocked.

### M6b — Passphrase-encrypted refresh_token (FOLLOW-UP)

- DoD:
  - Request offline_access (refresh_token) during OAuth.
  - WebCrypto-derive AES-GCM-256 key from passphrase + per-origin
    salt; encrypt refresh_token; persist to IndexedDB.
  - On session-open: prompt for passphrase; decrypt; refresh
    access_token; proceed.
  - APP users: detect refresh-token-revocation; degrade to M6a
    re-auth.
  - Tests: WebCrypto roundtrip, wrong-passphrase rejection,
    revocation-degrade.

### M6c — GitHub Device Flow (LATER)

- DoD:
  - Device Flow: show user code + verification URL; poll
    /login/oauth/access_token.
  - Same SaveDocument format committed to configured repo path
    (`saves/<campaign-slug>.json`).
  - Public-repo only in v1; private-repo deferred to v1.1 (GitHub
    App registration).

## M7 — Simulated playtest

**Coverage-gap insurance.** Spawn focus-group sim + gameplay sim agents to
walk the four target scenarios. Capture surprises.

Scenarios:
- DM returns after 3 months — finds campaign, loads it, opens last scene.
- Player joins 2-month-old campaign mid-arc — substituted save loads cleanly.
- DM laptop dies mid-session — co-DM picks up; data loss window is the autosave debounce.
- Browser evicts storage — DM has no autosave; recovery path is "ask the table" or "load the manual save you took at session-end".

DoD: each scenario has a transcript in `simulations/` and any bug it reveals
files a follow-up task.

## M8 — UAT readiness

**Human-runnable acceptance.** No more "trust me, it works." Real DMs can
follow a checklist.

DoD:
- `docs/save-restore-uat.md` — checklist with screenshots.
- Recovery-rehearsal guide ("once a month, test that your save still loads
  in a fresh tab — here's why and how").
- TTRPG-expert agent signs off on the in-fiction copy.

## Re-scoping authority

The program lead may merge / split / re-order any of these. Update this file
in the same commit that re-scopes; don't quietly drift.
