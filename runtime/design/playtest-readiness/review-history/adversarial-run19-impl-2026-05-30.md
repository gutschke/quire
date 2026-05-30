# Adversarial re-review — UX-MH implementation (Run #19 Phase 7)

**Reviewer lens:** the same adversarial firewall posture used in
`adversarial-ux-must-haves-2026-05-30.md`, replayed against the
LANDED code rather than the planned shapes.  Same threat model
(accidental DM disclosure + outsiders), same load-bearing
discipline (LL-1 sliver-trap avoidance, silent-player-firewall,
chargen-authorship-division).

**Implemented surfaces audited:**

  - Phase 1: `state.ts` + `persistence.ts` for the 5 new event
    kinds (`peer-rename-by-coord`, `pc-tag-add/-remove/-rename`,
    `backstory-refresh-proposal`)
  - Phase 2: `ai/backstory-refresher.ts` (the AI module)
  - Phase 3: `ui/components/inline-diff.ts`,
    `ui/components/chargen-edit-tray.ts`,
    `ui/components/backstory-refresh-inbox.ts`,
    `ui/player-name-lookup.ts`, chargen-dm-review integration
  - Phase 4: `ui/shell/quire-shell.ts` (7-column grid),
    `ui/shell/splitter-controller.ts`, quire-app.ts firstUpdated
    wiring

## Verdict

**FIREWALL HELD.**  Counts: **P0 ×0**, **P1 ×0**, **P2 ×2** (both
are watch-items, not ship-blockers).

The four P0/P1s the planning-phase adversarial flagged all received
their MUST-FIX:

  - **P0 MH-1-A** (peer-rename INERT): NEW event kind
    `peer-rename-by-coord` materializer at `state.ts:applyPeerRenameByCoordEvent`
    writes `state.peers[targetPeerId].name` (NOT
    `state.peers[event.peerId]`) under a coord-gate.  Production-path
    test `state.run19-events.test.ts:peer-rename-by-coord` drives
    through `materialize(log.events())` — LL-1 clean.
  - **P1 MH-2-A** (tag-event firewall classification): all three
    tag kinds + the proposal kind land in `EVENT_KINDS_PLAYER_VISIBLE`
    + `EVENT_KINDS_NO_SCRUB_NEEDED` (no DM-only sub-fields on tag
    ops; the proposal's `triggerSummary` is registered in
    `PER_KIND_SCRUBBERS`).  `persistence.coverage.test.ts` passes;
    the self-completing tripwire catches the next addition.
  - **P1 MH-3-A** (backstory-refresher scope discipline): the
    module's public API has no `scope` parameter; the source-code
    grep test `backstory-refresher.test.ts:scope discipline`
    asserts no `scope:'dm'` literal + no `buildCampaignContext`
    direct reference (only the comment-stripped source is checked
    so doc-comments that describe the lock don't trip it).
  - **P1 MH-3-B** (forbidden-token post-check BEFORE proposal
    emit): the `refreshBackstory` orchestrator runs
    `containsSpoilerTokens` + `aiSemanticSpoilerCheck` on the
    output BEFORE returning the proposal payload.  Persistent leak
    after one auto-retry returns `spoiler-leak-persistent` — the
    caller surfaces the DM-only soft-warn + NEVER materializes the
    `backstory-refresh-proposal` event.  Unit tests in
    `backstory-refresher.test.ts` cover the happy path, the retry
    path, and the persistent-leak refuse.
  - **P1 MH-3-D** (DM rationale not in prompt): the
    `BackstoryFieldDelta` type signature is a strict allowlist
    (name change / pronouns change / tags added/removed/renamed /
    player hint).  No `dmNotes` / `reason` / `rationale` field on
    the type — TypeScript prevents the call site from passing them
    in.  Test `backstory-refresher — prompt shape` greps the
    assembled prompt for those strings (lowercased) and asserts
    none appear.

## P2 watch-items (track for the next iteration)

### [P2-IMPL-1] chargen-edit-tray is NOT yet integrated into chargen-dm-review

The Phase 3 components (`<chargen-edit-tray>`,
`<backstory-refresh-inbox>`) are landed + tested as standalone
primitives.  The chargen-dm-review.ts host file is 3400 lines and
the full per-row tray integration was deferred — only the player-
name read-side (UX-MH-1) was wired in.

**Risk:** the DM cannot YET edit tags / pronouns / backstory from
the chargen-dm-review surface in production; the UX-MH-2 affordance
is reachable only via direct component instantiation (which the
e2e specs do for the closure proof).

**Mitigation:** components are production-ready; the host
integration is a routine UI wiring task with no new firewall
implications (the components emit callbacks; the host wires them
to event-log emit).  Follow-up issue tracked.

### [P2-IMPL-2] backstory-refresher AI module is callable but not yet wired into UI

Same shape as P2-IMPL-1: the AI module's public API is stable +
tested + ready, but no UI surface invokes it today.  The host
integration is a separate task.

**Mitigation:** the firewall posture is correct in the module
itself.  When the UI wiring lands, the only new check needed is
"the host invokes `refreshBackstory` only after building a
PLAYER-FACING context" — easy to spot in code review.

## Spoiler firewall replay

Ran the firewall fuzz with the run-19 sentinel additions
(`persistence.restore-firewall-fuzz.helpers.ts` updated to plant a
`triggerSummary` sentinel on a `backstory-refresh-proposal` event):

  - All five new event kinds: present in their correct
    `EVENT_KINDS_*` set; classification CI lint passes.
  - `triggerSummary` sentinel: stripped by `PER_KIND_SCRUBBERS`
    on the player-projection serialize path.  Coord projection
    keeps the sentinel (DM resilience).
  - `pc-tag-add/-remove/-rename`: NO DM-only sub-fields; the
    payload survives the player projection verbatim.
  - `peer-rename-by-coord`: NO DM-only sub-fields; the rename
    payload survives intact.
  - Defense-in-depth: `filterBackstoryRefreshProposalsForViewer`
    strips `triggerSummary` at the RENDER boundary even if the
    persistence-side scrubber regresses.

## Silent-player-firewall replay

Probed every new player-facing surface for accidental disclosure:

  - `<backstory-refresh-inbox>`: NO "we suppressed a spoiler"
    banner, NO mention of the DM's reason, NO "AI declined" copy.
    The card only renders when `proposal !== null` — refused
    proposals are the DM's responsibility (the DM sees the
    soft-warn; the player sees nothing, not even a "trying again"
    indicator).  Test
    `backstory-refresh-inbox.test.ts:silent-firewall` asserts the
    card text contains none of `spoiler`, `refused`, `hidden`, or
    `dm notes`.
  - The unit-test naming the staleness warning: "This suggestion
    was made against an older version of your backstory."  Honest
    + content-free.

## Sliver-trap audit (LL-1)

All Phase 1 unit tests drive through `materialize(log.events())`,
NOT through direct materializer calls.  No materializer-impl test
masks a wiring regression where the kind isn't registered in
`MATERIALIZERS`.

## New leaks introduced: NONE

The 5 new event kinds + the AI module + the UI components + the
splitter introduce zero new firewall surfaces beyond the ones
classified.  The splitter persistence (localStorage) carries only
geometry (rail/aside pixel widths) — no narrative content.

## Recommendations forward

  1. Land the chargen-dm-review tray integration in a follow-up
     run.  The host is large; do it as a focused E-LARGE refactor
     rather than mixing it with this run's already-large scope.
  2. Track the AI-module wiring as a separate item so the
     refresh flow becomes user-reachable from the UI.
  3. The classification CI lint (`persistence.coverage.test.ts`)
     remains the load-bearing tripwire.  Keep it green.

## GO / NO-GO for re-test

**GO.**  The firewall holds; the engine + AI + components are
production-ready; the chargen-dm-review host integration + the
DM operational view's chargen Refresh button are routine wiring
that can ship in a follow-up run without re-opening the firewall
discussion.
