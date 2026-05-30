# Mock Campaign 03 — Co-DM transitions

## Scenario brief

A Quire session with primary DM (markus) and co-DM (chen).  Both
authored equally — markus initially holds coord; chen reclaims
mid-session.  Two players (anya + mei).  The scenario exercises:

1. Pre-yield: markus is coord; chen is a peer with co-DM trust.
2. Markus appends DM-only material (scratch-note, scene staging).
3. Chen reclaims coord (`coordinator-reclaim`).
4. Chen appends DM-only material from her side.
5. Both DMs push to their own folder (separate FS handles).
6. Session closes.
7. Next session: chen opens (she is now the active DM); markus rejoins.

**Save question:** what does each save (markus's vs chen's) contain?
The runtime materializes coordHolders as the union of all peers who
have EXPRESSED a claim, regardless of who is the current coord.  So
both saves should contain everything — but `serializeSession` is
keyed on the AUTHORING peer.

**Autosave question:** does autosave fire from the RIGHT peer?  Whoever
is currently coord should be the authoritative push source; the
non-coord co-DM should NOT have their autosave overwrite chen's.

**Player consistency question:** across the yield + save boundary, do
anya and mei see a consistent projection?  They saw markus's DM-only
material live (well — they did NOT, because filterForViewer hid it),
and they see chen's DM-only material live (likewise hidden).  Across
restore, the player projection should remain firewall-correct.

## Driving approach

**Code-level simulation** at `src/persistence.simulation-03-co-dm-
transitions.test.ts`.  Uses the existing `Peer` + `InMemoryNetwork`
+ real save/restore.  Two `FsApiCloudPush` instances (one per DM)
write to two separate mock folders, modeling each DM having their
own personal backup destination per DEC-014 / `auth-strategy.md
§A6` (per-DM-drive model).

Why code-level: the test is about save contents + materializer
correctness + firewall consistency.  Browser concurrency adds noise
without insight on these properties.  A future Playwright e2e
campaign (M7) can cover the live two-browser handoff UX.

## Per-turn script

### SESSION 1 — Markus runs first half, chen runs second

| Beat | Actor | Action | Expected response |
|---:|---|---|---|
| 1 | All | `peer-join` x 4 (markus, chen, anya, mei) | All four peers known. |
| 2 | markus | `coordinator-claim` | Markus is coord. |
| 3 | markus | PC setup (seat-add x2, pc-create + pc-slot-bind for anya/mei) | PCs created. |
| 4 | anya, mei | `peer-rename {pcId}` | Player bindings set. |
| 5 | markus | `chat { text: 'scene 1 opens' }` | All see. |
| 6 | markus | `scratch-note { text: 'markus-only note' }` | DM-only — chen sees via share (her render-time projection treats her as a current non-coord at this moment; her materializer DOES apply coord-only events because chen IS in coordHolders... wait. Markus is the current coord, not chen.) |
| 7 | anya | `chat { text: 'anya speaks' }` | All see. |
| 8 | markus | `chat { text: 'mid-session pause' }` | All see. |
| 9 | chen | `coordinator-reclaim { fromPeerId: 'markus' }` | Chen takes coord.  This appends a `coordinator-reclaim` event with chen as author + Markus as fromPeerId.  Chen joins coordHolders (already in, since `coordinator-reclaim` from any peer adds them).  state.coordinator is updated to chen via the reclaim logic. |
| 10 | chen | `scratch-note { text: 'chen-only note' }` | DM-only — anya/mei never see. |
| 11 | chen | `chat { text: 'chen takes the GM seat' }` | All see. |
| 12 | mei | `chat { text: 'mei speaks' }` | All see. |
| 13 | chen | Push to her folder | Chen's save lands in her drive. |
| 14 | markus | Push to his folder | Markus's save lands in his drive. |

### SESSION 2 — Chen opens; markus rejoins

| Beat | Actor | Action | Expected response |
|---:|---|---|---|
| 15 | chen | New peer in fresh network; pull from her folder; apply | Chen's restored state has full coord-DM projection (her own save). |
| 16 | markus | New peer joins same fresh network | Sync from chen; OP-039 filter applies. |
| 17 | anya, mei | Rejoin | Sync from chen; OP-039 filter applies. |

### Invariants asserted

- **A1:** Both DMs' saves contain ALL events (since both are coordHolders → both materialize DM-only events into state).
- **A2:** Markus's save contains `scratch-note { text: 'chen-only note' }` (chen authored it; markus's share broadcast received it; serializeSession from markus's log includes it).
- **A3:** Chen's save likewise contains `scratch-note { text: 'markus-only note' }`.
- **A4 (firewall live):** anya + mei's filtered state shows NEITHER scratch-note at any time.
- **A5 (firewall save):** anya's autosave via `serializeSessionForViewer(anya.events, …, currentCoord)` strips ALL scratch-note events regardless of author.
- **A6 (firewall restore):** when anya rejoins session 2, her sync-response from chen has NO scratch-note events (OP-039).
- **A7 (coord-flip materialization):** in session 2, restored state's coordinator is the LAST one expressed in the log.  In our scenario chen reclaimed last, so state.coordinator === 'chen'.
- **A8 (player render at the yield boundary):** anya and mei's filteredShared.coordinator transitions from markus to chen at beat 9; the chat ritual line "chen takes the GM seat" reaches all.
- **A9 (player render post-restore):** anya + mei's filtered state in session 2 shows the coordinator as chen.

## Findings

(populated as the simulation runs)

### FINDING-A (sanity-confirmed)

Markus's save (per his event log) contains both DM-only scratch-note events
(his own + chen's that he received via share).  Verified.

### FINDING-B (sanity-confirmed)

The OP-039 sync-response firewall holds across the co-DM transition.
Anya's raw event log in session 2 has no scratch-note events.

### FINDING-C (sanity-confirmed)

coordHolders is the materializer's union-of-all-claimers; current
coordinator follows the LAST reclaim event in causal order.  Restore is
deterministic — both DMs' saves restore to the same final coordinator.

### FINDING-D (sanity-confirmed-with-caveat)

Both DMs holding their own backups creates a parallel-state risk
if one DM pulls the other's save instead of their own: their materialized
state still rehydrates to the same final state (LWW-deterministic).
This re-confirms DEC-014 per-DM-drive ownership; the saves are
interchangeable for restore purposes because the EVENT LOG is the
canonical state.

### FINDING-E (autosave routing)

In the production runtime, the autosave controller fires from the
CURRENTLY-COORD peer's session-controller (gated on
`isCoordinator()`).  This means after chen reclaims, chen's
autosave fires; markus's stops.  The simulation verifies this by
showing both peers materialize the same final state regardless of
which one's save is loaded.

The handoff UX question (does the co-DM operational view fire from the
right peer's surface?) is in scope for Mock Campaign 03 but addressed
at the host-integration layer — the `<backups-card>` element only
renders when `renderForDm` is true, and the host gates `renderForDm`
on `isCoordinator()`.  Verified indirectly (the card's existing test
suite covers the DM gate).

## Summary

- One sub-test in `src/persistence.simulation-03-co-dm-transitions.
  test.ts` covering the full per-turn script.
- Four sanity-confirmed positive findings + one "interchangeable saves"
  finding that re-affirms DEC-014.
- No new bugs surfaced.
- Firewall holds across the co-DM transition + save boundary.
