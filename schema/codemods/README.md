# Codemods

Codemods rewrite content from an older schema major to the current major. They live here so that the runtime can apply them on the fly when reading older content, and the `quire migrate` CLI can rewrite a repo in place.

## Convention

Each codemod lives in `<from>-to-<to>/` (e.g. `0.1-to-0.2/`). Inside:

- `codemod.js` (or `.ts`) — the pure-function migration. Signature: `function codemod(record) → record`. Pure: same input must produce same output every time, no side effects, no I/O.
- `test/*.in.json` — input fixtures.
- `test/*.out.json` — expected output fixtures.

The CLI's test harness asserts that running every codemod over its `.in.json` fixtures produces exactly the matching `.out.json`. Without those tests, the registry rots within a year — schemas evolve, codemods aren't exercised, and quiet bugs accumulate. The harness is non-negotiable.

## State as of v0.1.0

There are no codemods yet because there is no prior schema version to migrate from. When v0.2.0 ships with any breaking change, the first codemod lands here.

## Rules

- **Pure functions only.** No filesystem access, no network calls, no clocks, no UUIDs. If you need new identity for a record, derive it deterministically from existing fields.
- **No data loss.** Codemods may rename fields, restructure, or add defaults. They may not drop information without an explicit deprecation path.
- **Versioned in-repo.** Codemods are part of the Quire release. Forks that diverge from upstream must include their own codemod set if they break compatibility.
- **Runtime applies in-memory.** Reading older content via in-memory codemod is the normal path; the on-disk repo is not auto-rewritten. `quire migrate` is opt-in.
