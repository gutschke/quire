# Review history — engine

Per-lens running record of `(finding → resolution)` tuples from milestone gates. Reviewers spawned with this lens are briefed with this file as context, so they don't re-flag resolved findings.

Format: one entry per finding, newest at the bottom.

```
## M<n> — <YYYY-MM-DD>
- **<area>**: <one-line summary>
  - Resolution: <acked | wontfix: reason | deferred: task-id>
  - Evidence/notes: <optional>
```

## M1 — 2026-05-21

- **payload versioning — v:1 invariant never enforced.** No materializer cases existed for the 18 M1-registered kinds; `EVENT_PAYLOAD_V1 = 1` was exported but no code rejected wrong-version payloads.
  - Resolution: **acked**. Added `isPayloadV1(payload)` predicate in `core/state.ts`; added explicit switch cases for all 18 new kinds that validate via `isPayloadV1` before break. 10 new hostile tests in `state.hostile.test.ts` pin the contract. Commit `fd33a25`.

- **bundle-gate .mjs runner cap drift unverified.** Test suite covered `bundle-gate.ts` but not the CI-invoked runner script.
  - Resolution: **acked**. Added 5 tests in `bundle-gate.test.ts` that read the `.mjs` as text and assert constants + regexes + exit paths match the TS source. Commit `fd33a25`.

- **LOC overrun — 2722 vs ≤1200 target.** Bulk is the ~1700 LOC of renderXxx templates the plan defers to M2 region work.
  - Resolution: **deferred to user**. Tiered LOC cap proposal (M1 ≤2750, M2 ≤1500, M3a ≤900) drafted in `STATUS.md`; requires user ack.

- **filterForViewer implemented but never wired.**
  - Resolution: **deferred: P0-4-followup**. Wire into `SessionController.view()` as `filteredShared` alongside the first M2 player-region commit.

- **H-4 banner is save-load-only; no runtime peer-version banner.**
  - Resolution: **deferred: P0-12-followup-banner + P0-12-followup-refuse-join**. Both land alongside the M2 roster region.

- **disconnected past coord-holder leakage.** Monotonic `coordHolders` keeps DM-only read access after yield+disconnect.
  - Resolution: **deferred: P0-4-followup-coord**. Split `coordHolders` from `currentCoordHolders` at M3a.

- **WorkingCopy path validation rejects `..` substring.** False-rejects `1.0..1.md`.
  - Resolution: **deferred: P4-1-followup-paths**. Share with `campaign-loader` validator.

- **runtime/.github/workflows empty dir.**
  - Resolution: **acked**. Removed in commit `5ac0815`.

- **QuireAppHooks type test only catches at build, not unit-test level.**
  - Resolution: **wontfix**. `npm run build` (which runs `tsc --noEmit`) is in CI; coverage is real. Documented in commit `400631e` context.

- **QuireApp.appState is now public; external assignment type-checks.**
  - Resolution: **deferred: P0-11-followup-appState**. Convert to readonly getter at M2.
