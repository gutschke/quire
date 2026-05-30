# M6a-FS Playable Release Plan

**Owner:** save/restore program lead
**Created:** 2026-05-29 (run #8)
**Status:** in execution
**Supersedes (in part):** the open-ended "M6a host integration" framing
in `status.md` run #7

This plan defines what "playable release" means for the
File-System-Access-API cloud backup feature and lays out the path to
get there. It exists because the human escalated M6a-FS from "ship the
host integration when convenient" to "get this code ready for a
playable release" (verbatim, run #8 mandate).

## Definition of "playable release"

A returning DM running Chrome / Edge / Brave / Arc / Opera on desktop
can do this loop end-to-end without engineering help:

1. Open a campaign URL.  Play a session normally.
2. At session-close (or any time via the DM operational view), pick
   "Connect a folder" → pick a folder inside their Drive Desktop /
   Dropbox / OneDrive / iCloud Drive tree → ack the consent dialog.
3. Click "Push now."  Wait ~1s.  See "Pushed N bytes to
   `<campaign-slug>.quire-save.json`."
4. Close the browser.
5. Next week, open the campaign URL on the same machine.  Click
   "Pull."  Continue playing where they left off.
6. Optional: open on a SECOND machine where the sync tool has the
   folder mirrored.  Connect the same folder.  Pull.  Continue.

That's the spine.  Around it:

### Required user-visible surfaces

- **Operational view (DEC-029).**  Discrete DM-only surface, modal-
  overlay on top of play.  Reachable from a launcher chip on the DM
  Aside.  Hosts the `<backups-card>` element today; will host more
  engineering-reality surfaces later.
- **Session-digest chip (OP-037).**  Just-in-time discovery surface
  per §A10-A.  At session-close, the DM sees a single chip:
  "Back up tonight's session?" → opens the operational view.
  Required for discovery; the operational view alone is too hidden.
- **Cross-device probe (§A11 / §FS.11).**  On cold-load with empty
  localStorage AND a connected folder, surface `[Load it] [Start
  fresh]` — never auto-load.

### Required error UX coverage

Every row in `ux-strategy.md §A12` has working UI:

| Error | Engine signal | UI surface |
|---|---|---|
| `feature-unavailable` | `getAvailabilityVerdict().available === false` | unavailable card with reason-specific copy ✓ run #7 |
| `cancelled` (picker dismissed) | `connectFolder` → `reason: 'cancelled'` | "No folder picked" chip ✓ run #7 |
| `permission-denied` | `requestWritePermission` → false | "Your browser blocked write access" ✓ run #7 |
| `permission-revoked` (mid-session) | `pushCampaignToFolder` → `reason: 'permission-revoked'` | "Click Reconnect" chip + [Reconnect] button ✓ run #9 |
| `conflict` (external write) | `pushCampaignToFolder` → `reason: 'conflict'` | "Pull first, then push" chip ✓ run #7 |
| `write-failure` | `pushCampaignToFolder` → `reason: 'write-failure'` | "Couldn't write to folder" chip ✓ run #7 |
| `not-connected` | `pushCampaignToFolder` → `reason: 'not-connected'` | "Connect a folder first" chip ✓ run #7 |

Open gap from the run #7 review: the "permission-revoked" chip
needs an actual `[Reconnect]` button that calls
`requestPermissionForCampaign`.  Shipped in run #9.

### Bug bar

- **NO P0 / firewall-leaking bugs.**  Restore-firewall fuzz still
  passes.  Save-side fuzz still passes.  M4 restore-drill still
  passes.  Mock-campaign cross-firewall assertions pass.
- **NO P1 / data-loss bugs in the documented happy path.**  Push
  succeeds; pull restores byte-identical; close-and-reopen continues.
- **P2 / UX warts may ship with a documented work-around** — but
  must be filed in `open-problems.md` with a target-fix-by milestone.
- **Honest copy.**  Each error message is a single primary action
  per §A12 principle 2; no engineering jargon leaks into player-
  visible surfaces (n/a since this surface is DM-only, but the
  principle protects future composition).

### Documentation requirements

- `status.md` reflects ship state at the end of every run.
- `maintainer-ops.md §8.5` (run #7 ship) accurately describes how to
  flip M6a-FS live and what gets reported by users — already done.
- `playable-release-plan.md` (this doc) tracks what's left.
- `simulations/mock-campaign-NN-<theme>.md` — one per mock campaign
  with findings logged into `open-problems.md`.
- README-level user-facing copy is NOT a release blocker — the
  feature ships as "Cloud backup (Chromium desktop preview)."
  Final copy is M8 / TTRPG-craft.

## What's IN scope for playable release

- M6a-FS engine (run #7 ship) + host wiring (run #8+).
- DM operational view as a discrete surface (DEC-029).
- Session-digest chip (OP-037).
- Cross-device probe on cold-load (§FS.11).
- Consent dialog wiring (DEFAULT_CONSENT_COPY_FS_API).
- Reconnect-on-permission-revoked button.
- Mock-campaign simulations + their findings either fixed or
  filed-with-target.

## What's OUT of scope for playable release

- M6a-OAuth (Drive REST) — separately gated on maintainer's
  verified Google OAuth app registration.  Lands AFTER M6a-FS
  reaches playable.
- M6c-A / M6c-B (GitHub publish-and-fork / personal backup) —
  separate milestone.
- M6b (passphrase-encrypted refresh_token) — separate milestone.
- Final TTRPG-craft copy (M8).
- Mobile / Safari / Firefox path (covered by M6a-OAuth, not
  M6a-FS).

## Milestone breakdown (per run granularity)

Run-by-run plan.  Each milestone is one engineering run; can stretch
to two if scope grows.

### M6a-FS-1 (run #8 — this run)

**Scaffold the DM operational view + wire backups-card.**

- DEC-029 logged ✓.
- Playable-release-plan.md written ✓.
- New `appMode = 'dm-operational'`.
- Launcher chip on DM Aside.
- `renderBody` branch for `'dm-operational'`.
- Render `<backups-card>` inside it.
- Wire `backups-push-request` and `backups-pull-request` host
  handlers (OP-036 close).
- Wire `requestConsent` callback — Lit dialog component reading
  `DEFAULT_CONSENT_COPY_FS_API`.
- Mock campaign 01 (the flagship cross-session save/restore loop).
- Tests: unit on the new dialog + integration on the host event
  handlers + a happy-path integration on the operational view
  itself (gate, render, embed presence).
- End-of-run docs + push.

### M6a-FS-2 (run #9) [SHIPPED]

**Session-digest chip + Reconnect button + simulations 02-03 +
OP-039 fix.**

All shipped:
- OP-039 fix: `defaultSyncResponseFilter` wired through
  `Peer.syncResponseFilter`.  Drops PLAYER_SCOPE_STRIP_KINDS
  events on sync-response without running per-field scrubbers
  (narrower than rebroadcastFilter by design — sync-response is
  the joining peer's only catch-up channel for partial-DM
  fields).  3 regression tests.
- OP-037 close: session-digest backup chip.  Renders for DM only,
  suppressed mid-edit, dispatches `session-digest-open-operational-
  view` to open the operational view.  5 unit tests.
- Reconnect-on-permission-revoked button.  `<backups-card>`
  hoists `permission-revoked` into its own chip state with a
  `[Reconnect]` button that calls `requestPermissionForCampaign`.
  4 unit tests including denied-permission state preservation.
- Mock campaign 02: magic-discovery-arc through save/restore.  2
  tests pass.  Surfaced FINDING-A → OP-040 (load-bearing P2
  classification tension — see below).
- Mock campaign 03: co-DM transitions.  3 tests pass.  No new
  findings.

Tests: 2913 + 2 skipped = 2915 (up from 2898 baseline; +17 new).

### Known issues (M6a-FS-2 finds)

- **OP-040 (P2):** OP-039 firewall strips `pc-mark-realization` on
  sync-response, blocking a player who joins fresh post-realization
  from seeing their own cast capability.  Live-play workflow
  unaffected (the realization is normally witnessed at the table).
  DM workflow workaround: re-mark realization for late-joiner
  (idempotent on the visible state).  Architectural review
  may pick the OP-040 "reclassify out of PLAYER_SCOPE_STRIP_KINDS"
  fix during M7+ if friction-y.  Does NOT block playable release.

### M6a-FS-3 (run #10) [SHIPPED]

**Cross-device probe + simulations 04-05.**

All shipped:
- §FS.11 probe wired:
  - `src/controllers/cross-device-probe.ts` (10 unit tests) —
    once-per-landing guard + gating on feature-available + folder-
    connected + no-local-autosave.  NEVER auto-loads per DEC-015.
  - Host wiring in `quire-app.ts`: `getCrossDeviceProbe()` lazy
    field + `maybeRunCrossDeviceProbe()` fires on
    `checkResumePrompt`; `crossDeviceProbeMatch` @state stages
    a match; reset on campaign URL change.
  - Render: `renderCrossDeviceProbePrompt()` renders inline next
    to the resume prompt.  "Load it" (default-focused per
    DEC-015) calls `crossDeviceProbeLoad()` which pulls + applies
    via the existing `loadFromString` projection path.  "Start
    fresh" calls `dismissCrossDeviceProbe()` — no folder mutation.
  - 7 quire-app integration tests covering: match-staging, local-
    autosave defers, no-folder no-match, no-matching-file, dismiss,
    Load-it round trip, per-landing guard.

- Mock campaign 04 (chargen spoiler authorship) SHIPPED at
  `src/persistence.simulation-04-chargen-spoiler.test.ts`.  2 tests,
  both pass.  Doc at `design/save-restore-program/simulations/
  mock-campaign-04-chargen-spoiler-authorship.md`.  Findings A-C
  sanity-confirmed (silent-player firewall holds across the
  save/restore boundary for chargen drafts); FINDING-D documented
  as a sub-P3 player-side recovery edge (player wipes device
  between deliver and DM-accept).  No new OPs filed.

- Mock campaign 05 (cloud push during active play) SHIPPED at
  `src/persistence.simulation-05-cloud-push-during-active-play.test.ts`.
  6 tests, all pass.  Doc at `design/save-restore-program/
  simulations/mock-campaign-05-cloud-push-during-active-play.md`.
  Findings A-D + G sanity-confirmed (snapshot semantics hold;
  autosave + push independent; conflict detection works; offline
  recovery works; visibilitychange flush doesn't conflict).
  Surfaced FINDING-E → OP-041 (first-push silently overwrites
  orphan file) and FINDING-F → OP-042 (consent dialog can
  interleave with concurrent host actions).  Both P2 — do NOT
  block playable release.

Tests: 2938 + 2 skipped = 2940 (up from 2915; +25 new this run).
Typecheck clean.  Build clean (645KB main chunk).
No credentials in diff.

### Known issues (M6a-FS-3 finds)

- **OP-041 (P2):** First-push silently overwrites an orphan
  `<slug>.quire-save.json` if the folder already contains one
  AND the cross-device probe didn't fire.  Cross-device probe
  closes the typical path; pre-release polish should add a
  `'first-push-orphan'` reason to the conflict-check.
- **OP-042 (P2):** Consent dialog can interleave with concurrent
  host actions during active play.  Defer; document the
  invariant in ux-strategy.md before any future auto-opening
  dialog work lands.

### M6a-FS-4 (run #11) [SHIPPED]

**Game-mechanic edges + simulation 06.**

All shipped:
- Mock campaign 06: harm-to-max, stress-to-max, advancement-cap,
  bond-draft cap, many-foci save/restore, pc-retire firewall,
  co-DM yield with half-completed scene reveal.  8 tests, all
  pass.  Doc at `simulations/mock-campaign-06-game-mechanic-
  edges.md`.

Tests: 2946 + 2 skipped = 2948 (up from 2940 baseline, +8 new
this run).  Typecheck clean.  Build clean.  No credentials.

**Findings (NEW, filed):**

- **OP-043 (P1)** — pc-retire player-save round-trip fails to
  materialize retired seat.  The DM-coord save path is fine; the
  player-side load path (localStorage autosave restore, cross-
  device probe load as non-coord) shows the retired PC as
  `bound-active` after restore.  Same SHAPE as OP-040 (firewall
  strips a sub-field the materializer requires).  Real player-
  side hit — a tab closed+reopened during/after a retire session
  shows wrong state.

- **OP-044 (P3)** — Engine permits `advancements` value above
  ADVANCEMENT_CAP (8).  Render gate self-protects (the carryover
  card uses `>= 8` to flip to cap-reached chip).  Latent.  Three-
  line clamp fix; defensive only.

### Known issues (M6a-FS-4 finds)

- **OP-043 (P1):** see above.  M6a-FS-5 priority (first item to
  ship).  Does NOT block release per the definition (DM happy
  path works), BUT the player-side hit is real and visible —
  schedule for FIX before flipping the "playable released" flag.

- **OP-044 (P3):** post-release polish (low priority).

### M6a-FS-5 (run #12)

**Pre-release sweep + OP-043 fix + simulation 07 + cleanup.**

Three pieces, in priority order:

1. **Fix OP-043** (FIRST, P1).  Tolerate `p.reason === undefined`
   in `applyPcRetireOrArchiveEvent` — materialize the seat into
   `bound-retired` with `retireReason` absent.  Mirror for
   `pc-archive` (same materializer).  Regression test in
   `state.test.ts` covering both paths.  Mock-campaign-06 test
   updated to expect the fixed behavior.

2. **Mock campaign 07 (network partition).**  Peer goes offline
   mid-session, comes back with diverged log.  Merge is
   deterministic + firewall-correct.

3. **Pre-release OP sweep + ship/defer call for OP-040 / OP-041 /
   OP-042 / OP-044** (the four other open OPs — see "OP triage
   table" below).

### M6a-FS-6 (run #13, contingency)

**Reserved for any P0/P1 finding from runs 11-12 that's load-bearing
and needs a dedicated fix run.**

Reasonable expectation: 5-6 runs to playable release.  This is a
best-case if mock campaigns don't surface major arch reworks.

## OP triage table (M6a-FS-4 close)

| OP | Severity | Ship pre-release (M6a-FS-5)? | Rationale |
|---|---|---|---|
| OP-040 | P2 firewall/continuity | NO — post-release | Workflow workaround exists (DM re-marks realization).  Same shape as OP-043; batch in a follow-up "firewall-vs-materializer tolerance" sweep. |
| OP-041 | P2 data-loss | OPTIONAL — ship if time | Probe + cloud-sync version history close the typical path.  Pre-release polish; not blocker. |
| OP-042 | P2 UX surprise | NO — post-release | Today's interleave requires deliberate dual-intent.  Defer until auto-open path lands. |
| OP-043 | P1 visible-broken-state | **YES — M6a-FS-5 priority** | Player tab restored from localStorage shows wrong PC state on retired seats.  Real-world hit.  Fix is small (tolerate missing `reason` in materializer). |
| OP-044 | P3 latent | OPTIONAL — ship if time | UI render gate self-protects.  Three-line clamp fix; defensive. |

Recommended M6a-FS-5 scope: ship OP-043 (mandatory) + OP-041 +
OP-044 (low-effort, defensive).  OP-040 + OP-042 ship post-
release.

## Mock-campaign methodology

### Format

Each mock campaign is one file in
`design/save-restore-program/simulations/mock-campaign-NN-<theme>.md`
with sections:

```
# Mock Campaign NN — <theme>

## Scenario brief
<3-4 sentences setting up the table, PCs, and the system slice
this campaign exercises>

## Driving approach
<code-level simulation via in-memory transport> OR
<Playwright e2e with N peers> OR <hybrid>

## Per-turn script
<DM action / player A action / player B action / expected system
response — beat by beat>

## Findings
<bullets, severity-tagged.  Each finding is either:
- FIXED inline (link to commit) — for 1-line obvious fixes
- FILED as OP-NNN in open-problems.md — for load-bearing issues
- ACCEPTED as a known issue — documented here + in OP file
>
```

### Driving approaches

The program lead has no sub-agent to "play" the campaign.  The lead
walks the script:

- **Code-level simulation (default for save/restore loops).**  Drive
  the runtime via the same in-memory transport the existing
  `restore-drill.test.ts` uses.  Each beat advances the test fixture;
  invariants are asserted between beats; the test file IS the
  simulation transcript.  Use this when the campaign is about
  state-machine correctness.

- **Playwright e2e (for UX/timing-sensitive paths).**  Multi-peer
  session.  Capture screenshots at decision points.  Use when the
  campaign exercises real rendering or real browser dialogs
  (window.showDirectoryPicker, native consent, etc.).  Note:
  `showDirectoryPicker` requires a user gesture; not Playwright-
  testable — those campaigns drive the engine layer directly.

- **Hybrid.**  Code-level simulation for the spine, Playwright
  screenshot at the decision points the human will eyeball.

### Coverage targets

Per the run #8 mandate, the mock campaigns target the following.
Each is at least one campaign:

1. **Magic discovery arc** (accidental → realization → tax
   progression).  Player A realizes; player B sees nothing.  Save
   mid-arc, restore, continue.  Firewall held?  Realization moment
   fires on the right player?
2. **Co-DM transitions.**  Primary DM yields mid-session; what does
   each save contain?  Player projection consistent?  Autosave from
   the right peer?
3. **Spoiler authorship at chargen.**  Player writes prophesied-one
   backstory; campaign has prophecy as DM-only.  Silent-player
   firewall holds?  DM amber chip?
4. **Network partition.**  Peer offline mid-session, returns with
   diverged log.  Merge deterministic + firewall-correct.
5. **Save / restore / continue across sessions.**  The flagship
   loop.  Tonight, close, next week, continue.
6. **Game-mechanic edges.**  Max harm / max stress / advancement
   cap / bond limit / focus-grant limit.  UI doesn't break at
   edges.
7. **Cloud-folder push during active play.**  DM pushes mid-
   session; does autosave conflict?  Does the push race with
   materialization?

Run #8 lands campaign 5 (the flagship).  Runs #9-12 land the rest.

### Bug-fix discipline (from run #8 mandate)

- **1-line obvious fix that's clearly correct:** fix inline,
  commit, push, link from the mock-campaign findings section.
- **Load-bearing (firewall-adjacent, race condition, state
  machine):** STOP.  File in `open-problems.md`.  Decide if it
  blocks playable release or ships as a known issue.  Document
  here.
- **UX issue:** file in `open-problems.md` and stack-rank
  against the M6a-FS user-facing milestone.

## QA gates

- **Unit tests:** Every new module has a test file colocated;
  fail-fast on `npm test`.
- **Integration tests:** Host event handlers + dialog roundtrip
  + operational-view embed are covered.
- **M4 restore-drill:** 12 tests must still pass on every push.
- **Save-side firewall fuzz:** must still pass on every push.
- **Restore-side firewall fuzz:** must still pass on every push.
- **Simulation tests (NEW):** mock-campaign simulations that
  are code-level drive the runtime through the script and
  assert invariants between beats.  These live in
  `src/persistence.simulation-*.test.ts` (one file per
  simulation) and run with the rest of the test suite.
- **Type-check + build:** clean on every push.
- **Cred audit:** no credentials in diff, end-of-run.
- **Playwright e2e:** runs separately (CI skips by design);
  the simulation tests are the in-suite proxy.

## Deploy contract

- Every run ends with a push to `main`.  The Cloudflare Pages
  deploy is the user-visible artifact.
- The end-of-run report includes the short-SHA for the human to
  verify against the deployed bundle.
- Until `maintainer-ops.md §8.5` flips M6a-FS "live," the feature
  is shipped behind no flag — it's gated only by browser support
  (the `<backups-card>` self-renders the unavailable state on
  Safari / Firefox / mobile).  Playable release means the
  Chromium-desktop DM sees the live feature once they enter the
  operational view.

## Known-issue tracker

Filed during this run:

- (none yet — will fill as mock campaign 01 runs)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Operational-view appMode breaks existing modal-overlay tests | low | medium | unit tests on the new branch; full test suite on every push |
| `<backups-card>` renders inside a Lit shadow tree that breaks the slot mechanic | low | low | the card uses `createRenderRoot: () => this` (light DOM); embeds inside the existing Aside stack without shadow boundaries |
| Mock campaign 01 surfaces a firewall regression we didn't see in fuzz | medium | high | mock campaigns ARE the fuzz hardening; any finding is a P0 that delays release |
| Real DM Drive Desktop sync lag → push appears successful but file isn't synced for minutes | medium | low | Quire does not own this; "the folder is the trust boundary, not Quire" framing documented |
| Permission-revoked between sessions (browser cleared site data) | medium | medium | reconnect button in M6a-FS-2; until then, the chip copy is the surface |

## Where this plan can flex

- Mock campaigns can interleave with shipping work.  The
  human's mandate said simulations DRIVE the work — if campaign
  01 finds a P0, run #8 fixes it before the operational view
  is wired.
- The "session-digest chip" milestone can shuffle if a
  simulation surfaces something more urgent.
- M6a-FS-6 contingency run can absorb 1-2 simulation findings.
- If mock campaigns surface NO P0/P1 findings through run 11,
  M6a-FS-5 may collapse into M6a-FS-4 — release one run early.

## Out-of-scope-but-tracked

- **Once M6a-FS reaches playable:** M6a-OAuth picks up where run
  #6 left off.  Adds the parallel "My Drive" line to the same
  operational view (DEC-029 specified this composability).
- **M6c / M6b** ship per the existing DEC-022 / DEC-016 ordering.
- **M7 simulated playtest** subsumes the mock-campaign methodology;
  the simulations files become the M7 deliverable.
