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

Layered ship per DEC-008 + DEC-016/DEC-022 (re-rank M6c ahead of M6b
for account-loss durability) + DEC-028 (M6a-FS ships AHEAD of
M6a-OAuth):

**Updated order: M6a-FS → M6a-OAuth → M6c (B then A) → M6b.**

### M6a-FS — File System Access API path (NEW, FIRST per DEC-028)

Zero-infrastructure cloud sync: the DM picks an OS-level
folder; Quire writes the save file there; the user's existing
desktop sync client (Drive Desktop / Dropbox / OneDrive /
iCloud Drive) uploads it.  NO Quire-side OAuth, NO client_id,
NO Cloudflare proxy, NO maintainer-app registration.

Sibling to M6a-OAuth (which stays valuable for mobile, Safari,
Firefox, and DMs without a desktop sync client).  See DEC-028
for the rationale on shipping FS first.

Engine layer SHIPPED 2026-05-29 run #7:
- ✅ `src/auth/fs-api-availability.ts` (16 tests).
- ✅ `src/auth/fs-api-handle-store.ts` (19 tests).
- ✅ `src/auth/fs-api-cloud-push.ts` (37 tests).
- ✅ `cloud-push-consent.ts` extended with `'fs-api'`
  destination + `DEFAULT_CONSENT_COPY_FS_API` (8 new tests).

UI layer SHIPPED partially 2026-05-29 run #7:
- ✅ `src/ui/regions/backups-card.ts` (19 tests).

UI host integration SHIPPED 2026-05-29 run #8 (DEC-029):
- ✅ `appMode = 'dm-operational'` added.
- ✅ `<dm-operational-view>` Lit region (7 tests) hosts
  `<backups-card>`; player-side fallback "DM is checking the
  table's gear" preserves silent-player firewall.
- ✅ `<cloud-push-consent-dialog>` Lit region (11 tests)
  renders `ConsentDialogCopySpec` with Esc/backdrop/cancel
  resolving false.
- ✅ Host event handlers `handleBackupsPushRequest` +
  `handleBackupsPullRequest` in `quire-app.ts` close
  OP-036 + OP-038.
- ✅ "Operational view…" launcher chip on the DM Aside.
- ✅ Session-digest chip surface (§A10 placement A) —
  SHIPPED 2026-05-30 run #9 (OP-037 close).

Per `playable-release-plan.md` (run #8 NEW), M6a-FS work
is now broken into the following sub-milestones leading to
playable release:

- ✅ **M6a-FS-1 (run #8)** — DM operational view +
  consent dialog + host handlers + flagship mock campaign
  01.  SHIPPED.
- ✅ **M6a-FS-2 (run #9)** — session-digest chip
  (OP-037) + reconnect-on-permission-revoked button +
  fix OP-039 (sync-response firewall) + mock campaigns
  02 (magic discovery arc) + 03 (co-DM transitions).
  SHIPPED 2026-05-30 run #9.  Surfaced OP-040 (P2,
  pc-mark-realization stripped on sync-response) — does
  NOT block playable release; fix path TBD at M7+.
- ✅ **M6a-FS-3 (run #10)** — cross-device probe
  (§FS.11) + mock campaigns 04 (chargen spoiler
  authorship) + 05 (cloud push during active play).
  SHIPPED 2026-05-30 run #10.  Surfaced OP-041 + OP-042
  (both P2 — neither blocks playable release).
- ✅ **M6a-FS-4 (run #11)** — game-mechanic edges +
  mock campaign 06.  SHIPPED 2026-05-30 run #11.  Surfaced
  OP-043 (P1, pc-retire player-save round-trip fails to
  materialize retired seat) + OP-044 (P3, latent
  advancement-cap-not-clamped).  Neither blocks playable
  release per the DM-happy-path definition; OP-043 is queued
  as the FIRST item in M6a-FS-5.
- ✅ **M6a-FS-5 (run #12)** — OP-043 fix + network partition
  (mock campaign 07) + OP-041 + OP-044 + pre-release sweep.
  SHIPPED 2026-05-30 run #12.  M6a-FS playable-release status
  flipped to GREEN; the human can flip the maintainer switch
  and deploy to actual players.  P2 issues OP-040 + OP-042
  deferred post-release with documented workarounds.  +12 net
  new tests (2948 → 2960).
- 🟢 **M6a-FS-6 (contingency)** — not needed.  M6a-FS-5 closed
  cleanly; reserved slot can absorb post-deployment user-report
  findings if any.

Browser support: Chromium desktop only (Chrome, Edge, Opera,
Brave, Arc, …).  Safari / Firefox / mobile fall through to the
"OAuth Drive coming soon" placeholder per §FS.1 feature-detection
verdict.

### M6a-OAuth — Drive `drive.appdata` PKCE + ephemeral (SECOND)

Runs after M6a-FS, gated on the maintainer's verified Google
OAuth app registration (see `maintainer-ops.md`).

- BLOCKED ON (gate expanded by independent consultant pass — see
  draft-3 `auth-strategy.md` "M6a ship gates"):
  - ✅ OP-016 (CORS probe) — SHIPPED run #4.
  - ✅ OP-017 (callback-page CSP + golden-diff CI) — SHIPPED run #4.
  - 🔴 OP-017b (UX placement / discovery / error matrix).
  - ✅ OP-017g (canonical client_id integrity) — SHIPPED run #5.
  - ✅ OP-018 (runtime-overridable client_id + discovery doc)
    — SHIPPED run #5.
  - ✅ OP-019 (CONDITIONAL on OP-016: Worker fallback decision)
    — RESOLVED run #4 by OP-016 outcome (CORS open; no Worker).
  - 🟡 OP-020 (two-tab OAuth race: per-flow UUID) — covered
    incidentally by the OP-021 / DEC-012 envelope (`flowId`);
    full listener-lifecycle wiring lands with M6a code.
  - ✅ OP-021 (state-nonce intent binding) — LOGIC SHIPPED
    run #5; UI wiring lands with M6a code.
  - 🔴 OP-022 (mid-session 401 detection).
  - 🔴 OP-023 (account-switch detection via id_token `sub`).
  - 🟡 OP-024 (APP + WebAuthn-in-popup detection + fallback)
    — logic ships with M6a code per DEC-026; real-world
    verification parked-until-UAT (DEC-026, M8).
  - ✅ OP-027 (player-content first-push consent ceremony)
    — LOGIC SHIPPED run #5; UI hookup lands with M6a code.
  - ✅ OP-030 (OAuth error PII redaction) — callback-side
    SHIPPED run #4; opener-side redactor lands with M6a code.
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

### M6c — GitHub destinations (RE-RANKED ahead of M6b per DEC-016)

M6c is a two-arm milestone per the run-#4 human framing
(github-publish-fork-analysis.md, Phase A):

- **M6c-B (personal backup)** — DM pushes to their own private
  repo as durable belts-and-suspenders alongside Drive. Closes
  the account-loss-durability gap (NEW-ADV-3 / OP-017e).
- **M6c-A (publish-and-fork)** — DM pushes a sanitized seed to
  a public repo; others fork via GitHub's normal workflow and
  load into Quire. Verified mechanically possible via
  `src/persistence.publish-fork.test.ts` (10 tests).

Both arms share the same auth surface (Device Flow + PKCE
fallback per §A4 of `auth-strategy.md`) and the same
`SaveDocument` format. Differences are purely in destination
path + publish-side scrub.

#### M6c-B — Personal backup (FIRST under DEC-016 ordering)

- DoD:
  - Device Flow: show user code + verification URL; poll
    /login/oauth/access_token.
  - Same SaveDocument format (full DM-coord projection)
    committed to configured repo path (`saves/<campaign-slug>.json`).
  - Public-repo only in v1; private-repo deferred to v1.1 (GitHub
    App registration).
  - Re-uses Drive M6a's `serializeSessionForViewer` with
    DM-coord projection (the destination is the DM's own
    repo — they own everything in the file).
  - Same pull-rebase-push semantics as Drive (Git's index ref
    plays the role Drive's revision_id plays).

#### M6c-A — Publish-and-fork seed (SECOND, on same auth surface)

Phase A (`github-publish-fork-analysis.md`) verified that
mechanical fork-and-cherry-pick works today. M6c-A scope is:

- DoD:
  - `publishSeedFromSession()` helper in `persistence.ts` that
    calls `serializeSessionForViewer` with the NON-COORD
    projection (publish-side firewall = existing player-scope
    SSOT). NO new firewall list (OP-033).
  - Publish-side roster scrub: drop `peer-join` / `peer-leave`
    of historical peers from the published JSON (OP-035, P2
    cosmetic).
  - First-publish DM-only acknowledgment dialog (silent-player-
    firewall-preserved). Sibling to DEC-011 / DEC-020. Closes
    OP-033.
  - Publish path: `published-seeds/<slug>.json` by default
    (config-tunable). Git tag affordance for cherry-pick
    anchoring (e.g. `seed-end-of-ep02`).
  - Fork-side discovery: "Load a published seed" workflow (file
    picker or "Pull from URL").
  - Regression test: sentinel-fuzz that plants DM-only markers
    in every DM-only kind + sub-field, asserts no sentinel
    survives the publish projection.
  - Truncation-at-publish UX deferred to v1.1 (OP-034, P2 UX).
    v1 ships "publish the whole log only".
  - Documentation: README pattern for "publish your campaign
    for community fork" coordinated with Underleaf's existing
    content-on-GitHub pattern.

**Phase A finding summary:** No P0/P1 engine-side blockers.
The work is publish-side helpers + UX. See
`github-publish-fork-analysis.md` for the full verification
matrix.

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
