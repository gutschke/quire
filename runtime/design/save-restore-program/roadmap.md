# Save/Restore Roadmap

Sequencing principle: **firewall leaks first** (real data exposed today), then
**correctness** (the "any party member can continue" promise is currently false),
then **durability** (data loss windows), then **discoverability + honest scope**.

## M0 — Living docs bootstrapped (DONE 2026-05-29)

Roadmap published, charter written, expert findings catalogued in this doc set.

## M1 — Firewall: seal known leaks + self-completing tripwire (DONE 2026-05-29)

**Adversarial findings 1 + 2 + 3 + 4 from the 2026-05-29 review.** Real data
leaks today through the save path. Highest-impact-per-LOC fix on the board.

DoD:
- `map-blob-add` payload labels for unrevealed blobs do NOT reach a non-coord save.
- `causedByResponseId` is scrubbed from `pc-create` and `pc-edit` for non-coord saves (latent leak today; closes ahead of future logging extensions).
- `PER_KIND_SCRUBBERS` becomes self-completing: any new event kind that carries DM-only sub-fields trips a CI lint if not registered (analogous to the existing kind-level lint in `persistence.coverage.test.ts`).
- Save-path taint fuzz (#420) lands — companion to `state.firewall-fuzz` for the SAVE STREAM.
- Tests prove the leak is fixed AND prove regression class can't silently recur.

## M2 — Tab-close durability (DONE 2026-05-29)

**Architect finding 5 + Test-QA finding 2.** The 1.5s autosave debounce window
is structurally lost on tab-close. `hostDisconnected()` actively cancels.

DoD:
- Flush-on-unload via `visibilitychange === 'hidden'` (the recommended modern
  signal, per WHATWG; `beforeunload` is unreliable on mobile).
- Decision: does `hostDisconnected()` still cancel? Probable YES (legitimate
  unmount during route change shouldn't write), but the flush path is separate
  from the host-disconnect path. Document in `decisions.md`.
- Test: a synthesized `visibilitychange → hidden` after an unflushed change
  writes localStorage before returning.

## M3 — Restore re-broadcast

**Architect finding 1.** `Peer.applyEvent` does not share re-applied events.
"Any party member can continue" is currently false; restored events stay local.

DoD:
- A player who restores their autosave and joins a fresh session has their
  unique events propagate to the rest of the table within one sync round.
- Unit test pinning `applyEvent` → broadcast behavior.
- 3-peer e2e: peer A restores save with N unique events; peers B and C
  see all N within bounded time.
- Care: don't re-broadcast events that came in via sync-response, that would
  break the existing hub-forwarding chain. Probable shape: `applyEvent(event, { propagate: true })`.

## M4 — Restore-drill CI

**Test-QA finding 5 + the in-progress backlog #425.** Critical-path
assertions live only in e2e, which CI skips by design.

DoD:
- Nightly job: 1-second deterministic seed → 100-event soak → save → restore → assert
  byte-identical (modulo `savedAt`) + 0 `unknownKinds` + convergence.
- Three currently-e2e-only assertions promoted to fast unit tests:
  cross-week save→load→continue, branch-divergence merge, 100-event soak.
- A simple `npm run drill` script local devs can run.

## M5 — Discoverability

**TTRPG-UX findings 1 + 2 + 3.** Silent eviction is the highest-impact UX
failure; resume prompt anonymous; no cold-restore experience.

DoD:
- `navigator.storage.persist()` request on first session-write of a campaign.
- Resume prompt shows scene title + PC list + last-session digest headline.
- "Recently played" list on the no-campaign landing — last 5 campaigns with
  evidence in localStorage, in-fiction-supportive copy.
- (Silent-player firewall: if a player's autosave was evicted, NO warning;
  they just see a fresh-start UI. The DM gets a soft-warn at session-open if
  their own autosave is missing.)

## M6 — Honest scope

**TTRPG-UX finding 5.** GitHub-push and Drive-sync aren't built. User-facing
copy implies them anyway.

DoD:
- Decision: build OR strip. Drive sync is a 1-2 week project at minimum;
  GitHub-push of the event log is smaller (1-3 days) but has its own threat
  model questions (does the player's event log push to the DM's repo? whose
  token?). My recommended default is **strip + park as roadmap**.
- Whatever the decision, the user-facing copy + this doc set reflect it.

## M7 — Simulated playtest

**Coverage-gap insurance.** Spawn focus-group sim + gameplay sim agents to
walk the four target scenarios. Capture surprises.

Scenarios:
- DM returns after 3 months — finds campaign, loads it, opens last scene.
- Player joins 2-month-old campaign mid-arc — substituted save loads cleanly.
- DM laptop dies mid-session — co-DM picks up; data loss window is the autosave debounce.
- Browser evicts storage — DM has no autosave; recovery path is "ask the table" or "load the manual save you took at session-end".

DoD: each scenario has a transcript in `simulations/` and any bug it reveals
files a follow-up task.

## M8 — UAT readiness

**Human-runnable acceptance.** No more "trust me, it works." Real DMs can
follow a checklist.

DoD:
- `docs/save-restore-uat.md` — checklist with screenshots.
- Recovery-rehearsal guide ("once a month, test that your save still loads
  in a fresh tab — here's why and how").
- TTRPG-expert agent signs off on the in-fiction copy.

## Re-scoping authority

The program lead may merge / split / re-order any of these. Update this file
in the same commit that re-scopes; don't quietly drift.
