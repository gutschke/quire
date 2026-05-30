# Mock Campaign 12 — Player ghost + recast (run #18)

**Date:** 2026-05-30 (run #18)
**Test file:** `src/persistence.simulation-12-revoke-and-recast.test.ts`
**Status:** SHIPPED (7 scenarios; all GREEN)
**Driver:** TTRPG-expert player-removal advisory at
`runtime/design/playtest-readiness/review-history/ttrpg-expert-player-removal-2026-05-30.md`
**DECs:** DEC-039 (two SlotStates) + DEC-040 (existing-NPC reassign)
+ DEC-041 (magic-log clear) + DEC-042 (no `pc-revoke-request` in v1)
+ DEC-043 (`pc-revoke` engine primitive) + DEC-044 (DM operational
view surface).

## Why this mock exists

The product owner asked for "the ability to clearly wipe out a
player as if they had never been there" + "keep the PC1 slot in the
story but completely re-create the character because the player is
unhappy with how their character worked out... a little bit of
creative retconning by the DM can often fix things, if the game
engine allows it."

Run #18 ships:
- `pc-revoke` engine primitive (DEC-043) — coord-only, one atomic
  event, distinct from `pc-retire` / `pc-archive` (which preserve
  the PC as a referenced narrative entity).
- New `revoked` SlotState (sticky-N preserved).
- DM operational view "Manage seats" section (DEC-044) — per-seat
  "Manage seat ▾" disclosure with "Reset character (recast)…" +
  "Remove player from this seat…" destructive options behind the
  run-#17 two-step confirm idiom.
- This mock as the LL-1/LL-2/LL-3 end-to-end carrier: every
  scenario drives through the production code path (engine event
  → materializer → save-layer firewall → restore-side materializer
  OR Lit click handler → host bridge → engine event), NEVER a
  test-side state-poke.

## Scenarios

### Scenario A1 — never-arrived wipes the PC from both projections

Three PCs at the table.  PC2's player vanishes pre-fiction; DM
revokes with `never-arrived` + a stand-in name.  Asserts:
- DM projection: `synthesizedPcs[pcId]` deleted, seat enters
  `revoked`, sticky-N preserved for slots 1 + 3.
- Inbound bonds (Mei → PC2) are tombstoned with the DM-supplied
  stand-in name on Mei's bond list.
- Outbound bonds (PC2 → others) dropped entirely (no source PC
  left to render under).
- Player projection (Kasumi, who didn't author Mei's bond) sees
  the SAME tombstone, no leaked DM-only metadata.

### Scenario A2 — chat is ink, not pencil (Q4 expert advisory)

Yui logs a chat line BEFORE the revoke.  After save → parse round-
trip, the chat event survives BYTE-IDENTICAL with the byline
preserved.  No log rewriting — the table's memory is intact.

### Scenario B1 — recast: same slot, new PC, fresh state

PC1 player + DM agree to recast.  The OLD PC has accumulated
magic-discovery state (`pcAccidentalGrants`).  After `pc-revoke`
(`recast`) + follow-up `pc-create` + `pc-slot-bind` to the SAME
slot:
- Slot 1 carries the NEW PC; sticky-N preserved.
- OLD PC's `synthesizedPcs` entry is gone.
- OLD PC's magic-discovery log is wiped per DEC-041 (the new PC
  starts at zero accidental casts).
- NEW PC has NO inherited per-PC state.

### Scenario B2 — recast preserves inbound bond as tombstone

Aiko has a bond TO Yui ("I owe them my life").  After Yui's
recast with a DM-supplied stand-in name ("someone they trusted"),
the bond on Aiko's sheet reads as a tombstone — the renderer can
show "someone they trusted" instead of looking up the deleted
`synthesizedPcs[pc-recast]`.

### Scenario C1 — END-TO-END production click path through QuireApp

This is the LL-1/2/3 carrier.  Mount a real `QuireApp` Lit
element, build a two-PC session, flip to `appMode='dm-operational'`,
click the "Manage seat ▾" toggle for slot 2, click "Remove
player from this seat", flip the dialog to `never-arrived`,
click Confirm.  Then assert the ENGINE STATE:
- The session log carries exactly one new `pc-revoke` event with
  the right pcId + slot + narrativeShape.
- The materialized state shows slot 2 in `revoked` +
  `synthesizedPcs['pc-vanish']` undefined.
- Sticky-N preserved at slot 1.

This is the scenario that closes the click-→-event chain through
real Lit reconciliation — the same shape as mock-11's production-
path discipline.

### Scenario D1 — firewall: DM-only sub-fields stripped from player save

Serialize the post-revoke state for a player viewer via
`serializeSessionForViewer`.  Asserts:
- DM-side save (coord projection) retains `narrativeShape` +
  `causedByPeerId`.
- Player-side save STRIPS both DM-only sub-fields.
- The event itself survives in the player's projection so the
  player's seat state stays consistent with the DM's (slot
  enters `revoked`).
- `pcId` + `slot` survive (needed for the materializer to find
  the seat).

### Scenario E1 — silent-player firewall: no system-inserted notification

After a revoke, the player's filtered chat log is identical to
pre-revoke.  No "Mei was removed" event, no system message, no
toast.  The change is experienced as fiction shifting under the
player, the way fiction always shifts (per Q3 + Q10 expert
advisory + locked `silent-player-firewall` memory entry).

## How this mock differs from prior mocks

- **Mock-02 / 06 / 07** operate at the engine altitude only (Peer +
  InMemoryNetwork).  Mock-12 adds the Lit-app altitude in C1 to
  close the LL-1/2/3 gap.
- **Mock-11** operates at the Lit-app altitude only.  Mock-12 keeps
  the engine-altitude scenarios for fast feedback on the engine
  invariants while reserving C1 for the production click path.

## Cross-references

- TTRPG expert advisory (the design spec):
  `runtime/design/playtest-readiness/review-history/ttrpg-expert-player-removal-2026-05-30.md`
- DEC-043 (`pc-revoke` event):
  `runtime/design/save-restore-program/decisions.md`
- DEC-044 (DM operational view surface): same file
- `state.ts` materializer: `applyPcRevokeEvent` (search the file
  for the line number — likely ~3195).
- UI host bridge: `appendPcRevoke` + `handlePcRevokeRequest` +
  `buildManageSeatRows` in `src/quire-app.ts`.
- DM operational view UI region: `src/ui/regions/dm-operational-view.ts`
  (Manage seats section) + `src/ui/regions/pc-revoke-confirm-dialog.ts`.
