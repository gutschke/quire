# Mock Campaign 05 — Cloud push during active play

## Scenario brief

Mid-session: the DM clicks "Push now" in the operational view to
take a backup.  At the same instant:

- Autosave is in flight (scheduled by recent edits + about to fire
  on visibilitychange when the DM accidentally alt-tabs to look up
  a reference document).
- Two players are actively typing and submitting chat messages.
- The DM has the consent dialog open for the first time (they
  never pushed before).

Does the push race with the local autosave?  Does the push body
capture a coherent snapshot or a torn one?  Does the consent dialog
interrupt play unrelated to the dialog?  Can the DM cancel?  Does a
paused-tab DM (sync client offline) gracefully recover when the
network returns?

These are the load-bearing race-condition probes for the M6a-FS
push path.

## Driving approach

**Code-level simulation** at
`src/persistence.simulation-05-cloud-push-during-active-play.test.ts`.
Drives:

- Real `Peer` + `InMemoryNetwork` for the engine layer.
- Real `FsApiCloudPush` orchestrator (the production code path).
- A mock `FileSystemDirectoryHandle` that exposes the same shape as
  the production browser API.
- Direct method calls to simulate the host's handler
  (`handleBackupsPushRequest`); no Lit / UI required.
- `serializeSessionForViewer` + `serializeSession` for the autosave
  and push paths respectively (same shape the host uses).

Why not Playwright: the races are at the engine / orchestrator
layer — Playwright adds noise without testing different code.  The
sync-client offline behavior is the desktop sync tool's
responsibility (Google Drive Desktop / Dropbox); Quire doesn't
control it and tests it by waiting for the file's
`lastModified` to update, which IS testable at the engine layer.

## Per-turn script

### Beat 1-4: pre-session setup

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 1 | DM | `coordinator-claim` + `seat-add` × 2 + `pc-create` × 2 + binds | Standard chargen + bind. |
| 2 | Mei | `peer-rename({pcId:'mei'})` | Mei bound. |
| 3 | Anya | `peer-rename({pcId:'anya'})` | Anya bound. |
| 4 | DM | Open chat: "Session 1 begins." | All see. |

### Beat 5-9: concurrent push + autosave + active play

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 5 | DM | `pushCampaignToFolder({campaignId, body=serializeSession(events,now)})` invoked (kicks off the async chain). | Picker is connected; permission probe succeeds; file open + write + close. |
| 6 | Mei | `chat({text: 'Mei rolls forward.'})` lands DURING the push. | Mei's event is in the log AFTER the push body was serialized — so the push body does NOT include this chat.  Expected; not a bug. |
| 7 | Anya | `chat({text: 'Anya circles.'})` lands after push await. | Same as beat 6. |
| 8 | (Autosave path) | `serializeSessionForViewer(events,now)` builds a separate body for the autosave to localStorage.  Fires CONCURRENTLY with the push. | Both target different surfaces (folder vs localStorage).  Both see consistent snapshots — `events()` is an immutable array view at call time. |
| 9 | DM | Push resolves: `{ok: true, fileName, bytesWritten}` | File contains the snapshot from beat 5 (incl. events 1-4); not the chats from beats 6-7 (they fired after). |

### Beat 10-12: torn-write probe

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 10 | DM | Pull the file → parse → assert it's a valid SaveDocument with the expected events 1-4. | Parse succeeds; events match expectation. |
| 11 | (concurrent peer) | Another peer wrote to the file between beats 5 and 9 (simulated by mock). | Push detects the external write via the lastModified check + bails with `{ok: false, reason: 'conflict'}`. |
| 12 | DM | Pulls latest, merges (engine CRDT path), pushes again → succeeds. | Two-cycle resolves. |

### Beat 13-15: consent dialog mid-session interruption

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 13 | DM | First-time push triggers consent ledger check.  `hasAcknowledged` returns false. | Caller invokes `requestFsApiConsent` → opens the consent dialog. |
| 14 | (during dialog) | Player chat arrives via `share` envelope. | Player's chat lands in the session's event log even while the consent dialog is open.  Verify: chat is materialized; the DM's render shows it after dialog closes. |
| 15 | DM | Clicks "Cancel" on the dialog. | Push is aborted; folder is NOT connected; subsequent events still flow. |

### Beat 16-18: paused-tab DM + offline recovery

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 16 | DM | visibilitychange → 'hidden' fires.  Autosave flushes synchronously to localStorage. | localStorage save updated; durable. |
| 17 | (network offline simulation) | DM's tab "wakes up" but `pushCampaignToFolder` would fail with `write-failure` if the underlying sync client is offline. | Push returns `{ok: false, reason: 'write-failure'}`.  No state mutation. |
| 18 | (network returns) | DM retries push. | Push succeeds; `lastObservedModifiedMs` updates; subsequent pushes don't conflict-bail. |

## Invariants asserted

- **A1 (no torn writes):** The push body is parseable as a valid
  SaveDocument.  No corruption.
- **A2 (snapshot semantics):** The push body equals
  `stringifySave(serializeSession(eventsAtCallTime))` — events
  appended after the call are NOT in the body.
- **A3 (autosave + push independence):** Both fire concurrently
  without interfering with each other or the active session.
- **A4 (chat continues during push):** Player chat events that fire
  during the push are received + materialized correctly + not lost.
- **A5 (consent dialog doesn't pause play):** While the dialog is
  open, share envelopes still deliver to all peers including the
  DM; player chats land in the DM's event log.
- **A6 (cancel doesn't corrupt state):** A cancelled push leaves
  the handle storage in a deterministic state; subsequent pushes
  work.
- **A7 (conflict detection):** External writes to the same file
  between push attempts are detected via `lastObservedModifiedMs`
  comparison; the push bails with `reason: 'conflict'` rather than
  clobbering.
- **A8 (offline recovery):** A failed push leaves no partial state
  in the handle storage; a retry succeeds when the underlying I/O
  succeeds.

## Findings

### FINDING-A (sanity-confirmed)

Snapshot semantics hold.  The push body equals `stringifySave(serializeSession(events))`
at the call instant.  Later events that fire during the I/O await
do NOT back-leak into the body.  This is the load-bearing
invariant for "the push is a point-in-time snapshot."

### FINDING-B (sanity-confirmed)

Autosave + push are independent.  They target different surfaces
(folder vs localStorage) and produce independently valid bodies.
No torn writes.

### FINDING-C (sanity-confirmed)

Conflict detection works — external writes between pushes are
detected via `lastObservedModifiedMs` comparison; the push bails
with `reason: 'conflict'` rather than clobbering.

### FINDING-D (sanity-confirmed)

Offline recovery works.  A failed write does NOT advance the
handle storage baseline; a retry after the underlying I/O recovers
succeeds.  Consistent with the "write happens once or not at all"
contract.

### FINDING-E (new, P2 — first-push orphan-overwrite hole)

**Severity:** P2 (class 2 — accidental disruption between trusted
peers).

**Evidence:** The conflict-check is `if (currentLastModified > record.lastObservedModifiedMs)`.
On the FIRST push after a fresh connect, `record.lastObservedModifiedMs === null`,
so the check short-circuits and the push proceeds.  If the folder
already contains an orphan `<slug>.quire-save.json` from a prior
session (different browser profile, teammate's accidental push,
old export, etc.), the first push silently overwrites it.

**Why it's class 2:** A DM connecting a fresh device to a folder
that has an existing save EXPECTS Quire to either:
  (a) read it first (the §FS.11 cross-device probe handles this
      AFTER it's wired in run #10), OR
  (b) warn before overwriting.

Without (b), the orphan-overwrite is silent data loss for whoever
authored the orphan.

**Mitigation today:** The cross-device probe (§FS.11 shipped this
run) surfaces an existing matching file BEFORE the DM can push
fresh — they see "[Load it] [Start fresh]" and have to choose.
"Start fresh" then leads to a deliberate push that overwrites
intentionally.  So in the §A11 happy path, FINDING-E doesn't fire
in practice.

**Residual hole:** If the DM clicks "Start fresh" and the existing
file is the orphan they DIDN'T want to overwrite (mistake in the
probe prompt), the push fires.  Recovery: the underlying desktop
sync client may have version history (Google Drive Desktop +
Dropbox both do); the runtime doesn't have its own undo.

**Filed:** OP-041 in `open-problems.md`.  Does NOT block playable
release given the probe + cloud-sync-client version history; ideal
fix is a "read-first-or-create" semantic on first push (read the
file's lastModified; if non-null AND we just connected, surface a
"this folder has a save not from this device" confirm prompt).

### FINDING-F (new, P2 — consent dialog can interleave with pull-in-flight)

**Severity:** P2 (class 2 — UX surprise; not a corruption).

**Evidence:** During the consent dialog, share envelopes deliver
to the DM (verified by test 5).  The dialog itself doesn't pause
the network.  Mostly desirable — the players can keep playing
while the DM resolves the dialog.

**The wart:** If the DM has the consent dialog open AND clicks
the resume-prompt's "Load" button (or the cross-device probe's
"Load it"), the dialog and the load can both progress.  Today's
host handlers don't gate the load on dialog state.  This is
narrow (the DM has to deliberately click both); but a future
DM workflow where the dialog is opened by a backups card timer
(not a deliberate click) could interleave more easily.

**Filed:** OP-042 in `open-problems.md`.  Does NOT block playable
release (the DM today can only open the consent dialog via a
deliberate click, so the interleave requires deliberate intent
on both halves).

### FINDING-G (sanity-confirmed)

Paused-tab visibilitychange + push fire concurrently produce
consistent results.  Both bodies parse; both target different
surfaces.  No new finding; documents the existing safety.

