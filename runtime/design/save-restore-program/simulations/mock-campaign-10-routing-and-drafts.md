# Mock Campaign 10 — Routing + drafts (run #15)

**Test file:** `src/persistence.simulation-10-routing-and-drafts.test.ts`

**Purpose:** Pin the three production-path fixes shipped in
run #15: player-side session-open auto-trigger (UX-3 routing fix),
digest draft persistence (UX-5), and the FC-2 false-positive
narrowing (a player named "Tax" round-trips).

**Why this campaign exists (run #14 lesson):** Mock-09 Scenario 4
shipped with a passing test that the TTRPG/UX expert proved was a
false positive — the test forced `appMode = 'session-open'` from
outside the production routing path.  Per the run #15 mandate,
ALL UX tests must respect production code paths.  Mock-10's
scenarios use the production session-controller subscriber
trigger; no test-side appMode mutation.

## Scenarios

### Scenario 1: player auto-flips to session-open via the production trigger
The DM authors a session-digest before the player joins; the
player joins; after enough flush ticks the
`applySessionViewChange` subscriber fires the player-side
auto-trigger (the one added in run #15 — `playerHasUnseenDigest`
gates the flip).  Asserts `appMode === 'session-open'` WITHOUT
test-side mutation.  This is the test that would have caught the
run #14 regression.

### Scenario 2: Dismiss sets the seen-marker; later session-view changes don't re-flip
After Scenario 1's auto-flip, the player clicks the
`.session-open-player-recap-dismiss` button.  The handler updates
the in-memory + localStorage seen-marker.  A subsequent chat
event fires another session-view change.  Asserts
`appMode === 'in-session'`.

### Scenario 3: A STRICTLY NEWER digest re-flips after dismiss
After Scenario 2's dismiss, the DM authors a digest with a later
`ts`.  The trigger fires again because the new digest's ts >
seen-marker.  Asserts `appMode === 'session-open'`.

### Scenario 4: digest-draft persistence helpers round-trip via localStorage
Pure-helper test of `saveDigestDraft` / `loadDigestDraft` /
`clearDigestDraft`.  Mirrors `chargen-persistence` tests — same
contract shape.

### Scenario 5: storage keys are campaign-scoped
A DM in mid-wrap on campaign A doesn't leak their draft into
campaign B's storage key.  Pins the `digestDraftStorageKey`
shape.

### Scenario 6: `<session-digest>` picks up a persisted draft on connect
Seeds a persisted draft via `saveDigestDraft`, then mounts the
component with `campaignSlug` set.  Asserts the
`textarea.session-digest-draft` value is the persisted body.
This pins the connect-time `loadPersistedDraft()` lifecycle hook.

### Scenario 7: FC-2 narrowing — "Tax" rename survives player projection
Builds a `pc-edit { field:'name', value:'Tax' }` and runs it
through `projectSaveForViewer(doc, false)`.  Asserts the event
survives with the value intact.  Without the run #15 narrowing
(adversarial v2 H-3 fix), the run #14 broad value-scan would
have dropped the event because `'tax'` is a DM-only field name.

## Class-name contract pins

The following classes are now pinned by mock-10.  A re-style
that renames them must update the test in lockstep:

- `.session-open-player-recap`
- `.session-open-player-digest`
- `.session-open-player-recap-dismiss` (new in run #15)
- `textarea.session-digest-draft`

Cross-referenced in `quire-app.css.ts` (brittle-class radar
doc comment at line 100-117).

## What this doesn't cover (deferred to mock-11+)

- Multi-DM digest race (co-DM both type drafts; only one wins).
- Player at a SECOND device picking up a draft typed on a first
  device (out of scope — drafts are per-device by design).
- The DM-side digest editor's interaction with the M6a-FS
  backup chip (covered by `session-digest.test.ts`).
