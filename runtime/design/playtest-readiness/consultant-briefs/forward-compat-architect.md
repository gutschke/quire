# Consultant brief — Forward-compat / data-format architect

**Date queued:** 2026-05-30 (run #13)
**Sent by:** Playtest-Readiness Program Lead

## ROLE

You are a senior systems engineer whose specialty is
making formats survive their own evolution. You've worked
on protobufs / Cap'n Proto / Avro, you've seen IDL drift
the hard way, and you know the difference between "tests
green at HEAD" and "format will survive five years of
schema additions without conversion tools."

You walk into a cold room. The team has a JSON save
format. They want to lock it for a playtest, after which
breaking changes get expensive. The human's verbatim
ask: "make sure there are no hidden skeletons in the
current data format and ensure that it is extensible; we
only need forward compatibility though."

Specifically: the team needs to know what an UNKNOWN
future field added at any nesting level WILL DO to a save
that today's runtime parses. They need to know what
TODAY's runtime can SAFELY EVOLVE without breaking saves
already on disk.

## MANDATORY READS (cold-room briefing)

1. `/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/playtest-readiness-plan.md`
   §1.3 + §3 WS-A.
2. `/home/markus/src/ttrpg/quire/runtime/src/persistence.ts`
   — full file. Focus on `stringifySave`,
   `parseSaveDocument` (lines ~915-1022), the
   `SaveDocument` interface (~line 398), `SAVE_SCHEMA_VERSION`
   (~line 406), `applySaveToLog` (~line 1046), and the
   `stableStringify` family (~line 1098-1139).
3. `/home/markus/src/ttrpg/quire/runtime/src/core/state.ts`
   — search for `KNOWN_EVENT_KINDS`, `isPayloadV1`,
   `EVENT_PAYLOAD_V1`, the per-kind materializers in
   `MATERIALIZERS`. You don't need to read all 4297 lines
   — sample 10 materializers across the alphabetical range
   of event kinds.
4. `/home/markus/src/ttrpg/quire/runtime/design/save-restore-program/decisions.md`
   DEC-030 (materializers tolerate firewall-stripped
   optional sub-fields) — this is the precedent for the
   contract you're being asked to lock.
5. `/home/markus/src/ttrpg/quire/runtime/src/persistence.simulation-07-network-partition.test.ts`
   to see how concurrent peers' logs converge after
   restore.
6. `/home/markus/src/ttrpg/quire/runtime/src/persistence.restore-drill.test.ts`
   to see the byte-identical roundtrip contract.

## SPECIFIC QUESTIONS

Answer each with file:line citations.

1. **Top-level forward compat.** `parseSaveDocument`
   (lines ~1010-1020) reconstructs the `SaveDocument`
   shape from explicit fields. Unknown TOP-LEVEL keys are
   silently dropped. What are the consequences when a
   future runtime adds a `dmAnnotations` top-level field
   and writes a save that today's runtime then reads? Is
   "drop silently" the right behavior? Or should we
   preserve unknown fields in a passthrough bag?

2. **Per-event sub-field forward compat.** The
   `stableStringify` recurses into objects and arrays
   without a schema. Per-event sub-fields are stored as
   opaque objects in `EventLog`. So a future runtime
   adding a new sub-field to `pc-edit`'s payload IS
   preserved by today's stringify on roundtrip — verify
   this is true. Where would it break?

3. **Unknown event KIND.** `applySaveToLog` accepts
   events with unknown kinds (counts them in
   `unknownKinds`) and applies them to the log. The
   materializer's switch silently drops them. But the
   event stays in the log + replicates via sync-response.
   Is this the correct behavior for forward compat? What
   happens when a peer running OLD runtime is the
   coordinator and a peer running NEW runtime authors a
   new-kind event? Walk the path.

4. **Major-version gate.** `parseSaveDocument` refuses
   saves whose `$schemaVersion` major doesn't match
   ours. Currently `SAVE_SCHEMA_VERSION = '0.1.0'`. What
   does the team need to lock about WHEN to bump major
   vs. minor vs. patch? Propose a concrete contract
   anchored in this codebase.

5. **Payload `v: 1` versioning.** `isPayloadV1` is a
   load-bearing gate per `applySessionDigestEvent` and
   neighbors. What's the migration path when an event
   kind needs to evolve to `v: 2`? Walk a hypothetical
   scenario (e.g. `session-digest v: 2` adds a new
   `summaryTokens` field). Does today's code tolerate it?
   Should it?

6. **Hidden skeletons.** Walk every event kind and look
   for FIELDS that look forward-compat-hostile:
   - Fields that are REQUIRED in the materializer but
     OPTIONAL on the wire (a precedent for DEC-030).
   - Fields whose absence is a sentinel for a behavior
     change.
   - Fields whose validation is strict-eq vs. range/set
     membership.

   Report 0-3 high-priority surfaces.

7. **The materializer registry.** `MATERIALIZERS` (per
   `state.ts:4290`-ish) is the SSOT for "what kinds we
   know about." Is there a missing self-completing test
   that asserts EVERY entry in
   `MATERIALIZERS.keys() === KNOWN_EVENT_KINDS`? Today
   it's stated as `state.ts:4290`-ish; verify there's a
   regression test pinning it.

8. **CRDT determinism guarantee.** The format depends on
   stable peerId-based tiebreaking for concurrent writes.
   Are there any forward-compat changes that could
   invalidate the LWW ordering (e.g. adding a timestamp
   field that's used in tiebreaks)? Cite the LWW logic
   path.

9. **The `unknownFields` proposal.** The lead is
   considering adding an `unknownFields` counter to
   `ParseResult` so the host can warn "this save was
   written by a newer version." Worth it? Or is the
   current "silent drop" the right default?

10. **What you would lock as the format-stability
    contract.** Propose 5-10 concrete invariants for a
    new doc at
    `design/playtest-readiness/format-stability.md`. Each
    invariant must be testable.

## OUTPUT FORMAT

```
# Forward-compat architect report — 2026-05-30

## Top 5 hidden skeletons (ranked)

1. <one-line> — file:line — severity — fix shape
...

## Format-stability contract proposal

1. <invariant statement that's testable>
...

## Q1-Q10 answers

### Q1 — Top-level forward compat
<answer>

...
```

## OUTPUT FILE PATH

`/home/markus/src/ttrpg/quire/runtime/design/playtest-readiness/review-history/forward-compat-architect-2026-05-30.md`

## WORD BUDGET

600 words. Slightly higher than other consultants
because the analysis is dense.

## CONSTRAINTS

- Forward-compat ONLY. The human said no conversion
  tools are required. We are NOT defending against
  back-compat scenarios.
- Cite file:line for every claim.
- For each invariant you propose, name the assertion
  shape ("in `<file>`, assert `<concrete expect>`").
- Do not propose schema changes that break existing
  saves — the lead has saves in flight.
- Do not propose adding a JSON Schema validator
  library — overkill; the existing TS interfaces +
  manual checks are the right tier.
