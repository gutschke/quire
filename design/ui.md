# Quire play app — UI design

Status: design spec, v0.1. Synthesized from a TTRPG-craft design pass, a web-UX design pass, cross-critique, and an engine-feasibility review (May 2026). The current implementation in `runtime/src/quire-app.ts` is a vertical stack of Lit cards; this doc replaces that shape. Engineering plan with prioritized tasks: see [`runtime/design/redesign-plan.md`](../runtime/design/redesign-plan.md).

## Prime directive (re-stated)

The software supports the DM and players; it does not drive the game. A session with zero dice rolls is just as legitimate as one with heavy combat. Chrome is quiet, mechanics fade, the scene text is the largest thing on screen. Animations attract attention only when the DM caused them to. See [`architecture.md`](architecture.md) for the rest of the framing.

## Design principles

1. **Cockpit, not document.** The browser window is the instrument panel. Muscle memory beats discoverability for a four-hour session — regions sit at fixed locations and never move under the user's hand.
2. **Tablecloth, not dashboard.** A real tabletop is mostly empty wood with a sheet, a die, and a notebook nearby. The UI quietly mirrors that. Pulses and notification dots are the enemy of in-person play; the DM owns the right to direct attention.
3. **Glanceable, not legible.** Sheet contents are absorbed peripherally — stats as numbers-in-shapes, harm boxes as filled squares, modifiers as chips. If a thing needs a sentence to convey, it lives one click deeper.
4. **Story over mechanics, visually.** The center of the screen is the scene text now, the schematic map later, or the post-session diff-review. Numbers cluster at the periphery.
5. **One canonical action per region.** Roster shows people. Dock rolls dice. Stage shows what the table is looking at together. Regions with multiple modes get explicit mode chips, not buried tabs.
6. **Asymmetric — the DM is a power user, players are spectators with sheets.** Both share the grid; their region contents diverge.
7. **No-scroll is a discipline.** Only the Stage and a small set of Aside sub-panels scroll. If you find yourself adding `overflow: auto` to the shell, the design is wrong, not the container.

## Platform

- **Desktop-first. Mobile is explicitly NOT required.** Primary target: 27" 16:9 with Discord on a second monitor. Must remain workable down to a 13" laptop at half-width (~1100 px). Ultrawide is a bonus.
- **`architecture.md`'s "phone-first" framing is dead.** Solo browse on a phone is acceptable (the binder mode below), but no in-session use case is designed for mobile.
- Dark-first; a light variant exists for daytime sessions, toggled in Topbar (not auto-detected — DMs prep at night and play in daylight).

## Layout system — the five-region grid

The shell is a single CSS Grid pinned to `100dvh × 100vw`. No outer scrollbar ever.

```
+-- topbar (40px) -----------------------------------------------------+
| Quire · Episode title · ladder (DM) · Mode · Status · Me · ?         |
+----------+---------------------------------------------+-------------+
|          |                                             |             |
|  RAIL    |                  STAGE                      |   ASIDE     |
|          |                                             |             |
| (sheet,  |  (scene prose / outline / npcs / map /      |  (roster,   |
| DM scene |   diff-review / authoring editor)           |   pinned    |
| nav)     |                                             |   NPCs,     |
|          |                                             |   AI/notes, |
|          |                                             |   chat)     |
+----------+---------------------------------------------+-------------+
|     DOCK — dice + reveal + broadcast (DM) + scratch (DM)             |
+----------------------------------------------------------------------+
```

Five regions: **Topbar**, **Rail** (left), **Stage** (center), **Aside** (right), **Dock** (bottom). Each region owns its own scroll. Grid template:

```css
grid-template-rows: 40px 1fr auto;
grid-template-columns: clamp(260px, 28ch, 320px) 1fr clamp(280px, 30ch, 340px);
```

Rail and Aside are sized in `ch` (text-driven). Stage gets `1fr`. Dock auto-heights between ~56-120 px depending on whether the DM scratch column is expanded.

### Reflow

- **Wide (≥ 1600 px)** — full three columns; Aside expands to room for roster + pinned NPCs + AI + chat all visible. Bonus secondary Stage pane on ultrawide ≥ 2400 px (for outline-next-to-scene or live-preview-while-authoring).
- **Default (1280 – 1599 px)** — three columns; Aside collapses chat/AI/notes into a tab strip *within* the Aside column.
- **Narrow (≤ 1100 px)** — two columns (Rail + Stage). Aside collapses into a slide-over drawer triggered from the Topbar. Dock remains.
- **≤ 820 px** — banner: "Quire is tuned for a larger window; some panels are hidden in the topbar drawers." No phone layout is provided.

### Reactive typography

`clamp()`-driven, anchored to viewport width. Continuous (not stepped) — at the table, DMs resize windows frequently as they dock Discord, and stepped typography snaps visibly and breaks read-aloud immersion.

| Surface | Range |
|---|---|
| Chrome (sheet labels, dice readout, roster) | `clamp(12px, 0.55vw + 6px, 14px)` |
| Body chrome (buttons, list items) | `clamp(14px, 0.78vw + 8px, 18px)` |
| Section headers | `clamp(15px, 1.2vw + 4px, 22px)` |
| **Scene prose** (Stage body) | `clamp(16px, 0.95vw + 8px, 22px)`, line-height 1.55, max-width 68ch |
| Dice result readout | `clamp(28px, 2.4vw + 10px, 56px)`, slab/geometric, tabular nums |

`font-variant-numeric: tabular-nums` everywhere a number appears. Units: `ch` for column widths, `dvh`/`dvw` for the shell, `rem` for paddings, raw `px` only for hairlines and focus rings.

Type stack: system sans for chrome (`ui-sans-serif, system-ui, ...`), one serif webfont for prose (Source Serif 4 or Literata, subset, ≤ 30 KB woff2), system mono for numbers (`ui-monospace`).

### Color tokens

Dark-first oklch palette. Single muted teal accent for primary actions; **amber for DM-only material** (caution rail, badge, warm tint). Harm red, stress violet. Light mode mirrors. No pure white, no pure black.

```
--surface-bg:    oklch(16% 0.01 250)   /* warm near-black */
--surface-card:  oklch(20% 0.012 250)
--ink-prose:     oklch(92% 0.01 90)
--accent-teal:   oklch(72% 0.09 200)   /* primary action, selected */
--dm-amber:      oklch(78% 0.13 75)    /* DM-only badge, caution rail, warm tint */
--harm-red:      oklch(64% 0.16 25)
--stress-violet: oklch(64% 0.12 295)
```

DM-only AI cards use `--dm-amber` at 8% alpha as a tinted fill plus a 4 px solid amber left rail. Player-visible content has no rail; DM-visible-only content always has the rail.

Motion: 100-220 ms ease-out for region/state changes; respect `prefers-reduced-motion`.

## Modes

Mode is a top-level state machine; the grid skeleton is identical across modes, only region contents change. Mode chip lives in the Topbar.

1. **Pre-session lobby** — DM solo plus players joining. Topbar shows campaign loader. Stage shows campaign README + episode picker. Rail shows the active campaign's character picker ("Who are you playing?"). Aside shows roster as people join, with the join code prominent. Dock is hidden (no dice yet, no reveal yet). When the DM hits "Start session," Dock slides in and Stage swaps to the first scene.
2. **In-session play** — the default. See player view and DM view below.
3. **Post-session** — Stage swaps to the [living-document diff-review](#living-document-workflow). Dock collapses to one-line status. The DM walks the diff and commits per category.
4. **Between-session authoring** — Stage promotes to a split-pane markdown editor + preview. Rail becomes a file tree. Aside becomes the frontmatter form + lint panel. Dock = 28 px status bar.
5. **Solo browse (binder)** — implicit when a user opens the app without an active session. Same grid, locked verbs: Dock collapses (no dice), Aside shows static roster + prior-session summaries, Stage shows the binder index, Rail stays as the sheet. A small "no live session" chip in Topbar. The only mode where mobile is acceptable.

Transitions are 180 ms ease-out — long enough to perceive, short enough not to annoy.

## Player view (in-session)

### Rail — the sheet, always

The Rail is the player's character sheet, never tabbed away from. Default render is condensed (~256 px wide):

```
+--------------------------+
| NAME · pronouns          |
| alignment chip           |
+--------------------------+
| STATS (2-col grid)       |
|   STR  0   INT  +2       |
|   DEX +1   WIS  +1       |
|   CON  0   CHA  +1       |
+--------------------------+
| HARM   [#][#][ ][ ]      |
| STRESS [#][ ][ ][ ]      |
+--------------------------+
| SKILLS (chips, wrap)     |
|   Knowledge · Tech       |
+--------------------------+
| FOCI                     |
|   grandmother's ring     |
|   (identity, intact)     |
+--------------------------+
| ▸ Tags                   |
| ▸ Backstory              |
| ▸ Advancement            |
+--------------------------+
```

Tap own portrait → Rail grows to `clamp(420px, 44ch, 480px)` (Stage absorbs delta via `1fr`) and expanded sections become visible. No modal, no overlay, no Stage occlusion.

Stat chips pre-fill the dice Dock when clicked. Harm/stress boxes are click-to-toggle with a 4-second undo toast — no confirmation dialog. Skill chips → 1-paragraph definition popover anchored to the chip (rules live where they're used).

### Stage — the revealed scene

Markdown rendered to ~68ch centered prose, scene-strip header above (`name · location · mood · expectedDuration · presentNpcs`, small caps, one line, ellipsed). The player sees only what the DM has revealed — paragraph by paragraph if the DM is doing slow-burn reveal (see [per-paragraph reveal](#per-paragraph-reveal)).

### Aside — roster, chat, private notes

- **Roster (top)** — other PCs as portrait + name + tiny harm/stress glyph + a single connection-state dot (present / lagging / gone). Current speaker (last to roll or chat) has a subtle 1 s outline pulse that fades. The DM gets a small crown glyph. Raised hands show a ✋ glyph next to the player.
- **Chat (middle, collapsible)** — collapsed by default in-person; opens on hybrid/remote.
- **Private notes (bottom)** — an auto-saving Markdown textarea, never replicated to peers, never persisted in events.jsonl. Players use this for their own threads.

### Dock — dice and raise-hand

Six stat chips (showing current modifier as superscript-tabular), a modifier stepper (`−` / `+0` / `+`), optional `+1 from tag` picker, a big "Roll 2d6" button. Last 3 rolls shown to the right as small pills (`STR+1 → 9`); clicking a pill re-rolls that exact roll. Result animates briefly, lingers ~10 s in the tray, then fades to a one-line "last: 9 (partial)" record. Doubles trigger a colored halo (red for double-1s, gold for double-6s) so the DM doesn't miss the complication/positive.

**Keyboard:** `R` opens dice popover, `1-6` pick stat, `+`/`-` adjust modifier, `Enter` rolls.

A small "raise hand" button lives at Dock-right. Tapping it adds a ✋ to the player's roster entry in everyone's Aside. Tapping again lowers.

## DM view (in-session)

Same grid skeleton; content differs. The DM is a power user with a cockpit.

### Rail — scene navigator + active PC

Top ~60% of Rail: **scene navigator** — vertical list of all scenes in the current episode. Current scene bolded. Each scene shows a reveal-state pip (filled = some/all paragraphs revealed, hollow = nothing revealed). Click a scene → Stage navigates. The navigator is the DM's spine of the session.

Bottom ~40% of Rail: **active-PC focus card** — when the DM clicks a player in the Aside roster, that PC's sheet (read-only) appears here with a small "GM controls" strip (nudge harm, nudge stress, mark thread-debt ladder, set `knowsTheyCanCast`, set `tryingTooHardSessionsRemaining`). Default state shows the DM's own condensed sheet.

### Thread debt — inline with the active-PC card

Five rungs: **Quiet → Noticed → Watched → Pushing Back → Hunted**. The ladder lives **inside the active-PC focus card in the Rail** (DM only), beneath that PC's stats and harm/stress, rendered as a horizontal 5-chip row with the current rung highlighted in amber. DM clicks a chip to advance/retreat (or uses the active-PC card's "advance debt" button).

Per-PC ladders rather than session-wide. The DM consults a PC's ladder while consulting their sheet — the data is *about that PC*, so it co-locates. A strip-above-Stage was considered and rejected: in a four-hour session, the DM reads scene prose constantly and a chip row above it would visually decay to background within the first session. Co-locating with the sheet keeps the ladder near where the DM is already looking when adjudicating a cast.

### Stage — scene, outline, NPCs, map

Stage gains a header with tabs: **Scene · Outline · NPCs · Map**.

- **Scene** — same Markdown render as players see, **plus a left gutter (~24 px)** with per-paragraph reveal pips (filled = revealed, hollow = hidden). Click a pip to toggle. Keyboard: `J`/`K` walk paragraphs, `Space` toggles. Above the prose, when a `dm/` companion exists for the active scene, an inline "DM aside" card appears in warm-tinted amber background with the corresponding text (e.g. `dm/the-gate.md`). The card carries a `[!CAUTION]` sticky banner and a 4 px amber caution rail down the Stage's left edge — the DM cannot mistake DM-only content for player-visible.
- **Outline** — the full episode's scene list with stakes summary, pacing target per scene, and per-scene reveal state.
- **NPCs** — the per-episode `dm/npcs.md` content, rendered as cards. Provides quick-ref while the DM is mid-scene.
- **Map** — the map for the current scene (see [Maps](#maps)). When the active scene has no `map:` frontmatter, this tab is hidden.

Stage tabs are local UI state, not events. The DM can switch tabs without affecting players.

### Aside — roster-dominant

The Aside is roster-dominant by visual weight. AI is the quietest panel by default; chat is collapsed.

- **Roster (top, the largest panel)** — same as player view but harm/stress values are visible to the DM, and clicking a player surfaces their sheet in the Rail's active-PC card.
- **Pinned NPCs (middle, expandable)** — when the DM consults an NPC via the NPCs Stage tab or via AI search, they can pin it. Pinned NPCs appear as a portrait row here, expandable to the quick-ref card. Pin state survives scene changes. Survives sessions (it's a `npc-pin` event, shared with co-DMs).
- **Stakes / pacing summary** — a single collapsed strip below pinned NPCs, expandable to the stakes-menu and pacing notes for the active scene.
- **AI console (bottom, smallest)** — a single-line input + the most recent response, pinned to Aside bottom. Default collapsed to one input row. `Cmd-K` focuses from anywhere. `↑`/`↓` walks prompt history. `Esc` collapses. Streaming response renders above the prompt and expands the panel upward only while in use; after the DM dismisses or uses the response, the panel re-collapses to the one-input-row default. The AI console does NOT compete with the roster for attention — it surfaces when the DM addresses it, then recedes. See [AI assistance](#ai-assistance).
- **Chat** — collapsible strip below AI; collapsed by default in-person.

### Dock — dice, reveal, broadcast, scratch

The DM's Dock has more verbs than the player's:

- **Dice bar** (same as player view; the DM rarely rolls but can).
- **Reveal** button (Dock-right, amber while there's an unrevealed paragraph in the active scene; changes to a quiet checkmark after firing). Reveals the *next* hidden paragraph in the active scene. Keyboard: `Cmd-Enter`. Long-press or Shift-click: reveals the entire scene.
- **Broadcast view** button (small, separate from Reveal). Pushes the DM's current Stage state (scene + tab + scroll position, or map state, or NPCs tab) to every player. Players' Stage navigates to match. Press again retracts. This is the DM's "everyone look at this now" verb — distinct from Reveal, which is about *content visibility*. Keyboard: `B`.
- **Scratch column** — always-visible one-line text input at the Dock-top, full Dock-width. Type a quick note, Enter, gone. Last 2-3 timestamped entries ghosted above on hover. Hotkey `'` focuses from anywhere. Scratch notes are coord-only events that DO go into `events.jsonl` (so the post-session AI can ingest them) but are **never rendered to players** and are **stripped from player-distributable save exports**.

## Per-paragraph reveal

The single most important DM control after dice. Mechanism:

- Markdown source is split at the source level into "blocks" (paragraphs, lists, blockquotes, code fences, headings, tables). Each block is rendered independently to sanitized HTML.
- Each block is identified by a **content hash** — short SHA-256 of the block's normalized source text. This is the reveal identifier; positional indices are NOT used as the source of truth because a campaign author inserting a paragraph or fixing a typo would otherwise invalidate every prior reveal event for the scene. Reveal state is preserved across edits as long as the block text is unchanged. When a block IS edited, prior reveals for that block silently lapse to hidden — which is the right behavior: the text has changed, the DM should re-decide.
- The Stage renders blocks as siblings; the DM-side Stage adds a sibling left gutter (~24 px) with one pip per block. Click to toggle. The pip is a sibling column, not injected into rendered content — robust against `marked` / DOMPurify updates.
- `scene-reveal-paragraph` event payload: `{scenePath, blockHash, paragraphIndex?}`. The materializer keeps `revealedParagraphs[scenePath]: Set<blockHash>`. `paragraphIndex` is a UI hint for tooltips ("approximately paragraph 3"), not authoritative.
- **Player Stage never emits hidden blocks to the DOM**. CSS `display: none` is not sufficient — a curious player could open devtools. The renderer omits non-revealed blocks entirely from the player-side render pipeline.
- Existing `scene-reveal` (whole-scene) remains as sugar: revealing a whole scene marks all current blocks revealed.
- The DM's gutter never appears on the player Stage — it's a sibling column added only when `coordHolders.has(viewerId)`.
- **Reveal-state cap per scene**: 256 distinct block hashes. Bounds DoS surface for a hostile coord; well above any realistic scene length.

Keyboard: `J`/`K` walk paragraphs (move focus, scroll into view); `Space` toggles the focused pip.

## AI assistance

AI is DM-only. Players never invoke AI.

### Structured tool return — `{safe, dmOnly, sources}`

Every AI call goes through an `AiBroker` that requests a structured response shaped:

```ts
interface AiResponse {
  safe: string;          // safe to read aloud
  dmOnly: string;        // contains spoilers / DM-only material
  sources: SourceRef[];  // {kind, path, ref} per cited file
  raw: string;           // for audit
  tokensIn: number;
  tokensOut: number;
  responseId: string;
}
```

The renderer never trusts free-form blobs. Provider implementations (Claude tools, Gemini response schemas) normalize to this shape. On parse failure, the broker returns `{safe: '', dmOnly: '(parse error)', sources: []}` — UI degrades cleanly.

### Visual treatment — render only what's there

```
+-- AI response ------------------------------+
|                                             |
|  Yui Tanaka, she/her, mid-30s, flight       |
|  attendant on upper-deck galley.            |
|                                             |  ← safe card (no rail)
|  [copy as read-aloud]                       |
|                                             |
|  +-- DM-ONLY --------------------- [copy]+  |  ← 4 px amber rail
|  | Her wife Inez is a nurse at SFGH;     |  |     warm-tint fill
|  | toddler Mei at her mother's tonight.  |  |
|  | Sources: dm/npcs.md, characters/...   |  |
|  +---------------------------------------+  |
|                                             |
|  AI considered: scenes/wheels-up.md ·       |  ← provenance footer
|                  dm/npcs.md (DM-only)       |
+---------------------------------------------+
```

**Only non-empty cards render.** If the AI returned no DM-only material, the DM-only card is absent — not a `(none)` placeholder. The provenance footer at the bottom of every response lists what the AI considered (with `DM-only` markers on files from `dm/` paths), so the DM still sees that the safety check happened without paying for an empty card visually.

The safe card carries no rail. The DM-only card always carries:
- 4 px amber left rail (`--dm-amber`)
- `[DM-ONLY]` small-caps badge top-left
- Lock glyph
- Warm-tinted background (`--dm-amber` at 8% alpha)
- "Copy (do not read aloud)" button
- Source-file chips at the bottom, clickable to open in Stage NPCs/Outline tab

The DM never has to *check* a card before reading aloud — the safe card has no chrome cue that would be confusable with the amber-rail card. Visual treatment makes it impossible to confuse.

### Public-vs-DM-only context

The broker exposes `buildContext({ scope: 'public' | 'dm' })`. By default, AI calls send ONLY public files (`scenes/`, `npcs/` non-secret, `world/`). The DM can flip a "include DM notes" toggle on the prompt form to pull in `dm/*` and `design/DM-ONLY/`. This makes the safety property explicit and audit-able: a DM who fires AI calls without the toggle cannot accidentally leak DM-only material into the response.

**The toggle resets to `public` after every prompt submit.** A one-off DM-only query should not stay armed for the next query. This is opt-in per prompt, not per session — a mid-session DM in a hurry must re-affirm the broader scope each time they want it. The toggle's reset is part of the safety property, not a UX nicety.

AI calls are restricted to the **current coordinator only**. A peer who is in `coordHolders` historically but is not currently coordinator cannot fire AI prompts. This keeps the hash-chained audit log a strict chain (single appender) rather than a fork-prone DAG. Mid-session DM handoff: the new coordinator picks up the chain head from `aiAudit` and appends from there.

### Three reference flows

1. **"What's that NPC's name?"** — AI sees scene file + present-NPC list + (if toggle on) `dm/npcs.md`. Returns a card with name/pronouns/voice/want. If sourced from `dm/npcs.md`, the DM-only card carries the warm border + badge.
2. **"Adjudicate magic tier."** — AI sees the PC's foci, `knowsTheyCanCast`, scene mood, magic tier rules. Returns a recommendation (`Cheap — no roll; minor debt`), a one-line in-fiction consequence (safe card), and a "watch for" note (DM-only card, e.g. *if PC is at Noticed already, this might tip them to Watched*).
3. **"What did I write about the cable last session?"** — AI sees prior `sessions/*/summary.md`, unlocked `dm/the-cable.md`, prior events.jsonl entries. Returns a chronological strip with provenance chips. DM-only excerpts get the warm border; player-visible session summaries appear in the safe card.

### Audit chain

Every prompt/response is hashed and the hash chained against the previous. `ai-prompt` and `ai-response` events carry hash + token counts (NOT content). Full prompt/response text lives in IndexedDB on the DM's machine. This satisfies the auditable-AI property without bloating the event log.

Per-session token budget meter lives in the Topbar; hard-stop at the ceiling.

## Living-document workflow

The unique-feature requirement. Post-session, the DM clicks **"Wrap session."** Stage becomes a structured diff-review.

### Inputs to the AI

- Current campaign files (per-file, in current state on disk).
- This session's `events.jsonl`.
- DM's written summary (Markdown, freeform).
- DM's scratch notes from the session.

### AI output — structured proposals

The AI returns a list of `DiffProposal` objects with the shape:

```ts
interface DiffProposal {
  category: 'npc-update' | 'scene-retcon' | 'new-thread'
          | 'dropped-thread' | 'pacing-note';
  target: { file: string; jsonPointer: string };
  before: string;
  after: string;
  rationale: string;
  sources: SourceRef[];
  baseSha: string;  // git SHA at time of generation
}
```

Each proposal is a single logical change, not an essay. Proposals that fail schema validation are rejected by the broker.

### Diff-review UI

Stage promotes to a two-pane scroll-synced diff:

```
+-- Topbar: Post-session — Wrap session — Tue 21 May -----------------+
+----------+-----------------------------------------+----------------+
| TIMELINE | DIFF-REVIEW (centered)                  | DM summary     |
| of       | [npc·9] [retcon·3] [thread·2] [drop·1]  | (sticky        |
| events   | [pacing·5]                              |  reference)    |
| (Rail)   +-----------------------------------------+                |
| beat 47  | NPC update — Yui Tanaka                 |                |
| beat 48  | -  (no field)                           |                |
| beat 49  | +  wife: Inez, ICU nurse at SFGH        |                |
| beat 50  |  source: dm/npcs.md ← session note      |                |
|          |  [✓ accept] [✗ reject] [✎ edit]         |                |
|          | ─────────────────────────────────────── |                |
|          | Scene retcon — 01-wheels-up             |                |
|          | -  (no "what happened" field)           |                |
|          | +  The party stayed in seats until ...  |                |
|          |  source: events.jsonl beat 47 +         |                |
|          |          DM summary §2                  |                |
|          |  [✓ accept] [✗ reject] [✎ edit]         |                |
+----------+-----------------------------------------+----------------+
| Dock: branch=living-doc-2026-05-21 · 9 proposals · [Commit per cat] |
+---------------------------------------------------------------------+
```

- **Category strip** above the diffs — chips for each category with a count badge. Click a chip to filter.
- **Per-proposal card** — current state on left, proposed on right, source-chip footer, three controls top-right (`✓` accept, `✗` reject, `✎` edit-then-accept). Accepted cards collapse to a single-line confirmation; rejected cards grey out but remain visible (undo affordance).
- **Per-category commit** — bottom of Stage shows one button per category: "Commit N accepted NPC updates," "Commit N accepted retcons," etc. ONE GIT COMMIT PER CATEGORY. Cleaner history than one giant blob.
- DM-only-file diffs (e.g. proposed changes to `dm/npcs.md`) carry the warm amber rail + `[DM-ONLY]` badge in the proposal card.

**MVP**: implement NPC-update category only. The other four categories follow the same pipe; ship them once the shape is proven.

This is the *unique feature* of an AI-supported TTRPG framework. It gets the central panel. The AI proposes structured changes; it does not write essays.

## Maps

MVP: a single image plus draggable named blobs.

- Scene frontmatter carries `map: scenes/01-wheels-up.png` (relative path within campaign).
- The Map Stage tab renders the image (via `URL.createObjectURL` of a fetched Blob — bypasses the Markdown sanitize pipeline entirely).
- SVG overlay on top; blobs are `<g>` elements with drag handlers. Each blob has `{id, label, x, y, kind?}`.
- DM operations: add/move/remove/reveal/unreveal. All are coord-only events.
- Players see the same image with only revealed blobs.

The map is a **Stage view-mode**, not a drawer. When the DM activates the Map tab, the scene prose collapses to a thin strip (title + mood line, ~80 px) along Stage-top; the map fills the rest of the Stage width. On ultrawide (≥ 2400 px), the secondary Stage pane can hold both side-by-side; otherwise it's one or the other. When players physically gather around the DM's screen — the in-person use case — the map needs the full width, not a postage-stamp drawer.

Deferred to v2: AI-generated maps, fog of war beyond hide/reveal, grid overlay, distance measurement, multi-layer, character tokens with sheets.

## Authoring on the web

Two surfaces — in-session quick edits and between-session full authoring.

### In-session quick edits

Low ceremony. The DM realizes mid-play that Yui's pronouns are wrong in `dm/npcs.md`. Clicks the field in the NPC quick-ref card, fixes, commits to a "session edits" branch. Single-field overlay. No editor mode switch. These edits ride through the diff-review at session end alongside AI proposals.

### Between-session authoring (mode 4)

Stage promotes to a two-pane split: **editor (left) + preview (right)**, 50/50 default, drag-resizable. Rail becomes a campaign file tree with dirty-state dots. Aside becomes the frontmatter form (YAML keys rendered as typed inputs, bidirectional with the editor's YAML block).

```
+-- topbar (author mode) ----------------------------------+
+------+------------------+----------------+---------------+
| TREE | EDITOR (mono)    | PREVIEW        | FRONTMATTER   |
|      |                  | (player view   |  name: ____   |
| ep1  | # Wheels Up      |  by default;   |  location: __ |
|  scn | The cabin lights |  toggle for    |  mood: ___    |
|  scn | dimmed forty …   |  DM view)      |  rolls: [...] |
| ep2  |                  |                | LINT          |
|      |                  |                |  ! mood empty |
+------+------------------+----------------+---------------+
| STATUS: dirty · branch: main · last commit 12m ago       |
+----------------------------------------------------------+
```

- **Markdown editor**: CodeMirror 6, lazy-loaded (the in-session bundle does not pay this cost).
- **Frontmatter form**: schema-driven from `schema/v0/*.schema.json`. Bidirectional — edit in either pane, the other updates.
- **Lint panel**: AJV validates against the JSON schemas. Errors inline with line numbers.
- **Scaffolding**: New Campaign / New Episode / New Scene each scaffold the directory layout with template files.
- **Sync**: MVP is manual export (tarball download of dirty files). GitHub PAT / device flow, Google Drive App-folder are deferred to v2.

WYSIWYG for the reveal contract: preview pane defaults to "what players will see" with a toggle for "what the DM will see" (including the `dm/` aside).

## Anti-patterns

A list of things that look like good UI but kill flow at the table.

### TTRPG-side
- **Notification dots and pulse animations on the player UI.** A pulsing icon at the table is a phone in a quiet restaurant. The DM should be able to cause attention; nothing else should.
- **Combat trackers, initiative orders, turn timers.** This is a theater-of-mind system. Adding any of these — even as an option — invites DMs to use them, and they will deaden the table.
- **"Generate a scene" or "generate an NPC" buttons during play.** AI as DM rather than AI as DM-assistant. AI ingests what the DM wrote and helps them re-read/recall/diff. It does not invent in front of the players. (Authoring mode is a different conversation.)
- **A persistent dice log feed.** Last roll lingers, then fades. A scrolling roll log turns the table into a Roll20 clone. The history is in `events.jsonl` post-session.
- **Detailed harm narratives.** The 4-box track is *deliberately* light. No "describe your wound" textarea on each box-tick. Players describe in fiction, at the volume they want, via voice.
- **Character-builder wizard.** Sheets are JSON, edited field-by-field with sensible defaults. Wizards encode a play-style; this ruleset is too thin to merit one.
- **Modal popups during play.** Modals stop the table. Sheet expansions, NPC quick-refs, dice popovers — all inline panels.
- **Sortable/filterable lists of anything.** A DM with a 12-NPC scene needs the 3 *for this scene* surfaced, not a filter. Filtering is a code smell for "we didn't curate."
- **Player-facing magic UI before the realization beat.** Sheets must look IDENTICAL to a non-caster's. No greyed-out spell section, no locked tab, no "?" icon. Fiction reveals the mechanic.

### UX-side
- **Tabbing the character sheet.** Stats and skills must coexist on screen with the scene.
- **A floating "roll dice" modal.** Dice live in the Dock, always visible.
- **Hamburger menus.** Every primary action is a visible button or a documented shortcut.
- **Confetti / dice-rolling animation theatre.** A short numeric pulse is enough.
- **Scrolling the whole app.** Only Stage and a small set of Aside sub-panels scroll. `overflow: auto` on the shell is a design bug.
- **Tooltips as the only label.** Every icon button has a visible text label by default; tooltips supplement, not replace.
- **DM-only content that looks like player content.** The amber rail is non-negotiable. Even a one-line spoiler note gets the rail.
- **Showing AI returns unfenced.** If the DM ever has to *check* whether they can read a return aloud, the UI has failed.
- **Treating chat as the centerpiece.** It isn't. Most sessions are in-person; chat is a backup. If chat ever grows louder than the scene prose, the design has failed.
- **A "settings" gear that opens a 12-tab settings page.** Settings live in a slide-over from the Topbar "me" chip, scoped tight (theme, font scale, API keys, peer name). Anything more goes in the campaign repo.

## Search palette (Cmd-K-K, `/`)

Opens a non-modal palette over the Stage (Stage dimmed but sheet and dice remain interactive). Searches the loaded campaign:

- **Scenes** — episode and scene titles + first-line summaries. Players see only revealed scenes; DM sees all.
- **Characters** — PCs and NPCs by name + tags. Player sees PCs in the session + revealed NPCs; DM sees everything with DM-only NPCs marked.
- **Items / spells / bestiary** — public records.
- **Notes** — the player's own private notes (player only).
- **Prior session summaries** — `sessions/<date>/summary.md` files.

Results grouped by category, keyboard nav with arrow keys, `Enter` opens, `Esc` dismisses. DM sees a small "[DM-only]" tag next to results from `dm/*` and `design/DM-ONLY/`.

This is NOT the AI prompt input — it's a deterministic filename/title search. AI is on the separate `Cmd-K` (Aside) console.

## Settings — slide-over from "me" chip

Tight scope: theme (dark/light/follow-system), font scale override (`±` from clamp default), API keys (Claude/Gemini), peer display name. Anything more belongs in the campaign repo or in a dedicated authoring-mode page.

The slide-over docks against the right edge of the viewport, ~360 px wide. It does NOT occlude Stage prose (Stage absorbs the Aside's column width but otherwise renders normally). The roster Aside slides behind it. The slide-over is `Esc`-dismissable from anywhere and does not steal focus from the dice or sheet — these remain clickable behind it. Not a modal in disguise.

## AppMode persistence

`AppMode` is encoded in the URL so reloads preserve it:

```
/?campaign=owner/repo&mode=in-session
/?campaign=owner/repo&mode=authoring&path=episodes/001-unattended-baggage/scenes/01-wheels-up.md
/?campaign=owner/repo&mode=post-session&session=2026-05-21
```

Default `mode=in-session` when omitted. `mode=solo-browse` is implicit when there's no live session AND no `&join=` parameter; the URL chip in Topbar says "no live session — browsing alone."

Solo browse with a deep-link to a scene (`?campaign=X&episode=Y&scene=Z`) honors the link **only for scenes the local save state records as previously revealed**. Unrevealed scenes redirect to the binder index with a one-line banner ("Scene not yet revealed — DM needs to host first."). This preserves the R3-A property (no pre-session scene leaks) while still letting players reread revealed material between sessions.

## Coordinator handoff mid-session

When a player is promoted to DM mid-session (the documented "player assumes DM duties if officially sanctioned" workflow):

- The Rail switches from player layout (sheet) to DM layout (scene nav + active-PC + DM sheet). The promoted peer's own sheet appears in the active-PC card by default.
- **Pinned NPCs** carry over. They are shared coord-only state; the new coordinator inherits the prior DM's tracking.
- **Scratch notes** carry over and are now visible to the new coordinator. This is the privacy trade-off of the handoff workflow — the original DM should be aware that handing off coord exposes their scratch column. (Spec note: a future "personal scratch" channel keyed to peerId could narrow this. Not v1.)
- **AI audit chain** is appended to by the new coordinator (single-appender invariant; see AI section).
- **Thread-debt ladders** carry over (shared state, render-gated DM-only).

## Error states

Specific failure paths and their UI treatment:

- **Budget ceiling hit mid-session** — AI prompt input disables; banner above input reads "Token budget reached for this session. Reset on next session, or raise the ceiling in Settings." Pending in-flight prompt is cancelled.
- **`baseSha` mismatch on living-doc proposal** — the affected proposal card grays out with a "campaign moved since this was generated; re-run AI to refresh" inline button.
- **Per-paragraph reveal arriving for an edited scene** — if the block-hash matches a current block, it applies. If the block-hash doesn't match any current block, the event is silently no-op'd (no visible error; the reveal is for a paragraph that no longer exists). The DM can see lapsed reveals in the gutter (a faint "lapsed" pip color).
- **Sync push failure (authoring mode)** — Stage status bar shows red "push failed: <reason>"; commit stays in local working copy and is retried on next push attempt. No silent data loss.
- **AI parse failure** — broker synthesizes `{safe: '', dmOnly: '(AI response was not in the expected format; raw text saved to audit log)', sources: []}`. The DM gets degraded but consistent output.
- **Peer disconnection during reveal/broadcast** — the event-log CRDT handles this transparently; no special UI. Disconnected peer shows a greyed-out roster row until they rejoin.

## Accessibility

- **Keyboard navigability is the primary input model**. Every primary action has a documented shortcut (see Keyboard map). No mouse-only affordances.
- **Color is never the sole signal**. The 4 px amber rail is paired with the `[DM-ONLY]` text badge; the harm-red and stress-violet fills carry filled-square count, not just color; the connection-state dot has both color and shape variants.
- **Live regions**: the Stage's revealed-paragraph updates use `aria-live="polite"`; dice roll results use `aria-live="assertive"`. The roster's current-speaker pulse is announced as "current speaker: <name>."
- **Focus management**: when a player taps their own portrait and the Rail expands, focus moves to the first newly-visible heading. When the search palette opens, focus moves into the search input. `Esc` always restores prior focus.
- **Contrast**: the oklch palette must meet WCAG AA (4.5:1 for prose, 3:1 for chrome). The dark surface (`oklch(16% 0.01 250)`) against prose ink (`oklch(92% 0.01 90)`) computes to ~14:1, comfortable. The DM-amber rail against warm-tint background must be verified at implementation time and adjusted if it falls below 3:1.
- **Reduced motion**: all transitions respect `prefers-reduced-motion`; 220 ms region-change becomes instant.

A full accessibility audit is deferred to v1.1 but the design constraints above are committed.

## Presence indicators

Beyond the 1 s outline pulse on current-speaker:

- **"Rolling..."** — when a player has the dice popover open, their roster entry shows a small `🎲` pip. Cleared when the roll lands or the popover closes.
- **"Typing..."** — chat shows a sticky "<name> is typing" line above the input when a peer has the chat input focused and non-empty. Not for AI prompts (DM-only privacy).
- **"Hand raised"** — ✋ glyph stays on the roster entry until the DM acknowledges or the player lowers.
- **Connection state** — dot color: green (good), amber (>200 ms RTT), red (lost). The pulse decay is supplemented by these sticky indicators for hybrid play with high-latency peers.

## Keyboard map

| Key | Action |
|---|---|
| `R` | Open dice popover |
| `1`-`6` | Pick stat (in dice popover) |
| `+` / `-` | Adjust modifier |
| `Enter` | Roll dice |
| `H` then `1`-`4` | Mark harm box N |
| `S` then `1`-`4` | Mark stress box N |
| `'` | Focus DM scratch input |
| `Cmd-K` | Focus AI prompt (DM) |
| `Cmd-K-K` or `/` | Open search palette |
| `Cmd-Enter` | Reveal next paragraph (DM) |
| Shift-click reveal | Reveal entire scene (DM) |
| `B` | Broadcast view (DM) |
| `J` / `K` | Walk paragraphs in Stage (DM) |
| `Space` | Toggle paragraph reveal pip (DM) |
| `[` / `]` | Previous / next scene (DM) |
| `Esc` | Collapse any expansion |
| `?` | Open shortcut sheet |

## Engineering plan

See [`runtime/design/redesign-plan.md`](../runtime/design/redesign-plan.md) for the prioritized P0-P5 task list, event-kind specifications, file-by-file migration path, and bundle estimates.

## Open questions / decisions deferred

- **Per-paragraph reveal granularity vs. heading-fusion.** Spec above ships "one pip per source block" identified by content hash. If campaign authors complain about reveal clicks for headings + immediate paragraph, revisit with explicit grouping syntax. (D-11 in [redesign-plan.md](../runtime/design/redesign-plan.md).)
- **Map Stage tab vs. drawer.** Spec above ships full-Stage map. If ultrawide users push back, the secondary-pane behavior already handles them; if narrow-window users push back, the drawer becomes a v2 option.
- **Anthropic via Chrome extension.** Architecture.md mandates it long-term; v1 uses the `anthropic-dangerous-direct-browser-access` flag with documented residual risk. (D-1 in plan.)
- **Personal vs. shared scratch column.** v1 ships shared scratch (coord-only, visible to whoever currently holds coord). A "personal scratch" channel keyed to peerId would narrow visibility on handoff; deferred until handoff usage data motivates it.
- **Five living-document categories vs. fewer.** v1 MVP is `npc-update` only. If during real post-session use the five-category split turns out to be a tax, collapse `new-thread` + `dropped-thread` into a single `thread-change`, and reconsider whether `pacing-note` is a structured diff at all (vs. a DM journal entry). Plan reflects this — v1 ships NPC-update only.
- **Map asset MIME restriction.** v1 accepts `image/png`, `image/jpeg`, `image/webp` only. SVG is rejected because SVG-with-script is unsafe in some embedding modes; revisit when the map embedding contract is locked to `<img>` only and an SVG safety pass has been audited.
- **Accessibility certification beyond AA.** A full audit is deferred to v1.1.

Resolved decisions (kept for traceability):

- `pinnedNpcs` and `threadDebt` are **shared coord-only state, render-gated DM-only**. AI calls restricted to the current coordinator.
- `scratch-note` events are **coord-only, in events.jsonl for AI ingestion, render-gated DM-only, stripped from player save exports**.
- Per-paragraph reveal uses **content hash** as the reveal identifier; positional index is a UI hint only.
- AI scope toggle (`public` / `dm`) **resets to `public` after every prompt submit**.
- AI response renders **only non-empty cards** plus a provenance footer; no `(none)` placeholders.
- Thread-debt ladder lives **inside the Rail's active-PC card**, not above Stage prose.
- The DM Aside is **roster-dominant**; AI console is the smallest panel by default, expanding only while in use.
