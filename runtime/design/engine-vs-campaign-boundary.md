# Engine vs campaign — boundary survey

**Status:** survey / design input.  Not a refactor plan.
**Source:** 2026-05-22 user prompt clarifying Quire's long-term scope.
**Principle:** Quire engine hosts primitives; campaigns host policy.  Move policy *out* of the engine and *into* the campaign whenever a hook is reasonably cheap to add.  Hardcoded Underleaf assumptions are acceptable today (we only have one campaign) but accumulate as refactoring debt to a future "retarget to a different game" effort.

This doc serves two purposes:

1. **Inventory** existing places where Underleaf-specific policy is baked into the runtime code (or into engine-scoped design docs that should arguably live in the campaign repo).
2. **Tag** every future work item in `m3d-playtest-followups.md` and `m4-character-creation.md` (and beyond) as **ENGINE**, **CAMPAIGN**, or **HYBRID** so the boundary question gets answered up front, not after the code lands.

The user has explicitly accepted that we won't fix the existing violations today — but each one should be visible so a future audit pass can find them, and no NEW violations should land without an explicit "yes, this is policy in engine, we accept the debt" decision.

## Definitions

- **ENGINE** — a primitive, mechanism, or contract that ought to work the same way for *any* TTRPG: event log, materializer dispatcher, scene-block reveal, navigation, persistence, AI broker contract.
- **CAMPAIGN** — content, schema values, rule mechanics, world details, vocabulary: the magic system, the stat keys, the dice resolution, the question set for character creation, the forbidden-token list.
- **HYBRID** — an engine primitive whose *vocabulary* the campaign supplies. The engine ships a "stat block" primitive; the campaign declares the keys.  The engine ships a "track" primitive; the campaign declares "harm: 4 boxes" + "stress: 4 boxes" or D&D's "HP: int." Hybrids are the right shape for *most* things in a well-targeted engine.

## Existing policy-in-engine violations (as of 2026-05-22)

Each entry: where it lives, what it does, why it's policy, what the hybrid shape would look like.

### V-1. CasterLadderState enum hardcoded in state.ts
- **Location:** `src/core/state.ts` L84-88 + L102-108 + L499-503 + L529.
- **What:** the 5-state magic-discovery ladder (`quiet | noticed | watched | pushing-back | hunted`) is a TypeScript union the materializer validates against.
- **Why policy:** the ladder vocabulary IS Underleaf's intent-based magic system.  A D&D campaign wouldn't have a "thread debt ladder" at all; a different intent-based game might call the states differently.
- **Hybrid shape:** engine ships a generic `CampaignTrackedState` primitive (a string-enum field with carry-forward merge semantics).  Campaign schema declares the enum values in `campaign.json` under `tracks.castingLadder.states: ['quiet', 'noticed', ...]`.  Materializer validates against the declared set, not a hardcoded one.

### V-2. Hard-gate categories baked into materializer
- **Location:** `src/core/state.ts` `pcEditHardGateReason` (~L601) + `casterStateHardGateReason` (~L634).
- **What:** specific transitions (harm ≥ 3, stress ≥ 4, ladder→hunted, taxActive toggle) trigger DM-accept hard-gates.
- **Why policy:** the *list of dangerous transitions* is Underleaf's narrative-weight model.  A different game might gate "death save," "alignment shift," "level-up" instead.
- **Hybrid shape:** engine ships a `hardGateRules[]` schema field in `campaign.json`.  Each rule: field path + predicate + reason template.  Materializer reads the rule list and evaluates each.

### V-3. Harm/stress 4-box tracks + stat range
- **Location:** `src/character-edits.ts` L32-35.
- **What:** `HARM_MAX = 4`, `STRESS_MAX = 4`, `STAT_MIN = -3`, `STAT_MAX = 3` are exported constants used by the clamp helper.
- **Why policy:** 4-box harm + ±3 stats are Underleaf's specific shape.  D&D uses HP + ±5; *Apocalypse World* uses 6-box harm; *Lancer* uses HP + Structure + Armor.
- **Hybrid shape:** the campaign manifest declares track shapes (name, type=integer/boolean/enum, min/max, clamp behavior).  The character-edits clamp helper looks up each field's declaration at edit time.

### V-4. Stat keys STR/DEX/CON/INT/WIS/CHA
- **Location:** `src/ui/regions/player-rail.ts` L47 (`type StatKey`) and several UI render sites.
- **What:** the six D&D-shaped stat keys.
- **Why policy:** these keys are arbitrary-but-Underleaf-pinned (per `quire/design/rules-reference.md` L18-23).  *Blades in the Dark* has Insight/Prowess/Resolve; *PbtA* games vary widely; *Cypher* uses Might/Speed/Intellect.
- **Hybrid shape:** engine ships a generic stat-block primitive; campaign declares the keys, their long-form labels, value ranges, and which key informs which roll.  The dice-Dock (planned) reads the declaration.

### V-5. Roll mechanic — "2d6 + stat" dominant
- **Location:** planned in `m3d-playtest-followups.md` §4 (dice-Dock spec); not yet implemented.
- **What:** the TTRPG-expert recommended optimizing the dice UI for the 2d6+stat case because ~95% of Underleaf rolls follow that pattern.
- **Why policy:** the roll mechanic is the heart of any TTRPG's identity.  D&D 5e is d20+mod; *Forged in the Dark* is dice pools; *Year Zero Engine* counts successes on d6 pools.
- **Hybrid shape:** the campaign declares its primary resolution expression (`primaryRoll: { expression: "2d6+{stat}", statSource: "boundPc" }`).  The dice-Dock builds the chip strip from the declaration.  d20/d% remain as the "Other dice…" escape hatch regardless.

### V-6. Forbidden-token list + AI tone anchors
- **Location:** planned in `m4-character-creation.md` §AI synthesis; not yet implemented.
- **What:** the regex post-check that auto-retries when the AI's backstory output mentions Quiet / magic / premonition / fate / chosen.
- **Why policy:** the forbidden tokens encode *what would constitute a spoiler in Underleaf's discovery arc*.  A high-fantasy campaign would have a different (probably much shorter) forbidden list.
- **Hybrid shape:** the campaign manifest carries a `spoilerTokens: string[]` field.  The AI broker's response validator reads from there.  The campaign also carries `toneAnchors: { avoid: string[], prefer: string[] }` for the system-prompt tone anchors.

### V-7. AI system-prompt language
- **Location:** planned in `m4-character-creation.md` §3; not yet implemented.
- **What:** the system prompt mentions "ordinary people in the present-day Bay Area" as the load-bearing tone anchor.
- **Why policy:** "ordinary people, Bay Area" is the Underleaf voice.
- **Hybrid shape:** the campaign manifest carries a `worldOneLiner: string` and a `characterCreationPromptAnchors: { systemTone: string, fewShotExamplePath: string }`.  The broker assembles the system prompt from the campaign declarations + a generic scaffold.

### V-8. Character-creation question set (10 questions)
- **Location:** planned in `m4-character-creation.md` §Player-facing question set; not yet implemented.
- **What:** the 7 MC + 3 SA questions including "Reason on Flight 887" (literally references the Underleaf opening).
- **Why policy:** the questions ARE the campaign's character-creation contract.  *Blades* has playbook-specific questions; *Monster of the Week* has playbook questions; *D&D* has none (point-buy + class choice).
- **Hybrid shape:** the campaign manifest carries a `characterCreation.questions[]` array, each with `id, kind (mc|short-answer), prompt, options?[], required, aiRole?`.  The chargen UI is a generic renderer for whatever the campaign declares.

### V-9. quire/design/rules-reference.md is policy in the engine repo
- **Location:** `/home/markus/src/ttrpg/quire/design/rules-reference.md`.
- **What:** the canonical Underleaf rules document lives in the engine's design folder.
- **Why policy:** "the rules" are by definition policy — they're what makes Underleaf the specific game it is.
- **Hybrid shape:** the engine repo gets a `quire/design/rules-schema.md` (what a campaign's rules schema looks like + the contract the engine enforces).  Underleaf's actual rules live in `underleaf/world/rules.md` or `underleaf/rules.md`.  When other campaigns appear they each have their own.

### V-10. Underleaf-shaped event kinds
- **Location:** `src/core/state.ts` REGISTERED_EVENT_KINDS list.
- **What:** event kinds like `caster-state-set` are pure Underleaf.
- **Why policy:** different games would have different state mutations.  A D&D game might want `concentration-broken`, `condition-applied`, `death-save-result`.
- **Hybrid shape:** longer-term — the engine ships a generic `campaign-state-event` kind whose payload schema is campaign-declared.  Materializer dispatches via the declared field paths.  Far-future; not blocking M3d/M4.

### V-11. Episode/scene navigation shape
- **Location:** `src/routing.ts` and various UI surfaces.
- **What:** routes assume `campaign / episode / scene / character` shape.
- **Why HYBRID:** most narrative TTRPGs have a similar chapter/scene hierarchy, but some are zone-based (*Stars Without Number*), location-based (West Marches), or event-driven (*Microscope*).
- **Hybrid shape:** acceptable as engine for now.  Future-proofing: allow the campaign to declare its `contentTopology: 'episode-scene' | 'zone-region' | ...`.  Routes might need to follow.  Defer.

## Findings on existing design docs

### `runtime/design/m3d-playtest-followups.md` — tag-pass needed

Items 1-7 in that doc were written without explicit engine/campaign tags.  Quick read-through with tagging:
- #1 (markdown-link interceptor) — **ENGINE**.
- #2 (campaign-link linter) — **ENGINE** (runs on any campaign).
- #3 (stale-peer cleanup) — **ENGINE**.
- #4 (2d6-first roll UI) — **HYBRID** (engine renders, campaign declares primary roll — see V-5).
- #5 (PC1/PC2 binding) — **ENGINE** (the `{{pc:N}}` markup convention is engine).
- #6 (modes-of-play) — **ENGINE** (table topology is engine; the *PCs that fill the seats* are campaign).
- #7 (scene-switching as dominant action) — **ENGINE**.

### `runtime/design/m4-character-creation.md` — needs tag-pass

The 31 CC-* items split as follows (initial pass; reviewers should refine):

- **ENGINE**: CC-1, CC-2, CC-3, CC-4, CC-5, CC-7, CC-9, CC-10, CC-11, CC-12, CC-13, CC-22, CC-23, CC-24.
- **CAMPAIGN**: CC-6 (the questions themselves), CC-15 (the constraint DSL values), CC-19 (the system prompt content), CC-20 (forbidden tokens), CC-21 (validator wordings), CC-26 (Bay Area allowlist), CC-28-31 (Underleaf-specific).
- **HYBRID**: CC-8 (pre-gen browser is engine; the pre-gens themselves are campaign), CC-14 (button is engine; per-PC review pill is engine but the *what counts as a backstory* is campaign), CC-16 (the warning *surface* is engine; the *thresholds* are campaign), CC-17 (the schema variant shape is engine; the prompt content is campaign), CC-18 (the `includeDmNotes: false` rule for player-facing calls is an ENGINE invariant; the specific files it filters are by virtue of the campaign's directory layout — engine-policy-of-restraint over campaign-content).

### `runtime/design/m3d-playtest-followups.md` — minor error to fix

I previously claimed `design/ui.md` was missing.  Wrong — it exists at `quire/design/ui.md` (one level up from the runtime).  Both experts referenced it correctly; I confused myself by looking in the runtime's design folder.

## Going-forward discipline

For every new design doc / feature:

1. Each work item gets an **[ENGINE]**, **[CAMPAIGN]**, or **[HYBRID]** tag in its label.
2. When the implementation requires hardcoding Underleaf-specific behavior in the engine repo, leave a `// TODO(campaign-policy): move to campaign schema` comment.  These are the audit-pass hooks for a future "retarget Quire to a different game" effort.
3. When you find an existing violation not in the V-1…V-11 list above, append it here.
4. Don't pause shipping on a violation — the user has accepted the debt — but DO make the violation visible.

## Open questions for the user

1. **Promote rules-reference.md to underleaf?**  Move `quire/design/rules-reference.md` → `underleaf/world/rules.md` and add a placeholder `quire/design/rules-schema.md`?  Or leave it where it is until the second-campaign question becomes real?
2. **When is the first cross-campaign moment?**  Is there a second campaign on the horizon, or is "retarget Quire" a 5-years-out goal?  The answer scales how much we invest in the hybrid shapes above.
3. **Do we add a `policy: 'underleaf-bias'` flag to STATUS.md** marking the violations as known-and-accepted, so a future drift-audit can scan for it?
4. **Schema work as M4-or-M5?**  Adding campaign-declares-this-field schema for CasterLadderState, hardGateRules, primaryRoll, etc., is meaningful work.  Should it be its own milestone, or folded into the relevant feature work as we go?
