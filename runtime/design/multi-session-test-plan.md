# Multi-session simulated-play test plan — v2

Working document.  Revised after first QA review.  Now awaiting
parallel review from (a) the QA agent for technical correctness and
(b) a UX expert agent for design / discoverability concerns.

## Changes since v1

The first QA review surfaced one architectural decision that cascades
through the whole plan: **how does coordinator authority survive a
save/load cycle?**  PeerJS issues a new peerId per session, but the
loaded event log carries a `coordinator-claim` from the old peerId.
The current `state.ts:115-117` "first-claim-wins" guard then silently
no-ops any subsequent claim, leaving the DM with no coordinator powers
(scene-reveal in particular fails silently).

v2 introduces a new event kind, `coordinator-reclaim`, that
supersedes a prior coordinator-claim.  This becomes the fix for the
single most likely "shipped and broke immediately" scenario.

Also added per the QA review:
- Deterministic serialization (sorted keys, stable event order) as a
  Phase 1 requirement, not a downstream nicety.
- Structured load-result (`{applied, rejected, duplicates,
  unknownKinds}`) instead of a bare count.
- Load-into-non-empty-log, load-twice idempotency, divergent-history
  cases in Phase 1.
- Phase 4 expanded substantially — coordinator-reclaim mechanic,
  ghost-peers UI, joining with own autosaved state.
- Phase 6 (git-as-snapshot) redesigned to test the engine via
  diff-readability + cross-version load + meaningful branch
  divergence instead of just exercising git.
- Phase 7 (QA probes) folded into Phases 3-5 at planning time.
- Concurrent-save resolution, quota exhaustion, cross-campaign load,
  forward-compat unknown event kinds, AI panel localStorage scope
  documented.
- Time estimates roughly doubled to match the actual surface.

Added per the UX-expert-as-player suggestion:
- A fourth player persona in the simulated session: a UX expert
  actually playing through.  Not adversarial — they're trying to
  enjoy the game.  They report friction points: things that took
  more clicks than expected, things they couldn't find, things they
  found and didn't realize were available.

## Why this exists

Today's automated coverage is layered (471 unit + 40 e2e) but
artificial:
- Unit tests probe isolated pieces
- E2E tests cover individual scenarios in single sittings
- Nothing exercises an actual end-to-end campaign across multiple
  play sessions

The gap that matters: **a DM and players play Episode 1 of
Underleaf, come back the following week, and want to continue.  The
current runtime has no persistence, so session 2 starts from zero.**
A user who experiences this once stops trusting the platform.

This plan addresses three distinct problems:

1. **Persistence** — a real feature gap
2. **Realistic flow testing** including multi-session continuity,
   adversarial play, and corruption recovery
3. **UX evaluation under actual play** — does the runtime feel
   right to a real user trying to enjoy it, not just pass
   assertions?

## Scope

**In scope:**
- Persistence design + implementation (save/load event log)
- `coordinator-reclaim` event kind — the multi-session fix
- Full-session simulation (4 browser contexts: DM + 3 players,
  including the QA-player and the UX-player; scripted real-time
  play; mocked AI; real Underleaf campaign)
- Multi-session continuity (save → load → continue, with
  coordinator-reclaim)
- State corruption recovery (graceful degradation)
- Git-as-snapshot test methodology (diff-readability + cross-version
  load + meaningful divergence)
- UX evaluation by the UX-player agent during the simulated play

**Out of scope:**
- AI creative quality (mocked; we test wiring + UX, not content)
- Story quality (the players follow a script; they don't ad-lib)
- Cloud sync of saves
- Implementing the UX fixes the report surfaces (those go on a
  separate followup list)
- Performance benchmarking

## Architecture decisions

### Save format

JSON document, deterministically serialized (sorted top-level keys,
stable event order by `(sum-of-clock, peerId, seq)`).  Git-friendly
diffs: appending one event should produce a small N-line diff, not
a re-serialize.

```json
{
  "$schemaVersion": "0.1.0",
  "savedAt": "<ISO-8601>",
  "campaign": { "owner": "...", "repo": "...", "ref": "main" },
  "savedByPeerId": "...",
  "events": [ ... ]
}
```

Note: `pairingCode` is intentionally NOT saved — a new pairing code
is generated when the DM re-hosts.  This avoids stale-code joins.

### Coordinator-reclaim (the v2 addition)

New event kind, `coordinator-reclaim`, materialized by `state.ts` as:

```typescript
case 'coordinator-reclaim': {
  // Unlike coordinator-claim ("first claim wins"), reclaim is
  // unconditional: the issuing peerId becomes coordinator.  This is
  // what a DM emits at the start of session 2 after loading a save
  // whose coordinator-claim refers to their now-defunct session-1
  // peerId.
  state.coordinator = event.peerId;
  break;
}
```

Trust model: same as coordinator-claim (Peer.handleMessage already
enforces transport-sender vs event.peerId, so a non-DM cannot
forge a reclaim).  Documented in the design doc.

UI surface: when a load happens and `state.coordinator !==
currentPeerId`, the session bar surfaces "Reclaim coordinator
role" as an explicit one-click action.  Not auto-fired, because:
(a) the loading user may be a player who joined the DM's saved
session, in which case they're NOT supposed to be coordinator,
and (b) the user-facing intent of "I'm taking over" should be
explicit.

### Storage layers

1. **localStorage autosave** — every N events (or every 30s,
   debounced).  Key: `quire.save.<campaign-slug>`.  Survives
   refresh, dies with browser data clear.
2. **Downloadable JSON** — explicit "Save session" button.  This
   is the cross-week / cross-machine save.
3. **Upload** — "Load session" button accepts a `.json` file.

### localStorage quota

5MB soft limit; saves over 1MB warn the user; over 4MB refuses
autosave (downloadable save still works).  Tests cover the
warning + refusal paths.

### Save scope (cross-cutting)

- **In save**: event log, campaign source ref, savedByPeerId, ISO
  timestamp, schema version.
- **NOT in save**: AI API keys, AI provider choice, system prompt
  (per-browser-per-user; saves are shared between DMs and emailing
  one would leak credentials), pairing code, chat draft, current
  scene selection, current AppRoute, local roll panel mirror.
- The QA agent's specific concern about API keys leaking via shared
  saves is addressed here.

### Schema versioning

- Same major → accepted
- Different major → rejected with explicit error
- Unknown `event.kind` in a known-version save → applied to log
  (idempotent, deterministic order) but silently dropped by the
  materializer's switch (it already is).  Counted in load-result's
  `unknownKinds` so the loader can surface "this save contains 3
  events your version doesn't understand; update for full
  compatibility."

### Concurrent-save resolution

Two peers in the same session save 200ms apart.  Both downloaded
saves are equally valid; vector clocks merge them on either-load.
The Load UI shows the timestamp + savedByPeerId so the user can
pick if they have both files.  No "this save is more recent" magic.

## Implementation phases

### Phase 1a: serialization (~1.5 hr)

- `src/persistence.ts`:
  - `serializeSession(events, campaign, peerId) → SaveDocument`
  - `stringifySave(doc) → string` — sorted keys, stable event order
  - `parseSaveDocument(json) → ParseResult` — discriminated success/error
- Unit tests:
  - Round-trip serialize → parse → equal
  - Deterministic output for the same input
  - Single-event-added diff is small
  - Malformed JSON, missing fields, wrong type fields all rejected
    cleanly

### Phase 1b: apply-to-log (~2 hr)

- `applySaveToLog(eventLog, doc) → LoadResult` with
  `{applied, rejected, duplicates, unknownKinds, errors[]}`
- Unit tests:
  - Apply into empty log: full count applied
  - Apply twice: second call returns all-duplicates
  - Apply into log with divergent local events: both sets present,
    order respects causal clock
  - Apply with one corrupt event: that one rejected, rest applied
  - Apply with unknown event.kind: applied to log (forward-compat),
    counted in `unknownKinds`

### Phase 2a: coordinator-reclaim event (~1.5 hr)

- Add to `state.ts` case + types
- Add `Peer.reclaimCoordinator()` convenience method
- Unit tests:
  - reclaim sets state.coordinator unconditionally
  - reclaim through transport authority (R2.1 cross-check applies)
  - replay determinism: reclaim then claim yields reclaim's
    coordinator
  - Tests in `state.test.ts` + `peer.test.ts` + the hostile suites

### Phase 2b: persistence UI (~2.5 hr)

- `quire-app.ts`:
  - Save button (download JSON)
  - Load button (file picker)
  - localStorage autosave debounced + quota handling
  - "Resume previous session?" prompt on campaign load when an
    autosave exists for that slug
  - When loaded state has `coordinator` set but it's not the current
    peerId, show a "Reclaim coordinator role" button next to the
    pairing code
- Save button is enabled IFF an active session exists AND the
  campaign is loaded.
- Load is always available but warns when an active session is
  being replaced.

### Phase 3: full-session simulation (~3 hr)

- `e2e/full-session.spec.ts`:
  - 4 Chromium contexts: DM, Player A (scripted narrative), Player
    B (QA adversarial), Player C (UX evaluator)
  - Real Underleaf campaign via GitHub fetch interception
  - Mocked Anthropic + Gemini routes
  - Scripted beats covering Episode 1's opening
- Inline adversarial probes (per QA review, not deferred):
  - Player B sends 600-char chat at beat 4
  - Player B clicks "Reveal" as non-coordinator (should no-op)
  - Player B rapid-clicks +/- bumpers (no race)
  - Player B opens same code in second tab
- Inline UX checks (the UX-player agent records observations
  during play; see Phase 3.5)
- Assertions: every event lands on every peer; event order
  converges; chat replicates; reveal banner appears + dismisses
  correctly; PC edits propagate

### Phase 3.5: UX-player report (~within Phase 3 budget)

The UX expert agent participates in the full-session run with their
own Playwright context.  They:
- Try to accomplish each task the DM/players might want without
  prior knowledge of the codebase
- Report friction: how many clicks for the most common actions?
  Where did they get confused?  What did they expect to find that
  wasn't there?
- Compare frequency vs friction: the most frequent actions (rolling
  dice, reading scenes, chatting) should be the lowest-friction
- Output: a UX findings report saved to `design/ux-findings-<date>.md`

The plan does NOT commit to fixing what they find — that's a
follow-up triage step.  But the findings inform the test plan: if
the UX agent says "I couldn't find the save button," then a Phase
2b test should assert the save button has a clear label and is
findable.

### Phase 4: multi-session continuity (~4 hr — the headline phase)

- `e2e/multi-session.spec.ts`:
  - Session 1: short play through, then DM saves
  - All browsers close
  - Reopen: DM clicks Load
  - DM clicks "Reclaim coordinator role" (new in v2)
  - DM hosts fresh session
  - Players join with new pairing code
  - Player A joins with their OWN session-1 autosave still in
    localStorage — assert that the merge respects causal order
    and doesn't double-apply
  - Continue with session 2: more reveals, rolls, edits
  - Final state assertions

- `e2e/peerid-continuity.spec.ts`:
  - The specific bug: load → host → reveal scene → assert reveal
    landed in revealedScenes (currently silently fails without
    coordinator-reclaim)
- Ghost-peer assertion: after load, `state.peers` still contains
  session-1 peerIds.  The UI should NOT show them as "currently
  online" (their leftAt should reflect their not-rejoining).
  Specific UI assertion required.

### Phase 5: corruption + recovery (~2 hr)

- `e2e/save-corruption.spec.ts`:
  - Truncated JSON → reject cleanly
  - Missing required fields → reject
  - Wrong schema major → reject with version message
  - Single corrupt event → that one rejected, rest applied,
    load-result surfaces the rejection
  - Tampered event.peerId (mismatches clock) → caught by EventLog
    validation, surfaced in load-result
  - Save that exceeds maxEvents bound → contract is "reject"
  - Cross-campaign load (save's campaign ≠ current campaign) →
    refuses, doesn't merge

### Phase 6: git-as-snapshot (~2 hr — redesigned per QA review)

- `e2e/git-snapshot.spec.ts`:
  - Boot a temp `git init` directory
  - Run a session; commit save at each beat
  - **Diff-size assertion**: appending one dice-roll produces a
    git diff of <10 lines (catches non-deterministic key order
    regression)
  - **Cross-version migration**: commit a v0.1.0 save, edit the
    file to v0.2.0 in a follow-up commit, roll back to v0.1.0,
    load — exercises schema-version handling
  - **Meaningful branch divergence**: branch A continues from
    commit N with events {a, b, c}; branch B continues from N
    with events {x, y, z}; load both into separate peer
    instances; verify each replays to its own state.  Then merge
    branches by loading both saves into a third peer; verify the
    merged state contains all 6 events in causal order.  This
    exercises the actual CRDT merge that the plan otherwise
    dodges.

### Phase 7: integrated probes (folded into Phases 3, 4, 5)

Per QA review, "probes authored separately, integrated later" tends
to produce probes that don't fit the e2e harness's timing.  Inline
the full list:

- Phase 3 inlined: long chat, non-coordinator reveal, rapid bumper
  clicks, duplicate-tab pairing code
- Phase 4 inlined: load mid-active-session (UI should warn), load
  as guest (UI should refuse), open-two-tabs-same-campaign
  autosave race, network partition during save
- Phase 5 inlined: refresh-during-autosave (interrupted partial
  write), AI panel mid-stream save, save with no session active

## Player personas (revised)

| Persona | Role | Script |
|---|---|---|
| DM | Coordinator, story driver | Fixed script: walks through scenes 1-3, reveals each, prompts dice, uses AI aide once |
| Player A | Narrative player | Fixed script: rolls when prompted, sends in-character chat, takes harm/stress when DM narrates damage |
| Player B (QA) | Adversarial player | Authored by QA agent: 12-15 probes interleaved with normal play |
| Player C (UX) | First-time-feel player | Plays naturally, narrates observations: "I tried X and was surprised by Y", "the dice panel was where I expected", "I couldn't find the save button for 30s" |

## QA + UX review iteration

After this v2 plan:
1. **QA agent**: technical re-review — does v2 close the gaps from
   v1?  Are the time estimates now realistic?  Is the
   coordinator-reclaim mechanic correct?
2. **UX expert agent**: fresh review — read the runtime UI surface,
   walk through the player personas, identify expected friction
   points BEFORE the simulation runs.  Their pre-simulation
   predictions become test assertions.
3. Revise to v3 if needed
4. User sign-off
5. Execute

## Success criteria

- All seven phases (rolled into v2's 6 phase numbers) land with
  green tests
- The "shipped and broke immediately" scenario from QA's v1 review
  is now caught by the Phase 4 reclaim-tests
- The UX agent's predicted friction points are either fixed or
  documented as known UX gaps for a future pass
- Multi-session play: a save authored by the DM at end of session
  1 can be loaded by the DM in session 2, reclaimed, and session 2
  proceeds without state corruption
- Git-snapshot: rolling back to any commit + loading produces the
  same state the session had at that commit

## Time estimate

| Phase | Estimate |
|---|---|
| 1a serialization | 1.5 hr |
| 1b apply-to-log | 2 hr |
| 2a coordinator-reclaim | 1.5 hr |
| 2b persistence UI | 2.5 hr |
| 3 full-session simulation (with UX/QA personas inlined) | 3 hr |
| 4 multi-session continuity | 4 hr |
| 5 corruption recovery | 2 hr |
| 6 git-snapshot | 2 hr |
| **Total** | **18.5 hr** |

This is roughly two full work days.  Plan accordingly; this is not a
"finish today" task.

## What this plan does NOT do

- Persist to anything other than localStorage / downloadable JSON
- Implement signature-based event authentication (the trust
  improvement that would close the sync-response gossip hole)
- Implement undo/redo within a session (different feature)
- Address the "two peers diverged for hours and now have
  conflicting histories" merge problem beyond what vector clocks
  already provide
- Commit to fixing the UX findings the UX agent surfaces (they
  inform future work; this plan validates the runtime, not the
  design system)
