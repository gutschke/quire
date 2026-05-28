# Reviewer playbook — project-specific training for the Quire review panel

**What this is.** Quire is reviewed by a recurring panel of tactical
experts — **TTRPG-craft**, **UX**, **Engineering**, **Adversarial-
security** — each spawned fresh per round with a short briefing.  They
have no memory between rounds, so they repeat the same mistakes unless
trained.  This doc is that training: a senior consultancy tier
(**Principal Architect**, **Principal Test/Verification Architect**,
**Creative/Game Director**) distilled their guidance here on
2026-05-28.

**How to use it.** When you spawn a tactical expert, paste the
**Universal verification creed** + that expert's section below into the
briefing. Update this doc when a new failure mode is observed or a
consultant round adds guidance.

---

## Universal verification creed (every expert, every finding)

1. **Cite `file:line`.** A finding without a location is a hypothesis,
   not a finding. The bar: the 2026-05-28 round *refuted* three agent
   claims with file:line ("synthResults isn't a leak — render gates on
   live `isCoordinator()` at quire-app.ts:1688"; "fate:'keep' IS seeded,
   reclaim-controller.ts:174"; "Growth 6/5 can't render — early return
   at marks≥5"). Refutation discipline is the standard.
2. **"Green test" ≠ "correct behavior."** Before trusting a passing
   test, confirm it sets up state the way the *runtime* does. The #398
   trap: a firewall test modelled "the player's own PC" with
   `seat.controllerPeerId`, passed green — but the runtime resolves own-PC
   via `peers[peerId].pcId` (state.ts), so the feature was inert AND the
   firewall scope was tested against a proxy. **Rule: trace one full
   event from `session.append(...)` → materializer → assertion. If the
   test hand-mutates internal state instead of emitting the real event,
   it's a proxy — downgrade trust.**
3. **Ship the regression assertion with the finding.** State it as:
   *"Lock with: in `<file>`, assert `<concrete expect>`; today it
   passes/fails."* A finding you can't express as a failing test is
   unverified — say so. (Model: task #403 / commit b87142e landed the
   defense-in-depth test *with* the finding.)
4. **Tripwire vs example test.** A tripwire is schema-driven (iterates a
   source-of-truth list and fails when something *new* is added
   uncovered — e.g. `persistence.coverage.test.ts` iterates
   `DM_ONLY_CHARACTER_FIELDS`). An example pins one case. Coverage % is a
   proxy like LOC; the goal is *meaningful-invariant-pinned*. Say which
   kind backs your claim.
5. **Brittle vs invariant assertion.** Asserting a secret's *absence*
   from a projection is invariant (keep). Asserting player-facing *copy
   presence* is brittle (will churn). Flag the latter.
6. **A confirmed-clean verdict, file:line-backed, is a real and valued
   result.** Don't manufacture problems.

**The creed in one line:** *A green test proves the code does what the
test says — not what production does. Trace the real event path, cite
the line, ship the regression assertion.*

---

## Adversarial-security expert

**The firewall is the crown jewel: ONE invariant enforced by THREE
mechanisms. Audit all three or you've audited none:**
1. `filterForViewer` — the viewer-scoped state projection (core/state.ts;
   keys on live `state.coordinator`, not historical `coordHolders`).
2. The `persistence.coverage.test.ts` classify-or-fail floor — every
   `KNOWN_EVENT_KIND` must be classified in exactly one visibility set.
3. `invalidateViewerScopedCachesOnCoordChange` (quire-app.ts) — clears
   write-time-stripped cache mirrors on the coordinator-flip edge.

**Coord-flip checklist (this class breached 3× — #392/#393/#395):** for
every new `@state`/cache holding character or DM data, ask "is the strip
decision baked in at write-time?" If yes → it MUST be cleared in
`invalidateViewerScopedCachesOnCoordChange` AND asserted in
`coord-flip-firewall.test.ts` ("ADD NEW MIRRORS HERE"). If the data
lingers but render-gates on *live* `isCoordinator()` (the AI-panel
pattern), that's the *other* safe shape — confirm the gate reads live
state, not a mirror.

**Own-PC-reveal trap (#398):** any "show the player their own X" reveal
MUST resolve own-PC via `state.peers[viewerPeerId]?.pcId`, NEVER
`seat.controllerPeerId` (the bind path doesn't reliably set it). Confirm
it excludes hidden-seat pcIds and is symmetric-per-viewer (un-strips
only the pcId in *this* peer's entry).

**Two questions every round:** (a) "Does any new event kind appear in
`KNOWN_EVENT_KINDS` but not in `PLAYER_SCOPE_STRIP_KINDS` /
visible set?" (b) "Does `filterForViewer`'s wholesale-wipe list match
`persistence.ts`'s strip list?" (no SSOT binds them yet — see backlog).
For a new DM-only field: in `DM_ONLY_CHARACTER_FIELDS` (auto-covered) or
a `v.shared.*` object (needs a `FIREWALL_PATTERNS` entry — and that lint
is hand-maintained, so a new wiped shared field can silently escape it)?

**Always** ship the regression assertion with the finding.

**Known false-alarm modes to avoid:** prior rounds flagged `synthResults`
and a "Growth 6/5 render" as leaks; both false (render gated on live
`isCoordinator()`; early-return at marks≥5). Trace to the actual render
gate before declaring a leak.

---

## Engineering expert

**Score the property, not the LOC.** `quire-app.ts` is ~7465 LOC because
~137 methods + 41 `@state` stayed on the host while controllers took
only state clusters. The metrics that matter are *authoring-method count
on the host* and *`@state` count* and *cohesion/testability* — not line
count. Always ask: "Did this extraction move BEHAVIOR off the host, or
just state?"

**Always ask for the END STATE.** Every decomposition recommendation
must name what `quire-app.ts` *becomes* (target: a render-orchestrator
owning zero domain `@state`; all event-authoring on controllers).
"Extract X" without "toward target Y" is motion, not progress.

**Determinism checklist for any materializer/event change:** (a) is
`materialize` still a pure fold from `emptyState()`? (b) does any new
handler claim LWW? The current tiebreak for concurrent same-sum writes
is *lexicographic peerId, NOT wall-clock ts*, and it is **untested**
(backlog E-TEST-1) — demand the same-ts/different-peer test. (c) is any
must-be-atomic multi-event sequence still a batch? Push to a single
atomic event (precedent: `pc-mark-realization`).

**Scaling lens:** `peer.state()` re-materializes the full log every call
(core/peer.ts); `view()` does it then filters. Flag any new per-render
`state()` call; treat the missing `requestUpdate` debounce as a
prerequisite, not a footnote, before recommending further extraction.

**Boundary discipline:** the engine/campaign boundary is *aspirational*
in code (engine-vs-campaign-boundary.md is explicit it's "not a refactor
plan") — do NOT score it as enforced. Block NEW hardcoded policy: for any
new constant/enum/rule ask "[E], [C], or [H]? If [C] and hardcoded, is
there an explicit 'accept the debt' note?" Cite existing V-numbers rather
than re-discovering known violations.

**Known false-alarm mode:** the "25 materializers in one switch" claim was
stale — `state.ts` already routes through a `MATERIALIZERS` registry.
Read the current structure before recommending a split that shipped.

---

## TTRPG-craft + UX experts

**You are reviewing Underleaf — a specific game, not "an RPG."** Hold
three locked principles, in order, before flagging anything:
- **Prime directive:** the game supports storytelling, never dominates
  it; growth and cost are *felt in fiction*, not ground as meters.
- **Silent-player-firewall:** telling a player they hit a spoiler IS a
  spoiler; player-facing spoiler warnings are forbidden — soft-warn the
  DM only.
- **The magic-discovery three-act arc** (rules.md:174-188:
  Accidental → Realization → Tax; release is the act-break cue).

**The three design tests (run on every finding):**
1. **Prime-directive test.** Does this make a number the player *manages*,
   or a fiction the player *feels*? A running "3/5 marks" on the player
   sheet fails; a one-time "✦ ready, talk to your DM" chip passes. When
   in doubt, the DM holds the precise count; the player gets the feeling.
2. **Firewall-as-design test.** Before proposing ANY player-facing cue:
   does showing it leak the existence of something the player shouldn't
   know yet? The canonical trap — spelling out the tax release condition
   turns a fiction beat into a quest to grind, the exact thing the tax
   punishes. The firewall is a *creative constraint that produces better
   design*, not just a security control.
3. **Source-of-truth beats expertise.** Cross-check `rules.md` *verbatim*
   before locking a mechanic. RPG-genre training reaches for XP bars,
   fade-outs, initiative trackers, reaction rolls — Underleaf
   deliberately *omitted* most of these. An absence is a design statement,
   not an oversight (e.g. the team killed a per-session tax decrement
   because rules.md:184 says "not a fade-out... a gating beat").

**Division of lenses + how to reconcile:**
- **Craft owns:** is this mechanic true to the world? **UX owns:** can
  the DM do it without breaking table flow? (Riley persona: "anything
  that breaks scene momentum is a UX bug.")
- **Craft wins** when UX friction-reduction would flatten a deliberate
  fiction beat (e.g. an inline advancement picker — advancement is a
  between-sessions conversation; ceremony that serves story outranks a
  saved click).
- **UX wins** when a craft-pure mechanic creates table dead-air with no
  story payoff (e.g. collapsing the noisy 5-pip drift widget to "N/5 +
  conversation-due chip").
- **Disagree productively:** when you split (the recorded "bonds are
  latent" vs "bonds already work"), do NOT argue from genre priors —
  verify against the code + rules.md, then state the disagreement as a
  falsifiable claim. Trust-but-verify killing false claims is the team's
  strongest move.

**Recurring craft/UX failure modes to avoid:**
1. Evaluating against tropes ("where's the XP bar?") — ground every claim
   in an Underleaf citation.
2. Player-facing helpfulness that leaks — any "warn the player" instinct
   is suspect.
3. Inventing UI for non-existent mechanics (a "downtime recovery" box was
   killed — rules.md has no downtime mechanic).
4. Adding enforcement primitives the table will route around — prefer
   DM-judgment cues over hard gates.
5. Treating state flips as if they were ceremony — Realization is the
   act-break but currently ships as a silent card-appearance. Ask "does
   the weight of the table moment match the weight of the fiction?", not
   just "is the data correct?"

**You also own the brittle-copy radar** (per the verification creed):
when a test asserts player-facing wording, flag it as churn-risk; when
you propose a copy change, name the `file:line` of any test pinning the
old string so it's a deliberate update, not a surprise red.

**Hand-off rule:** every new player-facing cue AND every new event kind
goes to the Adversarial reviewer for a firewall-classification pass
before it ships (this has caught inert features reading the wrong field
and DM-typed text leaking through autosave).

---

## Round protocol (orchestration)

1. Re-read the three locked creative principles + the firewall's three
   mechanisms.
2. Spawn the relevant tactical experts with their section above + the
   universal creed pasted into the briefing.
3. Each finding: name the owning lens, cite `file:line`, run the
   applicable design/verification tests, ship a regression assertion.
4. Reconcile craft/UX conflicts with the win-conditions; record *why*.
5. Firewall-classification pass on new cues + event kinds.
6. Re-run the full panel whenever a major player-facing surface lands;
   re-run the senior consultancy tier (Architect / Test / Creative)
   every few ships or when a whole-system question arises.
