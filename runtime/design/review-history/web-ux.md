# Review history — web-ux

Per-lens running record of `(finding → resolution)` tuples from milestone gates.

## M2 — 2026-05-21

- **Three new CSS classes ship unstyled** (`.version-mismatch-banner`, `.raise-hand` / `.raise-hand-active`, `.roster-hand`). Affordances render as default browser elements.
  - Resolution: **acked**. Added minimum-viable styling for all three in `quire-app.css.ts` at gate close. Bundle 68.35 → 68.90 KB gzipped.

- **Light-DOM rendering is load-bearing.** All 5 regions use `createRenderRoot() => this`. M3 token migration becomes a per-region all-or-nothing CSS rewrite if shadow DOM is the target.
  - Resolution: **acked (plan A-1)**. M3a-entry decision: ship tokens as global stylesheet (cheaper) OR per-region selector migration. Light-DOM continues unless decision changes.

- **Region prop interface inconsistency.** `onSubmit` vs `onSubmitRoll` vs `onSubmitRename`; type-export inconsistency; scene-stage `headerExtras: TemplateResult` couples parent to region internals.
  - Resolution: **deferred: P1-regions-harmonize**. M3a opening task before 4 new DM-side regions.

- **Raise-hand button INSIDE `<form>`.** Accidental Enter could submit roll form. Crowds at 1100px.
  - Resolution: **deferred: P-M3a-raise-hand-position**.

- **Scene-strip frontmatter omission.** Same finding as TTRPG-craft.
  - Resolution: **deferred: P-M3a-scene-strip** (cross-listed).

- **Six shell wrappers create 6 shadow roots + slot projections per render.** Small cost; value at M3 grid promotion.
  - Resolution: **acked (note for M3a benchmark)**.

- **`role="status"` announce-timing on initial mount.** Browser-dependent.
  - Resolution: **deferred to H-7 audit**.

- **Rename form opens without focus management.**
  - Resolution: **deferred to H-7 audit**.

- **`static styles` correctly omitted in light-DOM regions.**
  - Resolution: **fine**.

- **No CSS class drift in M2 commits.**
  - Resolution: **fine**.

- **Bundle 63.93 → 68.90 KB cumulative.** Reasonable for the deliverables.
  - Resolution: **fine**. Well under M2's 85 KB cap.
