# Review history — adversarial

Per-lens running record of `(finding → resolution)` tuples from milestone gates.

Format: one entry per finding, newest at the bottom.

```
## M<n> — <YYYY-MM-DD>
- **<area>**: <one-line summary>
  - Resolution: <acked | wontfix: reason | deferred: task-id>
```

## M1 — 2026-05-21

- **LOC overrun (acceptance criterion missed).** 2722 LOC vs ≤1200 target. Raising the cap unilaterally would teach "the cap moves when convenient" (it was already raised once from v0.1's 800 to v0.2's 1200).
  - Resolution: **deferred to user**. Tiered cap proposal (M1 ≤2750 / M2 ≤1500 / M3a ≤900) in `STATUS.md` requires user ack per execution-plan.md.

- **session-bootstrap deferral inverts cause-and-effect.** The lifecycle methods (host/join/leave) get MORE coupled after M2 (when their @state moves into regions), not less.
  - Resolution: **deferred: P0-8b**. Extract at M1 close-out OR as the first M2 commit; landing it in M1 territory.

- **STATUS.md NOT updated commit-by-commit.** Touched in 2 of 13 M1 commits.
  - Resolution: **acked (process note)**. Restated cadence requirement for M2. Documented as **H-process-status-cadence** in `redesign-plan.md`.

- **bundle-gate .mjs script no regression test.** Same finding as Engine HIGH #2.
  - Resolution: **acked** (cross-listed). See engine.md M1 entry.

- **QuireAppHooks type test too loose.** Method-signature widening passes silently.
  - Resolution: **deferred: P0-11-followup**. Add bidirectional `MutuallyAssignable<A, B>` check at M2 close.

- **AiKeyStore.hostConnected likely produces a double-render on mount.**
  - Resolution: **deferred**. Low-priority follow-up at M2 (controller init optimization).

- **AppMode plumbing is data-only.** No UI consumer at M1; risk that future commits treat appMode branches as "free" and pile conditionals into the still-2700-LOC render method.
  - Resolution: **acked (process note)**. M2 reviewer should assert each region branches on mode in its own render, not in the root.

- **Shell wrappers add ceremony without isolation.** Six `display: contents` wrappers each define their own shadow root + customElement registration.
  - Resolution: **deferred**. M2 reviewer to verify the wrappers appear in the render tree once region content lands (currently the renderXxx output still flows directly into `quire-app`'s shadow root because the methods stay on root per the facade-migration pattern).

- **CI gate omits CLI subproject.**
  - Resolution: **acked**. Added a `cli` job to `.github/workflows/ci.yml`. Commit `5ac0815`.

- **STATUS.md said 2704 LOC, actual 2722.** Minor drift.
  - Resolution: **acked**. Will update STATUS at gate close.

- **`accessibility.md` exists in review-history but a11y is no longer a per-milestone gate.**
  - Resolution: **acked**. Delete the file; H-7 audit cycle owns accessibility instead.

- **M1 completed in ~3 hours wall-clock.** Suspicious for a milestone the plan estimated at 3-4 weeks.
  - Resolution: **acked (process note)**. Flagged for M2; if M2 also wraps fast with similar gaps, the planner is over-stating milestone difficulty and the descope ladder is misleading.

- **EVENT_PAYLOAD_V1 = 1 exported but no enforcement** (cross-listed with Engine HIGH #1).
  - Resolution: **acked** (see engine.md).

- **Event-kind count drift (17 vs 18) in execution-plan.md.**
  - Resolution: **acked**. Fixed in commit `5ac0815`.
