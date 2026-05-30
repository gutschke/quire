# Save format stability contract (forward-compat only)

**Owner:** Playtest-Readiness Program Lead
**Created:** 2026-05-30 (run #13, WS-A)
**Scope:** what future runtimes can change without breaking
saves on disk today, and what today's runtime can ADD without
breaking saves it has already written.

This document is the **forward-compatibility contract** for
Quire's on-disk save format. After the first playtest, real
DMs will have saves with real player content. Changing the
format becomes a conversion problem; this contract defines
what changes never require conversion.

The contract is enforced by tests; the doc explains the
rationale. When a test changes, a code-review-shape PR
explains why. When this doc changes, the change must come
with a test change.

---

## 1. The format at a glance

A Quire save is a single JSON object:

```json
{
  "$schemaVersion": "0.1.0",
  "savedAt": "2026-05-30T13:00:00.000Z",
  "campaign": { "owner": "...", "repo": "...", "ref": "..." },
  "savedByPeerId": "...",
  "events": [ /* ordered, dedup-by-id */ ]
}
```

Sources of truth:

- Top-level shape: `SaveDocument` interface,
  `src/persistence.ts` line 398.
- Parser: `parseSaveDocument`,
  `src/persistence.ts` line 919.
- Serializer: `stringifySave` + `stableStringify`,
  `src/persistence.ts` line 915 + line 1098.
- Per-event applier: `applySaveToLog`,
  `src/persistence.ts` line 1046.
- Event vocabulary: `KNOWN_EVENT_KINDS`,
  `src/core/state.ts` line 1672.
- Materializer registry: `MATERIALIZERS` + the auto-
  completing test in `src/core/state.test.ts` (line 916).

---

## 2. The forward-compat invariants

Each invariant has an enforcing test. The test name is
the **invariant ID** the code-review PR cites.

### INV-1 — Unknown top-level fields ROUND-TRIP

A save written by a future runtime with extra top-level
fields (e.g. `dmAnnotations`, `cloudMetadata`) must
round-trip cleanly through today's `parseSaveDocument` +
`stringifySave`: the unknown fields must SURVIVE.

**Why:** Without this, a future runtime that writes an
extra field gets it silently stripped by ANY today's
runtime that loads + saves the document. Cross-device sync
where one device has updated and another hasn't would
silently shed data.

**Test:** `src/persistence.format-stability.test.ts` —
`'INV-1: unknown top-level fields round-trip'`.

**Status:** ENFORCED in this run. Required a small fix to
`parseSaveDocument`: today the parser reconstructs only the
explicit fields. Fix is to preserve `extraFields` and
include them in stringify.

### INV-2 — Unknown event-payload sub-fields ROUND-TRIP

A future runtime adding a new sub-field to an event
payload (e.g. `caster-state-set` gains a `triggeredByNpcId`
field) must round-trip cleanly through today's
`stringifySave` + `parseSaveDocument` + `applySaveToLog`:
the sub-field must SURVIVE in the on-disk JSON and in the
re-serialized JSON.

**Why:** Materializers in today's runtime are strict about
fields they recognize and pass through fields they don't.
Per DEC-030, materializers tolerate firewall-stripped
optional sub-fields; the inverse — tolerating ADDED
sub-fields — must also hold.

**Test:** `src/persistence.format-stability.test.ts` —
`'INV-2: unknown event-payload sub-fields round-trip'`.

**Status:** ENFORCED in this run. The `EventLog` stores
events as opaque objects; `stableStringify` recurses
through them; round-trip is naturally preserved. The test
locks this against accidental regression.

### INV-3 — Unknown event KINDS replicate without applying

A future runtime emitting a new event kind (e.g.
`session-mood-mark`) must:
- Be ACCEPTED by `applySaveToLog` (event lands in the log).
- Be COUNTED in `LoadResult.unknownKinds`.
- NOT throw, NOT be rejected, NOT corrupt state.
- Survive a save-then-restore cycle on today's runtime.
- When the runtime is later updated to KNOW the kind,
  re-materialization picks up the event correctly.

**Why:** The whole point of the event log is that the log
IS the SSOT. A future runtime author lands an event; an
older peer holds the event in its log; the older peer's
materializer doesn't see the effect (intended — that's
the forward-compat budget); but when that peer updates,
the materializer picks up the historical event correctly.

**Test:** `src/persistence.format-stability.test.ts` —
`'INV-3a/b/c: unknown event kinds round-trip'`.

**Status:** ENFORCED in this run.

### INV-4 — Major version is the BREAK gate

`$schemaVersion` follows semver. `parseSaveDocument`
refuses to load a save whose MAJOR differs from today's
runtime. Minor + patch are accepted without warning.

**Contract for the team:**
- **Bump MAJOR** only when the on-disk shape changes in a
  way today's runtime CANNOT honor (e.g. `events` becomes
  a Map, or `campaign` shape changes, or the JSON outer
  shell stops being a single object). This is the
  "conversion tools required" boundary.
- **Bump MINOR** when a new top-level field is added OR a
  new event kind is introduced. Today's runtime continues
  to work; the new field/kind round-trips.
- **Bump PATCH** for clarifying-comment-only or test-only
  changes.

**Test:** `src/persistence.format-stability.test.ts` —
`'INV-4: major version is the break gate'`.

**Status:** ENFORCED in this run. The MAJOR gate is
already at `src/persistence.ts` line 950. The test pins
that minor + patch saves are accepted.

### INV-5 — Stable stringify is canonical

`stableStringify` sorts object keys alphabetically at
every depth. Two saves with the same logical content
produce byte-identical JSON (modulo `savedAt`).

**Why:** Git-friendly diffs. Cross-device merge.
Determinism in tests.

**Test:** `src/persistence.restore-drill.test.ts`
(already shipped) — byte-identical roundtrip is M4.
`src/persistence.format-stability.test.ts` adds an
auxiliary check that key ordering is stable across
runtime-version-shaped mutations.

**Status:** ENFORCED.

### INV-6 — Materializer registry parity

Every entry in `KNOWN_EVENT_KINDS` MUST have an entry in
`MATERIALIZERS` (and vice versa). A new kind added to one
without the other is a forward-compat regression
(silently treated as unknown OR silently applied to no
known kind).

**Why:** The team adds new kinds in pairs; this gate
prevents the half-added state.

**Test:** `src/core/state.test.ts` line 916 (already
shipped) — `'no orphaned KNOWN_EVENT_KIND'` +
`'no orphaned MATERIALIZER_KIND'`.

**Status:** ENFORCED.

### INV-7 — Payload `v: 1` versioning is per-kind

Each M1+ event kind validates its payload via
`isPayloadV1` (or its successor). A future evolution to
`v: 2` requires either:
- Adding a new event kind (`session-digest-v2`), OR
- Updating `isPayloadV1` to also accept `v: 2` and
  branching in the materializer.

Today's runtime, presented with `v: 2`, silently no-ops
the event (intended: the v:1 check fails, materializer
returns).

**Why:** Versioning at the payload level prevents schema
churn from cascading into a top-level format change.

**Test:** `src/persistence.format-stability.test.ts` —
`'INV-7: future v:2 payload silently no-ops'`.

**Status:** ENFORCED in this run.

---

## 3. Hidden skeletons sweep — findings from the audit

(Done as part of WS-A. The forward-compat architect
consultant — brief queued — will independently
re-audit; this is the lead's first pass.)

### Finding A — RESOLVED inline: `parseSaveDocument` strips unknown top-level fields

**Severity:** P1 forward-compat hazard.

**Evidence:** `src/persistence.ts:1010-1020` reconstructs
the `SaveDocument` from explicit fields. Unknown keys are
silently dropped on roundtrip.

**Resolution:** This run extends `parseSaveDocument` to
preserve unknown top-level fields via an `extraFields`
property on `SaveDocument`. `stringifySave` includes
them. The fix is small + the test pin (INV-1) holds it.

### Finding B — NO ACTION: per-event sub-fields already round-trip

`EventLog` stores events as opaque objects;
`stableStringify` recurses without a schema; the
materializer reads only fields it knows about and ignores
the rest. INV-2 locks the contract; no fix needed.

### Finding C — NO ACTION: unknown event kinds replicate cleanly

`applySaveToLog` (lines 1071-1085) applies every event to
the log even when the kind is unknown to the
materializer. `EventLog.apply` validates only the
envelope (peerId, seq, clock, id) — the kind is a string.
Materializer registry's silent-no-op for unknown kinds
(state.ts:4283-4286) preserves the event for future
runtime versions. INV-3 locks the contract.

### Finding D — UNDER REVIEW: future v:2 payload shape

Some materializers do `isPayloadV1(event.payload)` AND
THEN read fields off the payload that may have moved in
v:2. Today's runtime correctly no-ops on a v:2 payload
(the isPayloadV1 check fails). But: if a future runtime
ships a v:2 with a renamed field, BOTH old and new
runtimes coexisting in a partition need to NOT corrupt
each other. The current model (no-op on unknown payload
version) handles this. INV-7 locks it.

**Open question for the consultant:** is there a sub-
field-renaming pattern that could surface a real bug?

### Finding E — DEFERRED: `causedByResponseId` audit

The `causedByResponseId` field at the event WRAPPER level
(not payload) is in some event kinds. The save-side
firewall strips it via `PER_KIND_SCRUBBERS`. Forward-
compat-wise: a future runtime adding more
wrapper-level audit fields should round-trip via INV-1's
pattern; lock the wrapper-level forward-compat as part of
the consultant's pass.

---

## 4. Maintainer self-check before adding a new event kind

When a new event kind ships:

1. Add to `KNOWN_EVENT_KINDS` in `src/core/state.ts`.
2. Add to `MATERIALIZERS` in `src/core/state.ts` (the
   INV-6 test fails otherwise).
3. Classify in `persistence.coverage.test.ts`'s strip vs.
   visible set (the existing classify-or-fail floor).
4. If the payload carries DM-only sub-fields, add a
   scrubber to `PER_KIND_SCRUBBERS` in
   `src/persistence.ts` AND ensure the materializer
   tolerates the stripped sub-field's absence per DEC-030.
5. If the kind name conflicts with a kind a future
   runtime might add, BUMP MINOR VERSION in
   `SAVE_SCHEMA_VERSION` (rare; almost always safe to
   skip).

---

## 5. Maintainer self-check before adding a new top-level field

When a new top-level field on `SaveDocument` ships:

1. Add to the `SaveDocument` interface in
   `src/persistence.ts`.
2. Update `parseSaveDocument` to recognize the new field
   (validate type, extract value).
3. Update `serializeSession` + `serializeSessionForViewer`
   to populate it.
4. BUMP MINOR VERSION in `SAVE_SCHEMA_VERSION` (this is
   the only case minor bump is REQUIRED).
5. Verify INV-1 still passes (unknown fields still
   round-trip — the new field is no longer "unknown" to
   us but we still must preserve fields beyond it).

---

## 6. What this contract does NOT cover

- **Back-compat.** Today's runtime is NOT required to
  read saves from a hypothetical future runtime that has
  BUMPED MAJOR. The human said "we only need forward
  compatibility."
- **Cross-runtime live sync.** Two peers running
  different runtime versions live: this contract covers
  what each peer's save can include, not what they emit
  on the wire. Wire-format forward-compat is a sibling
  contract (informal today; the same INV-2 + INV-3
  reasoning apply).
- **Materializer behavior on unknown payload v.** This is
  intentionally silent-no-op; INV-7 says so. A future
  runtime that wants to MIGRATE old payload to a new
  shape must do so explicitly (new event kind +
  materializer that picks up old kind too).

---

## 7. When this doc gets updated

- A new INV lands when a forward-compat hazard surfaces
  and gets enforced by a new test.
- A finding in §3 moves to RESOLVED when the fix lands +
  the INV test passes.
- The consultant's report (queued, run #14) may surface
  additional skeletons; those land here as Finding F+.
- A MAJOR version bump requires a new appendix at the
  end of this doc explaining the break.
