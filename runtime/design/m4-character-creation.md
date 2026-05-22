# Character creation design — three-expert synthesis

**Status:** design input. NOT a sequenced plan; the user has explicitly deferred prioritization.
**Source:** play-test follow-up 2026-05-22; three expert consultations (TTRPG-craft, UX, prompt-engineering).
**Companion docs:** `design/m3d-playtest-followups.md` (PC-slot binding scope), `quire/design/rules-reference.md`, `underleaf/characters/pcs/README.md`.

The user surfaced character creation as a planning concern with the following constraints (verbatim where they're load-bearing):

- Players usually pick their own names (or ask DM guidance) during creation; the chapter guide must show those names everywhere from then on (handled by the `{{pc:N}}` migration that landed inline today).
- **DM wants to gate the choice space** — no party of all bards.
- **DM pre-generation** is a supported workflow (some parties love this).
- **Q&A-driven AI synthesis** is a supported workflow (the player-doesn't-want-to-write case).
- **Player free-write** is a supported workflow (the player-loves-writing case).
- **Online mode**: first few minutes of session 1 with everyone at the table. Easy case.
- **Offline / async mode**: DM sends a link days before; players fill in their own time. Hard case with multiple constraints:
  - No DM-online daemon (DM can't keep machine on for 3 days).
  - No AI key on player devices (the API key stays with the DM).
  - No archetype-uniqueness coordination via a server (Quire is static-site SPA).
  - "Use the same device for session 1" is acceptable to require, with explicit communication.
- AI-driven backstory synthesis happens at session 1, not earlier. The player should know this.

## Cross-expert convergence

All three experts independently landed on overlapping recommendations:

1. **Three player paths converge on one PC schema.** Pre-gen / Q&A+AI / free-write all produce the same `PcRecord` shape; the only divergence is the entry-point screen.  Same edit screen for everyone after the initial path choice.
2. **Mode A (online) is Mode B (async) with sync + AI turned on.** Same screens, same components; Mode B mutes two features (real-time archetype-uniqueness, live AI assist) by virtue of no coordinator peer being connected.
3. **The DM is the coordination layer** in async mode — through pre-assignment + paste-backup-tokens, not through a daemon.
4. **The intention-against-pressure question is load-bearing in every path.** It's the canonical mandatory item (per `underleaf/characters/pcs/README.md` L26-29) and the source of the magic-realization arc later in play.
5. **The magic system MUST NOT leak to players during creation.**  AI prompts pass `includeDmNotes: false` for all player-facing synthesis. The forbidden-token list (Quiet, magic, premonition, fate, chosen) is enforced post-generation with single auto-retry.

## Three workflow primitives

These are the data-shape decisions that any implementation has to make. Each one is independently load-bearing.

### A. PC slot bindings (`pcSlots`) — landed in part today
`{{pc:N}}` markup in campaign source; runtime substitution at render time; fallback to `PC<N>` when unbound. **Landed in this commit**: source migration (32 + 3 + 31 + 7 + 3 = 76 substitutions across 15 files) + `substitutePcSlots` helper + scene-stage + player-rail wiring + 9 unit tests. Live state field still TODO (M3d/M4).

### B. Table seats (`tableSeats`) — M3d scope
Already specced in `m3d-playtest-followups.md` §6. A list of `PcId`s representing "PCs at this table tonight" — decoupled from peer joins. Underpins the modes-of-play polymorphism. Also the spine of character-creation: the DM creates seats first, then each seat goes through the creation flow.

### C. Invite tokens — M4 scope
`?campaign=<slug>&invite=<opaque-uuid>` route variant. Each token carries `slotIndex`, optional `archetypeHint`, optional `displayHint`, `campaignRef` + `campaignFingerprint`. DM generates tokens from an `<invite-manager>` panel; players use unique URLs to start creation; the DM's local ledger tracks which tokens are issued + redeemed.

## Player-facing question set (TTRPG-craft + prompt-engineer)

Both experts converged on roughly the same vocabulary; the prompt-engineer formalized it as **7 MC + 3 SA = 10 items total**, ~5 minutes to complete:

Multiple-choice (closed-form anchors the AI can't misread):
1. **Archetype** — locked from the slot's pre-assignment hint, but with "Other" as an opt-out.
2. **Temperament under pressure** — goes quiet / argues / acts unilaterally / asks one careful question.
3. **Relationship to the Bay Area** — lifer / transplanted as a child / recent transplant / ambivalent local.
4. **Default response to weirdness** — curious / suspicious / dismissive / spooked-but-quiet.
5. **Reason on Flight 887** — work / family / love / running-from / running-toward / opportunistic.  **At least one PC across the party must select an option that implies last-72-hour crystallization.** Soft DM warning if unsatisfied.
6. **Time horizon for the intent-integrity moment** — childhood / school years / first job / a specific recent year / ongoing.
7. **Alignment lean** — 2-axis (LNC × GNE).

Short-answer (specificity-grounders the AI imitates):
8. **One personally meaningful item.** Required.
9. **The intention-against-pressure moment.** Required.  Load-bearing for the magic-realization arc.
10. **One specific Bay Area neighborhood/route/place that's "yours".**

Not asked (deliberate): "secret," "fear," "tragic backstory event." Under-discovery is the engine of Underleaf; over-specification at creation forecloses play.

The TTRPG-expert flagged a sixth optional question for engagement-layer signal (curious / mildly curious / actively uninterested) — DM-facing only, players never see their own label.

## DM constraint DSL (TTRPG-craft + UX)

Authored in the campaign manifest (`campaign.json` or a sibling).  Evaluated client-side at creation time; first-write-wins for conflicts.

```yaml
# Soft constraints (warn, don't block).
party_requires:
  Tech: ">=1"          # at least one PC with Tech skill coverage
  Insight: ">=1"
party_at_most:
  archetype.Operator: 2
party_exactly:
  flight_reason.last_72h: ">=1"
party_unique:
  archetype: true      # no two PCs share an archetype
allowed_archetypes: [Hacker, Engineer, Caregiver, Outsider, Operator, Other]
```

Minimum viable subset: `party_requires` + `party_unique`. Covers 80% of "no party of all bards" cases.  Default Underleaf preset for Episode 1: `party_requires: { Tech: >=1, Craft: >=1 }`.

## Mode B (async) — UX architecture

**Storage:** device-local IndexedDB (the existing autosave-controller, scoped to a single-PC event log) **plus a player-initiated "Pack my character" file download AND a copy-to-clipboard token**.  Two exit paths every time: device-local is primary, file/token is the bring-on-USB-or-email fallback.

**Archetype-uniqueness:** the DM pre-assigns each invite link a soft archetype hint (or short-list). Conflicts only emerge at session 1 if a player deviates from their hint, and the DM saw that coming when they reviewed the incoming token.  No daemon needed; no server lock manager.

**Invite UX:** unique-token URLs; no typed codes.  DM generates from an `<invite-manager>` panel; player visits URL, sees "you're Player 3, suggested Engineer/Hacker."

**Three expectation moments** (UX-expert) — spread the messaging across the flow, not stuffed into one wall-of-text:
- Landing (step 2): "same computer, save here, AI later" — must click through.
- Persistent header strip: "Saved on this device" + "Pack my character (backup)" buttons.
- Final screen: "Recommended: also send your DM the backup file."

**Six steps:** Landing → Read-this-first → Pick path (Q&A or free-write) → The work → Done → Resume.

**Mode A diverges** in exactly two places: live-sync archetype enforcement, and live-AI assist.  Implementation-wise: `if (sessionView.coordinator) liveMode else asyncMode`.

## AI synthesis (prompt-engineer)

Synthesis runs ONCE at session 1, on the DM's machine, with the DM's API key.

**System prompt (cacheable; same for every player):**
- Negative-tone list (avoid: high-fantasy, grimdark, melodrama, mystical hints, trauma-as-origin, prophecy framing).
- Output format spec: JSON with `{name, pronouns, tags[3-5], backstory: markdown 250-400 words}`.
- Hard constraints: the intent-integrity question MUST be answered; Bay Area place required; no magic/Quiet/cosmology references; PC name ≠ player name; no invented "dark secret."
- One few-shot example from `underleaf/characters/pcs/example-character.json`'s backstory field (the Socratic-dinners paragraph — exactly the right register).

**User prompt (per call):**
- Wrapped campaign canon (public scope only — `includeDmNotes: false`).
- DM per-player constraints.
- All 10 player answers, with free-text quoted verbatim as canonical.
- "Honor EVERY player answer. Free text is canonical; MC answers are interpretable but not invertible."

**Failure-mode mitigations:**
- Forbidden-token regex post-check (auto-retry once on hit, then surface as DM warning).
- Word-count validator (10-400 chars on short-answer; 250-400 words on backstory).
- "PC name ≠ player display name" post-check.
- Temperature 0.7-0.9 (NOT 0 — tone-matching needs looseness).
- Independent calls per PC (NOT batched) for tone variance + clean error recovery.
- Anthropic 1h cache (`cache_control: { type: 'ephemeral', ttl: '1h' }`) on the prefix; parallel suffix calls warm the prefix once then hit cache.

**Iteration UX:**
- Three buttons: Re-roll whole, Regenerate one paragraph, Edit freely.
- Player can keep editing freely until DM approval; after approval, edits trigger soft re-review.

**DM gate:** async approval between session-1 prep and start. Per-PC "ready / needs review / approved" pill in the DM's session-1-prep view.  Lock-in happens on DM approval, not on AI generation.

**Pre-API-key coherence check** (cheap, runs without the API):
- Required short-answer fields non-empty + ≥10 chars + non-trivial.
- Bay Area place free-text contains a token from a curated allowlist (or "recent transplant" excuses unfamiliarity).
- MC ↔ free-text consistency sanity check (e.g., MC=childhood but SA mentions "first job" → flag).
- Surfaced as soft warnings in the DM-prep view, never blocking the player.

## Cross-cutting items for the planning backlog

These are the discrete work items the user can hand to experts for prioritization later. **Order below is not implementation order** — it's just numbered for reference.

### Char-creation primitives
- CC-1. Define the `tableSeats` shared field + `<seat-strip>` region (already in `m3d-playtest-followups.md` §6).
- CC-2. Define the `pcSlots` shared field + click-to-bind UI + AI `pc-slot-bind` write tool.  Renderer is landed; live state field is not.
- CC-3. New `AppMode = 'character-creation'` + invite-token route variant in `routing.ts`.
- CC-4. `SaveDocument` variant scoped to one PC (`PcCreationBundle`?); persistence-controller variant scoped to one PC's events.

### Player flow (UX)
- CC-5. 6-step creation page region (`<character-creation>`): Landing → Read-first → Pick path → Work → Done → Resume.
- CC-6. Q&A form for 7 MC + 3 SA questions with conditional follow-ups.
- CC-7. Free-write markdown editor with the mandatory question pinned.
- CC-8. Pre-gen browser with "edit after picking" affordance.
- CC-9. Path toggle (Q&A ↔ free-write) with answer-preservation across switch.
- CC-10. "Pack my character" file download + copy-as-token export.
- CC-11. Resume-on-revisit + "wrong-device" empty state.

### DM flow
- CC-12. `<invite-manager>` panel: list slots + generate invite link buttons + paste-incoming-token area.
- CC-13. Session-1 intake: WebRTC pull / paste-token / collapse-to-Mode-A for unfinished players.
- CC-14. "Synthesize all backstories" DM-only button + per-PC review pills.
- CC-15. DM constraint DSL (start with `party_requires` + `party_unique`).
- CC-16. Soft-warning surface for 72-hour-crystallization + engagement-layer balance.

### AI synthesis
- CC-17. Backstory-synthesis schema variant in `src/ai/schema.ts`.
- CC-18. Player-facing context builder that hard-overrides `includeDmNotes: false`.
- CC-19. System prompt (negative-tone + hard constraints + few-shot from existing example).
- CC-20. Forbidden-token post-check + single auto-retry.
- CC-21. Structural validator (word count, place token, name uniqueness).
- CC-22. 1h cache for the campaign prefix; parallel suffix calls.
- CC-23. Re-roll whole / regenerate-paragraph / edit-freely UX.
- CC-24. DM approval gate + per-PC pill.

### Pre-API-key checks
- CC-25. Required-fields + length validator.
- CC-26. Bay Area place allowlist + recent-transplant exemption.
- CC-27. MC ↔ short-answer consistency cross-check.

### Underleaf-specific
- CC-28. Promote `underleaf/characters/pcs/README.md` 5-element list into a structured questionnaire schema.
- CC-29. Per-archetype tag suggestions for the AI synthesis.
- CC-30. Curated Bay Area place allowlist for the place-grounding question.
- CC-31. "Two technical PCs" default constraint for Episode 1.

## Open questions for the user (carry into the prioritization conversation)

1. **Confirm `{{pc:N}}` migration choice.** Migration landed today; the renderer falls back to `PC<N>` until live bindings ship.  OK?
2. **Where does `pcSlots` state live?**  Campaign-level (durable) vs session-level (rebindable per session)?  UX-expert and TTRPG-expert both default to session-level.
3. **Async-mode policy on archetype deviation.** Pre-assignment is a soft hint per the recommendations — players CAN deviate (and the DM sees that at intake).  Or should the runtime enforce the hint as hard?
4. **DM approval gate — required, or skippable?**  Prompt-engineer recommends required; some DMs may want skip-for-speed.
5. **Pre-gen library scope.**  Does Underleaf ship with a curated pre-gen suite (5 PCs)?  Who writes it?
6. **The "use same device" message wording.**  UX-expert proposed three expectation moments; the exact copy is a tone decision the user owns.
7. **AI synthesis at scale.**  If 5 PCs synthesize in parallel at session 1, the DM may want a progress indicator + cancel-one-PC option.
8. **Print-friendly character sheet.** Tagged "bigger scope" by all three experts; ship later or carry into M5?

These are NOT decisions for me to make.  They're inputs for the prioritization pass the user said they'd run with the experts.
