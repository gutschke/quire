# TTRPG/UX expert v3 report — 2026-05-30

## Playtest GREEN verdict

**GO — conditional on the DM-side caveats in the pep talk.**
Run #16 closes the load-bearing v2 finding (UX-3 routing) at the
PRODUCTION path, plus UX-5 (digest-draft persistence), plus FC-2
narrowing + parity. The full suite is 3043 passing (vs. 2960
baseline). The remaining gaps are known-issue P2s with verbal
workarounds, not P0/P1 ship blockers.

## Top 3 next changes (post-playtest, not blocking)

1. UX-4: free-write + pre-gen chargen paths still placeholders;
   playtest opts into Q&A-only by DM invite copy. Mid-priority
   M8-track.
2. UX-6: `dmGuidance` field exists in
   `session-digest-prompt.ts:58` with NO UI; small textarea
   above Generate would let the DM aim the recap (XS).
3. UX-3 v2 #3: backstory editor full inline in the DM Identity
   block is visually heavy
   (`src/ui/regions/dm-pc-detail.ts:415-421`); collapse to a
   2-line preview that expands on Edit (XS).

## Q1-Q10 answers

**Q1 — UX-3 verification. 5/5.** Production path walked:
`quire-app.ts:1325-1334` is the new player auto-flip branch;
`playerHasUnseenDigest` (`:2287`) reads the ts marker from
`PLAYER_DIGEST_SEEN_PREFIX` (`:2230`) + in-memory mirror
(`:2241`). Dismiss handler (`:2302`) writes the seen-ts back
and exits to `in-session`. `renderSessionOpenStage`
(`:2363-2390`) renders the markdown card via `renderMarkdown` +
`unsafeHTML`. Mock-10 Scenarios 1-3 + Mock-09 Scenario 4 all
exercise the real routing with NO test-side appMode mutation;
all pass.

**Q2 — UX-5 verification. 5/5.** Module
`src/digest-draft-persistence.ts` mirrors chargen-persistence
load/save/clear. Component
(`src/ui/regions/session-digest.ts:142-208`) loads on connect,
debounces 750ms on `@input` (`:331`), flushes on
`disconnectedCallback` (`:152`), clears on Save (`:408`) and
Discard (`:422`). Host wires slug via
`currentCampaignSlugForPersistence()` at `quire-app.ts:2701`.
Mock-10 Scenarios 4-6 cover round-trip + scoping + connect-load.

**Q3 — First real session.** Cold start path works: idle →
Open Underleaf → DM start-hosting → share URL → guests
auto-discover the campaign via R3-C (`quire-app.ts:1359`) →
chargen Q&A. Known friction: free-write/pre-gen are
placeholders (DM invite copy must say "Q&A only"); the
`intent-moment` question carries the magic-discovery arc but
has no visual weight beyond a list bullet (`character-
creation.ts:520-622`). DM has no "who's still answering"
telemetry. None are ship blockers; surface in DM brief.

**Q4 — Silent-player firewall stress.** Holds. Digest enters AI
context only via `priorDigests` in `buildCampaignContext`
(`campaign-context.ts:213-240`), sourced from
`filteredShared.sessionDigests` (firewall-classified
player-visible). The Q&A character synthesis path uses
`buildCampaignContextForPlayer` (`:244`+) which physically
omits `scope:'dm'` from the type. Post-check is
`src/ai/spoiler-check.ts`. The locked design says NO
player-side spoiler warnings — confirmed: warning the player
IS the spoiler. DM is the gate.

**Q5 — Markdown rendering.** CARD-quality. Pipeline is
marked + DOMPurify (`markdown-pipeline.ts:24`) with forked
instance, dangerous-URL block on href/src
(`markdown-pipeline.ts:54`), event-handler strip. Images,
HTML, scripts all sanitized. Links default-allow which is the
right call for digest content the DM authored. Not
DEBUG-quality.

**Q6 — Dismiss copy.** "Got it — continue" reads slightly
web-form. Acceptable for ship. If the lead wants TTRPG
flavor: "Back to the table" or simply "Continue." Not a
blocker; the affordance is clear.

**Q7 — Pre-playtest gaps.** BLOCKERS: none. DEFER as known-
issue: UX-4 (paths), UX-6 (dmGuidance), UX-3 #3 (backstory
collapse), UX-7 (intent-moment visual lift), AI-2 (Anthropic
cache_control), AI-3 (live PC harm/stress in AI context),
co-DM ratify-race toast (#416). All are documented and
none affect firewall or the core loop.

**Q8 — Q&A-only path. CONFIRMED.** DM invite copy should
read: "We're playing the Q&A character creation path —
answer ~6 short questions, the AI drafts a backstory from
your voice, your DM ratifies. (~10-15 minutes.) Free-write
+ pre-gen paths arrive in a later release."

**Q9 — Adversarial v2 cross-check.** FC-2 narrowing
shipped: `format-stability.test.ts:770-793` pins "Tax"
SURVIVES + Mock-10 Scenario 7 confirms via projection. FC-2
parity: bond-ratify v:2 path-rename DROPPED
(`format-stability.test.ts:795-822`), pc-create v:2 path-
rename DROPPED (`:824-852`). No drift.

**Q10 — Final call. GO.** 3043/3045 passing. Production
routing verified. Firewall holds. Persistence holds. v2 hard
cap honored — no escalation to human needed for run #17
unless an unrelated regression surfaces.

## What I'd say to a brand-new DM about to run session 1

You're running the Q&A character path; tell players to expect
~10 minutes of short questions + an AI-drafted backstory you
ratify. After the session, open Wrap → Generate digest → edit
the recap before saving (drafts autosave, so a tab close
won't lose your work). Players will see "Previously, at the
table…" on next session-open automatically.

## Estimated runs to playtest GREEN (vs. v2 estimate of 2 more)

**One run used (this one). Zero more required.** v2 said two;
run #16 delivered the routing fix + persistence + FC-2
narrowing + tests in one. Run #17 contingency is unspent —
hold it in reserve.
