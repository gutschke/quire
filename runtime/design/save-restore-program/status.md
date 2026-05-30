# Save/Restore Program — Status

**Last updated:** 2026-05-29 end-of-session 2 (M4 + M5-partial + M6 design)
**Active milestone:** M6a — Drive `drive.appdata` PKCE + ephemeral access_token (after BLOCKING OP-016 CORS probe)
**Latest deploy hash:** 9e6009a (M6 auth-strategy draft 2)
**Branch:** main (origin up to date)

## Session log (most recent first)

- **2026-05-29 session 2 (this session):** M4 restore-drill ship +
  M5 recently-played list + navigator.storage.persist() request +
  M6 cloud-sync auth-strategy.md draft 1 + self-review (draft 2)
  + decisions/open-problems updated. Three pushes pending.
  +22 tests; all 2618 pass; typecheck clean; build clean.
- **2026-05-29 session 1:** M0 docs + M1 firewall + M2 tab-close +
  M3 re-broadcast. 12 new tests; all 2584 pass.

## Just shipped this session

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

1. **Drive scope default — `drive.appdata` (hidden) confirmed?**
   DEC-009 locked the choice; if you prefer `drive.file` default,
   say so before M6a starts.
2. **Layered ship pacing — M6a-only first, M6b later?** DEC-008
   locked it; pace is yours to override.
3. **Is the in-house self-review acceptable?** I acted as the
   security/UX consultant role because the harness has no spawn-
   sub-agent tool. If you want an independent pass, flag.
4. **CORS probe before code** — OP-016 BLOCKS M6a. Want me to ship
   the probe in the next turn?

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
- 🟢 Honest scope — cloud sync designed (M6 draft 2).
- 🔴 M6a CORS probe — BLOCKS implementation start.
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
