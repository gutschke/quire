# Mock Campaign 08 — DM write-up phase (bridge between sessions)

**Run:** #13 (2026-05-30)
**Code path:** `src/persistence.simulation-08-dm-writeup-phase.test.ts`

## Scenario brief

A 3-hour Quire session has just ended. The DM wraps the
table. Before next week, the DM writes (or AI-drafts and
edits) a session-digest entry — a player-facing markdown
recap that captures what happened and points to threads
worth following next time. This digest is the bridge
between sessions: it appears in every player's filtered
state, it informs the next session's AI context, and it
must survive every save/restore loop the playtest exercises.

The human's verbatim concern (run #13 mandate):

> after the first game session has completed, the dm
> will write up what happened during the campaign, and
> that will help guide authoring the next chapter for the
> following week. take a very close look at this phase
> of the game and make sure it works as intended.

## Driving approach

Code-level simulation via the existing in-memory
transport pattern (sim-01 through sim-07). The simulation
walks the digest authorship lifecycle through every
documented save/restore surface and asserts the
invariants.

## Per-turn script

### Scene 1 — Session-end digest authorship

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 1 | DM (markus) | Plays a full session (chat + chargen ratify + scene reveal + advancement chip + scratch-note) | events land in shared log |
| 2 | DM | Authors `session-digest` event with a 1KB markdown recap | digest lands in `state.sessionDigests`; one entry |
| 3 | Player (anya) | Materializes own filtered state | digest appears in filtered state (player-visible by design — `EVENT_KINDS_PLAYER_VISIBLE`) |

### Scene 2 — Save/restore round-trip

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 4 | DM | Saves coord-projection to disk | save JSON contains the session-digest event |
| 5 | Fresh DM peer | Loads the save via `parseSaveDocument` + `applySaveToLog` + `materialize` | digest is in `state.sessionDigests`; markdown bytes identical |
| 6 | Player | Re-loads via `projectSaveForViewer(doc, viewerIsCoord=false)` + materialize | digest is in `filterForViewer` projection |
| 7 | Both | Re-stringify | byte-identical to step 4 (modulo savedAt) |

### Scene 3 — Co-DM authorship of next-session digest

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 8 | DM (markus) | Reclaims coord | coord = markus |
| 9 | Co-DM (chen) | Authors a digest event (also coord per OOR) | event is REJECTED at materializer (only `coordHolders` can author per `applySessionDigestEvent`) — verifies the gate |
| 10 | DM (markus) | Yields coord to chen | coord = chen; markus now in `coordHolders` set |
| 11 | Co-DM (chen) | Authors a digest event | event lands; `state.sessionDigests` now has 2 entries |

### Scene 4 — Forward-compat with future digest field

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 12 | Future runtime | Authors digest with a `summaryTokens` future-only field | today's materializer reads the markdown but ignores the future field |
| 13 | DM | Saves, restores | the future field SURVIVES the round-trip (INV-2) |

### Scene 5 — Digest invalid-input boundaries

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 14 | DM | Authors `session-digest` with empty markdown | event materializer rejects (no `state.sessionDigests` change) |
| 15 | DM | Authors `session-digest` with > 20_000 char markdown | event materializer rejects (cap per `SESSION_DIGEST_MAX_MARKDOWN`) |
| 16 | DM | Authors `session-digest` with non-string markdown | event materializer rejects |

### Scene 6 — Network partition during digest authorship

| Beat | Actor | Action | Expected |
|---|---|---|---|
| 17 | DM | Partitioned from players; authors digest | DM's local log has the digest |
| 18 | Player | Rejoins via sync-response | digest event reaches player (session-digest is NOT in `PLAYER_SCOPE_STRIP_KINDS`) |
| 19 | Both | Materialize | both have the digest |

## Findings

### FINDING-A (sanity-confirmed): digest lifecycle works as designed

The `session-digest` event applies cleanly through the
canonical event lifecycle. Coord-only authorship gate at
the materializer (`applySessionDigestEvent` rejects events
whose `peerId` is not in `coordHolders`) holds. Markdown
size cap holds. Empty markdown rejected.

### FINDING-B (sanity-confirmed): player-visible projection

The digest reaches the player's filtered state via the
SAVE LAYER, the LIVE LAYER, and the SYNC-RESPONSE LAYER.
This is intentional — the digest IS the player-facing
recap.

### FINDING-C (sanity-confirmed): forward-compat survives

A future-runtime-authored digest with an unknown
`summaryTokens` sub-field round-trips through today's
runtime. Today's materializer ignores the unknown field
(no break). Saving the doc preserves the field for a
future-runtime reader.

### FINDING-D (architectural-note, no action): digest authorship vs. AI suggestion

The current flow lets the DM author the digest body
manually OR receive an AI-drafted suggestion (via
`generateSessionDigest`). The AI-drafted suggestion goes
through `appendSessionDigest` after DM review — this is
the locked "DM owns fit" division. No mock-campaign
finding here; flagged for the TTRPG/UX consultant brief
to verify the surface IA.

### FINDING-E (DEFERRED, not a P0/P1 for playtest): digest reaches AI context

The session-digest is supposed to surface in the next
session's AI context (per the AI-context-requirements
memory: "earlier episodes for recall"). The mock campaign
asserts the digest is in `state.sessionDigests` after
restore; verifying the AI context plumbing actually
INCLUDES `state.sessionDigests` in its prompt assembly is
out of scope for this simulation (it's an
AI-integration-auditor concern). Filed for the AI brief
to cover.

## Cross-cuts (firewall + forward-compat)

- Firewall: digest is player-visible by design. No DM-
  only sub-fields (the wrapper `causedByResponseId` is
  optional and benign). No firewall risk this campaign
  surfaces.
- Forward-compat: digest survives the INV-1/2/3 contracts
  from `design/playtest-readiness/format-stability.md`.
  No regression.

## Coverage table

| Scenario | Test name | Pass |
|---|---|---|
| Author + round-trip | `'digest survives save/restore round-trip'` | YES |
| Player-visible | `'digest is visible to player viewer after restore'` | YES |
| Co-DM authorship | `'digest authored by yielded coord lands in state'` | YES |
| Forward-compat sub-field | `'unknown digest sub-field survives roundtrip'` | YES |
| Invalid inputs rejected | `'invalid digest payloads are rejected at materialize'` | YES |
| Partition-then-rejoin | `'partition then sync delivers the digest'` | YES |
