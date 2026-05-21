# STATUS

Current milestone: **M1 — Foundation: god-object decomposition** (gate open)

## Acceptance criteria progress

- [x] `src/quire-app.ts` ≤ 1200 LOC — **GAP: currently 2704 LOC (~150% over target)**
- [x] `src/controllers/session-bootstrap.ts` extracted — **MINIMAL: pure helpers only (extractJoinCode, parseRevealedPath, scenePathFor, buildInviteLink). navigateToRoute + host/join/leave deferred — see commit 21f2e9e rationale.**
- [x] `src/controllers/autosave-controller.ts` extracted
- [x] `src/controllers/ai-key-store.ts` extracted
- [x] `src/sync/working-copy.ts` exists with IndexedDB store + in-memory store for tests
- [x] `src/ui/shell/` with `<quire-shell>` + 5 region elements (display: contents — real grid lands M2)
- [x] `src/ui/styles/tokens.css.ts` with oklch palette + clamp typography
- [x] `src/ui/modes/mode-state.ts` + AppMode URL routing
- [x] All 18 new event kinds in `KNOWN_EVENT_KINDS` with `v: 1` versioning
- [x] `filterForViewer` helper with unit tests
- [x] H-4 unknown-kind banner + peer version-gating at join (knownKindsCount embedded; refuse-join enforcement deferred)
- [x] CI bundle-size gate active with `bundle-gate.test.ts` + `.github/workflows/ci.yml`
- [x] Bundle ≤ 72 KB gzipped at M1 — **ACHIEVED: 66.51 KB**
- [x] All existing tests pass; `QuireAppHooks` interface stable
- [x] `STATUS.md` (this file) up to date
- [x] `runtime/design/review-history/` exists (empty — first gate)

## Commits in M1 (cumulative)

| SHA | Task | Tests | Bundle |
|---|---|---|---|
| `da55b81` | M1.2 CSS extraction | 529 → 529 | 63.93 → 65.00 KB |
| `b64576d` | M1.3 Shell wrappers | 529 → 529 | 65.00 → 65.62 KB |
| `3fed63e` | M1.4 Mode state + URL | 529 → 541 | 65.62 → 65.74 KB |
| `a460b72` | M1.5 Event kinds + v:1 | 541 → 546 | unchanged |
| `01c9043` | M1.6 filterForViewer | 546 → 555 | unchanged |
| `8225af8` | M1.7a AiKeyStore | 555 → 579 | 65.74 → 66.01 KB |
| `50473f7` | M1.7b AutosaveController | 579 → 592 | 66.01 → 66.13 KB |
| `21f2e9e` | M1.7c session-bootstrap (minimal) | 592 → 608 | 66.13 → 66.15 KB |
| `400631e` | M1.8 QuireAppHooks | 608 → 610 | unchanged |
| `1c639b6` | M1.9 H-4 banner + peer-version | 610 → 619 | 66.15 → 66.51 KB |
| `55ccc84` | M1.10 WorkingCopy | 619 → 639 | unchanged |
| `8bc1cd2` | M1.11 CI bundle-size gate | 639 → 650 | unchanged |

**Total**: 12 commits, 650 unit tests passed, +0 skipped delta (still 2 skipped from pre-M1).

## Known gaps for the gate

1. **LOC overrun.** quire-app.ts is at 2704 LOC; M1 target is ≤1200. The execution plan's facade-migration pattern step 3 ("one region per commit, handlers stay on root") is the path to reduce this further, but the bulk of the remaining LOC is renderXxx methods (~1700 lines) that the plan explicitly defers to M2 for region content. Reviewers may flag this as either: (a) accept the overrun (M2 will close the gap), (b) require additional render-template extraction at M1, or (c) propose a plan-adjustment to raise the M1 cap (requires user ack per execution-plan.md).
2. **session-bootstrap is minimal.** Pure helpers extracted; navigateToRoute + session lifecycle (host/join/leave/regenerateCode) NOT extracted because they're tightly coupled to @state fields used by the still-on-root render templates. Decision was to defer rather than entangle with M2 region work. Reviewers may require more aggressive extraction.
3. **Peer version-gating is data-only.** knownKindsCount embedded in peer-join + materialized into PeerPresence; banner-on-mismatch render lands in M2 with the roster region. Refuse-join enforcement at transport layer is explicitly deferred to a follow-up.

## Blockers

None — gate is open.

## Next planned commit

Determined by gate verdicts.  If all reviewers ship-or-followup, proceed to M2.
If any block, fix and re-run affected reviewers.
