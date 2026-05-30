# Save/Restore Program — Status

**Last updated:** 2026-05-30 run #13 (program WIDENED to
Playtest-Readiness; see `../playtest-readiness/status.md` for
the master plan + 4 consultant briefs queued + 4 new test
files; this program is folded as workstreams WS-A/B/C/D within
that larger effort).
**Active milestone:** M6a-FS playable release GREEN (unchanged
from run #12); playtest-readiness program is the active
container per `../playtest-readiness/playtest-readiness-plan.md`.
**Latest deploy hash:** 8501e48 (run #13 ship)
**Branch:** main

## Run #13 quick links

- Playtest-readiness master plan: `../playtest-readiness/playtest-readiness-plan.md`
- Format-stability contract: `../playtest-readiness/format-stability.md`
- Consultant briefs: `../playtest-readiness/consultant-briefs/`
- New mock campaign 08: `simulations/mock-campaign-08-dm-writeup-phase.md`
- New OP-045 (chargen rename gap): `open-problems.md`

## Prior milestone — M6a-FS Playable-Release Status: GREEN

## M6a-FS Playable-Release Status: **GREEN**

All required capabilities verified working:
- Open campaign URL + play normally → GREEN
- Connect a folder + ack consent → GREEN
- Push now → "Pushed N bytes" → GREEN
- Close browser → GREEN
- Next-week open + Pull + continue → GREEN
- Second machine via sync-tool mirror → GREEN
- Operational view (DEC-029) → GREEN
- Session-digest chip (OP-037) → GREEN
- Cross-device probe (§FS.11) → GREEN
- All 8 error-UX rows in §A12 wired → GREEN
- NO P0/P1 firewall bugs → GREEN (OP-043 fixed run #12)
- NO P1 data-loss in happy path → GREEN
- P2 deferred (OP-040, OP-042) with documented workarounds → YELLOW (acceptable per plan)
- Honest copy (DM-only surface, no jargon in player view) → GREEN
- Mock-campaign simulations 01-07 (26 tests) → GREEN

See `playable-release-plan.md` for the full capability table.

## Session log (most recent first)

- **2026-05-30 run #12 (this run):** M6a-FS-5 SHIPPED.

  - **OP-043 RESOLVED:** `applyPcRetireOrArchiveEvent` now
    tolerates `p.reason === undefined` (firewall-stripped).
    Player-save restore now materializes the retired seat with
    `inFictionRetireReason` + `seatMemory` preserved; DM-only
    `retireReason` + `retiredScene` remain unset.  Same shape
    as `scrubMapBlobIfUnrevealed`.  2 regression tests +
    mock-campaign-06 FINDING-B test updated to expect the fixed
    behavior.  DEC-030 codifies the pattern: per-kind scrubbers
    + materializers form a contract; the materializer MUST
    tolerate absence of stripped fields.

  - **Pattern check (PER_KIND_SCRUBBERS × materializers):** walked
    every scrubber against its materializer.  ALL other scrubbers
    strip OPTIONAL fields validated-when-present by their
    materializers.  `pc-retire`/`pc-archive` was the unique case
    (required enum).  **NO sibling bugs found.**  Findings
    documented inline in OP-043's resolution block.

  - **Mock campaign 07 (network partition) SHIPPED** at
    `src/persistence.simulation-07-network-partition.test.ts`.
    6 tests, all pass.  Doc at `design/save-restore-program/
    simulations/mock-campaign-07-network-partition.md`.
    Scenarios:
      - Two-peer partition: player offline N events → rejoin;
        player log = DM log minus DM-only events (sync-response
        filter stripped them).
      - Three-peer partition: isolated player + active table both
        write; merge converges.  FINDING-A documented (raw-log
        asymmetry: Anya holds scratch-note via direct `share`
        envelope; Mei does not via sync-response filter; both
        converge to identical filtered + saved projections).
      - Coord partition + DM-only events: late-joining player
        via sync-response does NOT receive the scratch-note from
        the partial-log player (OP-039 filter holds across
        partition).
      - Save during partition: minority-partition save reflects
        only local view; restore + re-sync converges via standard
        sync path.
      - Deterministic convergence: concurrent-author chats
        converge to byte-identical state.
      - Save-during-partition + restore on fresh peer: rejoin
        and converge; firewall holds across save/restore + sync
        boundary.

  - **OP-041 RESOLVED (P2):** `pushCampaignToFolder` now refuses
    with `'first-push-orphan'` when the connected folder contains
    a NON-EMPTY save we never observed.  New `overwriteOrphan`
    option lets the host proceed after DM ack.  0-byte placeholder
    files from a failed `createWritable()` are NOT treated as
    orphans (preserves the sim-05 offline-recovery contract).
    `<backups-card>` `pushErrorMessage` got a new branch for the
    user-visible copy.  2 new unit tests.

  - **OP-044 RESOLVED (P3):** `applyCharacterEdits` now clamps
    `advancements` to `[0, ADVANCEMENT_CAP]` (rules.md:166) and
    `marks` to `[0, 5]` (rules.md:157).  Defense-in-depth
    alongside the UI render gate.  2 new unit tests.

  - **Pre-release sweep COMPLETED.**  Walked every item in
    `playable-release-plan.md`'s definition of "playable release"
    + required user-visible surfaces + 8 error UX rows.  All
    GREEN.  Bug bar met (NO P0/P1 open; P2 deferred with
    documented workarounds).  Capability table appended to
    `playable-release-plan.md` end of `M6a-FS-5` section.

  - **DEC-030 logged.**  Materializers tolerate firewall-stripped
    optional sub-fields — codifies the SSOT-correct pattern that
    OP-043's fix exemplifies; closes the future-engineer self-
    check loop.

  Tests: 2958 + 2 skipped = 2960 (up from 2948 baseline, +12
  new this run; +89 net since M6a-FS started).  Typecheck clean.
  Build clean (646KB main chunk).  No credentials in diff.

- **2026-05-30 run #11 (prior run):** M6a-FS-4 SHIPPED.

  - **Mock campaign 06 (game-mechanic edges) SHIPPED** at
    `src/persistence.simulation-06-game-mechanic-edges.test.ts`.
    8 tests, all pass.  Doc at `design/save-restore-program/
    simulations/mock-campaign-06-game-mechanic-edges.md`.
    Scenarios exercised:
      - Harm to max (4) + save/restore + render (FINDING-C ok).
      - Stress to max (4) + save/restore + clamp (ok).
      - Advancement to cap (8) + cap-reached chip + survive
        round-trip (FINDING-A surfaced — engine permits >8;
        UI render gate self-protects).
      - Bond drafts cap (3) — packChargen rejects 4+ (FINDING-D ok).
      - 10 focus-grants + DM-only sub-field strip on player
        save (FINDING-E ok — D-prep-2-A scrubber works at scale).
      - PC retire mid-session + firewall (FINDING-F payload
        scrub ok at the SAVE LAYER; FINDING-B BUG surfaced at
        the MATERIALIZE LAYER — see OP-043).
      - Co-DM yield with half-completed scene reveal +
        save/restore (FINDING-G ok — partial reveal mask
        survives both DM and player projections).
  - **OP-043 (NEW P1):** pc-retire player-save round-trip fails
    to materialize retired seat.  Player tab restored from
    localStorage (or cross-device probe load as non-coord)
    sees retired PC as `bound-active` after restore — the
    firewall strips `reason`, the materializer requires it,
    event is silently dropped.  Same SHAPE as OP-040.  Live-
    play sync-response path unaffected (OP-039 strips by kind
    not sub-field).  Real player-side hit; queued as the FIRST
    item to ship in M6a-FS-5 (run #12).  Does NOT block
    playable release per the DM-happy-path definition.
  - **OP-044 (NEW P3):** Engine permits `advancements` value
    above ADVANCEMENT_CAP (8).  UI render gate self-protects
    (cap-reached chip uses `>= 8`).  Three-line clamp fix;
    defensive only.  Post-release polish.
  - **OP-040 / OP-041 / OP-042 triage call** documented in
    `playable-release-plan.md` (new "OP triage table" section).
    Recommendation: ship OP-043 (mandatory) + OP-041 + OP-044
    in M6a-FS-5; OP-040 + OP-042 ship post-release.

  Tests: 2946 + 2 skipped = 2948 (up from 2940 baseline, +8 new
  this run; +77 net since M6a-FS started).  Typecheck clean.
  Build clean (645KB main chunk).  No credentials in diff.

- **2026-05-30 run #10 (prior run):** M6a-FS-3 SHIPPED.

  - **Cross-device probe (§FS.11) SHIPPED.**
    `src/controllers/cross-device-probe.ts` (10 unit tests) is
    a thin controller that consults the connected folder for a
    matching `<slug>.quire-save.json` on cold-load with empty
    local state.  Once-per-landing guard inside; gates on three
    independent facts (FS API available + folder connected +
    no local autosave).  NEVER auto-loads per DEC-015.
    Host wiring in `quire-app.ts`: `getCrossDeviceProbe()`
    lazy field; `maybeRunCrossDeviceProbe()` fires alongside
    `checkResumePrompt`; `crossDeviceProbeMatch` @state stages
    the result; reset on campaign URL change.
    `renderCrossDeviceProbePrompt()` renders inline next to the
    resume prompt template.  "Load it" (default-focused per
    DEC-015) calls `crossDeviceProbeLoad()` which pulls + applies
    via the existing `loadFromString` projection path.  "Start
    fresh" calls `dismissCrossDeviceProbe()` — no folder
    mutation.  Silent-player firewall: prompt suppressed when
    a session is active AND the viewer is non-coord
    (defense-in-depth).  7 quire-app integration tests cover:
    match-staging, local-autosave-defers, no-folder no-match,
    no-matching-file, dismiss, Load-it round trip, per-landing
    guard.
  - **Mock campaign 04 (chargen spoiler authorship) SHIPPED**
    at `src/persistence.simulation-04-chargen-spoiler.test.ts`.
    2 tests, both pass.  Doc at
    `design/save-restore-program/simulations/mock-campaign-04-
    chargen-spoiler-authorship.md`.  Findings A-C sanity-
    confirmed: amber chip persists across save/restore; silent-
    player firewall holds; cross-PC firewall holds for a fresh-
    joining player.  FINDING-D documents a narrow sub-P3 player-
    side recovery edge — not filed as OP (recovery path exists
    via re-deliver from blank chargen).
  - **Mock campaign 05 (cloud push during active play) SHIPPED**
    at `src/persistence.simulation-05-cloud-push-during-active-
    play.test.ts`.  6 tests, all pass.  Doc at
    `design/save-restore-program/simulations/mock-campaign-05-
    cloud-push-during-active-play.md`.  Findings A-D + G sanity-
    confirmed (snapshot semantics; autosave + push independence;
    conflict detection; offline recovery; visibilitychange flush
    concurrency).  Surfaced two new P2 OPs:
      - **FINDING-E → OP-041** — first-push silently overwrites
        an orphan `<slug>.quire-save.json` if the folder
        already contains one AND the cross-device probe didn't
        fire.  Cross-device probe closes the typical path;
        pre-release polish should add a `'first-push-orphan'`
        reason to the conflict-check.
      - **FINDING-F → OP-042** — consent dialog can interleave
        with concurrent host actions during active play
        (resume-prompt Load, cross-device probe Load, push).
        Today the interleave requires deliberate dual-intent;
        defer + document the invariant.
    Neither blocks playable release.

  Tests: 2938 + 2 skipped = 2940 (up from 2915 baseline, +25
  new this run; +69 net since M6a-FS started).  Typecheck
  clean.  Build clean (645KB main chunk, on par with prior
  runs).  No credentials in diff.

- **2026-05-30 run #9 (prior run):** M6a-FS-2 SHIPPED.

  - **OP-039 RESOLVED:** `defaultSyncResponseFilter` shipped in
    `persistence.ts` — drops PLAYER_SCOPE_STRIP_KINDS events on
    sync-response without running per-field scrubbers (narrower
    than rebroadcastFilter by design — sync-response is the
    joining peer's only catch-up channel for partial-DM-field
    events).  Wired into `Peer` via new `syncResponseFilter`
    option (separate from `rebroadcastFilter` so the two surfaces
    can evolve independently).  Session-controller passes the
    real default.  3 regression tests in
    `persistence.restore-firewall-fuzz.test.ts`: peer holding
    scratch-note drops it on sync-response; exhaustive — every
    PLAYER_SCOPE_STRIP_KINDS event dropped; identity preserved
    when no DM-only events present.  Pre-fix tests fail; post-fix
    tests pass — load-bearing fix verified.
  - **OP-037 RESOLVED:** session-digest backup chip surface
    shipped per `ux-strategy.md §A10-A`.
    `<session-digest>` gains a `showBackupChip` property; when
    true AND viewer is DM AND no draft is in flight AND no
    generation in progress, appends a "Back up tonight's
    session?" chip.  Click dispatches `session-digest-open-
    operational-view` (bubbles + composed); host sets `appMode
    = 'dm-operational'`.  5 unit tests.  Host wires chip
    availability via new `isBackupChipAvailable()` →
    `FsApiCloudPush.getAvailabilityVerdict().available`.
  - **Reconnect-on-permission-revoked SHIPPED:** `<backups-card>`
    hoists `permission-revoked` into its own ChipState (distinct
    from generic error so the renderer can append a `[Reconnect]`
    button).  Click calls `requestPermissionForCampaign`.
    Success → chip = success ("Folder reconnected.  Click Push to
    back up.").  Denied → chip stays permission-revoked + button
    remains (DM can retry).  not-connected → chip = error.
    4 new unit tests cover all branches.  1 existing test
    updated to reflect the new chip-state data-attribute
    (`data-state=permission-revoked` instead of `error`).
  - **Mock campaign 02 (magic discovery arc) SHIPPED** at
    `src/persistence.simulation-02-magic-discovery-arc.test.ts`.
    2 tests, both pass.  Doc at
    `design/save-restore-program/simulations/mock-campaign-02-
    magic-discovery-arc.md`.  Drives the full pre-Realization
    → Realization → save → restore → tax-release arc with two
    players + DM.  **Surfaced FINDING-A → OP-040** (see below):
    the OP-039 firewall strips `pc-mark-realization` on
    sync-response, which is correct for the firewall but
    blocks a player who joins fresh post-realization from
    seeing their own cast capability.  Mitigation in production:
    workflow workaround (re-mark realization for late-joiner is
    idempotent on visible state).  Architectural review may
    pick path 1 (reclassify pc-mark-realization out of
    PLAYER_SCOPE_STRIP_KINDS) during M7+.  Does NOT block
    playable release.  Test file documents the FINDING-A
    behavior in-line via assertions so future changes flag the
    classification.
  - **Mock campaign 03 (co-DM transitions) SHIPPED** at
    `src/persistence.simulation-03-co-dm-transitions.test.ts`.
    3 tests, all pass.  Doc at
    `design/save-restore-program/simulations/mock-campaign-03-
    co-dm-transitions.md`.  Drives primary DM → co-DM reclaim
    mid-session with two players present.  No new findings.
    Confirms:
      - Both DMs' saves restore to the same final state (DEC-014
        per-DM-drive ownership; saves are interchangeable
        because the event log is the canonical state).
      - The OP-039 firewall holds across the co-DM transition +
        save/restore boundary.
      - Players' filtered state shows neither DM's scratch-note
        at any point.
  - **OP-040 FILED (NEW)** — load-bearing P2 classification
    tension surfaced by mock campaign 02.  See
    `open-problems.md` for the three fix paths + rationale.

  Tests: 2913 + 2 skipped = 2915 (up from 2898 baseline, +17 new
  in this run; +44 net since M6a-FS started).  Typecheck clean.
  Build clean (641KB main chunk, on par with prior runs).  No
  credentials in diff.

- **2026-05-29 run #8 (prior run):** Human escalated M6a-FS to
  "get this code ready for a playable release," conditional on
  the lead engineer agreeing with option (b) over (a) from run #7
  OP-038.  Lead engineer agreed (DEC-029); option (b) is the
  right design.  Shipped:

  - **DEC-029** logged — discrete DM operational view surface
    aligns with `ux-strategy.md` locked principle 3; future
    engineering-reality surfaces (eviction status, account
    mismatch, manual save) will live in the same hidden surface.
  - **playable-release-plan.md** (NEW) — defines the bar for
    "ready for a playable release," milestone breakdown per
    run, mock-campaign methodology, QA gates, and out-of-scope
    list.  Estimated 5-6 runs to playable (this run + 4-5
    more).
  - **`appMode = 'dm-operational'`** added to
    `src/ui/modes/mode-state.ts` (8 modes total).
    `renderBody` branches into `renderDmOperationalView`.
    Launcher chip lives on the DM Aside next to "Wrap
    session…" / "Open session…".  Escape closes the view.
  - **`<dm-operational-view>` Lit region** (`src/ui/regions/
    dm-operational-view.ts`) + 7 tests.  Hosts
    `<backups-card>` today; future surfaces compose alongside.
    Silent-player firewall: player-side render fires a
    "DM is checking the table's gear" placeholder (no
    leakage of WHAT the DM is doing).  Defense-in-depth via
    `renderForDm` short-circuit.
  - **`<cloud-push-consent-dialog>` Lit region**
    (`src/ui/regions/cloud-push-consent-dialog.ts`) + 11
    tests.  Renders `ConsentDialogCopySpec` (M6a-FS today;
    M6a-OAuth + GitHub will reuse with their own specs).
    Escape / backdrop / cancel all resolve false.
    Disconnected pending promise resolves false to avoid
    hung callers.
  - **Host event handlers in `quire-app.ts`**:
    `handleBackupsPushRequest` (builds save via
    `serializeSession` + `stringifySave`, calls
    `pushCampaignToFolder`, hands result to card);
    `handleBackupsPullRequest` (calls
    `pullCampaignFromFolder`, parses, applies via
    `loadFromString` so restore-firewall + auto-reclaim
    invariants are preserved).  Both route the result back
    to the card via `applyPushResult`.  OP-036 closed.
  - **Lazy `FsApiCloudPush` field** with
    `fsApiCloudPushFactory` test seam.  Production wires
    `browserDirectoryPicker` + `browserIndexedDbFsApiHandleStorage`
    + `browserLocalStorageConsentStorage`.
  - **Consent dialog mounted at app root** (outside
    `<quire-shell>` slots so the backdrop spans the full
    viewport).  Host-owned; the operational view's
    `requestConsent` arrow function locates the dialog via
    `querySelector` and calls `dlg.open(DEFAULT_CONSENT_COPY_FS_API)`.
  - **OP-036 + OP-037 + OP-038 status updates** (OP-036 +
    OP-038 closed; OP-037 still open — session-digest chip
    is M6a-FS-2 work).
  - **Mock campaign 01 (flagship cross-session cloud loop)**
    SHIPPED at `src/persistence.simulation-01-cloud-loop.
    test.ts` (3 tests, all passing) + descriptive doc at
    `design/save-restore-program/simulations/mock-campaign-
    01-cross-session-cloud-loop.md`.  Drives the engine
    layer + real `FsApiCloudPush` orchestrator + an
    in-memory mock of the directory handle through the full
    play → push → close → reopen → pull → continue loop.
  - **FINDING-01 / OP-039 (NEW):** mock campaign 01 surfaced
    a sister-of-NEW-ADV-2 firewall hole.
    `sync-request → log.since() → sync-response` ships raw
    events to the requester WITHOUT applying
    `defaultRebroadcastFilter`.  Render-layer firewall AND
    save-layer firewall both hold; the hole is the raw
    event log on the joining player's peer (devtools-
    visible only).  Filed P2 (class 2); not a playable-
    release blocker; one-line fix scheduled for M6a-FS-2.

  Tests: 2896 + 2 skipped = 2898 (up from 2877 baseline,
  +21).  Typecheck clean.  Build clean (640KB main chunk).
  No credentials in diff.

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
- 🟢 M6a-FS host integration (OP-036/OP-038) — SHIPPED (run #8).
- 🟢 M6a-FS DM operational view surface (DEC-029) — SHIPPED (run #8).
- 🟢 M6a-FS consent dialog component — SHIPPED (run #8).
- 🟢 Mock campaign 01 (flagship cross-session cloud loop) — SHIPPED (run #8).
- 🟢 OP-039 (sync-response carries DM-only events) — RESOLVED (run #9 — `defaultSyncResponseFilter` + Peer wiring + 3 regression tests).
- 🟢 OP-037 — session-digest chip surface — SHIPPED (run #9 — `<session-digest>` + 5 tests).
- 🟢 Reconnect-on-permission-revoked button — SHIPPED (run #9 — new ChipState + handler + 4 tests).
- 🟢 Mock campaign 02 (magic discovery arc) — SHIPPED (run #9 — 2 tests; surfaced OP-040).
- 🟢 Mock campaign 03 (co-DM transitions) — SHIPPED (run #9 — 3 tests; no new findings).
- 🟡 OP-040 (pc-mark-realization stripped from sync-response) — FILED (run #9, P2 — does NOT block playable release).
- 🟢 Cross-device probe (§FS.11) — SHIPPED (run #10 — `CrossDeviceProbeController` + host wiring + 17 tests; DEC-015 never-auto-load preserved).
- 🟢 Mock campaign 04 (chargen spoiler authorship) — SHIPPED (run #10 — 2 tests; silent-player firewall holds across save/restore).
- 🟢 Mock campaign 05 (cloud push during active play) — SHIPPED (run #10 — 6 tests; surfaced OP-041 + OP-042).
- 🟡 OP-041 (first-push silently overwrites orphan save) — FILED (run #10, P2 — does NOT block playable release; mitigated by §FS.11 probe).
- 🟡 OP-042 (consent dialog interleaves with concurrent host actions) — FILED (run #10, P2 — does NOT block playable release; today requires deliberate dual-intent).
- 🟢 Mock campaign 06 (game-mechanic edges) — SHIPPED (run #11 — 8 tests; surfaced OP-043 + OP-044).
- 🟢 OP-043 (pc-retire player-save round-trip) — RESOLVED (run #12 — materializer tolerates firewall-stripped `reason`; 2 regression tests).
- 🟢 OP-044 (engine permits `advancements` > 8) — RESOLVED (run #12 — clamp to ADVANCEMENT_CAP + marks to MARKS_MAX; 2 unit tests).
- 🟢 OP-041 (first-push silently overwrites orphan save) — RESOLVED (run #12 — `'first-push-orphan'` reason + `overwriteOrphan` option; 2 unit tests).
- 🟢 Mock campaign 07 (network partition) — SHIPPED (run #12 — 6 tests; FINDING-A documented as accepted-by-design firewall surface).
- 🟢 PER_KIND_SCRUBBERS × materializers pattern walk — COMPLETED (run #12 — no sibling bugs found).
- 🟢 Pre-release sweep — COMPLETED (run #12 — all capabilities GREEN).
- 🟢 **M6a-FS playable release** — **GREEN** (run #12 — human can flip maintainer switch + deploy).
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
- **M6a-FS DM operational view (run #8 NEW)** →
  `src/ui/regions/dm-operational-view.ts` (+ test file)
- **Consent dialog component (run #8 NEW)** →
  `src/ui/regions/cloud-push-consent-dialog.ts` (+ test file)
- **M6a-FS host integration (run #8 NEW)** →
  `src/quire-app.ts` (`renderDmOperationalView` +
  `handleBackupsPushRequest` + `handleBackupsPullRequest` +
  `requestFsApiConsent` + `getFsApiCloudPush` lazy field)
- **Playable-release plan (run #8 NEW)** →
  `playable-release-plan.md`
- **Mock campaign methodology / simulations (run #8 NEW)** →
  `simulations/` (mock-campaign-NN-<theme>.md +
  `src/persistence.simulation-NN-*.test.ts`)
- **Cross-device probe controller (run #10 NEW)** →
  `src/controllers/cross-device-probe.ts` (+ test file).
  Host wiring in `src/quire-app.ts`:
  `getCrossDeviceProbe()` / `maybeRunCrossDeviceProbe()` /
  `crossDeviceProbeLoad()` / `dismissCrossDeviceProbe()` /
  `renderCrossDeviceProbePrompt()`.
- **Quire-app cross-device probe wiring tests (run #10 NEW)** →
  `src/quire-app.cross-device-probe.test.ts` (7 tests).
- Fork verification → `src/persistence.publish-fork.test.ts`
