# GitHub Publish-and-Fork Analysis (M6c-A scope-finder)

**Status:** 🟢 Phase A complete — verification + findings (2026-05-29, run #4)
**Outcome:** Publish-and-fork is **MECHANICALLY POSSIBLE TODAY**.
The save format and event-log architecture support the flow without
runtime changes. The M6c-A work is **publish-side UX + a small
publish-time scrub helper**, not engine surgery.

## Bottom line for the human

| Question | Answer |
|---|---|
| Q1: Can a different DM clone + load + play? | **YES, today.** Verified by `src/persistence.publish-fork.test.ts` (10 tests passing). |
| Q2: Can they cherry-pick partial event ranges? | **YES, with a publish-side UX caveat.** Truncation must respect per-author causal boundaries. Mechanical layer accepts arbitrary truncation but it can leave a causal gap that manifests as missing chat/reveals. |
| Q3: Are there events that don't travel well? | **MINOR P2 — `peer-join` + `coordinator-claim` from original DM remain in the materialized state.** No security impact under DEC-023; the failure mode is UI clutter / authority bleed. |
| Q4: Publish-side scrub semantics? | **REUSE non-coord projection.** `serializeSessionForViewer(..., savedByPeerId, coord)` with savedByPeerId != coord triggers the existing player-scope scrub. The same `PLAYER_SCOPE_STRIP_KINDS` + `PER_KIND_SCRUBBERS` registry is the publish-side firewall. **No new firewall list needed.** |
| Q5: Repo layout? | **Format is destination-agnostic.** Recommend distinct paths: `saves/<slug>.json` (personal backup, M6c-B) vs `published-seeds/<slug>.json` or a git tag (published seed, M6c-A). |

## Why this matters

- **Engine surface stays small.** No changes to `persistence.ts`,
  `EventLog`, or materializer for M6c-A. The publish-side scrub
  composes with existing primitives.
- **Sequencing:** M6c-A can ship effectively in parallel with
  M6c-B since they share the GitHub PKCE / Device Flow auth
  surface. The difference is just the publish-time scrub helper
  + a different default destination path.
- **No P0/P1 findings.** The findings are all P2 UX/clutter
  items that get cleaned up by a publish-time scrub UX, not
  blocking issues.

## Verification matrix

See `src/persistence.publish-fork.test.ts` for the 10 mechanical
assertions. Test outcomes:

### Q1 — Clone + load + play

- ✅ Different DM (different peerId) loads the original save and
  inherits chat + revealed scenes.
- ✅ Forking DM can author `coordinator-claim` and immediately gets
  added to `coordHolders`; can then author `scene-reveal` events
  (the materializer gates coord-authority via `coordHolders`).
- The forking DM points their fork at a DIFFERENT campaign
  manifest (`forking-dm/my-spin-on-the-classic@main`). The
  `SaveDocument.campaign` field is metadata, not a binding
  constraint.

### Q2 — Partial event ranges (truncate-and-fork)

- ✅ Truncating at an episode boundary (drop the last N events
  cleanly) works: no rejected events, materialized state cleanly
  reflects the truncated history.
- ⚠️ **FINDING (P2 publish-side UX):** Truncation that omits an
  event in the MIDDLE of one author's per-peer sequence does NOT
  fail the EventLog validation (each event's clock is
  self-consistent), but it creates a CAUSAL GAP — the loaded log
  will be missing whatever state that event would have set. The
  publish-time UI must pick a "save point" that is a clean
  per-author boundary (e.g., "end of episode 2") to avoid gaps.
- The mechanical layer does NOT enforce the boundary; this is a
  publish-side responsibility.

### Q3 — Events that don't travel well

- ⚠️ `peer-join` events from the original DM persist into the
  forked materialized state. The forking peer's roster contains
  BOTH peers; the original is technically "in the roster" but
  not at the table. P2 (UI clutter, no security implication).
- ⚠️ `coordinator-claim` from the original DM persists in
  `state.coordHolders`. The original DM retains "ever-was-coord"
  authority in the forked log — meaning if their old event log
  somehow got rebroadcast into the fork, their old scene-reveal
  events would be accepted. P2 in practice: the original DM
  has no connection to the forked table, so this is a
  documentation concern not a security one.
- ✅ Transient state (pairing-code, AI api keys, AI prompts as
  drafts, chat draft, current route) is structurally excluded
  from `SaveDocument` per the persistence.ts head comment.

**Publish-side scrub recommendation:** drop `peer-join` and
`peer-leave` events for the original peers (the roster only needs
the forking peer's joins going forward). `coordinator-claim` and
`coordinator-reclaim` from the original DM are arguable — keeping
them honors historical attribution; dropping them gives the
forker a "clean slate" feel. Suggest a publish-time toggle.

### Q4 — Publish-side scrub semantics

- ✅ **`serializeSessionForViewer(..., savedByPeerId,
  coordinator)` with savedByPeerId !== coordinator already
  applies the player-scope scrub.** The same primitive that
  player-autosaves use IS the publish-side firewall.
- ✅ **No new firewall list.** Every future DM-only event kind
  added to `PLAYER_SCOPE_STRIP_KINDS` automatically becomes
  publish-stripped.
- ✅ **Critical finding for M6c-A roadmap:** The publish UX MUST
  use the non-coord projection by default. A `publishForSeed()`
  helper that wraps `serializeSessionForViewer(events, campaign,
  publisherPeerId, /* coord = */ 'sentinel-not-publisher')` is
  the cleanest surface. The current `serializeSessionForViewer`
  signature is sufficient; the helper is for naming + intent
  clarity.

This is a **load-bearing finding under DEC-023 class 1.** A
careless M6c-A implementation that uses the full DM-coord save as
the publish seed would put DM scratch-notes, AI prompts, NPC
pins, etc. on a PUBLIC GitHub repo — internet-rando-readable
forever.

### Q5 — Repo layout

- ✅ `SaveDocument` has no path/layout fields; the destination is
  a downstream concern.
- Recommended convention (for the M6c-A docs):
  - `saves/<slug>.json` for personal backup (M6c-B).
  - `published-seeds/<slug>.json` or a git tag (`seed-end-of-
    ep02`) for published seeds (M6c-A).
- Tags give forkers a stable cherry-pick anchor in the GitHub
  workflow: "Fork the repo, check out tag `seed-end-of-ep02`,
  load `published-seeds/<slug>.json` into Quire."

## M6c-A scope (derived from Phase A findings)

Minimum-viable M6c-A:

1. **Publish-time scrub helper:** `publishSeedFromSession()` in
   `persistence.ts` that wraps `serializeSessionForViewer` with
   the non-coord projection AND drops `peer-join` / `peer-leave`
   from the original peers. (Future enhancement: optional
   "include original DM's coord-history" toggle.)
2. **Publish destination UX:** "Publish a seed for others to
   fork" button in the DM-only operational view. Writes to
   `published-seeds/<slug>.json` (config-tunable). Surfaces a
   "What's in the seed" preview (DM can verify no DM-only
   content leaked) AND a clear "Anyone on the internet will be
   able to read this" confirmation.
3. **Publish-time consent ceremony:** Sister to DEC-011's
   first-push player-content consent — for publish, the DM
   acknowledges they are making the player-scoped projection
   PUBLIC. Player content (chat, character drafts, bond notes)
   IS in the published seed; the player content firewall ethos
   needs explicit DM sign-off here just like for personal
   backup.
4. **Fork-side discovery UX:** "Load a published seed" workflow
   (M6c-A consumer). The forking DM clones a repo, points Quire
   at the seed JSON file (file picker or "Pull from URL"), and
   gets dropped into a fresh campaign initialized from the seed.
5. **Documentation:** README pattern for "publish your campaign
   for community fork." Coordinated with Underleaf's existing
   content-on-GitHub pattern (campaigns ALREADY live on GitHub
   via Underleaf; the save format is a natural complement).

## What M6c-A does NOT need

- ❌ A new save format.
- ❌ A new firewall list.
- ❌ Engine changes in `persistence.ts`, `EventLog`, or
  materializer.
- ❌ Cherry-pick mechanics in Quire itself — GitHub's fork +
  branch workflow IS the cherry-pick UX. The forking DM uses git
  to choose which seed they want to load.

## Sequencing recommendation

M6c-A and M6c-B share the GitHub auth surface (Device Flow,
public_repo scope). They can ship in either order:

- **M6c-B first:** if account-loss durability is the urgent
  driver (per DEC-016/DEC-022, this is the rationale for
  M6c-before-M6b). M6c-B ships personal-backup as the second
  durability surface alongside Drive.
- **M6c-A first:** if community publish is the urgent driver
  (Underleaf-style campaign-publish symmetry).
- **Both at once:** sharing the auth + Device-Flow surface, with
  a single PR that adds both destination paths.

Recommendation: **M6c-B first (DEC-016 priority), M6c-A
immediately after on the same auth foundation.** The publish-side
scrub helper is a 50-line addition once the GitHub write path
exists.

## New open problems filed

- **OP-033 (NEW):** M6c-A publish-side scrub helper +
  consent ceremony. [R4: class 1 firewall, P1 — blocks M6c-A
  ship.] Reuses `serializeSessionForViewer` with the non-coord
  projection; adds publish-time `peer-join` / `peer-leave` drop;
  adds first-publish DM acknowledgment dialog (sibling to
  DEC-011 / DEC-020).
- **OP-034 (NEW):** M6c-A publish-time event-range truncation
  UI. [R4: class 2 UX, P2 — non-blocking.] DM picks a seed
  point that's a per-author causal boundary. The mechanical
  truncation is straightforward; the UX for picking the
  boundary needs design.
- **OP-035 (NEW):** M6c-A publish-side roster scrub: drop
  `peer-join` / `peer-leave` of historical peers. [R4: class 2
  UI clutter, P2 — non-blocking.] Cosmetic for v1.

## Test fixtures

`src/persistence.publish-fork.test.ts` (10 tests) is the
mechanical-behavior pin. Future M6c-A code should extend this
suite with the `publishSeedFromSession()` helper assertions.
