# Review history — security

Per-lens running record of `(finding → resolution)` tuples from milestone gates.

Format: one entry per finding, newest at the bottom.

```
## M<n> — <YYYY-MM-DD>
- **<area>**: <one-line summary>
  - Resolution: <acked | wontfix: reason | deferred: task-id>
```

## M1 — 2026-05-21

- **No DoS guard on event count in applySaveToLog.** A hostile save with 10^6 events would be fully materialized.
  - Resolution: **acked**. `MAX_EVENTS_PER_SAVE = 100_000` cap in `parseSaveDocument`. Commit `5ac0815`.

- **UC_CLOSE sentinel validator absent at M1 but security.md promised it.**
  - Resolution: **acked (doc amendment route)**. Updated security.md to scope the validator to M3b alongside the AI broker. Implementation ships with the broker.

- **AI keys in localStorage not documented in security.md.**
  - Resolution: **acked**. Added "AI key storage" subsection documenting residual risk (extensions, devtools, clipboard managers, fork environments).

- **Autosave persists full event log; no DM-only filter for player resume.**
  - Resolution: **deferred: P2-3-followup**. M3a — AutosaveController must use `serializeSessionForViewer` for non-coord peers.

- **WorkingCopy + campaign-loader path validators diverge.**
  - Resolution: **deferred: P4-1-followup-paths**. Shared helper at M3a/M4.

- **coord-reclaim audit chat uses peerIds.** Currently safe (opaque ids); fragile to a future change.
  - Resolution: **acked**. One-line comment at the synthesis site in `core/state.ts`. Commit `5ac0815`.

- **Bundle classifier accepts `index-author.js` as 'main'.**
  - Resolution: **deferred: P0-7d**. Vite-build integration test in M5.

- **knownKindsCount inflation suppresses M2 banner.**
  - Resolution: **deferred: P0-12-followup-banner**. Trigger on `< local OR > local + 50`.

- **R3-A / R3-B regression checks**: tests intact, no regressions. **fine**.

- **filterForViewer wipes DM-only fields correctly**: 9 tests cover the four fields + reveal-mask + edge cases. **fine**.
