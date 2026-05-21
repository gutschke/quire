# Review history — performance

Per-lens running record of `(finding → resolution)` tuples from milestone gates.

Format: one entry per finding, newest at the bottom.

```
## M<n> — <YYYY-MM-DD>
- **<area>**: <one-line summary>
  - Resolution: <acked | wontfix: reason | deferred: task-id>
```

## M1 — 2026-05-21

- **tokens.css.ts dead-weight.** ~700 B gz of CSS custom properties on `:host` shipped to no consumer (no `var(--…)` references existed at M1).
  - Resolution: **acked**. Removed `tokens` from QuireApp's `static styles` array. Module stays in place for M2 region components to import directly. Commit `f80c05d`. Bundle dropped 66.51 → 65.93 KB.

- **AI key/prompt inputs trigger full QuireApp re-render per keystroke.** `setApiKey`/`setSystemPrompt` wrote to `localStorage` synchronously and called `host.requestUpdate()` on every `@input` event.
  - Resolution: **acked**. Added 300 ms debounce on `localStorage` writes in `AiKeyStore`. In-memory state still updates synchronously (input stays responsive); persistence coalesces to one flush. `hostDisconnected` flushes pending writes on unmount. Tests gain `flushAiKeyStore()` / `flushPending()` helpers. Commit `f80c05d`.

- **bundle-gate uses gzip level 6 vs Vite's level 9.** Gate reported ~1.55 KB looser than CDN-served reality.
  - Resolution: **acked**. `.mjs` runner now passes `{ level: 9 }`. Commit `5ac0815`. Bundle inventory after fix: main 64.36 KB / bundler 30.74 KB.

- **Bundle-gate ignores 'other' chunks.** PeerJS bundler chunk (~31 KB) loads at session host/join but is uncapped.
  - Resolution: **deferred: P0-7c**. Add `OTHER_CHUNK_CAP_BYTES` or total cold-path cap in M2.

- **Six shell elements use `display: contents`.** Boot-time cost only at M1 (one-shot class definitions); no per-render cost because nothing instantiates them. **fine for M1**; M2 reviewer should verify they actually appear in the render tree once region content extracts.

- **Autosave stringifySave runs unconditionally before quota check.**
  - Resolution: **deferred: P3-3-followup-autosave-cost**. Pre-check event count before serializing at M3a.

- **IndexedDB has no `close()`.** Connection stays open for the page lifetime.
  - Resolution: **deferred: P4-1-followup-close**. Add at M4 when multi-instance use lands.

- **CI Node version mismatch.** `engines >= 18` but workflow pins 20.
  - Resolution: **acked**. Bumped `engines` to `>= 20`. Commit `5ac0815`.

- **The H-4 banner string allocates per save-load.** Trivial cost. **fine**.

- **Test suite duration 9s for 650 tests.** Acceptable. **fine**.
