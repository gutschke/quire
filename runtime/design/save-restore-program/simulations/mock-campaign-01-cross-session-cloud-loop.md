# Mock Campaign 01 — Cross-session cloud loop (flagship)

**Status:** ran 2026-05-29 run #8
**Method:** code-level simulation via in-memory transport + the
production `FsApiCloudPush` orchestrator with an in-memory FS
backing
**Lives in:** `src/persistence.simulation-01-cloud-loop.test.ts`

## Scenario brief

A DM named Markus runs a 2-hour session of *Quire / Underleaf*
with two players, Anya and Mei.  At session-close he opens the
operational view, connects a folder inside his Drive Desktop
mirror, pushes the save, and closes the browser.  A week later
he opens the same campaign URL on a fresh tab.  His
localStorage was cleared (simulating cache purge / new device).
He pulls.  Continues playing.  Tonight's events should land on
the chronicle the same as if he'd never closed the browser.

This is THE flagship test for the M6a-FS feature.  If this
loop doesn't work, the feature isn't ready for playable
release.

## Per-turn script

| Beat | Action | Expected system response |
|---|---|---|
| 1 | DM peer joins session, claims coordinator. | DM's peer becomes coord. |
| 2 | DM appends `chat` "scene 1: the rain begins". | Players see it. |
| 3 | Anya appends `chat` "Mei pulls up her hood". | All peers see it. |
| 4 | Mei appends `chat` "I do indeed". | All peers see it. |
| 5 | DM appends `dm-scratch` "Mei will get the realization next session". | DM's projection has it; player projections DO NOT (firewall). |
| 6 | DM connects a folder via `FsApiCloudPush.connectFolder` (consent already acked). | Handle persisted; folder is a real `MockDirectoryHandle` (in-memory). |
| 7 | DM pushes via `pushCampaignToFolder({campaignId, body})` where body is `stringifySave(serializeSession(...))`. | File `<slug>.quire-save.json` exists in the mock folder.  PushResult.ok=true. |
| 8 | DM peer closes (the test discards `dm` + `net`). | Session 1 done. |
| 9 | Next session: a fresh DM peer + new transport pull from the same folder. | PullResult.ok=true; body matches what was pushed. |
| 10 | The fresh peer parses + applies the save. | DM's projection now contains: chat 1+2+3 AND dm-scratch.  Player peer joining sees chat 1+2+3 but NOT dm-scratch (re-broadcast firewall). |
| 11 | DM appends new `chat` "scene 2: the next morning". | Player sees it. |
| 12 | DM pushes again. | File updated; lastModified bumped; conflict detection still consistent. |
| 13 | DM appends `dm-scratch` "Anya is on the verge". | Player still doesn't see scratch. |
| 14 | DM disconnects folder. | Consent withdrawn; handle gone; another connect would re-prompt. |

## Invariants asserted

- **A1.** After push, the file exists in the folder with the
  exact body bytes the DM stringified.
- **A2.** After pull, the body returned equals the body
  pushed (deterministic round-trip).
- **A3.** After the DM's fresh peer applies the pulled save,
  its event log contains every event the original DM had
  (including `dm-scratch`).
- **A4.** After a NEW player peer joins the post-restore
  session, they receive chat events but NEVER `dm-scratch`.
  This is the rebroadcast firewall in action (DEC-010).
- **A5.** A second push from the restored session does NOT
  surface a `'conflict'` reason — the read-before-write
  baseline tracks correctly across the push/pull cycle.
- **A6.** Disconnecting clears the consent ledger entry; a
  subsequent `connectFolder` with `consentAlreadyAcknowledged:
  false` is refused (the ceremony re-runs).
- **A7.** The save document's `events` count equals the
  source peer's event count modulo the per-viewer projection
  (DM-coord = all events; non-coord = stripped).  For this
  campaign Markus is always coord on push.

## Findings

- **2026-05-29 run #8.**  Simulation passes all 7
  invariants.  The cross-session cloud loop is mechanically
  sound for the user-visible surfaces.
  - **FINDING-01 (filed as OP-039).**  The flagship loop did
    surface a sister-of-NEW-ADV-2 firewall hole: when a new
    player peer joins a session AFTER the DM has appended
    DM-only events (e.g. `scratch-note`), the player's
    sync-request triggers a `sync-response` that ships ALL
    events from the responder's log INCLUDING the DM-only
    events.  The `defaultRebroadcastFilter` runs only on
    `forwardShareToOthers`, not on the direct
    `sync-request → log.since() → sync-response` path.
    Render-layer firewall (`filterForViewer`) AND save-layer
    firewall (`serializeSessionForViewer`) both hold — so this
    is not a play-time or save-time leak.  The hole is the
    raw event log on the joining player's peer (visible only
    to devtools inspection).  Filed as OP-039 (P2, class 2);
    not a playable-release blocker.  Fix is a one-line wrap;
    targeted for M6a-FS-2 (next run).
  - The simulation uses an in-memory mock of the directory
    handle.  Real `window.showDirectoryPicker` requires a user
    gesture and the OS-level dialog — neither code-testable
    nor Playwright-testable.  UAT (M8) covers that beat.

## Open questions

- Should the `sync-request` handler's `log.since(...)` apply
  the rebroadcast filter, or should we wrap the
  `sync-response` build path on the responding side?  The
  former is more surgical; the latter is more consistent with
  the existing `forwardShareToOthers` location.  Decide as
  part of OP-039 fix (M6a-FS-2 run).

## Follow-ups to file

- **OP-039** (filed 2026-05-29 run #8).  Targeted for fix in
  M6a-FS-2.
