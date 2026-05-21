# Multi-session simulated-play test plan — v3

Working document.  Revised after QA v2 review + UX agent
pre-simulation evaluation + user direction on DM-vs-player
perspectives and role-swapping.

## Changes since v2

**Three UX blockers fixed first.**  B1 (dice not on scene pages),
B2 (shared.diceRolls unrendered), B3 (chat /roll affordance trap)
are real runtime bugs that would have produced noisy QA data
during simulation.  Fixed in commit `298e55f` before drafting v3.
Per user direction: fix showstoppers immediately; batch minor bugs
in subsequent test runs to amortize cost.

**QA v2 blockers addressed:**
- Reclaim button visibility tightened to `currentPeerId ===
  savedByPeerId`; confirmation dialog required.
- Concurrent-reclaim race added to Phase 4 tests.
- Player C executability resolved: persona is now scripted with
  annotation, not freeform narration.

**User directive incorporated:**
- DM-as-distinct-role recognized as a first-class testing concern.
  A DM's task surface (host, save, load, reclaim, reveal, AI aide,
  NPC sheets, track all PCs, leave-as-coordinator) is quite
  different from a player's (join, read, roll, chat, edit own PC).
  Sessions must exercise BOTH.
- Two persona seats now: Player C (player UX) and Player D (DM UX).
- Role-swap: each agent runs as one role in run-1 and as the other
  in run-2.  Different friction surfaces.  The DM-only views (NPC
  sheets, AI aide, save/load surface) are only stress-tested when
  a UX-evaluator is in the DM seat.

## Why this exists

Current automated coverage (473 unit + 41 e2e) is layered but
artificial: isolated pieces, single-sitting scenarios.  Nothing
exercises:

- An actual end-to-end campaign played across multiple sittings
- Persistence (the runtime has no save/load today — a fresh feature)
- DM-specific frequent tasks (currently never tested as a real-use
  flow; piecewise tested only)
- The "shipped and broke immediately" scenario where a saved
  session corrupts on reload

This plan addresses:
1. **Persistence** — a real feature gap
2. **Realistic multi-session flow testing**
3. **UX evaluation under actual play, with DM and player as
   distinct first-class personas**

## Scope

**In scope:**
- Persistence design + implementation
- `coordinator-reclaim` event kind
- Full-session simulation with 4 contexts (DM, Player A scripted,
  Player B QA-adversarial, Player C UX-player)
- Role-swap: a second simulation where Player C becomes the DM and
  the previous DM becomes a player
- Multi-session continuity (save → load → continue, with reclaim)
- Concurrent-reclaim race resolution
- Corruption recovery
- Git-as-snapshot test methodology
- UX evaluation reports from both DM and player perspectives

**Out of scope:**
- AI creative quality (mocked)
- Story quality (scripted, not improvised)
- Cloud sync of saves
- Implementing the long-tail UX findings (batched for a separate
  pass; only the blockers found mid-execution get fixed inline)
- Performance benchmarking

## Architecture decisions

### Save format

JSON document, deterministically serialized (sorted top-level
keys, stable event order by `(sum-of-clock, peerId, seq)`).
Git-friendly diffs: appending one event should produce a small
N-line diff.

```json
{
  "$schemaVersion": "0.1.0",
  "savedAt": "<ISO-8601>",
  "campaign": { "owner": "...", "repo": "...", "ref": "main" },
  "savedByPeerId": "...",
  "events": [ ... sorted ... ]
}
```

`pairingCode` is intentionally NOT saved — stale codes would be
worse.  DMs share a new code each session via the same out-of-band
channel they used in session 1 (Discord/text).

### Coordinator-reclaim

New event kind, materialized unconditionally:

```typescript
case 'coordinator-reclaim': {
  // Unlike coordinator-claim ("first claim wins"), reclaim
  // unconditionally promotes the issuing peerId.  R2.1's
  // transport-sender-vs-event.peerId check prevents non-DM forgery.
  state.coordinator = event.peerId;
  break;
}
```

**Visibility rule** (user override of QA v2): the "Reclaim
coordinator role" button is visible to ANY peer in an active
session who has loaded a save (or who has localStorage autosave
state).  The strict `currentPeerId === savedByPeerId` rule would
block a legitimate workflow: the DM is sick, a trusted player
steps in with the previous session's save and takes over.

The protection is procedural, not technical:

1. **Confirmation dialog** is required and names the current
   coordinator: *"Take over coordinator from Riley?  This will
   override their session-coordinator powers."*  That's the
   "deliberate action" gate.
2. **Audit trail in chat**: every reclaim materializes a visible
   system-message chat entry — *"Sam took over as coordinator
   from Riley"* — broadcast to all peers.  A misbehaving
   reclaim is immediately visible to everyone in the session
   and the social contract handles the rest.

This matches how analogous tools work (Discord transferring server
ownership, Google Doc editor handoff): permission + transparency
beats permission alone.

**Concurrent-reclaim race**: two ex-coordinators both load the
same save and both click Reclaim within the same window.  Both
reclaim events land; materializer applies in causal order
(`(clock-sum, peerId, seq)` total order).  Last-write-wins by
event order.  Loser's UI updates to reflect they are not
coordinator.  Phase 4 has an explicit test.

### Storage layers

1. **localStorage autosave**: every N events / 30s debounced.
   Key `quire.save.<campaign-slug>`.  1MB warn, 4MB refuse.
2. **Downloadable JSON**: explicit "Save session" button.
3. **Upload**: "Load session" button.

### Save scope

- **In save**: event log, campaign source ref, savedByPeerId,
  savedAt, $schemaVersion.
- **NOT in save**: AI API keys, AI provider choice, system
  prompt, pairing code, chat draft, current AppRoute, local
  roll panel mirror.  (Per QA v1: avoids credential leak when
  DMs share saves.)

### Schema versioning

- Same major → accepted
- Different major → rejected with explicit error
- Unknown `event.kind` in known major → applied to log
  (forward-compat); silently dropped by materializer's switch.
  Counted in `LoadResult.unknownKinds` so the loader can
  surface "this save contains 3 events your version doesn't
  understand."

## Persona spec (revised — DM and player both first-class)

| Persona | Seat in run-1 | Seat in run-2 (role-swap) | Notes |
|---|---|---|---|
| DM | Scripted host | Becomes Player A | Coordinator, story driver |
| Player A | Scripted player | Becomes DM | Plays Yui in run-1 |
| Player B (QA-adversarial) | Player | DM | Inlined adversarial probes; in run-2 covers DM-specific probes |
| Player C (UX-evaluator) | Player | DM | Sam in run-1; "Riley the DM" in run-2 |

**Why role-swap matters**: the UX-evaluator playing Player C
catches "rolling dice from a scene page feels right" but never
sees the save/load flow as a DM.  Run-2 puts them in the DM seat
where their friction list shifts to "I couldn't find where to
share the pairing code", "the AI aide settings are buried", "I
saved but couldn't tell whether players had loaded the file."  The
QA-adversarial agent gets the same role-swap: run-1 tests probes
like "send 600-char chat", run-2 tests DM-only probes like "load
a save mid-active-session", "reclaim coordinator when I shouldn't
be able to", "save then immediately leave session."

### Player C (Sam) — player seat, scripted

Authored by the UX agent.  Mid-30s player, comfortable with Discord
+ Roll20.  Reads top-to-bottom, types when possible.  Beats include:
URL with code should auto-join (assert; documents friction if not);
typing in chat takes focus within 100ms; clicking reveal banner
loads scene <300ms; rolling from scene page requires no navigation
(B1 fix verified); roll appears in DM's view <500ms (B2 fix
verified); typing `/roll 2d6` in chat does NOT submit as literal
(B3 fix verified); etc.

Report format: JSON `e2e/results/player-c-<runId>.json` with
`{beat, task, expectedSteps, actualSteps, msToFirstFeedback,
friction[]}`.  Friction entries include `severity` (blocking /
significant / minor / nit) and `filePathHint`.

### Player D (Riley) — DM seat, scripted

Authored by the UX agent (Phase 0.5 below).  An experienced DM who
runs games online twice a week.  Beats DM-specific:

- **Pre-session prep**: open campaign, scan NPC sheets, configure
  AI aide
- **Host + share code**: how does Riley get the code to players?
  (Currently: triple-click + Discord paste.  Friction.)
- **Reveal scenes in sequence**: assert the reveal-banner history
  is visible — when Riley scrolls back to scene 1, can players
  return there?  (Currently only latest reveal in banner; lost
  history is significant UX gap.)
- **Use AI aide for an NPC voice**: Riley enables Anthropic
  (mocked), prompts for Yui's reaction, shares to chat.  Assert
  the [AI] prefix is the only marker; Riley might want to disguise
  it as in-character.
- **Track PC harm/stress as story unfolds**: when Riley narrates
  "the cave-in deals 2 harm to Yui," can Riley apply that without
  asking the player to do it?  (Currently: only the PC's own
  player can edit their sheet — DM cannot.  Significant UX gap.)
- **Save mid-session**: assert Save is discoverable, downloaded
  file is sensibly named (`underleaf-2026-05-20.json` or similar).
- **Load + reclaim next session**: assert Reclaim button is visible
  only to Riley (not to other peers who happen to have the file).

Report format: same JSON shape as Player C.

## Implementation phases

### Phase 0: simulation prerequisites (~3-4 hr — completed for B1/B2/B3; remaining for Phase 0.5)

- B1, B2, B3 fixed in commit `298e55f` ✓
- **Phase 0.5**: Write the Player D (DM) persona spec.  Spawn UX
  agent to author it based on the runtime's DM-facing surface.
  Output: `design/player-d-persona.md`.

### Phase 1a: serialization (~1.5 hr)

`src/persistence.ts`:
- `serializeSession(events, campaign, peerId) → SaveDocument`
- `stringifySave(doc) → string` — sorted keys, stable event order
- `parseSaveDocument(json) → ParseResult` discriminated success/error

Tests: round-trip, deterministic output, malformed JSON, missing
fields, wrong-type fields.

### Phase 1b: apply-to-log (~2 hr)

`applySaveToLog(eventLog, doc) → LoadResult` returning
`{applied, rejected, duplicates, unknownKinds, errors[]}`.

Tests: empty log, twice (idempotency), divergent log, single
corrupt event, unknown kind (forward-compat).

### Phase 2a: coordinator-reclaim event (~1.5 hr)

`state.ts` case + types; `Peer.reclaimCoordinator()` convenience.
Tests in state.test.ts + peer.test.ts + hostile suites.  Includes
the concurrent-reclaim race test.

### Phase 2b: persistence UI (~4 hr — per QA v2 revised estimate)

- Save button (download JSON), enabled IFF active session
- Load button (file picker), always available, warns when replacing
  an active session
- localStorage autosave debounced + quota tiers
- "Resume previous session?" prompt on campaign load when an
  autosave exists for that slug
- **Reclaim coordinator role** button visible ONLY when
  `currentPeerId === savedByPeerId`; confirmation dialog required

### Phase 3: full-session simulation run-1 (~3 hr)

`e2e/full-session.spec.ts`:
- 4 Chromium contexts: DM (scripted), Player A (scripted), Player B
  (QA-adversarial as player), Player C (UX-player; Sam)
- Real Underleaf campaign via GitHub fetch interception
- Mocked Anthropic + Gemini routes
- Scripted beats covering Episode 1 opening
- Inline adversarial probes (QA, player role): long chat,
  non-coordinator reveal, rapid bumper clicks, duplicate-tab
  pairing code
- Inline UX assertions (Sam's persona-driven checks)
- Assertions: convergence, replication, banner correctness, edit
  propagation

### Phase 3.5: full-session simulation run-2 (~3 hr) — role-swap

`e2e/full-session-swap.spec.ts`:
- Same 4 contexts but:
  - Original DM is now Player A
  - Player A from run-1 is now DM
  - Player B (QA) now in DM seat — runs DM-only adversarial probes
  - Player C (UX) now in DM seat — Riley's persona-driven checks
- Inline DM-only adversarial probes (Player B): load mid-active-
  session, reclaim when shouldn't, save → leave immediately, two
  rapid AI requests, save during in-flight AI request
- Inline DM UX assertions (Riley's persona-driven checks)

### Phase 4: multi-session continuity (~5-6 hr — per QA v2 revised)

`e2e/multi-session.spec.ts`:
- Session 1 runs to completion (shortened version of Phase 3)
- DM saves to JSON
- All browsers close, reopen
- DM loads the save
- **Reclaim button visibility assertion**: Riley sees it; other
  peers don't
- DM clicks Reclaim, confirms
- DM hosts new session (new pairing code)
- Players join
- Player A joins with their OWN session-1 autosave still in
  localStorage — assert merge respects causal order without
  double-apply
- Continue session 2
- Final state assertions

`e2e/coordinator-reclaim-race.spec.ts`:
- Two ex-coordinators both load same save
- Both click Reclaim within 500ms
- Assert deterministic resolution
- Loser's UI reflects non-coordinator status

`e2e/peerid-continuity.spec.ts`:
- The specific bug: load → host → reveal scene → assert reveal
  landed.  Catches absence of coordinator-reclaim.
- Ghost-peer UI assertion: session-1 peerIds in `state.peers` are
  NOT shown as currently online.

### Phase 5: corruption + recovery (~2 hr)

`e2e/save-corruption.spec.ts`:
- Truncated JSON, missing fields, wrong major version, single
  corrupt event, tampered event.peerId, over-cap save,
  cross-campaign load

### Phase 6: git-as-snapshot (~2 hr)

`e2e/git-snapshot.spec.ts`:
- `git init` temp dir; commit save at each beat
- **Diff-size assertion**: one dice-roll = <10-line diff
- **Cross-version migration**: commit v0.1.0, edit to v0.2.0,
  roll back, load
- **Meaningful branch divergence**: branch A with events {a,b,c},
  branch B with {x,y,z}; load each separately and verify; load
  both into a third peer and verify merged state contains all 6
  in causal order

### Phase 7: triage UX/QA reports (~1 hr)

After Phase 3 and Phase 3.5 both run, review:
- Player C's run-1 report
- Player C's run-2 report (Riley as DM)
- Player B's run-1 + run-2 probes
- Cross-reference: which findings are NEW (not anticipated by
  pre-simulation evaluation)?  Which are showstoppers?

Showstoppers found here get fixed immediately.  Minor + nit
batched for the next test cycle (per user direction).

## Inter-agent communication

Both Player B (QA) and Player C (UX) need to communicate with the
DM agent during the run.  Realistic options:

- **Shared scratchpad file**: `e2e/results/scratchpad-<runId>.md`,
  appended by each agent.  DM reads at beat boundaries.  Players
  write friction observations as they happen.  Simple, durable,
  reviewable.
- **In-test chat**: agents use the runtime's own chat surface to
  exchange notes ("DM, take 2 harm now" → DM applies it).  This is
  realistic (matches how human groups coordinate) but mixes test
  signal with assertion data.

Plan: scratchpad for test-meta communication, in-runtime chat for
in-character communication.  Boundaries kept clean.

## QA + UX iteration

This v3 needs one more review pass:
- QA agent: re-verifies the three v2 blockers (reclaim visibility,
  concurrent race, Player C executability) are now addressed
- UX agent: drafts Player D (Riley) persona for Phase 0.5

Then execute.

## Success criteria

- All phases land green
- The "shipped and broke immediately" scenarios are caught:
  - Reload doesn't lose state (Phase 4)
  - Reclaim isn't accidentally invoked by players (Phase 4)
  - Concurrent reclaim resolves deterministically (Phase 4)
  - Save corruption fails gracefully (Phase 5)
  - Git rollback restores expected state (Phase 6)
- Both DM and player perspectives have been exercised by UX-eval
- Showstoppers found mid-run are fixed inline; minor are batched
- Total test count grows by ~80-100 (mostly e2e)
- No regressions in existing 473 unit / 41 e2e

## Time estimate

| Phase | Estimate |
|---|---|
| 0 B1/B2/B3 | ✓ done |
| 0.5 Player D persona | 0.5 hr (agent-authored) |
| 1a serialization | 1.5 hr |
| 1b apply-to-log | 2 hr |
| 2a coordinator-reclaim | 1.5 hr |
| 2b persistence UI | 4 hr |
| 3 simulation run-1 | 3 hr |
| 3.5 simulation run-2 (swap) | 3 hr |
| 4 multi-session continuity | 5-6 hr |
| 5 corruption recovery | 2 hr |
| 6 git-snapshot | 2 hr |
| 7 triage | 1 hr |
| **Total** | **~26-28 hr** |

Three work days.  Plan accordingly.

## What this plan does NOT do

- Persist to anything beyond localStorage / downloadable JSON
- Implement signature-based event authentication
- Implement undo/redo
- Address the "two peers diverged for hours" merge problem
  beyond what vector clocks provide
- Commit to fixing the long-tail UX findings (significant +
  minor + nit) the agents surface — those inform future work
- Fix UX issues found mid-run unless they're test-blocking
