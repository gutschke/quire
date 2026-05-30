# Test Strategy

Map every invariant to its assertion + the gate that enforces it.

## Firewall invariants

| Invariant | Assertion | Gate |
|---|---|---|
| Every event kind is classified | `persistence.coverage.test.ts:34` enumerates `KNOWN_EVENT_KINDS` | CI unit |
| DM-only kinds don't reach non-coord saves | `persistence.hostile.test.ts` per-kind tests | CI unit |
| Field-granularity scrubbing for `pc-edit` | `persistence.coverage.test.ts:125` iterates `DM_ONLY_CHARACTER_FIELDS` | CI unit |
| Field-granularity scrubbing for `pc-create` | `persistence.hostile.test.ts:292` (SEC-1) | CI unit |
| Field-granularity scrubbing for `pc-retire/archive` | `persistence.hostile.test.ts:213` (B-1) | CI unit |
| Field-granularity scrubbing for `focus-grant` | `persistence.coverage.test.ts:194` | CI unit |
| Field-granularity scrubbing for `bond-ratify` | TBD (M1) | CI unit |
| **NEW M1:** Field-granularity scrubbing for `map-blob-add` (unrevealed labels) | `persistence.hostile.test.ts` new | CI unit |
| **NEW M1:** `causedByResponseId` strip on `pc-create`/`pc-edit` | `persistence.hostile.test.ts` new | CI unit |
| **NEW M1:** Save-path taint fuzz | `persistence.firewall-fuzz.test.ts` new | CI unit |
| **NEW M1:** Self-completing scrubber registry lint | `persistence.coverage.test.ts` new | CI unit |

## Correctness invariants

| Invariant | Assertion | Gate |
|---|---|---|
| Restored events propagate to other peers | `peer.restore-rebroadcast.test.ts` (M3) | CI unit + e2e |
| Save→restore byte-identical (modulo savedAt) | `persistence.restore-drill.test.ts` (M4) | CI unit |
| LWW under concurrent coordinator-claim | `persistence.restore-drill.test.ts` (M4) | CI unit |
| Schema-version mismatch rejects cleanly | `persistence.ts:530` + tests | CI unit |
| 100-event soak roundtrip | `persistence.restore-drill.test.ts` (M4) + `e2e/soak.spec.ts` | CI unit + e2e |

## Durability invariants

| Invariant | Assertion | Gate |
|---|---|---|
| Pending autosave flushes on tab-hidden | TBD (M2) | CI unit + manual |
| `navigator.storage.persist()` requested | TBD (M5) | CI unit + manual |
| Eviction recovery surfaces SOMETHING (DM only) | TBD (M5) | manual + sim |

## UX invariants

| Invariant | Assertion | Gate |
|---|---|---|
| Resume prompt shows scene + PCs + digest | TBD (M5) | e2e |
| Recently-played list on no-campaign landing | TBD (M5) | e2e |
| In-fiction copy reviewed | TBD (M8) | manual + TTRPG-expert sign-off |
| **Silent-player firewall:** no player-facing "your save was evicted" | Negative test (M5) | CI unit |

## Promotion targets — STATUS

Three currently-e2e-only assertions promoted to CI-unit in M4
(`persistence.restore-drill.test.ts`):
1. ✅ Cross-week save→load→continue.
2. ✅ Branch-divergence merge (both A-then-B and B-then-A orderings).
3. ✅ 100-event soak (byte-identical roundtrip + 0 unknownKinds + convergence).

Plus OP-004 (LWW determinism under concurrent coord-claim) was queued
for M4 and lands in the same drill file.

The pattern: replace the real WebRTC transport with the in-memory transport,
swap the e2e harness for vitest, keep the assertions verbatim. This was the
M3 / M3a / M3c pattern. `npm run drill` runs the focused subset locally.

Note on the "nightly" framing in the roadmap: the drill tests run on
EVERY `npm test` (every push + PR), not just nightly. The original
roadmap conservatively budgeted them as nightly because of e2e
overhead; the unit-test promotion makes them effectively-free, so they
run on every CI invocation. Nightly e2e is still useful for the
WebRTC-in-real-browser version of these same scenarios.
