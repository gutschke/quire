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

## M2 — 2026-05-21

- **Ratchet creep, second iteration.** LOC cap was raised twice (≤800 → ≤1200 at M1; tiered to ≤2750/≤1500/≤900 at M1 gate). M2 missed ≤1500 by 939 LOC.
  - Resolution: **partial ack + reframe** (user pushback led to code-quality expert evaluation 2026-05-21).
    - Adversarial's process diagnosis was right: the LOC target moved when convenient.
    - Adversarial's design implication (chase the number) was wrong: LOC was a proxy for navigability + vocabulary-separation, not the goal.
    - At 2439 LOC, the file is a coordinator with three identifiable fat spots (renderSessionBar 216 LOC, navigateToRoute policy logic 80 LOC, AI panel cluster 174 LOC). It is NOT a god-object.
    - M3a's ≤900 LOC cap was unphysical for a Lit root with legitimate dispatch+lifecycle+input-handler responsibilities. Replaced with structural criteria: max-method-LOC ≤80, delegation ratio ≥75%, three named extractions (`<session-bar>`, `route-policy.ts`, `<ai-panel>`), safety-net ≤2000 LOC. These force the same work the LOC cap was incentivizing, but with the failure mode aligned to "the code is bad" rather than "the number is bad."
    - See `runtime/design/review-history/` and the agentId in the Adversarial M2 review transcript for the full expert rationale.

- **Pace, second iteration.** M2 wrapped in ~30 minutes wall-clock vs 2-3-week estimate. Same yellow flag as M1.
  - Resolution: **acked (plan)**. STATUS records the cadence delta; redesign-plan.md adds P-M3a-pace-acknowledge for an honest time-estimate revision at M3a entry.

- **Four design-spec deviations carried into M3a; only 2 surfaced.** Scene-strip frontmatter (in STATUS); tap-to-expand (in STATUS); chat-as-sibling (only in M2.7 commit body, not STATUS); dice 6-chip layout (only in M2.6 commit body, not STATUS).
  - Resolution: **acked**. STATUS now has "Design-spec deviations carried into M3a" subsection enumerating all four.

- **STATUS.md cadence regressed.** 1 of 9 M2 commits touched STATUS (vs M1's 2 of 13).
  - Resolution: **deferred: P-M3a-status-cadence-decision**. M3a entry: drop the rule honestly, add a pre-commit hook, or commit STATUS as a separate commit between feature commits.

- **filteredShared zero consumers.** Same finding as TTRPG-craft.
  - Resolution: **deferred: P-M3a-filteredShared-migrate** (cross-listed). M3a HARD acceptance criterion (FIRST commit).

- **Unstyled version-mismatch banner.** Security-relevant affordance ships visibly broken.
  - Resolution: **acked**. CSS added at gate close (cross-listed with web-ux HIGH).

- **M2.9 batched 3 follow-ups in one commit.** Revert risk; M2.9 unwinds 3 unrelated items.
  - Resolution: **acked (process note)**. Future commits should split independent follow-ups.

- **DM raise-hand glyph render path** unreachable from UI but data flow exists. Same finding as TTRPG-craft.
  - Resolution: **deferred: P1-7-followup-hand-dm-decision** (cross-listed).

- **Region prop interfaces are snowflakes.** Same finding as web-ux.
  - Resolution: **deferred: P1-regions-harmonize** (cross-listed).

- **No e2e for raise-hand.** Cross-cutting "round-trip e2e per milestone" rule violated.
  - Resolution: **deferred: P0-12-followup-e2e**.

- **quire-app.ts wrapper growing.** renderRollPanel adds 3 computed props for the dice region. Not yet violating facade pattern but trending.
  - Resolution: **acked (watch in M3a)**. Move into a dice-dock controller when M3a adds the full stat-chip layout.

