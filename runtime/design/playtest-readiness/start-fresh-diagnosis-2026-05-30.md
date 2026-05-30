# Start fresh — diagnosis (run #17, 2026-05-30)

The product owner ran a dry-run TODAY and surfaced a P0:

1. Clicking "Start fresh" doesn't ask for confirmation.  A DM can
   accidentally blow away months of progress in one click.
2. After clicking "Start fresh," the DM still saw a PC they had
   created earlier AND a stale peer entry for another DM in the
   roster.  In other words: state isn't actually cleared.

This document walks every "Start fresh" / dismissal affordance in
the runtime and pins (a) where it's triggered, (b) what it does
today, (c) what it FAILS to clear.

---

## Surface inventory

There are two affordances literally labelled "Start fresh":

| # | Surface | Triggered from | Renderer |
|---|---------|----------------|----------|
| S1 | Resume-prompt "Start fresh" | Landing on a campaign that has a localStorage autosave (`quire.save.<owner>-<repo>`) | `renderResumePrompt()` in `src/quire-app.ts:6262` |
| S2 | Cross-device probe "Start fresh" | Landing on a campaign with NO local autosave + a folder is connected AND it has a `<slug>.quire-save.json` matching | `renderCrossDeviceProbePrompt()` in `src/quire-app.ts:6219` |

Adjacent dismissal-shaped affordances that DO NOT claim to "start
fresh" but are worth pinning in this audit (none turn out to have
the same bug, but the audit is the right altitude):

| # | Surface | Effect | Bug? |
|---|---------|--------|------|
| A1 | Recently-played list entries | Navigate to the campaign URL.  No clear affordance. | No — clicking a recent campaign navigates to it, then the resume-prompt fires.  No state-mutation on this surface. |
| A2 | `<backups-card>` Disconnect | Calls `cloudPush.disconnectFolder`.  Withdraws consent acknowledgment for `fs-api`.  Doesn't claim "fresh." | No — Disconnect is folder-scoped, NOT a session reset. |
| A3 | `<session-digest>` Discard | Clears the digest draft only.  Pure UI-state, not session-state. | No — scoped to the digest draft. |
| A4 | `leaveSession()` / `announceLeaveAndExit()` | Tears down the WebRTC session, fires `peer-leave`, flushes autosave, returns to home idle.  Used by SPA home-route navigation. | No — this is the CORRECT teardown path, and it correctly preserves the autosave (the DM may want to resume later).  But the autosave preservation is exactly why the resume-prompt then shows up on the next landing. |

So the user-reported bug is concentrated on **S1 + S2**.

---

## What each surface clears today (and what it doesn't)

### S1 — Resume-prompt "Start fresh" (`dismissResumePrompt`)

```ts
dismissResumePrompt(): void {
  this.resumePromptDoc = null;
}
```

That's the full implementation.  It clears the staged
`resumePromptDoc` so the prompt vanishes — and **does nothing
else.**  The underlying `quire.save.<owner>-<repo>` key in
localStorage is **untouched**.

Consequences:
- Reload the page → `checkResumePrompt()` runs → finds the same
  autosave → re-stages the same prompt → "Start fresh" was a no-op.
- If the DM then clicks "Resume" anyway (or hosts a session and
  triggers replay via `startHosting`), the prior campaign's events
  apply — bringing back the player PC the DM thought they had
  discarded.

### S2 — Cross-device probe "Start fresh" (`dismissCrossDeviceProbe`)

```ts
dismissCrossDeviceProbe(): void {
  this.crossDeviceProbeMatch = null;
  try { this.getCrossDeviceProbe().dismiss(); } catch {}
}
```

Clears the staged match + closes the controller's once-per-landing
guard.  The folder's save file is intentionally NOT mutated (per
DEC-015 / §A11 "Start fresh leaves the backup alone; you can load
it later").  That's CORRECT — for a cross-device probe, the
backup is the SOURCE OF TRUTH from the other device.

But this surface also doesn't address the user-reported bug at
all, because in the bug scenario:
- The DM is on the SAME device they played on before.
- The local autosave is the carrier of the PC + roster state.
- The DM clicks the resume-prompt "Start fresh" (S1), not the
  cross-device "Start fresh" (S2).

S2's behavior is fine as-is for its intended cross-device flow.
The fix for S1 must NOT clobber S2's "leave the cloud copy alone"
semantics.

---

## What "true Start fresh" needs to clear (S1)

Walking the six categories from the run-#17 mandate against the
production code:

| # | Category | Carrier | Current behavior on S1 | Fix needed |
|---|----------|---------|------------------------|------------|
| C1 | localStorage autosave | `quire.save.<owner>-<repo>` (per `AutosaveController`) | Not cleared | **Remove the key.** |
| C2 | In-memory session state | `this.session`, `this.sessionView`, `this.resumePromptDoc`, `this.loadedExtraFields`, `this.pcCharacterCache`, `this.playerLastSeenDigestTsInMemory` | Only `resumePromptDoc` cleared.  In the bug scenario `this.session` is null (the DM hasn't clicked "Resume" yet) so this is mostly fine — but if a live session has somehow started (e.g. autoplay flow / chargen warmup), it stays. | **Reset all of them through `leaveSession()` semantics.**  Cheap; the existing leave path already covers this. |
| C3 | WebRTC peer connections + stale roster | `this.session?.peer` + the in-flight transport | `session.leave()` calls `peer.close()` which closes the transport.  But `dismissResumePrompt` doesn't call `leaveSession`. | **Call `announceLeaveAndExit()` if a session is active.**  Fires `peer-leave` so OTHER peers see this DM disconnect; closes the transport on this side. |
| C4 | `loadedExtraFields` carrier | `this.loadedExtraFields` (per DEC-031) | Not cleared on S1 (only on cross-campaign navigation + clean leaveSession) | **Clear it.** |
| C5 | chargen-persistence drafts | `quire.chargen.<slug>:slot<N>` for slots 1..9 | Not cleared | **Decision needed.**  The mandate flags this as "verify the semantics — should Start fresh wipe these too or only the running session?" |
| C6 | Cross-device probe seen-marker | The probe controller has an IN-MEMORY `guard` field, NOT a localStorage seen-marker.  Re-checked in run #17. | Cleared on cross-campaign navigation; would NOT survive a tab close anyway since it's in-memory only.  No persistent seen-marker exists. | **No-op.**  Verified the probe is in-memory only. |

### Product call on C5 (chargen drafts)

The mandate explicitly flags this for a product call.  My
recommendation: **wipe per-slot chargen drafts on the DM's
"Start fresh."**  Rationale:

- The user's bug observation was "I still see the player that I
  created earlier."  A player PC the DM created in a prior session
  reaches the DM's view via two carriers:
  1. The autosave event log (which carries the player's
     `pc-create` event after the DM accepted the chargen pack).
     C1 handles this.
  2. The chargen draft, which is keyed by SLOT and lives on the
     SAME browser-origin.  If the same physical machine plays both
     DM and player roles during the dry-run (very common during
     solo testing!), the chargen drafts will repopulate the seat
     on a fresh session.
- "Start fresh" from the DM's perspective means "wipe the campaign
  state on this machine."  Surprise-preserving chargen drafts
  defeats that intent.
- Counter-argument: a real player on a real device shouldn't lose
  their half-completed chargen because their DM clicked Start
  fresh on the DM device.  But on a SHARED-machine dry-run, the
  drafts are the DM's to clear.  The "Start fresh" confirm modal
  can name this explicitly.

Decision: clear chargen drafts for all slots on this campaign
when "Start fresh" fires (S1 path).  Surface in the confirm modal
copy so the DM isn't surprised.  This is the lower-risk default
for the playtest (where the dry-run involved a single human
playing both DM and player roles).

I'm filing this in the report as a product call needing human
confirmation if they want different semantics.

---

## Is the bug present in multiple surfaces?

- **S1 (resume-prompt "Start fresh"):** YES — this is the bug
  the product owner hit.
- **S2 (cross-device probe "Start fresh"):** NO — correctly
  no-ops on the cloud file (by design per DEC-015).  However, the
  current S2 implementation does NOT clear the local autosave
  either.  In a scenario where a DM has BOTH a local autosave AND
  a folder-connected match (unusual since the probe gates on
  no-local-autosave, but plausible across reloads), the probe
  prompt wouldn't even surface.  So S2 is not the bug in practice.

In short: **the bug is concentrated on S1.**  S2 is
defense-in-depth-clean.

---

## What about the confirmation gate?

Both surfaces currently fire the destructive action on a single
click.  Per the mandate, BOTH need a two-step confirm — even S2,
because a DM who clicks "Start fresh" on the cross-device probe
on a SECOND device when their REAL device has the canonical save
could be confused into clicking S1 next.  Defense-in-depth: the
modal lives in front of EVERY "Start fresh" affordance, even the
ones that are non-destructive (S2), because the user can't tell
them apart by reading the button label alone.

Two-step shape:
- Click "Start fresh" → modal with:
  - Title: "Start fresh for [Campaign name]?"
  - Body: lists exactly what will be discarded:
    - "Your saved session for this campaign will be discarded.
      That includes [N] events covering [X PCs / Y scenes /
      session notes]."
    - "Players who reconnect will see an empty session."
    - "Cloud backups in connected folders are NOT touched.  You
      can re-pull from the cloud later."
  - Action buttons: `[Cancel]` (default-focused) and
    `[Discard saved session]` (destructive, requires explicit
    click).
- Escape / backdrop click both resolve as Cancel.

For S2 specifically the modal body changes slightly:
- "This dismisses the cross-device backup prompt.  Your local
  session stays empty until you connect a folder or open this
  campaign URL on the device that holds the save."

---

## The peer-teardown story

The product owner specifically observed: "a 'stale' instance of
another dm that appears to be connected in the roster and that i
need to remove."

Walking the code: a peer entry in the roster reflects the live
event log's `peer-join` event (sans matching `peer-leave`).  Two
ways a stale peer entry persists across what should be a "fresh"
session:

1. **The prior session's autosave contains the prior coord's
   `peer-join` event** (no matching `peer-leave` if the prior DM
   force-closed the tab).  On restore, the materializer sees the
   live peer.  This is the carrier in the user-reported bug:
   `dismissResumePrompt` doesn't clear C1 (autosave), so the
   stale `peer-join` survives.
2. **Live WebRTC connections are still open** to the prior DM's
   peer.  This requires the prior DM to actually still be live on
   the wire, which doesn't match "I started fresh on the same
   device" — but it CAN happen if the DM is testing on two tabs
   side-by-side.

The fix for category C3 (call `announceLeaveAndExit()` if a
session is active when Start fresh fires) handles #2.  C1
handles #1.

Net: clearing the autosave KEY is necessary and sufficient for
the user's specific observation.  Calling
`announceLeaveAndExit` is needed for the more general case.  The
orchestrator method should do both.

---

## Implementation shape (next phase)

Single orchestrator method `startFresh(campaignSlug)`:

```ts
private async startFresh(source: CampaignRef): Promise<void> {
  // 1. Tear down live session + announce peer-leave to remaining
  //    peers (no-op when no session).
  if (this.sessionView?.status === 'active') {
    this.announceLeaveAndExit();
  } else {
    // Even without a live session, clear adjacent in-memory state.
    this.leaveSession();
  }

  // 2. Clear the localStorage autosave key for this campaign.
  try {
    window.localStorage?.removeItem(
      `${SAVE_STORAGE_PREFIX}${source.owner}-${source.repo}`
    );
  } catch { /* sandbox */ }

  // 3. Clear chargen drafts for this campaign (all slots).
  const slug = `${source.owner}/${source.repo}`;
  for (let slot = 1; slot <= 9; slot++) {
    clearChargenState(slug, slot);
  }

  // 4. Drop staged prompts so neither surface re-fires
  //    immediately on the next render.
  this.resumePromptDoc = null;
  this.crossDeviceProbeMatch = null;
  this.loadedExtraFields = undefined;

  // 5. Best-effort: reset cross-device probe guard so the next
  //    landing on this campaign re-probes (if a folder is
  //    connected, the prompt re-surfaces — also intentional).
  this._crossDeviceProbe?.reset();
}
```

Both S1 and S2 buttons route through `confirmStartFresh()` which:
1. Opens the modal.
2. On Cancel → `Promise.resolve()` (no state change).
3. On Discard → `startFresh(...)`.

The confirmation modal is a host-owned Lit region (analogous to
`<cloud-push-consent-dialog>`).  Reuse the existing dialog
infrastructure where possible.

---

## Files in scope for the fix

- `src/quire-app.ts` — confirm modal, `startFresh()` orchestrator,
  button rewiring.
- `src/ui/regions/start-fresh-confirm-dialog.ts` (NEW) — Lit
  region for the confirm modal.  Mirrors
  `cloud-push-consent-dialog.ts` shape.
- `src/persistence.simulation-11-start-fresh.test.ts` (NEW) —
  mock campaign 11 covering all six scenarios from the mandate.

No changes needed to `AutosaveController`, `CrossDeviceProbeController`,
or the recently-played list.

---

## What this diagnosis missed in the v3 consultant pass

The trust-but-verify lesson (LL-2): the v3 adversarial consultant
walked the cross-device probe + the cross-campaign drift paths
extensively, but did NOT walk the resume-prompt "Start fresh"
button.  The single-line `dismissResumePrompt()` reads as
"obvious dismissal handler" and the test that pins it
(`quire-app.cross-device-probe.test.ts:213` asserts it nulls the
match) confirms the local behavior — but neither test nor
consultant walked the end-to-end production loop of "click Start
fresh → reload page → verify empty state."

The fix to LL-2 is captured in `lessons-learned.md`.
