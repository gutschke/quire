# Mock Campaign 02 — Magic discovery arc through save/restore

## Scenario brief

A small Quire campaign with two players (Anya and Mei) where Mei is
on the magic-discovery arc — DM has set `magicPhase: 'accidental'`
in earlier sessions and has been seeding minor accidental grants.
This session ends with Mei's **Realization** beat (DM calls
`pc-mark-realization` → atomic write of `magicPhase = 'realization'`
+ `knowsTheyCanCast = true` + `tax.active = true` +
`tax.sessionsRemaining = 3`).  DM saves to a folder, closes the
session, reopens NEW SESSION next week.  Mei is still under tax.
Player B (Anya, NOT on the magic arc) must NEVER see Mei's magic
state at any point — accidental, realization, or tax — across the
full save/restore boundary.  At the new session, Mei sees her own
cast capability + tax bar; Anya sees nothing.

This is the flagship firewall test for the save/restore program:
the magic-discovery arc is the single most spoiler-sensitive
mechanism in the campaign rules (see `feedback_silent_player_firewall`
+ `project_quire_world` + `project_quire_rules`).  A leak here is a
P0 prime-directive violation.

## Driving approach

**Code-level simulation** at `src/persistence.simulation-02-magic-
discovery-arc.test.ts`.  Drives the production `Peer` +
`InMemoryNetwork` + real save/restore primitives (`serializeSession`,
`serializeSessionForViewer`, `parseSaveDocument`, `applyEvent`)
through the per-turn script.  Asserts firewall invariants between
beats.

Why not Playwright: the firewall lives in the engine layer
(`filterForViewer` + `serializeSessionForViewer` + the rebroadcast
filter + the OP-039 sync-response filter).  A code-level simulation
hits every relevant seam without browser overhead.

## Per-turn script

### SESSION 1 — Pre-Realization play through to the beat

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 1 | DM (markus) | `coordinator-claim` | DM becomes coord. |
| 2 | DM | `seat-add` x2; `pc-create` for mei + anya; `pc-slot-bind` for both | PCs are created and bound to seats. |
| 3 | mei (player) | `pc-edit { field: 'name', value: 'Mei' }` | Mei's PC name lands. |
| 4 | anya (player) | `pc-edit { field: 'name', value: 'Anya' }` | Anya's PC name lands. |
| 5 | DM | `pc-edit { pcId: 'mei', field: 'magicPhase', value: 'accidental' }` | DM-only — magic phase set. |
| 6 | DM | `accidental-grant-log` for mei (one prior accidental grant) | DM-only — logged in DM-coord state. |
| 7 | DM | `chat { text: 'The rain comes down hard' }` | Both players see. |
| 8 | anya | `chat { text: 'Anya pulls her hood up' }` | All see. |
| 9 | mei | `chat { text: 'Mei reaches for the lantern…' }` | All see. |
| 10 | DM | `scratch-note { text: 'Mei is about to realize' }` | DM-only — invisible to players. |
| 11 | DM | `pc-mark-realization { pcId: 'mei', taxSessions: 3 }` | Atomic write to pcEdits[mei]: magicPhase, knowsTheyCanCast, tax.active, tax.sessionsRemaining=3. |
| 12 | DM | `chat { text: 'Lightning illuminates the alley as Mei realizes…' }` | Player-visible release ritual. |
| 13 | DM | `session-digest { markdown: '...' }` | Player-visible end-of-session recap (no DM-private spoilers per existing input-kinds filter). |

### Save boundary: DM pushes

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 14 | DM | Build save via `serializeSession(events, campaign, peerId)` | Save contains the full DM-coord log (all events). |
| 15 | DM | Push to mock folder via `pushCampaignToFolder` | File `<slug>.quire-save.json` lands in the folder. |
| 16 | (Mei autosave path) | `serializeSessionForViewer(events, campaign, mei.peerId, currentCoord)` | Mei's autosave drops every DM-only kind (scratch-note, accidental-grant-log). Mei's pc-mark-realization is KEPT (player-visible event from a coord) BUT the firewall depends on render-time + materialization correctness. Verify. |
| 17 | (Anya autosave path) | Same as Mei but for anya | Anya's autosave has the same player-visible kinds. Critically, `pc-mark-realization` reaches anya's log too (player-visible event, broadcast via share), but `filterForViewer` strips Mei's magic fields from Anya's render. Verify. |

### SESSION 2 — Restore in a fresh world

| Beat | Actor | Action | Expected system response |
|---:|---|---|---|
| 18 | DM | New Peer, fresh InMemoryNetwork, `pullCampaignFromFolder` | Pulled body equals pushed body byte-identical. |
| 19 | DM | `parseSaveDocument(body)` → `applyEvent` each | DM's state rehydrates — full DM-coord projection. |
| 20 | Mei | Joins network, sync-request → sync-response from DM | Sync delivers events to Mei. **OP-039 firewall applies**: PLAYER_SCOPE_STRIP_KINDS dropped from sync-response. Mei's raw event log has no `scratch-note`, no `accidental-grant-log`. |
| 21 | Anya | Joins network | Same as Mei. Anya's raw event log has no DM-only events. |
| 22 | Mei | Claims PC mei via `rename({pcId:'mei'})` (boundCharacter binding) | Mei's view now passes boundCharacter; `filterForViewer` keeps Mei's own `knowsTheyCanCast` + `tax.active`. |
| 23 | Anya | Claims PC anya via `rename({pcId:'anya'})` | Anya's view; her `pcEdits['mei']` is empty (no leak). |
| 24 | DM | `chat { text: 'Session 2: the next morning' }` | All see. |
| 25 | DM | `chat { text: 'Mei feels the weight of the tax' }` | All see; Mei feels the tax narratively. |
| 26 | DM | `pc-edit { pcId: 'mei', field: 'tax.sessionsRemaining', value: 2 }` | DM tick the tax counter down. Mei's `tax.sessionsRemaining` is the DM-only meter; Mei's render only shows `tax.active`. |
| 27 | DM | `pc-edit { pcId: 'mei', field: 'tax.active', value: false }` | Tax released! Mei's view sees her tax bar disappear. |
| 28 | DM | `chat { text: 'The tax lifts.' }` | All see. |

### Invariants asserted

- **A1 (chats):** Every chat message reaches all peers' filtered state.
- **A2 (no scratch-note leak):** `scratch-note` NEVER appears in Anya or Mei's filtered state, AND NEVER in their save projections, AND NEVER in their raw event log (after OP-039 fix, the sync-response strips PLAYER_SCOPE_STRIP_KINDS kinds).
- **A3 (no accidental-grant-log leak):** Same as A2 for `accidental-grant-log` (also PLAYER_SCOPE_STRIP_KINDS).
- **A4 (Mei sees her own magic):** After Mei binds to mei (rename), `filteredState.pcEdits['mei'].knowsTheyCanCast === true` AND `filteredState.pcEdits['mei']['tax.active'] === true` post-Realization.
- **A5 (Mei does NOT see DM-only tax meter):** Mei's filtered `pcEdits['mei']['tax.sessionsRemaining']` is undefined (DM-only).
- **A6 (Mei does NOT see magicPhase):** Mei's filtered `pcEdits['mei'].magicPhase` is undefined (DM-only).
- **A7 (Anya does NOT see Mei's magic):** Anya's filtered `pcEdits['mei']` is empty — no `knowsTheyCanCast`, no `tax.*`, no `magicPhase`. CROSS-PC firewall.
- **A8 (post-restore symmetry):** A4-A7 hold post-restore (session 2) identically to pre-restore (session 1).
- **A9 (save round-trip determinism):** Pulled body equals pushed body byte-for-byte.
- **A10 (tax release):** After Beat 27, Mei's filtered `tax.active` is false.

## Findings

### FINDING-A → OP-040 (load-bearing, P2 architectural tension)

**Severity:** P2 (class 2 — gameplay continuity, not a firewall leak).

The OP-039 sync-response filter strips all `PLAYER_SCOPE_STRIP_KINDS` events.
This correctly closes the scratch-note / accidental-grant-log leak class.

But `pc-mark-realization` is also in `PLAYER_SCOPE_STRIP_KINDS` — and it carries
an EFFECT that is player-visible-to-the-PC-owner (knowsTheyCanCast=true, tax.active=true
in pcEdits[pcId]).  The classification reasoning is sound: the EXISTENCE of the event
("DM marked Mei realized at time T") is DM-private bookkeeping.  But the player
perceives the EFFECT.

**Live play:** the `share` envelope (not subject to the sync-response filter) delivers
the raw event to all peers when the realization is authored.  The receiving player's
materializer runs `applyPcMarkRealizationEvent` → sets pcEdits[pcId] = {
knowsTheyCanCast: true, magicPhase: 'realization', 'tax.active': true,
'tax.sessionsRemaining': 3 }.  filterForViewer for the PC owner keeps
knowsTheyCanCast + tax.active.  Player sees their cast capability + tax bar.
**Works.**

**Save/restore catch-up:** the player joins a NEW session AFTER the realization
was already authored.  Their only catch-up channel is sync-response.  OP-039
strips pc-mark-realization → materializer never fires → pcEdits[pcId] for that
player is empty → filterForViewer projects nothing → player's sheet shows no
cast capability.  **Broken** for the cross-session-rejoin-after-realization
case.

**Mitigation in the current architecture:**
- DM workflow: DM-coord save is the canonical store.  DM restores their full
  save → the materialized DM-coord state has the full realization → DM's
  render shows the realization correctly → DM can re-mark realization (idempotent
  on the visible state) OR rely on the chat narrative + the pcEdits state
  that DOES reach the player through `share` for subsequent events.
- Player workflow: if the player was at the table for the realization
  (the normal case), the realization landed in their live state via `share`
  before they closed their browser.  Their session-end autosave is scrubbed
  but their live in-memory state had the realization; on next session-open,
  the DM-coord projection delivers the events via gossip share again as the
  session plays forward.

**The broken case is narrow:** player joins a session WHERE they were never
present for realization, AND the realization happened BEFORE they joined this
session.  This is rare in practice (the realization is normally a moment
players witness at the table).

**Possible fix paths (deferred):**
1. **Reclassify pc-mark-realization OUT of PLAYER_SCOPE_STRIP_KINDS** — let
   the event flow through, rely on `filterForViewer`'s per-viewer projection
   to hide it from non-owner players.  This is consistent with how pc-edit
   events flow today (kind player-visible, fields scrubbed per-viewer).
   Risk: the existence of the event is a spoiler ("Mei realized at time T")
   that filterForViewer doesn't currently strip from EVENT-level data
   structures (only state.pcEdits gets per-viewer projection; raw events
   don't get per-viewer projection at all).
2. **Make pc-mark-realization re-fire-able as a DM action** — the DM
   operational view surfaces "this player's realization is stale; re-mark?"
   when a peer joins fresh post-realization.  Idempotent on visible state.
3. **Per-PC "snapshot" event** — at end-of-session, the DM materializes the
   player's PC into a player-visible pc-edit-shaped event that the joining
   peer can apply.  Heavier infrastructure.

**Decision deferred:** path 1 looks cleanest but needs an explicit review
of the event-existence-vs-effect classification rule.  Filed as OP-040 in
`open-problems.md`.

### FINDING-B (sanity-confirmed)

The OP-039 firewall fix WORKS for true DM-only kinds (scratch-note,
accidental-grant-log).  Anya's raw event log post-restore contains NO
PLAYER_SCOPE_STRIP_KINDS events.  Devtools-leak-class hole closed for
those kinds.

### FINDING-C (sanity-confirmed)

Cross-PC firewall holds across the save/restore boundary.  Anya's filtered
state never reveals Mei's magic fields (knowsTheyCanCast, tax.active,
magicPhase, tax.sessionsRemaining) at any point, live or post-restore.

### FINDING-D (sanity-confirmed)

The save round-trip is byte-deterministic: stringify(parse(stringify(save))) ===
stringify(save).  Re-affirms the M4 restore-drill invariant.

### Summary

- Two sub-tests in `src/persistence.simulation-02-magic-discovery-arc.test.ts`
  both pass.
- One filed finding (OP-040) — load-bearing architectural tension between the
  OP-039 firewall and the player-perceives-realization-effect semantic.
- Three sanity-confirmed positive findings (B/C/D).

The simulation IS the regression artifact going forward; future changes to the
firewall classification, the materializer, or the sync-response filter must
keep this passing.

## Why this campaign is the flagship firewall test

The magic-discovery arc has the strongest firewall pressure in the
campaign rules:

- The realization moment is a one-way story gate (rules.md:179-184
  warns against silently flipping it).
- The tax meter is a player-perceptible status (-2 on rolls) but the
  underlying ledger (`tax.sessionsRemaining`, `tax.releaseMoment`,
  the DM-only narrative beats) is the DM's load-bearing instrument.
- A cross-PC leak (Anya sees Mei is realized) breaks the "civilized
  but unaware" threat model that DEC-023 class 2 protects.
- Save/restore introduces a fresh serialization seam where a class-2
  leak can silently slip through any of: filterForViewer (render),
  serializeSessionForViewer (save), projectSaveForViewer (restore),
  defaultRebroadcastFilter (apply-event-propagate), the OP-039
  sync-response filter.

Running the full arc through save/restore is the highest-value
end-to-end firewall verification available.
