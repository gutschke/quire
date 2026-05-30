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
| Restored events propagate to other peers | TBD (M3) | CI unit + e2e |
| Save→restore byte-identical (modulo savedAt) | TBD (M4) | CI unit |
| LWW under same-ms coordinator-reclaim | TBD (M4) | CI unit |
| Schema-version mismatch rejects cleanly | `persistence.ts:530` + tests | CI unit |
| 100-event soak roundtrip | `e2e/soak.spec.ts:155` | nightly |

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

## Promotion targets

Three currently-e2e-only assertions to promote to CI-unit (M4):
1. Cross-week save→load→continue (`multi-session.spec.ts:117`).
2. Branch-divergence merge (`git-snapshot.spec.ts:243`).
3. 100-event soak (`soak.spec.ts:155`).

The pattern: replace the real WebRTC transport with the in-memory transport,
swap the e2e harness for vitest, keep the assertions verbatim. This was the
M3 / M3a / M3c pattern.
