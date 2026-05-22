# Prioritized backlog — three-lens synthesis (2026-05-22)

> **Status as of 2026-05-22 (end of Phase 1):** Phase 0 and Phase 1 P0 items are landed (at least first commit per item).  Critique pass surfaced one user-decision blocker (invite-token signing — resolved with a safer default; see "Phase 2 design notes" below) and ~10 medium gaps for the implementation to address inline.  Phase 2 (chargen workflow stack + seat-strip + constraint DSL) is the active scope.


**Source:** the three parallel expert rankings against `backlog-catalog.md` (68 items).  Each item is rated by **TTRPG-craft / UX / Engine** lenses; this doc resolves their convergence into a single priority and surfaces the disagreements honestly.

The raw expert rankings are preserved in this conversation's history.  Items aliased in the catalog (e.g. V-5 ≡ M3D-4) inherit the canonical item's priority.

## Synthesis rules

- **All three say P0/P1** → final P0/P1.
- **TTRPG + UX say P0, Engine says lower** → P0 (table-bites trumps architectural caution; engine concern noted as sequencing).
- **Engine says P1 for an unblocker, others say lower** → consider P1 (engine knows what foundations cost).
- **Single-lens dissent** → settle with the majority; note the dissent inline.
- **All three say P3** → defer indefinitely.

## P0 — must land before next milestone ships

These six items are play-test-blocking, security-load-bearing, or both.  The next milestone scope is essentially "ship the P0 list."

| ID | Item | Convergence |
|---|---|---|
| **M3D-3** | Stale-DM-peer cleanup (route-change-fires-leave + heartbeat tri-state roster glyph). | All three P0. |
| **M3D-4** | 2d6-first dice-Dock (stat chips, modifier stepper, big Roll button, last-3 pills, doubles halo; `/roll <expr>` demoted). *Alias V-5 inherits.* | TTRPG+UX P0; Engine P2 with sequencing note (schema field can land first to avoid throwaway work). **Engine concern resolved by SPLIT** — see V-5 below. |
| **M3D-5** | `pcSlots` live state + click-to-bind UI + `pc-slot-bind` AI write tool. Renderer already landed; live state is the gap. *Alias CC-2 inherits.* | All three P0. |
| **M3D-7** | Scene-switching primary affordance: `<dm-rail>` enumerates `dm/*.md`, `[`/`]` hotkeys, AI `requestNav` tool, Cmd-K palette, recent-visited list. | TTRPG+UX P0; Engine P1 ("cheap once `navController` extracted"). Sequencing note, not a deprio. |
| **CC-18** | Player-facing context builder hard-overrides `includeDmNotes: false` for chargen AI synthesis. | All three P0. Engine notes this is small and security-critical. |
| **CC-20** | Forbidden-token post-check (Quiet/magic/premonition/fate/chosen) + single auto-retry on hit. *Alias V-6 inherits.* | TTRPG P0; UX+Engine P1. Settle P0 — TTRPG argues that if this ships *after* any other chargen AI call, the leak has already happened.  Pair with CC-18. |

**P0 batch character:** these six are heterogeneous (stale-peer fix, dice UI, slot binding, navigation, two AI safety guards) but they share one property: **each one's absence breaks the next session in a different way.**  Ship them together as the next-milestone deliverable.

## P1 — should land in next milestone

Tier-1 lift.  Sorted approximately by load-bearingness inside the M4 character-creation workflow:

| ID | Item | Notes |
|---|---|---|
| **M3D-2** | Campaign-link linter (pre-commit). | All P1.  Cheap CI gate; prevents the exact bug that bit the first play-test. |
| **M3D-6** | `tableSeats` + `<seat-strip>` region (modes-of-play); whisper event kind + print stylesheet later. *Alias CC-1 inherits.*  **Critique upgrade C1**: M3D-6 is a load-bearing dependency for CC-3/CC-5/CC-12/CC-24 — the chargen flow needs a seat surface as its spine. | TTRPG P0; UX+Engine P1.  Elevated note: minimum-viable `tableSeats` IS effectively P0 because DM-only mode is broken today AND because Phase 2's chargen stack depends on it. |
| **CC-3** | New `AppMode = 'character-creation'` + invite-token route variant. **Critique D1**: retag from [E] to [H] — the invite-token payload includes `archetypeHint` which is Underleaf-policy.  Engine ships the route + opaque-token plumbing; campaign declares the payload shape. | TTRPG P2 ("foundational once we commit to Mode B"); UX+Engine P1.  The route is the entry-point seam for every other CC item. |
| **CC-5** | 6-step `<character-creation>` region (Landing → Read-first → Pick path → Work → Done → Resume). | TTRPG+UX P1. |
| **CC-6** | Q&A form (7 MC + 3 SA) with conditional follow-ups. *Alias V-8 inherits.* | TTRPG+UX P1; Engine P2 (depends on V-8 schema OR Underleaf-hardcoded shortcut). |
| **CC-10** | "Pack my character" file download + copy-as-token export. | All P1.  Mode B has no recovery path without this. |
| **CC-12** | `<invite-manager>` panel: generate-link + paste-incoming-token. | TTRPG+UX P1.  Coordination surface for async chargen. |
| **CC-13** | Session-1 intake: WebRTC pull / paste-token / collapse-to-Mode-A for unfinished players. | TTRPG+UX P1. |
| **CC-14** | "Synthesize all backstories" DM button + per-PC review pills. | TTRPG+UX P1; Engine P3 ("trivial UI once stack is in"). |
| **CC-15** | DM constraint DSL minimum: `party_requires` + `party_unique`. | TTRPG P1 (user named "no party of all bards" as a constraint); UX+Engine P2.  **TTRPG argues elevation** — the DM literally cannot run session 1 without this. |
| **CC-17** | Backstory-synthesis schema variant in `src/ai/schema.ts`. | All P1.  Mechanical and blocks every other CC-AI item. |
| **CC-19** | System prompt content (negative-tone + hard constraints + few-shot). *Alias V-7 inherits.* | TTRPG+UX P1. |
| **CC-21** | Structural validator (word count, place token, name uniqueness). | TTRPG+UX P1. |
| **CC-23** | Re-roll whole / regenerate-paragraph / edit-freely UX. | TTRPG+UX P1. |
| **CC-24** | DM approval gate + per-PC pill. | UX P0 (visibility IS the trust anchor); TTRPG+Engine P1.  Resolve P1 — the gate exists; the *visibility* polish elevation is real but not session-blocking. |
| **CC-25** | Required-fields + length validator (pre-API-key). | TTRPG+UX P1. |
| **M3C-1** | Per-kind materializer extraction.  Today's `state.ts` switch has 32 case arms; M3D/M4 add ~6 more event kinds (`pc-slot-bind`, `whisper`, `table-topology-set`, `peer-reclaim`, etc.).  **Engine P1 + sequencing constraint** — land this BEFORE the new event kinds, not after. | TTRPG P2; UX P3; Engine P1.  Resolve P1 — engine's argument that "the marginal cost rises with every new event kind" is correct.  Schedule as M4 phase 0. |
| **M3C-6** | Prompt-cache hit-rate verification (one-shot measurement). | TTRPG+Engine P1; UX P2.  Resolve P1 — runs during the first real AI-heavy session; tells us whether CC-22 will pay off. |

## P2 — should land in next 2-3 milestones

Sorted by category:

**Chargen flow polish:**
- CC-4 (per-PC SaveDocument variant)
- CC-7 (free-write markdown editor)
- CC-9 (path toggle Q&A ↔ free-write)
- CC-11 (resume-on-revisit + wrong-device empty state)
- CC-16 (soft-warning surface for crystallization + engagement balance)
- CC-22 (1h cache + parallel suffix calls) — engine wants P1 for cost discipline; UX P2 ("$0.20 a session is fine"). Resolve P2.
- CC-28 (promote `pcs/README.md` 5-list to questionnaire schema)
- CC-30 (curated Bay Area allowlist) — pairs with CC-26 deferral
- CC-31 ("Two technical PCs" Episode 1 constraint default)

**Slot rebinding (Q2 user clarification):**
- CC-32 (DM-triggered slot reassignment after PC death) — TTRPG P1 ("realistic in episodes 2-3"); resolve P2 with note that this lands soon after CC-2's live state.
- CC-33 (player-temporarily-out via `present: boolean`)
- CC-34 (player-permanently-leaves: reassign or retire as NPC)
- CC-35 (mid-session rebinding affordance behind confirm)
- CC-37 (session/chapter granularity independence — test, not feature)

**DM-gate opt-out (Q3 user clarification):**
- CC-38 (`aiBackstory.requiresDmApproval` field; default true)
- CC-39 (post-gen validators still run on opt-out)

**Open questions:**
- Q-CC-1 (async-mode archetype-deviation policy) — TTRPG P1; engine P2 with proposed disposition "soft hint default."
- Q-CC-2 (pre-gen library scope) — proposed disposition: not needed for v1; "edit example PC" works.
- Q-CC-3 ("use same device" wording) — user owns; ship CC-5 with placeholder copy.
- Q-CC-5 (print-friendly character sheet) — M5+ carry.

**M3c followups still open:**
- M3C-2 (dice-roll dispatch placeholder `result: 0, dice: []`) — promotes to P1 IF M3D-4 ships first (UX flagged: AI-proposed roll pills would all show `0`). Sequence with M3D-4.
- M3C-5 (`pushing-back` ladder gating) — defer post-playtest per plan.

**M3b followups still open:**
- M3B-2 (topbar budget widget) — *inline* meter landed at M3b.7; the topbar variant is polish. TTRPG ranking mistook the inline meter for this item; entry is NOT stale.
- M3B-3 (tag `playtest-1` on green pass) — bookkeeping; do at next milestone close.

## P3 — defer indefinitely

| ID | Item | Convergent reason |
|---|---|---|
| **CC-8** | Pre-gen browser. | "Edit the example PC file directly" works for v1. |
| **CC-26** | Bay Area place allowlist. | Pure campaign content; trivial to add when CC-21 lands. |
| **CC-27** | MC ↔ SA consistency cross-check. | DM eyeballing the answers is faster than the rules. |
| **CC-29** | Per-archetype tag suggestions for AI. | AI-output garnish, not load-bearing. |
| **CC-36** | AI-assisted slot rebinding. | DM clicks a menu; voice command is automation candy. |
| **V-1** | CasterLadderState hardcode → campaign-declared. | Tech-debt invisible at the table. |
| **V-2** | Hard-gate categories → `hardGateRules[]` schema. | Same. |
| **V-3** | Harm/stress max + stat range → declared track shapes. | Same. |
| **V-4** | Stat keys → declared stat block. | Same. |
| **V-10** | Generic state-event kind. | Explicit long-term refactor. |
| **Q-CC-4** | AI synthesis progress indicator at scale. | "DM can wait 30s" — over-engineered. |
| **M3C-3** | pc-edit stale-read window (LWW race). | Tolerated per threat model. |
| **M3C-4** | pc-edit universal-write trust gap. | Explicitly tolerated per threat model. |
| **M3B-1** | IndexedDB full-text store keyed by AI hash. | Audit chain + in-memory broker is enough. |

## Aliases (no separate priority)

- **CC-1** → M3D-6 (same `tableSeats` field).
- **CC-2** → M3D-5 (same `pcSlots` field).
- **V-5** → M3D-4 (engine SPLIT proposal: schema field `primaryRoll` can land independently before the UI; document the field as part of M3D-4 phase 0).
- **V-6** → CC-20.
- **V-7** → CC-19.
- **V-8** → CC-6 (engine note: the schema half — engine accepts `characterCreation.questions[]` — worth doing concurrently with CC-17).

## Most load-bearing dependency constraints (engine perspective)

Five sequencing facts that should govern the next milestone's plan:

1. **`navController` extraction (inside M3D-3)** must precede M3D-5, M3D-6, M3D-7, CC-3.  Single seam; one extraction unlocks five items.
2. **M3D-5 (`pcSlots` live state)** precedes CC-32, CC-33, CC-34, CC-35, CC-36, CC-37, and the seat-strip portion of M3D-6.
3. **CC-17 (synthesis schema)** precedes CC-19, CC-20, CC-22, CC-23, CC-24.  Whole AI synthesis stack assumes the schema.
4. **M3C-1 (per-kind materializer extraction)** should precede the M3D/M4 event-kind additions.  Otherwise the 32-case switch grows to 38+.
5. **CC-3 (`AppMode='character-creation'` + invite-token route)** precedes CC-5, CC-12, CC-13.  The `routing.ts` change is also the right place to slot the route-change-fires-leave hook from M3D-3.

## Notable cross-lens disagreements

| Item | Disagreement | Resolution |
|---|---|---|
| **CC-15** (constraint DSL) | TTRPG P1 ("named DM constraint"); UX/Engine P2 (engine plumbing). | **P1.**  TTRPG-craft argues the DM cannot run session 1 without it — that argument trumps engine economy. |
| **CC-24** (DM approval gate visibility) | UX P0; TTRPG/Engine P1. | **P1.**  Gate exists conceptually; the elevation is about *visibility* polish, not the gate itself. |
| **CC-22** (1h prompt cache) | Engine P1 (cost discipline); UX/TTRPG P2. | **P2.**  UX wins — "DM doesn't notice $0.20 per session" at v1 scale.  Revisit when budget meter trips. |
| **M3D-4** (dice UI) | TTRPG/UX P0; Engine P2 (with V-5 sequencing note). | **P0** with SPLIT: schema field lands in phase 0 (cheap V-5 hybrid), UI in phase 1.  Engine concern addressed by sequencing, not deprio. |
| **CC-32** (PC-death rebind) | TTRPG P1 ("realistic in episodes 2-3"); UX/Engine P2. | **P2.**  Underleaf is one campaign and combat isn't lethal-by-default; revisit if first play-test mortality is higher than expected. |
| **M3C-1** (per-kind extraction) | Engine P1 (debt grows with new event kinds); TTRPG P2; UX P3. | **P1.**  Engine's sequencing argument is correct; new event kinds in M4 would each add a case arm. |

## Recommended next-milestone scope (M3d-or-M4-merged)

Based on the priority + dependency graph above, a coherent next-milestone scope:

**Phase 0 (foundations, ~1 week):**
1. M3C-1 (per-kind materializer extraction) — before any new event kinds.
2. `navController` extraction (the seam inside M3D-3).
3. CC-17 (synthesis schema variant).
4. V-5 schema-half: declare `primaryRoll` in `campaign.json` (cheap; sets up M3D-4).

**Phase 1 (P0 items, ~2-3 weeks):**
5. M3D-3 (stale-DM-peer + heartbeat).
6. M3D-5 / CC-2 (live `pcSlots` + click-to-bind + `pc-slot-bind` AI tool).
7. M3D-7 (scene + dm-doc navigation; `[`/`]` hotkeys; AI `requestNav`).
8. M3D-4 (2d6 dice-Dock UI consuming `primaryRoll`).
9. CC-18 (player-facing context override) + CC-20 (forbidden-token check).

**Phase 2 (P1 items, ~2-3 weeks):**
10. M3D-6 (`tableSeats` minimum viable; seat-strip; full polymorphism deferred).
11. CC-3 (chargen AppMode + invite tokens).
12. CC-5 (6-step chargen region).
13. CC-6 (Q&A form; Underleaf questions inline first; schema later).
14. CC-19, CC-21, CC-23, CC-24, CC-25 (AI synthesis stack + DM gate).
15. CC-10, CC-12, CC-13, CC-14 (DM/player intake flow).

**Phase 3 (P1 polish + post-playtest, ~1 week):**
16. M3D-2 (campaign-link linter).
17. CC-15 (constraint DSL min subset).
18. M3C-6 (prompt-cache hit-rate measurement).

**Out-of-milestone:** everything P2/P3, plus the V-* items handled opportunistically per the tech-debt policy.

## Open questions, proposed dispositions (carry into next user conversation)

The cross-expert pass effectively resolved most Q-CC items:

- **Q-CC-1** (archetype deviation): default to "soft hint" per engine recommendation; revisit only if first async play-test shows DM conflicts.
- **Q-CC-2** (pre-gen library scope): not needed for v1; the existing five `characters/pcs/` files serve as direct-edit pre-gens.
- **Q-CC-3** (use-same-device wording): user owns the copy; ship CC-5 with placeholder text first.
- **Q-CC-4** (synthesis progress indicator): defer (P3).
- **Q-CC-5** (print sheet): M5+ carry.

The user can accept these dispositions in passing or flag any for re-discussion.

## Phase 2 design notes (post-critique 2026-05-22)

A critique-agent pass against the Phase 2 scope surfaced one user-decision blocker (F1 — invite-token signing/expiry) and ~10 medium gaps.  The blocker was resolved with a documented default; the user can override at gate review.

**F1 resolution (invite-token signing/expiry):**
- Token shape: `?campaign=<slug>&invite=<base64url(JSON{slotIndex, issuedAt, campaignFingerprint})>`.
- **NO** `archetypeHint` or `displayHint` in the token payload.  Those leak DM-intent if the URL is screenshot/forwarded.  The DM communicates them in the email body alongside the URL.
- `issuedAt + maxAgeDays` (default 30) checked at redeem time; expired tokens show "ask your DM for a fresh link."
- `campaignFingerprint` checked at redeem time prevents accidental cross-campaign redemption.
- No HMAC signing — the threat model accepts "outsider redeems an expired/stolen URL" because all they can do is start a local chargen flow for a slot.  The DM physically imports each player's token at session 1, so impersonation at the table requires social-engineering not URL-discovery.

**Other critique resolutions adopted inline** (no user ask):
- **B1**: `<invite-manager>` lives in `<dm-aside>` as a collapsible panel, visible in pre-session mode.
- **B5**: All AI calls + iteration happen on the DM's machine at session 1.  "Use same device for session 1" goes from optional to required-by-architecture.
- **B6**: Per-PC DM-approval pill lives on each seat in `<seat-strip>` with an aggregated "N of M ready" in `<invite-manager>`.
- **C3**: 1h cache `cache_control` header lands with CC-19; parallel suffix calls stay P2.
- **D3**: dm-only path predicate (V-12) — engine hardcodes `dm/` + `design/DM-ONLY/` as the directory pattern; campaign-relative directory layout assumption noted in boundary doc.
- **F3**: IndexedDB key is `{campaignSlug}:{slotIndex}`, not `{inviteToken}`.  Regenerating a token doesn't orphan data; slot-reassignment (CC-32) is the explicit clear path.
- **F4**: `<invite-manager>` has an explicit "Add slot" button.
- **F5**: `characterCreation.questions[]` lives inline in `campaign.json`.
- **F6**: `campaign.json` declares `aiBackstory.fewShotPath`; engine reads.
- **F7**: CC-3 URL parser detects in-progress IndexedDB state and offers resume.
- **F8**: `AppMode='character-creation'` renders `<character-creation>` as a full-Stage takeover; Rail collapses to a step-progress strip; Aside + Dock hide.
- **E1**: CC-1 ≡ M3D-6 *seat-strip subset* only.  Whisper + print stylesheet remain deferred to M3e.
- **D2**: Q-CC-3 ("use same device" wording) — split out of CC-5 as a [C] copy item.

**Critique items NOT adopted (deferred or unchanged):**
- Critique requested CC-3 be tagged [H].  Accepted — see backlog-catalog tag column update.
- Critique flagged C2 (M3D-3 hook covers all AppMode transitions, not just home↔campaign) — added as a smoke-test item for the M3D-6 commit.
