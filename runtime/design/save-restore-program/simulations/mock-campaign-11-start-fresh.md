# Mock Campaign 11 — Start fresh (run #17 P0 fix)

**Date:** 2026-05-30 (run #17)
**Test file:** `src/persistence.simulation-11-start-fresh.test.ts`
**Status:** SHIPPED (8 scenarios; all GREEN)
**Diagnosis:** `design/playtest-readiness/start-fresh-diagnosis-2026-05-30.md`
**Lesson:** `design/playtest-readiness/lessons-learned.md` (LL-2)

## Why this mock exists

The product owner ran a dry-run TODAY and surfaced a P0 the v3
consultants signed off without catching:

- Clicking "Start fresh" on the resume prompt fires a destructive
  state-clear with NO confirmation.
- The clear doesn't actually clear: the local autosave key
  survives, so a "fresh" session is repopulated with the prior
  PC + a stale peer-join the next time the DM clicks Resume / a
  session is restored.

This mock walks the PRODUCTION code paths for every "Start
fresh" affordance and asserts the full clear contract.  It also
serves as the regression carrier for the broader trust-but-verify
discipline: every state-clearing button gets an end-to-end test
that walks the production routing, not a unit test that pokes the
state directly.

## Scenarios

### Scenario 1 — no autosave, no-op happy path

Setup: DM lands on a campaign URL with no localStorage autosave.
Action: call `dismissResumePrompt()`.
Expected: silently no-ops; no error; no dialog opens; autosave
stays absent.

Why: the surface should be robust to "nothing to clear" — the
user mighte click Start fresh after an idle landing with no
prompt actually staged (race or stray click).

### Scenario 2 — autosave but no live session, confirm clears

Setup: localStorage has a `quire.save.test-fresh-camp` key with a
prior session.  DM lands, `checkResumePrompt` stages the doc.
Action: click "Start fresh" + confirm in the modal.
Expected: autosave key gone; `resumePromptDoc` null.

Why: this is the user's exact carrier — the autosave key MUST
be deleted, otherwise next load just re-stages the same prompt.

### Scenario 3 — live session, peer teardown + autosave clear

Setup: DM hosts a session; appends a chat event; autosave fires.
Stage a resume prompt directly (simulating a multi-step scenario
where the prompt re-fires).
Action: click Start fresh + confirm.
Expected: session controller drops back to mode='solo' /
status='idle' / no peer / no transport.  Autosave cleared.

Why: this is the more general case — a DM has been playing, hits
Start fresh, expects everything to go.  WebRTC teardown must
happen so OTHER peers see this DM drop off their roster too.

### Scenario 4 — Cancel preserves state

Setup: autosave + staged resume prompt.
Action: click Start fresh + Cancel.
Expected: autosave INTACT; staged prompt preserved.

Why: a misclick on Start fresh must not destroy state.  Cancel
is the safe path — full no-op.

### Scenario 5 — prior session's PC does NOT survive (the user's exact observation)

Setup: prior DM creates a `pc-create` event for "Leftover Hero" +
autosaves + closes.  New DM lands; the autosave is staged as a
resume prompt and we sanity-confirm it contains the pc-create.
Action: click Start fresh + confirm.  Start a brand-new session.
Expected: no `pc-create` for `pc-leftover` in the new event log;
no `pcSlots` binding to `pc-leftover`.

Why: this is the carrier the user literally observed.  "i still
see the player that I created earlier" maps to the autosave
event log being replayed into the new session.  Clearing the
autosave key BEFORE the new session hosts means the new session
has no `pc-create` to replay.

### Scenario 6 — stale peer-join does NOT survive

Setup: prior session has a `peer-join` for `OTHER-DM` with no
matching `peer-leave` (force-closed tab).  Autosave + close.
New DM lands; the resume prompt's staged doc contains the stale
peer-join.
Action: Start fresh + confirm.  Host a fresh session.
Expected: no `peer-join` for `OTHER-DM` in the new log; no
matching entry in `peers` materialized state.

Why: this is the user's other observation — "a 'stale' instance
of another dm that appears to be connected in the roster."  The
carrier is the same as Scenario 5: the autosave's event log.
Clearing the autosave defeats the carrier.

### Scenario 7 — chargen drafts cleared

Setup: seed `quire.chargen.test/fresh-camp:slot1` and `:slot3`
directly in localStorage.  Stage an autosave so the resume
prompt fires.
Action: Start fresh + confirm.
Expected: all 9 chargen draft slots cleared.

Why: on a shared dev machine, the chargen drafts can repopulate
a "fresh" session.  The diagnosis doc flagged this for a product
call (decision: clear them; surface in the confirm copy).  See
DEC-036.

### Scenario 8 — cross-device probe Start fresh routes through confirm gate (safe variant)

Setup: stub FsApiCloudPush reports a matching backup file.  DM
lands; the probe surfaces.
Action: click "Start fresh" on the cross-device probe.
Expected: the confirm modal opens with `data-variant=safe` (NOT
destructive).  Confirming dismisses the match; the cloud-side
`pullCampaignFromFolder` is NOT called.

Why: per DEC-015 + §A11, the cross-device "Start fresh" does NOT
mutate the cloud file.  But the button label is identical to the
destructive variant, so confirm both as defense-in-depth — the
user can't tell them apart by reading the label alone.

## What we did NOT cover (and why)

- **Recently-played list entry "remove."**  The list has no
  Start fresh affordance today.  Clicking a recent campaign
  navigates to its URL; the resume prompt is then the
  Start-fresh affordance, covered by Scenarios 2 + 4-7.
- **`<backups-card>` Disconnect.**  Disconnect is folder-scoped,
  NOT a session reset.  Out of scope.
- **`<session-digest>` Discard.**  Pure digest-draft UI; not a
  Start-fresh affordance.  Covered by mock-10 Scenario 4.

## Files

- Test: `src/persistence.simulation-11-start-fresh.test.ts`
- Production: `src/quire-app.ts` (`startFreshForCampaign`,
  `confirmStartFresh`, `dismissResumePrompt`,
  `dismissCrossDeviceProbe`)
- Dialog: `src/ui/regions/start-fresh-confirm-dialog.ts`
- Dialog tests: `src/ui/regions/start-fresh-confirm-dialog.test.ts`

## Lesson reinforced (LL-2)

The pre-fix `dismissResumePrompt` was a single one-line method
(`this.resumePromptDoc = null;`) with a unit test that pinned
exactly that one-line behavior.  The unit test PASSED.  The
production user experience was BROKEN.  This is the same trust-
but-verify pattern as LL-1 (UX-3 false positive in run #14).
Future state-clearing methods must come with an end-to-end mock
that walks production routing, not a unit test that pokes the
internal state.
