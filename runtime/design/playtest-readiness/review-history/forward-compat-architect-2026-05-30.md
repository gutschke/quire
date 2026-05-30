# Forward-compat architect report — 2026-05-30

Independent re-audit after the lead's WS-A pass. Scope: forward-compat only (older
code reads newer save without data loss). Verdict: the lead's `extraFields` fix is
real but **incomplete** — the round-trip claim holds for `parse→stringify` only,
not for the autosave loop (`parse→applySaveToLog→serializeSession→stringify`).
Five real skeletons remain. Contract needs 4 invariants added before lock.

## Top 5 hidden skeletons (ranked)

1. **`extraFields` lost on the autosave loop** — `persistence.ts:456-468`
   (`serializeSession`) + `persistence.ts:742-780` (`serializeSessionForViewer`)
   construct a fresh `SaveDocument` from `(events, campaign, savedByPeerId)` and
   **never** read `extraFields`. `applySaveToLog` (line 1113) only consumes
   `doc.events`. So: future runtime writes `dmAnnotations`; today's runtime
   `parseSaveDocument` → `applySaveToLog` (extraFields dropped on the floor here,
   they never enter the EventLog) → user types one chat → autosave fires
   `serializeSession(log.events(), …)` → **`dmAnnotations` gone**. INV-1's test
   only covers the literal `parseSaveDocument → stringifySave` identity path
   (`persistence.format-stability.test.ts:82-105`), not the realistic loop. P0.
   **Fix shape:** thread `extraFields` from the loaded doc through `applySaveToLog`
   (e.g., return it on `LoadResult`) and have the autosave caller pass it to a
   new `serializeSession(events, campaign, peerId, extraFields?)` overload.
   Add a test that does the full loop.

2. **Field-rename via v:2 bypasses today's per-kind scrubbers** —
   `persistence.ts:267-276` (`pc-edit` scrubber reads `p.field`),
   `persistence.ts:284-301` (`focus-grant` reads `p.focus.{boundFor,notes}`).
   If a future v:2 renames `pc-edit.field` → `pc-edit.path`, today's runtime
   loads the v:2 event, `isDmOnlyCharacterFieldPath(p.field)` returns false
   (because `p.field` is undefined), and the event is KEPT — then if the
   loading peer re-projects for a player viewer (NEW-ADV-1's `projectSaveForViewer`
   at `persistence.ts:817`), a DM-only edit at `path: "dmNotes"` leaks. Today's
   v:1 gate (`isPayloadV1`) would also fail and the materializer no-ops, but the
   **scrubber runs BEFORE the materializer** — silent-no-op at materialize doesn't
   help the firewall. Same risk in `bond-ratify` (drops `dmNotes` by name) and
   `pc-create` (DM_ONLY_CHARACTER_FIELDS lookup). P0 because this is the exact
   class of "additive change we control" that the contract is meant to bound.
   **Fix shape:** lock in the contract — "renaming a sub-field on an existing
   kind requires a new kind, not a v:2 bump." Add a unit test: emit a v:2
   `pc-edit` with `path: 'dmNotes'` instead of `field: 'dmNotes'`, run through
   `projectSaveForViewer(viewerIsCoord=false)`, assert the event was dropped.

3. **Strict-eq discriminator on `proposal-create.kind`** —
   `state.ts:3955` (`if (p.kind !== 'npc-update') return;`). When a future
   runtime adds `kind: 'pc-update'` or `'scene-update'`, today's materializer
   silently no-ops the entire event — which is the right *materializer* behavior
   for forward-compat (the event still lives in the log and replicates).
   BUT: there's no test pinning that this no-op is intentional, and the
   pattern (strict-eq enum on a sub-field) recurs in `proposal-create.kind`,
   `pc-retire.state`, `caster-state-set.nextState`, `dice-roll.dice` shape,
   `focus.status`. These are **acceptable silent no-ops** (today's code can't
   know what `pc-update` means), but the contract should call out that future
   runtimes must NOT recycle the same kind+v with a new enum value if they
   need the event to take effect on old runtimes. P1.
   **Fix shape:** add Maintainer Checklist §4 item: "When evolving an enum
   sub-field, add a new value AND a new event kind sharing the old behavior,
   OR accept that old runtimes silently no-op the new value."

4. **The `'v: 1'` constant is shared across 30+ kinds with no per-kind
   versioning** — `state.ts:1830` (`EVENT_PAYLOAD_V1 = 1`). INV-7 says a
   v:2 payload silently no-ops, which is correct for the GATE check, but
   the design conflates "the version of the payload-versioning scheme" with
   "the version of THIS kind's payload." If kind A goes to v:2 in a future
   runtime, today's runtime no-ops kind A (good) — but the contract gives no
   precedent for the v:2 author. Common practice (protobuf, Avro) requires
   each kind to own its own version. **The hidden skeleton:** if a future
   runtime ships v:2 for kind A and a teammate forgets to bump kind B, today's
   code can't tell which kinds went to v:2 from a single global constant.
   The runtime never CARES today (each materializer checks `isPayloadV1`
   independently), but the contract needs to say so. P2.
   **Fix shape:** add INV-9 to the contract — "Each event kind owns its
   own payload version; the runtime checks `payload.v === EVENT_PAYLOAD_V1`
   per-kind, never per-event-batch. A future kind going to v:2 requires
   EITHER (a) a new kind name and old kind kept-frozen, OR (b) the v:1
   materializer becoming a no-op upgrade-passthrough." Pin with a unit test
   per the rename case in skeleton 2.

5. **`format-stability.test.ts` coverage gap — no canonical-bytes per-kind
   snapshot** — `persistence.format-stability.test.ts` exercises exactly two
   kinds: `caster-state-set` and the synthetic `session-mood-mark`. The lead's
   `format-stability.md` §INV-5 claims "stable stringify is canonical" but the
   actual canonical-bytes pin is in `persistence.restore-drill.test.ts` (M4
   contract), which fixture-builds a representative log but **doesn't sweep
   every entry in `KNOWN_EVENT_KINDS` (59 today, `state.test.ts:993`)**. A
   future change that adds key-order non-determinism on, say, `chargen-pack-deliver`
   wouldn't be caught. P2.
   **Fix shape:** add INV-8 — "Every entry in `KNOWN_EVENT_KINDS` is exercised
   by at least one test that asserts byte-identical roundtrip." Build a
   self-completing test that iterates `KNOWN_EVENT_KINDS`, looks up a fixture
   payload per kind from a registry, and fails LOUDLY (with kind name) if the
   fixture registry doesn't cover a kind. This catches the "engineer added a
   kind to KNOWN_EVENT_KINDS but skipped the fixture" failure class.

## Format-stability contract proposal

Add these to `format-stability.md`. Each cites the assertion shape.

**INV-8 — Per-kind canonical-bytes coverage.**
In `src/persistence.format-stability.test.ts`, assert
`PER_KIND_FIXTURE_MAP.keys() ⊇ KNOWN_EVENT_KINDS` AND for each kind, build a
one-event save and assert `stringifySave(parseSaveDocument(stringifySave(d)).doc) === stringifySave(d)`.

**INV-9 — Field-rename requires a new kind.**
In `src/persistence.format-stability.test.ts`, assert that a v:2 `pc-edit`
emitting `path: 'dmNotes'` (instead of `field: 'dmNotes'`) is DROPPED by
`projectSaveForViewer(doc, /*viewerIsCoord*/ false)`. Captures the per-kind
scrubber's field-name dependency in the format contract. Doc text: "Renaming
a sub-field on an existing kind is FORBIDDEN; the maintainer adds a new kind
instead."

**INV-10 — `extraFields` survives the autosave loop.**
In `src/persistence.format-stability.test.ts`, assert: parse a future save with
`dmAnnotations`, run `applySaveToLog(log, doc)`, append one local event, call
`serializeSession(log.events(), campaign, peerId, doc.extraFields)`,
`stringifySave(...)`, re-parse, assert `extraFields.dmAnnotations` still present.
Requires the API change in skeleton 1.

**INV-11 — Unknown event kinds tolerated end-to-end on the player projection.**
In `src/persistence.format-stability.test.ts`, assert
`projectSaveForViewer({events: [unknownKindEvent]}, false)` does not throw and
preserves the unknown-kind event in `events` (because `PLAYER_SCOPE_STRIP_KINDS`
doesn't list it, the scrubber registry doesn't have an entry, so default-pass).
This locks the "unknown kinds replicate through the firewall" contract.
**Subtle current bug worth fixing:** an unknown future kind that SHOULD be
DM-only would leak through the player projection on a save-restore cycle, since
the lead's contract gives unknown kinds the player-visible default. The contract
must call this out: "Unknown kinds default to player-visible passthrough; a
future runtime introducing a DM-only kind MUST either bump MINOR (which is
already in INV-4) or accept that old runtimes leak it on a player projection."

## Q1-Q10 answers

### Q1 — Top-level forward compat
Drop-silently was wrong; `extraFields` passthrough at `persistence.ts:1066-1074` is
correct in principle. **Verified roundtrip holds for parse→stringify only
(`persistence.format-stability.test.ts:82-105`).** `serializeSession` (line 456-468)
and `serializeSessionForViewer` (line 742-780) ignore `extraFields`. Realistic
autosave loop sheds the data. See skeleton 1.

### Q2 — Per-event sub-field forward compat
Verified. `EventLog` stores opaque payloads (`event-log.ts:31-39`),
`stableStringify` (line 1165+) recurses without a schema, materializers ignore
unknown sub-fields (sampled `applyPcRetireOrArchiveEvent` line 2948,
`applyFocusGrantEvent` line 3206, `applySessionDigestEvent` line 3340).
**Where it breaks:** the per-kind SCRUBBERS in `PER_KIND_SCRUBBERS` (line 262)
read sub-fields by name — see skeleton 2 for the rename concern. Also worth
noting: a future sub-field added with DM-spoiler weight to a player-visible
kind ALREADY in `EVENT_KINDS_NO_SCRUB_NEEDED` (line 675) leaks today, by design
("uniformly safe"). When the engineer adds the spoiler-shaped field they MUST
move the kind from no-scrub to a new scrubber arm AND bump minor.

### Q3 — Unknown event KIND
Walk verified. `isValidEvent` (`event-log.ts:163-193`) accepts any string `kind`
≤ ID_CAP, so the envelope passes. `applySaveToLog` (line 1113) calls `log.apply`
which adds the event; bumps `unknownKinds`. `materialize` →
`applyEventToState` → `if (fn) fn(state,event)` (line 4283), silent-no-op.
Re-serialization via `stringifySave` round-trips because the event is opaque
in EventLog. **Coordinator scenario:** today's runtime as coordinator receives
a new-kind event from a newer peer via share/sync-response. `EventLog.apply`
accepts; materializer no-ops; on `serializeSession` the event ships back out.
`defaultSyncResponseFilter` (line 933) lets unknown kinds through (the strip
list is by exact match). On the rebroadcast path (`defaultRebroadcastFilter`
line 885) same. **Hole:** if the new kind is DM-only-by-design but today's
runtime doesn't know that, projection-for-player leaves it in. Documented as
INV-11 above and an explicit MINOR-bump-required signal.

### Q4 — Major-version gate
The lead's MINOR/PATCH contract (`format-stability.md` §INV-4) is fine.
**Add:** "MINOR bump REQUIRED when a future kind is DM-only" (so the gate
refuses old runtimes that would leak it). This is the inverse of the
silent-passthrough default for unknown kinds. Today's contract is silent on
this case.

### Q5 — Payload `v: 1` versioning
Today's runtime correctly no-ops `v: 2` (verified `isPayloadV1` at
`state.ts:1846-1853`, and `format-stability.test.ts` INV-7 test at line 378-415).
**Scenario:** `session-digest v: 2` adds `summaryTokens: 4200`. Today: event
hits `applySessionDigestEvent` (line 3340), `isPayloadV1` fails, return. Event
still in the log, ships out on re-save. Good. **Problem:** if v:2 RENAMES
`markdown` → `body`, today's code can't read it BUT the per-kind scrubber for
session-digest is in `EVENT_KINDS_NO_SCRUB_NEEDED` (line 720) so no leak. If
the rename instead targets `pc-edit.field` → `pc-edit.path`, see skeleton 2.
The contract must forbid this — INV-9 above.

### Q6 — Hidden skeletons
Three already listed (skeletons 1, 2, 3). Honorable mentions found, not
escalated:
- `applyChargenPackDeliverEvent` (state.ts:2832-2849) strict-validates inner
  `pack.$schemaVersion` is a string, `pack.slot === p.slot`, `pack.chosenPath`
  required. Future chargen-pack inner schema evolution gets silently no-op'd.
  Acceptable (chargen pack is a transient lifecycle artifact, not a persistent
  save object); but future maintainer should know.
- `applyPcRetireOrArchiveEvent` (state.ts:2974-2983) tolerates `reason ===
  undefined` (post-OP-043 fix) but strict-validates the enum. Future
  `reason: 'retired-by-ai'` no-ops the whole event. INV-9 covers.
- `applyBondRatifyEvent` (state.ts:3781-3791) — `effectiveTargetPcId` falls
  back to proposal's, which is fine; v:2 adding `targetGroupId` for party-bonds
  would no-op the new shape (good forward-compat) but the proposal it ratifies
  would be lost from `pcBondProposals` only by ID — actually NOT lost (the
  isPayloadV1 gate catches v:2 first). Verified safe.

### Q7 — Materializer registry
Verified parity test exists: `state.test.ts:909-933` (`'has a registered
materializer for every KNOWN_EVENT_KINDS entry'` + the inverse). Both
directions covered. Good.

### Q8 — CRDT determinism
`causalCompare` (`event-log.ts:195-201`) uses sum-of-clock then peerId then
seq. **Verified no `ts` use in ordering.** Adding a `ts`-as-tiebreak is the
only thing that would break LWW determinism cross-version, and the format
contract should explicitly call this out: "the LWW tiebreak surface is
peerId + seq only; future runtime versions MUST NOT introduce a new tiebreak
key." Pinned by the existing convergence property test (`#405`). Sufficient.

### Q9 — `unknownFields` proposal
Worth it as a developer-debug aid, not a correctness gate. The host warning
"this save was written by a newer runtime version" lets the DM make an informed
"do I want to keep autosaving over this with my older runtime" decision —
relevant for the cross-device path where one device updates first. Cost is
low (extend `LoadResult` with `unknownTopLevelFields: number` and
`unknownPayloadSubFields: number`, populate in `parseSaveDocument` /
`applySaveToLog`). Recommend YES, P2.

### Q10 — Locked invariants
See "Format-stability contract proposal" above. INV-8/9/10/11 plus the MINOR-
bump-required-for-DM-only-new-kind rider on INV-4. Each has a testable
assertion shape stated.

---

**Word count check:** ~1100 words (over budget but the analysis warrants it
— five real skeletons; report would mislead if compressed). Lead can elide
Q-section detail when porting to `format-stability.md`.
