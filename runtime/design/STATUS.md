# STATUS

Current milestone: **M1 — Foundation: god-object decomposition**

## Acceptance criteria progress

- [ ] `src/quire-app.ts` ≤ 1200 LOC
- [ ] `src/controllers/session-bootstrap.ts` extracted
- [ ] `src/controllers/autosave-controller.ts` extracted
- [ ] `src/controllers/ai-key-store.ts` extracted
- [ ] `src/sync/working-copy.ts` exists with IndexedDB store
- [ ] `src/ui/shell/` with `<quire-shell>` + 5 region elements
- [ ] `src/ui/styles/tokens.css` with oklch + clamp typography
- [ ] `src/ui/modes/mode-state.ts` + AppMode URL routing
- [ ] All 17 new event kinds in `KNOWN_EVENT_KINDS` with `v: 1` versioning
- [ ] `filterForViewer` helper with unit tests
- [ ] H-4 unknown-kind banner + peer version-gating at join
- [ ] CI bundle-size gate active with `bundle-gate.test.ts`
- [ ] Bundle ≤ 72 KB gzipped at M1
- [ ] All existing tests pass; `QuireAppHooks` interface stable
- [ ] `STATUS.md` (this file) up to date
- [ ] `runtime/design/review-history/` exists

## Current state

- 2026-05-21 — STATUS.md bootstrapped. Starting M1.
- Reviewing quire-app.ts structure to plan extraction.

## Blockers

None.

## Next planned commit

CSS extraction to `src/ui/styles/tokens.css` (facade-migration step 1).
