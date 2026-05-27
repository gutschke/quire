# Holistic 4-expert review — 2026-05-26

**Build at review time:** `23dbb35` (P2 chargen + #294 seat memory shipped).
**Review-bundle commit:** `80e2a78` (Wave A landed alongside this doc).

This doc captures the full output of the parallel 4-expert review
launched after #294 shipped and before the next-wave direction was
chosen.  Each expert read the codebase fresh and produced a
prioritized list; this doc synthesizes them and tracks status.

**Why this doc exists:** session-only TaskCreate evaporates between
runs.  The experts named long-tail items (clocks, living-doc diff,
LWW regression matrix) that risk being forgotten if not persisted.
This doc is the durable record.

**Update rules:** when an item ships, flip ✓ and add the commit hash.
When new findings arrive, append to the relevant expert section.
When the review goes stale (next major surface lands), re-run all 4
experts and supersede this doc with `holistic-review-YYYY-MM-DD.md`.

---

## Wave plan (synthesized priority order)

### Wave A — firewall hardening + Aside re-order ✓ SHIPPED `80e2a78`

Unanimous "do first" — XS-S scope, BLOCKER-grade adversarial findings.

- [x] **A1** — autosave routes through `buildShareableSaveDocument` so
  non-coord peers' localStorage strips DM-only events.  Regression
  test in `quire-app.persistence.test.ts`.
- [x] **A2** — `pcCharacterCache` + `boundCharacter` strip DM-only
  fields on player devices via new
  `cacheCharacterForLocalViewer` helper.
- [x] **A3** — swap `v.shared.synthesizedPcs` → `v.filteredShared` at
  the two outliers in `quire-app.ts` (wrap-marks builder +
  buildRosterSnapshot).
- [x] **A4** — wrap `dmGuidance` and DM AI prompt in
  `<untrusted_content>` sentinel.
- [x] **A5** — re-order Aside to spec (`dmAside+roster+chat+ai`);
  add `chat>` / `ai (DM)>` input glyph prefixes.

### Wave B — magic-arc DM runtime controls ✓ SHIPPED `5dbe48e`

TTRPG expert #1 — engine had the data, UI was read-only.  Discovery
arc is rules.md's act-1-to-act-2 spine.  Engineering also flagged
character-edits.ts:31-35 explicit deferral of array ops.

**Engine work:**
- [x] **B1** — new event kind `accidental-grant-log` (coord-only, append
  to `state.pcAccidentalGrants[pcId]`); materializer + 8 tests.
- [x] **B2** — new event kind `focus-grant` (coord-only, append to
  `state.pcFoci[pcId]`); materializer + 7 tests.  Engine
  deliberately does NOT enforce the magicPhase gate per
  engine-vs-campaign-policy; UI is the firewall.
- [x] **B3** — extend `filterForViewer` to strip `pcAccidentalGrants`
  for non-coord; `pcFoci` passes through (player-visible at
  Realization).  Belt-and-suspenders firewall test pins it.
- [x] **B4** — render-merge helper in `quire-app.ts:5524`:
  `effective foci = record.foci ∪ state.pcFoci[pcId]`; same for
  accidentalGrants.

**UI work (dm-pc-detail.ts):**
- [x] **B5** — "Log silent grant" textarea + Save (Accidental phase).
- [x] **B6** — "Mark Realization" button → multi-field pc-edit
  (`knowsTheyCanCast=true` + `magicPhase=realization` +
  `tax.active=true` + `tax.sessionsRemaining=3`); confirm dialog
  + re-entry guard per verifier S2.
- [x] **B7** — "Grant focus" form (name + domain) → `focus-grant`
  event.  Gated on `magicPhase >= 'realization'` at UI layer.
- [x] **B8** — "Release tax" button + releaseMoment textarea →
  pc-edit (`tax.active=false`, `tax.releaseMoment=text`).

**Host wiring + verification:**
- [x] **B9** — `quire-app` host methods: appendAccidentalGrantLog,
  appendMarkRealization, appendFocusGrant, appendReleaseTax.
- [x] **B10** — verifier pass: no BLOCKERS; addressed S1
  (draft-leak across PC selection — `willUpdate` resets all
  drafts on pcId change), S2 (re-entry guard on Realization
  commit), S3 (TODO comment on under-captured focus fields), S4
  (host-method batch test), S5 (concurrent-grants test from two
  coordHolders), N1 (engine-vs-campaign-policy doc on focus
  materializer), N5 (release-tax termination-path doc).

**Anti-pattern from TTRPG expert (recorded so it doesn't drift):**
DO NOT auto-suggest the accidental-grant text via AI.  Must be
DM-typed to preserve silent-player-firewall.  Same rule applies
to release-moment text.

**Verifier deferred-to-followup items:**
- S2 (atomic mark-realization event): the current implementation
  fires 4 sequential pc-edit events.  Re-entry guard mitigates
  double-click but a network drop mid-batch can leave
  half-applied state.  An atomic `mark-realization` event would
  be cleaner.  Defer to follow-up (composes with the broader
  "more atomic multi-field pc-edits" theme).
- S3 (expose focus condition/notes/status/boundFor in UI):
  engine accepts these; UI captures only name+domain.  Wave C+.
- N3 (dmNotes hint pointing at grant log): nice-to-have UX hint.
- N4 (Realization confirm not a real `<dialog>`): hotkey-driven
  flow is OK; upgrade if a11y audit demands it.
- N5-followup (session-end auto-decrement of tax.sessionsRemaining):
  campaign-side mechanic; defer.

### Wave C — DM cliff + chargen extraction 🚧 PARTIAL

UX expert flagged these as next after firewall.  C1 + C3 shipped
together; C2 + C4 (larger scope) deferred.

- [x] **C1** — hotkey `?` overlay ✓ SHIPPED `50d303d`.  New
  `<quire-help-overlay>` self-contained component owns global `?`
  keydown + custom-event open; topbar `?` chip is the click
  affordance.  Lists 8 shipped hotkeys (single source of truth in
  the component file — `SHIPPED_HOTKEYS` constant) grouped
  Shared / DM.  Editable-target gate respects text inputs.  8
  tests pin the contract (mount, key open, event open, input
  gate, content, sections, close button, listener cleanup).
- [x] **C2** — chargen-dm-review unmount-when-complete ✓ SHIPPED `5194e5c`.
  Simpler than the original "move to Stage" framing — just gate
  the mount on `isChargenActive` (any unbound seat OR pending
  synth via new `ChargenController.hasPendingSynth`).  Re-entry
  path is already wired: dm-roster-strip's ⊕ button (+ F1
  hotkey) → `chargen.addSeat()` → unbound seat exists → gate
  re-opens.  No "Resume chargen" affordance needed because
  add-seat IS the re-entry verb.

  5 new C2 integration tests in `quire-app.chargen-mount.test.ts`
  (mounts on unbound, unmounts on clean, re-mounts on add-seat,
  remains on pending synth, dm-aside-independent-of-chargen) + 5
  new controller tests on `hasPendingSynth`.  2115 total tests
  pass (+10).  Practice memo gained item #6b: QuireApp uses
  Shadow DOM, integration tests MUST use `app.shadowRoot?.querySelector`
  not `app.querySelector` (cost 3 test runs to find on this wave).

  **Future ambition (NOT in v1):** the original UX-3 framing was
  "during chargen IS the Stage (mode 1 per ui.md L100)."  That's
  a bigger change — would require route-aware mount + a "back
  to play" verb.  v1 of C2 keeps the Aside mount but gates it;
  the bigger change can come if the table reports the Aside
  surface still distracts even when chargen is genuinely active.
- [x] **C3** — callback-type consolidation ✓ SHIPPED `50d303d`.
  New `src/ui/callback-types.ts` is the single source of truth for
  `NavigateCallback` (was duplicated in 4 files),
  `DisplayNameLookup` (was 3), `AddSeatCallback` + `BumpStatCallback`
  (was 2 each), and split the divergent `RetirePcCallback` into
  `RetireSeatRequestCallback` (stage-roster's open-dialog shape)
  vs `RetirePcCommitCallback` (chargen-dm-review's payload shape).
  Region files now use `import + re-export` pattern so existing
  local consumers stay green AND any future cross-file import
  resolves to the same source.
- [x] **C4** — single active-PC focus card in Rail ✓ SHIPPED `242f497`.
  Thread-debt selector + reset-spam chip + casterState data prop
  added to `<dm-pc-detail>`; `<dm-aside>` stripped down to pinned-
  NPC management only (259 → 113 LOC).  dm-pc-detail at 496 LOC,
  well under the 800 threshold.  6 new C4 tests on dm-pc-detail;
  4 dropped from dm-aside; 2105 total (+2 net).  Verifier caught
  CSS class-rename regression (chip + selector were unstyled
  because the .dm-aside-debt-* rules didn't port with the class
  names) — fixed in same commit + captured as practice memo item
  #6 to catch the class next time.  Also caught backtick-in-css-
  comment parse bug that bit Wave C1 too — captured as memo #6a.
  Verifier inline-doc nits N1 (import order) + N2 (casterState
  null asymmetry) applied.

  **Deferred surface gap (orphan rungs):** previously dm-aside
  listed orphan thread-debt entries (PCs no peer has bound but
  who carry non-zero debt).  No surface for this in C4 v1; the
  DM navigates to the PC's character page directly.  Watch-item:
  if DMs report losing track, promote the readout into the Stage
  roster's Retired/Archived tabs instead of restoring it in
  dm-aside (preserves the one-canonical-home invariant).

  **C2 unblocked:** with thread-debt/caster widgets out of
  dm-aside, the remaining chargen-dm-review extraction is now an
  S-scope job per UX expert's "C4 first turns C2 from L → S."

- [x] **C5** — extract `<magic-arc-controls>` ✓ SHIPPED `86cd29d`.
  Engineering re-prioritization 2026-05-26 recommendation.  dm-pc-
  detail dropped 621 → 383 LOC (38%); new component is 377 LOC
  (well under the 800-LOC threshold the audit flagged).  willUpdate
  draft-leak guard moved WITH the drafts per practice memo
  `feedback_engineering_practices_from_reviews` #2.  Verifier-N3
  applied: `DmDetailView extends MagicArcControlsView`, so the
  parent passes its view directly to the child — kills the
  hand-rolled mapper + makes future field additions
  compile-checked at the parent boundary.  9 new direct tests + 16
  existing dm-pc-detail tests (regression net) all green.
  Verifier-N2 + N6 inline doc nits applied.  Foreshadows D5
  (bonds) which inherits the extends-pattern for free.

### Wave D-prep — firewall regression fix + atomicity + UI gates ✓ SHIPPED `d98daf4`

Triggered by the 2026-05-26 re-prioritization round: adversarial
expert caught a Wave B firewall regression (same class Wave A
closed); TTRPG expert + engineering both pushed atomic mark-
realization to the front; engineering flagged missing render-merge
regression test.  Bundle landed as one commit to close the loop
before the bigger Wave-D items begin.

- [x] **D-prep-1 (BLOCKER)** — `accidental-grant-log` added to
  `PLAYER_SCOPE_STRIP_KINDS` (was missed in Wave B; player
  autosaves were leaking DM-typed silent-grant notes verbatim).
  Plus new `EVENT_KINDS_PLAYER_VISIBLE` set + CI lint test
  (`persistence.coverage.test.ts`) that fails when ANY new event
  kind lacks a visibility classification.  Forces the engineer
  who adds the next event kind to make the firewall-classification
  decision explicitly.  Two-peer autosave-strip regression test
  pins the fix.
- [x] **D-prep-2** — atomic `pc-mark-realization` event replaces
  the Wave B 4-pc-edit batch.  TTRPG-expert deferred-S2 from Wave
  B: "real risk, low frequency, high embarrassment when it hits"
  — half-applied state on the one-way Realization gate destroyed
  DM trust on the most-narratively-loaded moment in the campaign.
  Single materializer call writes magicPhase + knowsTheyCanCast
  + tax.active + tax.sessionsRemaining atomically.  Cut-point
  test pins the all-or-nothing invariant.  `appendMarkRealization`
  swapped to fire the new event; preserves prior pcEdits via
  overlay merge.
- [x] **D-prep-3** — render-merge regression tests for
  `effective foci = record.foci ∪ state.pcFoci[pcId]` and the
  same for `pcAccidentalGrants`.  Pre-fix, silent desync if one
  side changed without the other.  Plus `boundFor` hidden from
  player-rail's foci-card via new `hideBoundFor` prop (adversarial
  audit: DM-typed narrative anchor could carry spoiler text like
  "bind-on-mother-reveal-ep4" through to player view).  DM
  surfaces keep the field; player rail strips it.  Engine policy
  unchanged — UI gate per engine-vs-campaign-policy boundary.

**Stale entries cleaned from this doc:**
- Original E-PERF-1 ("SessionController.notify recomputes view per
  listener") was already fixed at `session-controller.ts:466` —
  removed from long-tail.  Real concern is E-PERF-2 (no
  requestUpdate debounce, 21 notify call sites).
- Engineering audit said `chargen-controller` had "101 host.*
  taps" — current count is 36.  Original was inflated.

### Wave D-prep-2 — field-granularity firewall + T-LT4 + alignmentDrift cleanup ✓ SHIPPED `5d6a73c`

Triggered by the post-C2 4-expert round (2026-05-26 second pass).
Adversarial sweep found 2 NEW pre-existing field-granularity
firewall gaps (one latent, one real-today).  TTRPG named
T-LT4 (focus condition) as the on-ramp to Wave D.  TTRPG + UX
convergently flagged alignmentDrift 5-pip as the cockpit's
worst signal-to-noise.  Bundled.

- [x] **2-A (Adversarial Findings A+B)** — `serializeSessionForViewer`
  gained a field-granularity scrub (`scrubEventForPlayer`):
  pc-edit events whose top-level field is in
  `DM_ONLY_CHARACTER_FIELDS` get DROPPED for non-coord viewers
  (handles dotted like `tax.releaseMoment`, `threadDebt.rung`,
  `alignmentDrift.marks`); focus-grant events get their
  `boundFor` + `notes` fields stripped from the payload (focus
  itself still lands).  Real dmNotes text like "the Quiet is
  speaking through Mei" was reaching player autosaves pre-fix.
  Plus a field-coverage CI lint in `persistence.coverage.test.ts`
  that iterates the source-of-truth `DM_ONLY_CHARACTER_FIELDS`
  list — converts "I remembered the examples I wrote" into
  "every future addition is automatically covered" (same pattern
  as the kind-level lint Wave D-prep-1 introduced).
- [x] **2-B (T-LT4)** — focus-grant form on `<magic-arc-controls>`
  gained the `condition` input.  Cross-expert resolution:
  condition is player-visible per rules.md:139.  Practice-memo
  draft-wipe extension applied (focusConditionDraft joins the
  willUpdate guard).  3 new tests pin the form rendering,
  commit threading, blank-omission.
- [x] **2-C (T-LT2)** — alignmentDrift 5-pip widget collapsed to
  one-line counter "N / 5" + "conversation due" chip at marks
  >= 5 (rules.md:170 trigger).  Dead `.dm-pc-detail-drift-pip*`
  CSS removed.  TTRPG + UX convergent removal-flavor recommendation.

**4 next-wave findings deferred (recorded so they don't rot):**

- **Engineering:** D3 (clocks) is the lowest-risk D-item — no
  overlap with shipped surfaces, additive primitive, the
  persistence-coverage lint already covers any new event kind.
- **Engineering:** chargen-controller-extraction (E-LARGE-2) more
  urgent post-C2 — `hasPendingSynth` is the new canonical
  chargen-active predicate; extract `ChargenAcceptanceMachine`
  + `ChargenPersistenceQueue` BEFORE D5 (bonds) which will plug
  into the same controller.
- **Engineering:** quire-app.css.ts split-per-region (start with
  chargen.css.ts extract, ~600 LOC).  Bit twice by backticks-in-
  comments; per-region unlocks tree-shaking + scoped CSS-rename
  lint.
- **Engineering:** CSS-class-rename CI lint ("class referenced in
  *.ts but no matching rule in css.ts").  Cheap; fills the gap
  practice memo #6 calls out (happy-dom doesn't see visual
  regressions).
- **TTRPG:** order D4 → D1 → D5 → D2 → D3.  Digest is the
  campfire recap; you always recap before you canonize.  Skipping
  recap to canonize first produces "wait, who is that NPC?"
  three sessions later.
- **TTRPG:** D5 bonds materially easier post-C5 — `extends
  MagicArcControlsView` pattern + chargen-dm-review unmount-when-
  complete means bonds can live inside chargen without later
  eviction work.
- **TTRPG/UX convergent:** swing focus to post-session (D4 + D1)
  — chargen has had 5 consecutive waves; diminishing returns.
- **UX:** D-wave chrome cost ranking D3 < D5 < D4 < D1 < D2.
  D2 has most chrome (per-PC × multiple decision rows).
- **UX:** promote U-LT2 (player-advancement-confirm) — composes
  with D2, shrinks D2 from M-L → M.
- **UX:** D1 has a real S-MVP — strip per-item accept/reject,
  per-category commits, edit affordance; keep two-pane diff +
  NPC-update only + ONE "Commit all" button.  Add accept/reject
  in D1.5 if DMs report wanting it.
- **UX:** proactively add orphan-rungs indicator on Stage roster
  Retired tab — XS, regression-shaped gap, cheap insurance.
- **Adversarial:** Q-LT4 grep lint (no `v.shared.synthesizedPcs`
  outside an allowlist) still uncreated.

### Wave D — between-sessions ritual + clocks (longer-term)

Genuine unique-feature payload but L scope.

**TTRPG re-prioritization (2026-05-26):** D1 is now THE biggest
remaining engine-vs-table gap.  Wave B added typed events
(accidental-grant-log, focus-grant, mark-realization) that give
D4 (session-digest) structured raw material it didn't have 30
minutes ago — D1 + D4 compose strongly.  Recommended order:
D-prep-2 → C5 (extract magic-arc-controls) → C4 → D1 + D4 paired.

- [ ] **D1** — living-doc diff review post-session (UX-4 + TTRPG-5,
  L scope).  After `session-wrap-marks`, transition Stage to the
  two-pane diff-review per `ui.md` L298-363.  MVP: NPC-update
  category only.  Without this, "wrap session" is a checkbox sheet
  with no payoff; AI-living-doc value never reaches the table.
### Wave D2 — session-open ritual 🚧 IN PROGRESS

3-expert pre-design round (TTRPG / UX / Adversarial) locked the
MVP scope before coding.  Framing: **"the table picks up the
thread."**  Twin of session-wrap; ritual is shared with both
coords, but the SURFACE is DM-coord-only because so many fields
are DM-only.

**MUST-DECIDE-BEFORE-CODING (locked):**

- **D2-1 (Adversarial B-1)** — D2 surface is DM-coord-only,
  rendered like the dm-aside family.  NOT a shared cockpit region
  whose CSS hides DM-only fields visually (that's the D-prep-2-A
  bug class).  Player-side equivalent ("welcome back" narrower
  view) is OUT OF SCOPE for MVP.
- **D2-2 (Adversarial B-2)** — `drift-conversation-due` flag /
  badge has NO player render path under any condition.
  `alignmentDrift.marks` is DM-only; even the COUNT leaks state.
- **D2-3 (Adversarial B-3)** — `appMode` stays local @state, NOT
  shared.  "Begin session" is a per-peer local mode-flip.  The
  new `session-open` event records WHO began (audit trail) but
  doesn't synchronize co-DM appMode.  Cockpit MUST NOT imply
  coords are mode-synced.
- **D2-4 (REVERSED by D2-verifier 2026-05-26)** — **tax is NOT
  decremented at session-open.**  The earlier lock (decrement
  per-Begin via pc-edit) was caught by the D2 verifier as
  contradicting rules.md:184: tax is "**not a fade-out** (no
  gradual -2 → -1 → 0); it's a gating beat" terminated by a
  fiction-driven release moment.  Implementing a per-session
  decrement would have introduced a fade-out mechanic the
  ruleset disclaims, AND contradicted the existing N5-followup
  defer in this same doc.  D2 records the session-open marker
  and surfaces `tax.sessionsRemaining` as DM-only carryover
  context, but does NOT mechanically advance it.  Existing
  magic-arc-controls B8 "Release tax" button remains the only
  termination path.  Lesson captured in the practice memo
  (rule 7a, new): when a TTRPG-expert proposal touches mechanical
  state, cross-check against rules.md verbatim before locking —
  expert recommendations don't override the source-of-truth.
- **D2-5** — no new spend-mark / advancement-pick affordance.
  Marks-ready is a passive badge; player Rail advancement-confirm
  is a separate component (defer to D2.5 / U-LT2).
- **D2-6 (UX)** — single pane, not a stepper.  Data is parallel
  (one digest + N per-PC cards); stepper manufactures sequence
  where none exists.
- **D2-7 (UX, idempotent reload)** — auto-open trigger:
  `sessionDigests.length > sessionOpens.length` AND coord viewer.
  Reload mid-ritual re-enters; reload post-Begin skips.  Session 1
  has no digest → no auto-open → drops straight into in-session.
- **D2-8** — no AI surface in D2.  TTRPG + Adversarial agree:
  D2 is the human handoff back to the table; AI scene-opening
  would violate the prime directive.
- **D2-9** — drop "downtime recovery" affordance.  No downtime
  mechanic exists in `underleaf/rules.md` v0.1; harm/stress
  recovery is fictional ("days", "a meaningful conversation"),
  not a between-sessions ticked box.  Inventing a UI for a non-
  existent mechanic crosses the engine-vs-campaign boundary
  the wrong way.

**Carryover-rank (per TTRPG-expert, by play-impact):**

1. `tax.active` + `tax.sessionsRemaining` (DM-only) — live -2
   modifier; the most rules-active carryover (rules.md:180-184).
2. Persistent harm boxes (≥ 2) — roll penalties (rules.md:74-81).
3. Persistent stress boxes (≥ 2) — WIS penalty + cast cap
   (rules.md:85-94).
4. `threadDebt.rung` (DM-only) — frames every cast adjudication
   (rules.md:125-137).
5. `marks ≥ 5` — advancement-ready trigger (rules.md:157).
6. `alignmentDrift.marks` ≥ 5 (DM-only) — drift-conversation-due
   (rules.md:170-172).

**Sub-wave plan:**

- [ ] **D2-A** — locked scope above (DONE in this commit).
- [ ] **D2-B [engine + UI]** — new `session-open` event kind
  (player-visible; coord-only authored); `state.sessionOpens`
  array; materializer.  New AppMode `session-open`.  New region
  `src/ui/regions/session-open-stage.ts`.  Launcher in dm-aside
  ("Open session…" twin of wrap-launcher).  Host method
  `beginSession()` emits session-open + tax-decrement pc-edits +
  transitions appMode.  Auto-open wiring in QuireApp's
  sessionView subscriber.
- [ ] **D2-C** — tests + verifier + commit.

**Conscious MVP debt:** no per-card "delta since last session"
arrows (would require `state.lastWrapSnapshot`; defer to D2.5).
No player-side welcome-back surface (defer to D2.5 / U-LT2).
Realignment-acknowledge receipt is local @state only (re-fires
on reload of the same session-open; acceptable since reload
mid-open is rare).
- [ ] **D3** — progress clocks as first-class primitive (TTRPG-2, M
  scope).  ~300 LOC: new `clock` event kind +
  `clocks: Record<id, ClockState>` shared state + `<clock-strip>`
  component in `dm-aside`.  Extends `StateUpdate` variants so AI
  can propose `clock-tick` ops.  Covers world-side time pressure
  (the only TTRPG tool the build doesn't already have for "ordinary
  scene → tense scene").
### Wave D4-cleanup — post-ship 4-expert sanity check findings ✓ SHIPPED `d6eb8e5`

Triggered by the post-D4 4-expert sanity-check round (2026-05-26
third pass).  Three findings the experts flagged as material (not
polish), one prereq for D1 architecture, three D1 must-decide-
before-coding items.

- [x] **D4-cleanup-1 (UX-material)** — render prior digest as
  markdown, not `<pre>`.  UX-expert: this is the highest-value
  player-facing AI artifact; literal `##` and `*` chars in front
  of players is a broken surface, not polish.  Use existing
  `src/markdown.ts` renderer.
- [x] **D4-cleanup-2 (TTRPG)** — prompt + input-kind tweaks:
  (a) DROP `seat-memory-edit` from `SESSION_DIGEST_INPUT_KINDS`
  (DM-intimate, never AI-fed);  (b) magic-discovery constraint:
  "pre-Realization stays luck — do not pattern-match across
  events to imply hidden cause";  (c) Quire-register constraint:
  "contemporary, mundane-surface; friend at a bar, not fantasy
  prologue";  (d) thread-debt ladder phrasing;  (e) add prior-
  digest as "previously" anchor.
- [x] **D4-cleanup-3 (Engineering — D1 prereq)** — extract shared
  `isPcEditDmOnly(event)` helper alongside `DM_ONLY_CHARACTER_FIELDS`
  in `character-loader.ts`.  Currently duplicated between
  `persistence.ts:scrubEventForPlayer` and
  `quire-app.ts:generateSessionDigest`.  D1 will need it for the
  NPC analog — extract NOW so D1 reuses cleanly.
- [x] **D4-cleanup-4 (Adversarial A-1)** — pin pc-retire / pc-
  archive payload scrub with a regression test.  Today the
  summarizer is narrow so `reason` + `scene` don't leak; the
  firewall is implicit.  Test fails if a future summarizer
  change surfaces those fields.

**Deferred to a polish pass (not blockers):** UX Regenerate
confirm/relabel, unsaved-draft exit guard, Saved toast,
char-count, Adversarial A-3 hallucination soft-warn (cheap
post-gen name/foci cross-check), Engineering `_pendingDigest…`
return-tuple refactor, JSON.stringify truncation in summarizer,
input-token cap, per-event free-text untrusted-wrap.

### Wave D1 — living-doc diff review (NPC memory MVP) 🆕 PLANNED

TTRPG narrowed MVP to **NPC memory of player choices ONLY** (vs
the broader "NPC-update category").  Engineering split into 4
sub-waves shippable as 2 commits.  UX restructure: wrap mode
becomes a stepper.  Adversarial flagged 5 must-decide-before-
coding gates — all locked in this plan section so we don't
discover them post-implementation.

**MUST-DECIDE-BEFORE-CODING (Adversarial B-1 through B-5, all resolved):**

- **B-1 — kind-classification.** Three new event kinds:
  `proposal-create` + `proposal-reject` go in
  `PLAYER_SCOPE_STRIP_KINDS` (DM-private); `proposal-accept` is
  player-visible BUT its broadcast payload must be re-derived
  from the resolved field-set, NOT echoed from the diff text.
  Field-coverage CI lint extended to `DM_ONLY_NPC_FIELDS`.
- **B-2 — AI scope.**  AI sees DM material (must, to propose
  updates to DM-only fields).  The structural firewall is on the
  TARGET FIELD-LIST per proposal, not on the prompt
  `includeDmNotes` flag.  AI returns each proposal tagged with
  the target jsonPointer; broker validates pointer against the
  player-visible/DM-only NPC field allowlist.
- **B-3 — D4 verifier-blocker analog.** The Stage diff UI
  displays DM-private rationale, but the accept event broadcasts.
  Regression test FIRST: DM accepts a `dmNotes` diff → non-coord
  peer sees nothing in their autosave.  Don't echo the diff text
  to the event; derive from the resolved NPC field value.
- **B-4 — concurrent co-DM accept.** Accept events carry
  `proposalId`; materializer deduplicates by id (Set-based).
  Last-content-wins on the resolved NPC field is acceptable.
- **B-5 — persistence model.** Proposals live as DM-private
  event-log entries (`proposal-create` strip-kind), not
  Stage-local state.  Survives reload, replicates to co-DMs.
  Trade-off accepted: log bloats; safe per strip-filter.

**Sub-wave plan:**

- [x] **D1-A [E] engine** ✓ SHIPPED `3394913` — `src/living/diff-format.ts`
  (DiffProposal interface + Zod-equivalent validator);
  `src/living/proposals.ts` (`applyProposalsToWorkingCopy`,
  baseSha staleness rejection); `DM_ONLY_NPC_FIELDS` in
  `character-loader.ts`; extend `persistence.coverage.test.ts`.
  Hostile-proposal tests per redesign-plan.md:446.
- [x] **D1-B [E+C] AI prompt** ✓ SHIPPED `3394913` — `src/ai/diff-proposal-prompt.ts`.
  Input filter REUSES the extracted `isPcEditDmOnly` helper from
  D4-cleanup-3.  MVP scope: NPC memory of player choices only
  (TTRPG-narrowed).
- [x] **D1-C [H] UI: wrap-mode stepper** ✓ SHIPPED `4ed4947` — UX restructure:
  `<wrap-stepper>` orchestrates Marks → Digest → Diff-review →
  Exit panes.  Digest BEFORE diff-review (digest IS input to
  diff-review).  Existing session-wrap-marks + session-digest
  become panes.  Composes for D2 reverse.
- [x] **D1-D [H] UI: diff-review-stage + wiring** ✓ SHIPPED `4ed4947` —
  `<diff-review-stage>` 3-pane (Queue | Card | Context with
  source events); j/k/a/r/e hotkeys; edit-in-place;
  `proposal-create/accept/reject` event kinds (DM-private per
  Adversarial B-5 simplified MVP); host methods
  `generateDiffProposals` + `acceptDiffProposal` +
  `rejectDiffProposal`; WorkingCopy lazy-init (IDB-backed in
  prod, injectable for tests via `workingCopyStoreFactory`);
  per-pointer cards w/ DM-only warm-amber rail; filterForViewer
  wipes `state.diffProposals` for non-coord viewers.  Bumped
  MAIN_CHUNK_CAP_BYTES 150→175 KB; bundle currently 159 KB.
  +52 tests across engine (12), AI prompt (14), UI (24), host
  regression carryover.

### Architecture review findings (2026-05-26) — captured from spawned agent

Bundle gate hit 151 KB during D1-D build.  Spawned senior eng
architecture-review agent.  Verdict: 151 KB is **normal-to-good**
for the feature surface (markdown + DOMPurify + js-yaml + Lit +
WebRTC + 25-materializer event-sourced engine).  Bumped cap to
175 KB; took E-LH6 immediately; restored cap to 150 KB.

- [x] **E-LH6** ✓ SHIPPED `fa0fa02` — lazy-loaded markdown pipeline.  Split
  heavy implementation (marked + DOMPurify + js-yaml, ~30 KB
  gzipped) into `src/markdown-pipeline.ts`; `src/markdown.ts`
  became a thin sync facade with module-level pipeline cache +
  `ensureMarkdownPipeline()` lazy-loader + `onMarkdownPipelineReady`
  callback for re-render scheduling.  QuireApp's
  `connectedCallback` kicks off warmup + requests update once the
  chunk resolves; pre-load, sync `renderMarkdown` returns the
  empty `SanitizedHtml` brand (one-frame placeholder).  Tests
  `await ensureMarkdownPipeline()` in beforeAll where they assert
  rendered HTML.  Main bundle: 159 → 127.92 KB gzipped (-31 KB,
  matching the architecture review's prediction exactly).  Bundle
  cap restored to 150 KB.
- [ ] **WRAP-LAZY [defer, post-D2]** — bundle `<session-wrap-marks>`,
  `<session-digest>`, `<wrap-stepper>`, `<diff-review-stage>` into
  one lazy chunk loaded only when DM enters wrap mode.  Static
  imports at `quire-app.ts:21-26` today.  Pair with D2 (session-
  open ritual) so both wrap-direction surfaces share one chunk.
- [ ] **E-LH3 [REVISED]** — pair chargen.css.ts extract with
  chargen lazy chunk so the CSS actually leaves main.  Standalone
  extract is DX-only (per-region CSS modules don't shrink the
  concatenated tagged-template string materially).
- [ ] **E-LARGE-3.5 [defer, ships with E-LARGE-3]** — materializer-
  kinds registry in `core/state.ts` so adding a kind doesn't
  touch the central switch; closes the loop
  `persistence.coverage.test.ts` lint started.
- [ ] **Bundle-watch [monitor]** — if main exceeds 180 KB gzip
  after WRAP-LAZY, escalate E-LARGE-1 from defer to now (signals
  undisciplined @state growth).
- [ ] **E-LARGE-1 [defer]** — controller extraction hold per plan
  doc; ship E-PERF-1 + E-PERF-2 first.  Trigger: 180 KB main OR
  3 more @state clusters in QuireApp.

Commit boundaries: D1-A + D1-B → one commit (engine + prompt,
testable without UI surface); D1-C + D1-D → one commit (UI swap
+ wiring).

---

### Wave D4 — session-digest ✓ SHIPPED `1ded0d1`

- [x] **D4** ✓ SHIPPED `1ded0d1` — session-digest end-of-session campfire
  recap.  New `session-digest` event kind (coord-only, append-only,
  player-visible) + `applySessionDigestEvent` materializer with
  bounds validation + `state.sessionDigests` array.  AI-side:
  `buildSessionDigestPrompt` in `src/ai/session-digest-prompt.ts`
  with `SESSION_DIGEST_INPUT_KINDS` allowlist + JSON-schema
  constrained decoding ({markdown}).  Host: `generateSessionDigest`
  (coord-gate + AI broker) + `appendSessionDigest`.  UI: new
  `<session-digest>` Lit region mounts as sibling of
  `<session-wrap-marks>`; 3-button Generate / Save / Discard flow,
  prior digests render with latest primary + older behind
  `<details>`.  **Field-level firewall (verifier-found pre-commit
  blocker, fixed in same bundle):** `generateSessionDigest`
  filters pc-edit events whose top-level field is in
  `DM_ONLY_CHARACTER_FIELDS` (dmNotes, magicPhase, tax.*,
  threadDebt.*, accidentalGrants, alignmentDrift,
  knowsTheyCanCast) so the DM-only payloads never reach the AI
  prompt — mirrors `scrubEventForPlayer` from D-prep-2-A.
  21 new tests (10 engine + 9 UI component + 2 host regression).
  Pending followups (verifier-flagged, deferred to a polish pass):
  markdown-render saved digests (currently `<pre>`), input-token
  cap for first-ever digest, AbortSignal wiring from UI, integration
  test for sibling mount, co-DM concurrent-save UI nudge.
- [ ] **D5** — session-zero bond/relationship web (TTRPG-3, H
  scope).  Per-PC "name one connection to another PC" surface; AI
  synthesizes the shape; DM ratifies.  Without it, early sessions
  devolve into "four strangers in a coffee shop."

---

## Long-tail items by expert (don't lose these)

These are the lower-priority items each expert flagged that didn't
make the Wave A-D ranking.  Captured so they don't rot.

### Engineering (low-hanging cleanup + tech debt)

- [ ] **E-LH1** — `character-edits.ts:130` `(out as unknown as
  Record<string, unknown>)[key]` is the only non-test `as unknown
  as` in production.  Fix with a typed accessor.  XS.
- [ ] **E-LH2** — `quire-app.ts:611` `_skipNextReactiveYield`
  underscore-prefixed flag is the only of its kind in the class.
  Rename to match siblings OR extract with `BroadcastFollowingController`
  (see E-LARGE-1 below).
- [ ] **E-LH3** — `src/ui/styles/quire-app.css.ts` (5,126 LOC) is one
  tagged-template literal.  Each region's CSS imports into its own
  component.  Sections already comment-bracketed and self-
  contained.  M scope.
- [ ] **E-LH4** — `src/core/state.ts:2819` stale `// TODO M3a/M3b/...`
  should be a real ticket or deleted.  XS.
- [ ] **E-LH5** — 4 `TODO(campaign-policy)` markers at
  `spoiler-check.ts:28`, `backstory-synthesis-prompt.ts:15,49`,
  `campaign-loader.ts:167` — the engine-vs-campaign drift the
  `feedback_engine_vs_campaign_policy` memory targets.  File as
  [C] tickets.
- [ ] **E-LARGE-1** — `quire-app.ts` god-object extraction (L scope,
  the long pole).  Continue the facade-migration pattern from
  Phase 3a.  Extract in order: `ChatSpoilerLintController` (lines
  ~542, 3851-3920), `ReclaimController` (`yieldPcFatePrompt` +
  `reclaimConfirmShown` + render methods), `BroadcastFollowingController`
  (`prevCoordStatus`, `lastFollowedBroadcastTs`,
  `_skipNextReactiveYield`).  Each XS-S in isolation; program is L.
  **Policy:** stop adding `@state` to `QuireApp`; new clusters
  land as controllers.
- [ ] **E-LARGE-2** — `chargen-controller.ts` god-object inside the
  controller (101 `host.*` taps + 11 private state collections).
  Extract `ChargenAcceptanceMachine` (pre-accept/accepted/resync
  Maps) + `ChargenPersistenceQueue` (persist timer Maps).  XS-S
  each.  Do before the next chargen wave lands.
- [ ] **E-LARGE-3** — `core/state.ts` (2,912 LOC, 25 materializers in
  one switch) — split into
  `src/core/handlers/{peer,coord,scene,chat,pc,note,npc,scratch,broadcast}.ts`.
  Each gets a doc block stating its LWW/tie-break/coord-gate
  posture as a stable contract.  M scope.

### Engineering — tests we don't have but should

- [ ] **E-TEST-1** — **LWW concurrent-write regression matrix** for
  `core/state.ts` handlers claiming LWW.  Two events same-ts,
  different peers, both for same `(slot, key)` — assert which wins
  and that materialize is deterministic.  None exist today; this is
  the bug class most likely to slip past 2,047 tests.  M scope.
- [ ] **E-TEST-2** — `pc-edit universal-write trust gap` hostile
  test asserting current behavior (any peer can edit any PC).
  Pins the QA-4 / `project_quire_pc_edit_trust_gap` gap as a
  deliberate decision rather than an accidental bypass.  XS.
- [ ] **E-TEST-3** — AI write-controller cross-PC dispatch
  (`ai-write-controller.ts:373` `isCrossPc`) — only one indirect
  test path; given hard-gate is the safety property, this is
  under-asserted.  S.
- [ ] **E-TEST-4** — `filterForViewer` redaction for every newly-
  added DM-only field.  Today only the originally-redacted fields
  have tests; new ones rely on developer discipline.  XS each.

### Engineering — anti-patterns approaching the wall

- [ ] **E-PERF-1** — `SessionController.notify()` (line 466)
  recomputes `filterForViewer` per listener invocation by calling
  `view()` inside the listener loop.  With one subscriber
  (QuireApp) this is invisible; once controllers extracted in
  E-LARGE-1, each subscribe = O(listeners × |shared|).
  **Pre-compute the view once outside the loop** BEFORE landing
  E-LARGE-1.  S.
- [ ] **E-PERF-2** — `requestUpdate()` triggered indirectly by 19
  `notify()` call sites + reactive controllers — no debouncing.
  Render storms haven't bitten yet because the file is monolithic;
  will bite during E-LARGE-1 extraction.  S.
- [ ] **E-PERF-3** — `as unknown as {private}` in tests (~70
  occurrences).  Every extraction in E-LARGE-1 is gated by these.
  Each controller you extract, do the test-port in the same commit
  so the cast count goes down, not up.

### TTRPG (long-tail)

- [ ] **T-LT1** — spam-counter machinery (rules.md:141) is the most
  mechanically heavy part of the build for one specific edge case.
  Watch for adding more enforcement primitives — at some point the
  table will route around them.  No action; watch-item.
- [x] **T-LT2** ✓ SHIPPED in D-prep-2-C — `alignmentDrift.marks`
  collapsed from 5-pip widget to one-line counter "N / 5" with
  "conversation due" chip appearing at marks >= 5 (rules.md:170
  trigger).  TTRPG + UX experts convergently flagged this as the
  worst signal-to-noise ratio in the cockpit; both rated it
  removal-flavor XS.  Dead `.dm-pc-detail-drift-pip*` CSS deleted.
  2 new tests pin the counter format + due-chip appearance.
- [ ] **T-LT3** — `magicPhase` enum in code is `'accidental' |
  'realization' | 'tax' | 'free'`; some memory notes and prose
  said "aware / realized" — code is source of truth.  Tracker for
  future memory hygiene.
- [x] **T-LT4 partial** ✓ SHIPPED in D-prep-2-B — focus form on
  `<magic-arc-controls>` gained a `condition` input (the
  in-fiction trigger).  Cross-expert resolution: TTRPG over
  Adversarial — condition IS player-visible per rules.md:139
  (player owns the focus + needs to know when it triggers); only
  `boundFor` + `notes` stay DM-only.  The save-stream scrub
  (D-prep-2-A) hardcodes that split in `persistence.ts:76`
  `FOCUS_DM_ONLY_PAYLOAD_FIELDS`.

  **Deferred:** `notes` + `boundFor` form fields + `status`
  enum cycle (Wave C+ verifier S3).  Engine accepts these; UI
  doesn't capture them today.  Hold until a real campaign
  scenario needs the surface.

  **Long-tail [C] item (verifier #2):** the
  `FOCUS_DM_ONLY_PAYLOAD_FIELDS` constant in `persistence.ts:76`
  is currently engine-policy.  Per the
  `feedback_engine_vs_campaign_policy` boundary, this should
  drift toward campaign-authored config — a campaign that treats
  `notes` as player-visible should be able to opt out of the
  strip.  Watch-item; no action until a second campaign needs
  the difference.

### UX (long-tail)

- [ ] **U-LT1** — chargen tile has ≥21 distinct interactive
  affordances + 185 click/change handlers.  After Wave C2 (move
  out of cockpit), audit the in-Stage chargen surface for further
  affordance trimming.  M scope.
- [ ] **U-LT2** — player-side advancement-confirm.  When a PC hits
  5/5 ticks, the player picks the advancement next session.  Today
  nothing on the player Rail surfaces "you're advancement-ready" or
  queues the picker.  Composes with D2 (session-open ritual).  S.
- [ ] **U-LT3** — AI-proposed scene summaries with DM acceptance.
  Composes with D4 (session-digest).  M.
- [ ] **U-LT4** — tablet-class layout vs the current `≤1100px`
  collapse that hides Aside entirely.  Per `ui.md` L21 mobile is
  explicitly NOT required, but a player picking up an iPad at the
  table loses the roster.  Watch-item; flip to active if user
  reports it.

### Adversarial / QA (long-tail risks)

- [ ] **Q-LT1** — pc-edit universal-write trust gap (memory:
  `project_quire_pc_edit_trust_gap`).  S fix:
    ```
    const seat = Object.values(state.pcSlots).find(s =>
      s.pcId === p.pcId);
    if (!state.coordHolders.has(event.peerId) &&
        seat?.controllerPeerId !== event.peerId) return;
    ```
  Reduces blast radius from "any peer can rewrite any PC" to "a
  peer can only edit their controlled seat OR they are coord."
  Tolerated today but smallest mitigation before "open table" mode.
- [ ] **Q-LT2** — `coordinator-reclaim` (state.ts:1625) is
  unconditional: any peer can take coord by appending a reclaim.
  Acceptable per locked threat model (system chat synthesizes a
  visible "X reclaimed" event).  Keep the test that asserts the
  system-chat synthesis fires.  Watch-item.
- [ ] **Q-LT3** — adversarial test: two coords editing pc-edit /
  seat-memory-edit / advancement-grant simultaneously.  Documents
  the silent-overwrite hazards in each case.  S.
- [ ] **Q-LT4** — CI grep lint that asserts zero matches of
  `v\.shared\.synthesizedPcs` outside an allowlist.  Cheap, catches
  future copies of the QA-3 bug pattern.  XS.
- [ ] **Q-LT5** — lint: any prompt-string concatenation in `src/ai/`
  that touches state-derived text MUST call `wrapUntrusted`.
  Cheap CI rule.  XS.

---

## Cross-cutting observations

- **AI write API (M3c) shipped 2026-05-22.**  The memory note
  `project_quire_ai_write_api_design` had stale "blocked" framing;
  refreshed alongside Wave A.  Forward-looking extensions: clock-tick
  (D3), focus-grant (B2), accidental-grant-log (B1), bond-set (D5)
  all extend `StateUpdate` variants when their primitives land.
- **Big-three god objects** confirmed: `quire-app.ts` (5,647 LOC,
  modified in 52 of last 100 commits), `chargen-dm-review.ts`
  (3,339 LOC, 32 of 100), `quire-app.css.ts` (5,126 LOC).  All
  three need scope-split — captured under Wave C2 + E-LARGE
  entries.
- **What's working — don't touch:** `session-wrap-marks.ts` (197
  LOC, one verb, no modals); `dice-dock.ts` (settled); `scene-stage.ts`
  (clean per-paragraph reveal); `quire-shell.ts` (5-region grid is
  the right amount of CSS); `chip-editor.ts` primitive.  Per UX
  expert anti-recommendation: resist iteration on these surfaces.

---

## Original expert outputs

Full agent transcripts (verbatim) live in
`design/review-history/2026-05-26-holistic/` if needed for re-
reading.  (Not committed at this time — captured here in synthesis
form.)
