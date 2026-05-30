# Save/Restore Program — Status

**Last updated:** 2026-05-29 end-of-session 3 (NEW-ADV-1/2 firewall fix + draft-3 auth strategy)
**Active milestone:** M6a — Drive `drive.appdata` PKCE + ephemeral access_token (BLOCKED on 12 open-problems + OP-016 CORS probe; see ship gates)
**Latest deploy hash:** 78a4600 (draft-3 docs); preceding code commit a7dedac (NEW-ADV-1/2 firewall fix + 11 new regression tests)
**Branch:** main (push pending)

## Session log (most recent first)

- **2026-05-29 session 3 (this session):** Independent consultant
  pass (4 reports x 9-10 findings each = 33 new findings) folded
  into the program. NEW-ADV-1/2 (the 5th render-gated-but-restore-
  not-gated firewall breach + the rebroadcast leak it amplifies)
  fixed in code: commit `a7dedac`. `projectSaveForViewer` +
  `defaultRebroadcastFilter` exported from persistence.ts; Peer
  takes a rebroadcastFilter injection; session-controller wires it.
  +11 regression tests in `persistence.restore-firewall-fuzz.test.ts`.
  Remaining 31 findings triaged into 14 new OP entries (OP-017
  through OP-031) + 6 new decisions (DEC-010 through DEC-015).
  auth-strategy.md revised to draft 3 with §B + §C + §A1.5 +
  §A7..§A15 new/revised sections + M6a ship-gate list.
  Tests: 2629 / 2 skipped (was 2618 / 2 skipped baseline; +11).
  Typecheck clean, build clean.
- **2026-05-29 session 2:** M4 restore-drill ship +
  M5 recently-played list + navigator.storage.persist() request +
  M6 cloud-sync auth-strategy.md draft 1 + self-review (draft 2)
  + decisions/open-problems updated. Three pushes pending.
  +22 tests; all 2618 pass; typecheck clean; build clean.
- **2026-05-29 session 1:** M0 docs + M1 firewall + M2 tab-close +
  M3 re-broadcast. 12 new tests; all 2584 pass.

## Just shipped this session (3)

### NEW-ADV-1/2 — Restore + rebroadcast firewall (SHIPPED, commit a7dedac)

The 5th breach in the render-gated-but-restore-not-gated firewall
class (same class as #392/#393/#395 + M1 map-blob) closed. The
cloud-pull / file-load path now scrubs events through the same
viewer-scope filter at restore time; the rebroadcast path filters
events before forwarding via the gossip channel. SSOT reused —
`PER_KIND_SCRUBBERS` + `PLAYER_SCOPE_STRIP_KINDS` cover save / load
/ rebroadcast uniformly.

- `persistence.ts:projectSaveForViewer` — restore-side viewer
  projection (companion to `serializeSessionForViewer`).
- `persistence.ts:defaultRebroadcastFilter` — rebroadcast classifier.
- `core/peer.ts` — `rebroadcastFilter` constructor option (default
  identity for low-level tests, production filter injected at
  session-controller).
- `quire-app.loadFromString` — projects the save based on the
  loading peer's mode (host = full save, guest = scrubbed).
- `src/persistence.restore-firewall-fuzz.test.ts` — 11 tests.
  Plants sentinels in every DM-only kind + sub-field; asserts no
  sentinel survives the restore projection OR the rebroadcast
  filter OR an end-to-end "alice loads + bob is connected" scenario.

See DEC-010 for the full rationale + map-blob conservative-mask
trade-off discussion.

### Triage + draft 3 (commit pending)

- `open-problems.md` — 14 new OPs (OP-017 through OP-031) from
  the 4 consultant reports. OP-013 marked subsumed.
- `decisions.md` — DEC-010 (NEW-ADV-1/2 closure), DEC-011 (player-
  content consent), DEC-012 (state-nonce intent binding),
  DEC-013 (runtime-overridable client_id), DEC-014 (per-DM
  appdata for co-DM ownership), DEC-015 (pull-on-discovery
  default).
- `auth-strategy.md` — draft 3: §B (restore firewall, shipped),
  §C (privacy posture), §A1 / §A1.5 / §A7 / §A9 / §A10 / §A11 /
  §A12 / §A13 / §A14 / §A15 new/revised. M6a ship-gate list
  enumerates the 12 OPs that must close before M6a code lands.

### M4 — Restore-drill CI (DONE, commit c3e2707)

- `src/persistence.restore-drill.test.ts` — 12 tests covering
  byte-identical roundtrip, 100-event soak convergence across 3 peers,
  cross-week save→load→continue, sick-DM handoff, branch-divergence
  merge (both orderings), LWW determinism under concurrent
  coordinator-claim (closes OP-004), schema sanity.
- `npm run drill` script for focused local iteration.
- Drill suite runs in ~140ms — kept in default `npm test`, not
  promoted to nightly (DEC-006 rationale).

### M5-partial — Recently-played + persist (DONE, commit 0ef07c3)

- `src/controllers/recently-played.ts` — scans `localStorage` for
  `quire.save.*` keys, returns sorted-most-recent-first.
  17 tests (FakeStorage; sort, limit, malformed-skip; time-ago
  granularity from moments to years).
- `renderRecentlyPlayed()` in quire-app.ts surfaces the list under
  "No campaign loaded" — silent-player-firewall preserving (stripped
  saves display identically to DM saves).
- `AutosaveController.requestPersistentStorage()` fires
  `navigator.storage.persist()` after the first successful save.
  Fire-and-forget, tolerant of missing API / throw / rejected
  promise. 5 tests.

### M6 design — Auth strategy + self-review (commits pending)

- `design/save-restore-program/auth-strategy.md` — draft 1 + draft 2
  with self-review applied.
- `design/save-restore-program/auth-strategy-review.md` — full
  issue log (SEC/PRV/ADV/UX/ARC tags + P0/P1/P2 severity + fix
  proposals). Transparency note: program lead acted as the
  consultant role since no spawn-sub-agent tool is available in
  this harness.
- DEC-008 (layered ship M6a → M6b → M6c).
- DEC-009 (`drive.appdata` default scope; closes ADV-1 leak path).
- OP-006 superseded by build-decision; OP-007/008/009/010/012
  resolved or superseded by draft-2 review; OP-013/014/015/016
  newly filed.

## Up next

### IMMEDIATELY: OP-016 CORS probe (BLOCKING M6a)

Before any M6a code lands, verify `oauth2.googleapis.com/token`
accepts CORS requests from our origin. Build a tiny dev-only test
script that hits the endpoint with deliberately bogus payload and
asserts JSON-error (CORS open) NOT CORS-block. If blocked, add a
Cloudflare Worker token-exchange proxy.

### M5 follow-up (task #429)

Enrich the resume prompt with scene title + PC names + session
digest headline. Deferred this session — needs design conversation
around engine-emits-signal vs campaign-authored-copy.

### M6a — Drive `drive.appdata` + PKCE + ephemeral

Implementation kick-off after OP-016 verified. Per
auth-strategy.md "What's locked": PKCE S256, `drive.appdata`,
ephemeral in-memory access_token, `crypto.getRandomValues` for
state + verifier, strict origin validation on postMessage.

### M6b — Passphrase-encrypted refresh_token

Follow-up; requires UX validation of "type your Quire passphrase
to unlock cloud sync" with a real DM. APP users degrade to M6a.

### M6c — GitHub Device Flow

Same save format, committed to a configured repo path. Public-repo
only in v1.

### M7 — Simulated playtest

### M8 — UAT readiness

## Decisions pending the human (SHORT LIST — see at-end-of-turn report)

NEW open questions surfaced by the independent consultant pass that
need a product call before M6a code lands:

1. **OP-017e — Account-loss durability.** `drive.appdata` is
   structurally irrecoverable on Google account death. Three
   mitigations (auto-download on push / promote `drive.file` /
   re-rank M6c). Re-ranking M6c ahead of M6b is the cleanest
   answer; needs your call.
2. **OP-018 — Canonical client_id incident response.** DEC-013
   locks runtime-overridable + discovery-doc as the spec. If you
   want a simpler "build-time only" v1 with a documented
   incident-response delay, say so.
3. **OP-019 — Cloudflare Worker fallback (CONDITIONAL).** If
   OP-016 CORS probe forces the fallback, the Worker becomes a
   man-in-the-middle that sees every auth code. The spec
   requires explicit DM disclosure + a no-log policy +
   reproducible build. Do you want to BLOCK any Worker code
   behind an explicit decision (current plan), or accept a
   "maintainer-trusted" default?
4. **OP-026 — M5 recently-played list account-scoping.** Patch
   the existing M5 (commit `0ef07c3`) to scope by
   `sha256(google_sub)` once OAuth runs. Pure-local DMs keep
   today's behavior. Just confirm this is the right shape.
5. **OP-027 — Player content consent ceremony.** DEC-011 locks
   the one-time DM-only acknowledgment dialog ("You are
   uploading the full table's content..."). If you'd rather
   skip the dialog and trust the civilized-peer model entirely,
   say so. Strong recommendation: KEEP the dialog — it's
   cheap, it honors Quire's firewall ethos, and a future DM
   asking "wait, players' words go to MY drive?" is a real
   surface we should be ahead of.
6. **NEW-SEC-7 M6b KDF cost.** PBKDF2-SHA256 ≥600k iter is the
   ship-now option; scrypt-via-WASM is the security-better
   option at a much higher engineering cost. If M6b is "later,"
   we can defer this — but a bad KDF would be worse than no
   encryption (false sense of security per the security
   consultant). Acceptable: M6b lands as PBKDF2-≥600k-iter +
   ≥12-char passphrase enforcement + explicit "delays a
   passer-by, not a determined attacker" microcopy?
7. **Carryover from prior session:**
   - CORS probe before M6a code (OP-016): want me to ship the
     probe in the next turn?
   - Layered ship pacing (DEC-008): still OK?
   - Drive scope default (DEC-009 `drive.appdata`): still OK?

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
- 🔴 M6a CORS probe (OP-016) — BLOCKS implementation start.
- 🔴 M6a callback-page CSP + golden-diff (OP-017) — BLOCKS.
- 🔴 M6a UX placement / discovery / errors (OP-017b) — BLOCKS.
- 🔴 M6a canonical-id integrity (OP-017g) — BLOCKS.
- 🔴 M6a state-nonce intent binding (OP-020/021) — BLOCKS.
- 🔴 M6a token-lifecycle handlers (OP-022/023/024) — BLOCKS.
- 🔴 M6a player-content consent (OP-027) — BLOCKS.
- 🔴 M6a Drive auth flow — code pending.

## Where to find things

- Charter + invariants → `README.md`
- Milestone plan → `roadmap.md`
- Decisions → `decisions.md`
- Known issues → `open-problems.md`
- Test plan → `test-strategy.md`
- UX plan → `ux-strategy.md`
- Cloud-sync auth → `auth-strategy.md` (+ `auth-strategy-review.md`)
- Sub-agent transcripts → `simulations/`
