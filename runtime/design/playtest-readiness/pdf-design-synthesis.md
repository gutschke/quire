# PDF character-sheet — design synthesis

Run-20 work item: "Print PC as PDF" for tabletop play. Synthesis of three
parallel expert briefs (TTRPG/UX, visual designer, PDF engineering). This
doc is the contract the implementation honours.

## Decisions

### What

A button on the PC sheet that produces a real `.pdf` file (not a browser
print dialog) sized for A4 and US Letter, downloadable and table-printable.
Two audiences: **player** (firewall-scrubbed) and **DM** (full record +
dossier).

### How

- **pdf-lib**, lazy-loaded from `src/pdf/print-pc.ts`. The bundle classifier
  in `scripts/check-bundle-size.mjs` whitelists only `^index-` (main) and
  `^authoring-` (authoring); the resulting `print-pc-<hash>.js` chunk is
  classified `other` and uncapped.
- **StandardFonts only (Helvetica + Times) in v1.** Defer font subsetting and
  fontkit to v2; if visual critics endorse embedded fonts, the swap is
  isolated to `src/pdf/print-pc.ts`. Trade-off: ~50KB smaller lazy chunk now,
  visual polish later.
- **Page size**: portrait 595×842 pt (A4) and 612×792 pt (Letter). Margins
  pad the difference so the content area (≈186×255mm) is constant. One PDF
  per request; the caller picks page size.
- **Determinism for CI**: `setCreationDate(new Date(0))`,
  `setModificationDate(new Date(0))`, `setProducer('')`, `setCreator('')`,
  `setTitle('PC Sheet')`, `save({useObjectStreams:false})`. SHA-256 gold test
  + `pdftotext` content/firewall test.

### Firewall

Player-audience exports go through `stripDmOnlyFromCharacter` (the canonical
projection from `character-loader.ts`) BEFORE any layout code runs. DM-only
fields cannot reach the renderer. Per-entry `bonds[].dmNotes` strip is part
of the same projection.

**Conditional magic section**: when `knowsTheyCanCast === false`, the magic
section emits zero glyphs — not a redacted placeholder, not a header. The
layout reflows. This honors the silent-player-firewall rule
(`feedback_silent_player_firewall.md`) literally: telling the player there's
a redacted block IS a spoiler.

## Layout (player audience, portrait, single side)

```
+------------------------------------+
| IDENTITY BAND  (name · pronouns ·  | <- 22mm
|  alignment · archetype label)   ◊  | <- Quire mark glyph (top-right)
+------------------------------------+
| HARM        STRESS                 | <- 28mm paired tracks
|  [ ][ ][ ][ ]   [ ][ ][ ][ ]       |    inner-offset rule on stress boxes
|  Bruised...     Tense...           |    (B&W redundancy)
+------------------------------------+
| STATS strip  STR DEX CON INT WIS CHA | <- 14mm compact horizontal
+------------------------------------+
| SKILLS + TAGS                      | <- 18mm
+------------------------------------+
| FOCI (name · domain · status)      | <- 22mm
+------------------------------------+
| CONDITIONS         INVENTORY       | <- 22mm two-column
+------------------------------------+
| MONEY BAND  broke·tight·comfortable·… | <- 8mm horizontal ring
+------------------------------------+
| BONDS    (player-visible text only) | <- 26mm
+------------------------------------+
| BACKSTORY prose                    | <- flex, overflow to page 2
+------------------------------------+
| ADVANCEMENT  [ ][ ][ ][ ][ ]  n/8  | <- 10mm
+------------------------------------+
| FOOTER  2d6+stat: ≤6 miss · 7-9    | <- 8mm
|  partial · 10+ hit · 12+ exceptional |
+------------------------------------+
```

When `knowsTheyCanCast === true`, a **Magic section** ("The Quiet" header)
slots between Foci and Conditions:

- Five-tier table (Free / Cheap / Costly / Hard / Prohibited) — short text,
  no boxes.
- Footer reminder: "Foci shift in-domain casts one tier easier."

Tax-active state is NOT printed on the player sheet (DM-only by firewall).
The −2 manifests in fiction via DM ruling.

## Layout (DM dossier — separate sheet)

- Player sheet (verbatim) PLUS a dossier page with:
  - Header band: amber 4pt left bleed bar (`oklch(55% 0.14 75)`); label
    "DM — DO NOT SHOW PLAYER" small-caps top.
  - `magicPhase`, `knowsTheyCanCast`, `tax` state + `sessionsRemaining` +
    `releaseMoment`.
  - `threadDebt` rung on the 5-step ladder (Quiet → Noticed → Watched →
    Pushing-back → Hunted) — printed as a horizontal ladder, current rung
    circled.
  - `accidentalGrants[]` — timestamped list.
  - `alignmentDrift.marks` (0-5) + lastUpdated.
  - `dmNotes` prose.
  - `bonds[].dmNotes` per entry, labeled with bond target.

## Color / B&W redundancy

Color carries flavor, never information. Print stylesheet uses light-mode
oklch from `tokens.css.ts` darkened ~10% for ink. Required redundancies:

- Harm/Stress: **shape difference**. Harm boxes single 0.7pt stroke; stress
  boxes have an inner 0.4pt offset rule 1mm inside. Same color or different
  color, both readable in B&W.
- Track labels printed in small-caps left of each row — redundant name.
- Penalty crib printed above each box position — redundant cost.
- DM dossier: amber bar PLUS vertical "DM" small-caps label on the bar.

## Motif system

v1 ships 2 of the visual designer's 4 motifs (rest deferred to v2):

- **Fold-rule hairlines** between sections, 0.5pt, with 1.5mm upward curve at
  the margin ends (mimics quire spine-fold).
- **Quire mark** in top-right of identity band: 4mm stacked-arcs glyph,
  0.6pt stroke, inner arc filled with print-accent.

Deferred for v2 (pending critic endorsement): marginal botanical sprig
(Underleaf), dot-grid background under prose blocks (Quiet).

## Implementation outline

```
src/pdf/
├── print-pc.ts            (public entry, lazy-imported)
├── print-pc-layout.ts     (section drawing helpers)
├── print-pc-firewall.ts   (wraps stripDmOnlyFromCharacter for safety)
├── print-pc-fixtures.ts   (5 synthesized PCs for tests)
├── print-pc.test.ts       (unit: SHA gold + structure)
├── print-pc.firewall.test.ts (firewall regression: no DM-only string
│                             surfaces on player-audience pdftotext)
└── print-pc.e2e.test.ts   (pdftotext/pdfinfo against real .pdf bytes;
                            gated on PDF_TOOLS=1)
```

Public API:

```ts
export interface RenderOptions {
  audience: 'player' | 'dm';
  pageSize: 'A4' | 'Letter';
  /** For testing: lock all timestamps. */
  deterministic?: boolean;
}
export async function renderPcPdf(
  pc: CharacterRecord,
  options: RenderOptions
): Promise<Uint8Array>;
```

UI handler (in `quire-app.ts` or the PC-sheet component):

```ts
const { renderPcPdf, downloadPdf } = await import('./pdf/print-pc');
const bytes = await renderPcPdf(pc, { audience, pageSize: 'A4' });
downloadPdf(bytes, `${pc.name}-pc-sheet.pdf`);
```

## Anti-patterns (forbidden)

- Stat grid as the dominant visual centerpiece (D&D-itis; anti-prime-
  directive).
- Health-bar style harm track (encourages depletion-thinking; should be
  4 labeled boxes).
- Redacted magic block when `knowsTheyCanCast === false` (firewall: the
  presence of the block itself is the spoiler).
- Spell-list slots, prepared-spells block, XP bar, encumbrance column.
- Combat-moves card (implies combat-centric play; rules.md:111 says combat
  is rare).
- Heavy backgrounds / fantasy ornamentation (rune borders, dragons,
  parchment textures, leather, drop-caps).
- Embedding the PC name in PDF metadata Title field (PII surface).

## Test plan

- **Unit (`vitest`, happy-dom)**: render fixture PC → SHA-256 of bytes ===
  known gold. Re-running produces identical bytes (proves determinism).
- **Firewall (`vitest`)**: for each of 5 fixtures with `audience:'player'`,
  `pdftotext` extract MUST NOT contain any DM-only string (dmNotes
  paragraph, accidentalGrants notes, threadDebt rung name, tax fields,
  alignmentDrift, magicPhase, bonds[].dmNotes). Gold list of forbidden
  substrings derived from the fixture.
- **E2E (`vitest`, gated on PDF_TOOLS=1)**: `pdfinfo` must report page count
  and size; `pdftotext` must contain PC name + every player-visible field
  identified in the fixture.
- **Bundle gate (`bundle-gate.test.ts`)**: add an assertion that a chunk
  named `print-pc-<hash>.js` classifies as `other` (uncapped).

## v3 outcomes (2026-06-06)

User asked to work the deferred v2 list.  v3 shipped:

- **Bezier fold-rule** — section dividers now have a real 1.2mm
  upward curve at each margin end (`drawSvgPath` with quadratic
  bezier).  v1/v2 shipped straight-line approximations.
- **Stacked-arcs Quire mark** — three nested arcs evoking a folded
  gathering of pages, rendered via three quadratic-bezier paths +
  a small filled glyph at the heart.  v1/v2 shipped flat circles.
- **Quiet dot-grid backdrop** on every prose page (not just backstory
  overflow): a 2.4mm orthogonal grid of low-opacity dots spanning
  the content area.  Signals the Underleaf "implicit order" motif
  without competing with body text.
- **Botanical sprig** in the lower-right margin of every prose page:
  S-curve stem + 3 alternating leaflets, drawn as quadratic-bezier
  almond shapes.  Marks the long-form record visually.
- **Bond name resolver** — `pcNames: Record<string, string>` option
  resolves `targetPcId` → display name (e.g., `slot-5-sam` → `Sam`).
  Falls back to the slug if the resolver returns undefined.  The
  Quire app passes `pcSlotBindings.map(b => [b.pcId, b.displayName])`
  when wiring this up.
- **`selfExport` flag** for explicit cross-PC defense-in-depth.
  `selfExport=true` (default): narrow scrub preserves the PC's own
  `knowsTheyCanCast` + `tax`.  `selfExport=false`: broader scrub
  also strips those for sibling-PC exports.  Aligns with
  `DM_ONLY_CHARACTER_FIELDS`.  Documented in `print-pc-firewall.ts`.
- **Section-floor pagination cascade** — extended the v2 bonds gate
  to also cover conditions/inventory and money/languages.  Each
  section that would draw into the advancement-strip floor pushes
  itself + everything after to a new page.  Eliminates any chance
  of a dense PC's sections bleeding into the advancement strip.

v3 deferred to v4:
- Full 1F/1B/2F/2B double-sided choreography (still single-page
  cockpit + multi-page prose tail; the TTRPG expert's per-face
  identity design needs more conversation).
- DM dossier surfaces `advancementHistory` (currently rendered, but
  the layout could be tightened for densely-advanced PCs).
- Markdown emphasis in *other* prose fields (bond text, focus
  boundFor) — currently parsed only in backstory + dmNotes.

## v2 outcomes (2026-06-06)

User flagged three real flaws after v1.1 ship: literal `*` separators
that looked like leftover markdown, no thought given to multi-sheet
flow, no edge-case fixtures. Three parallel experts (TTRPG, visual,
adversarial artifact-hunter) confirmed the issues + sketched fixes.

**Highest-leverage fix (one change, kills six findings):** swap
StandardFonts (Helvetica/Times) for embedded Liberation Sans + Serif
via fontkit.  Eliminates the `asciify` table and unlocks `·`, `→`,
`≤`, `—`, `…`, real italic from parsed `*emphasis*`.

**v2 changes shipped:**
- Liberation Sans + Serif embedded via `@pdf-lib/fontkit` (lazy chunk
  ~512 KB gz, uncapped).  OFL license bundled in `src/pdf/fonts/`.
- Markdown `*…*` → italic-run renderer for backstory + DM notes.
  Wrap algorithm preserves italic state across line breaks.
- Replaced `*` separators with real `·` middle-dot throughout.
- Skills + Tags as a chip cluster (mint-tint background, sans-bold
  for skills, sans-regular for tags).
- Foci promote to 2-column at ≥3 entries.
- Status glyphs (active / broken / faded / corrupted / transformed)
  drawn as vector primitives, not Unicode geometric shapes — works
  identically across font-coverage edges.
- "The Quiet" magic block: 2×3 tier-card grid (Free / Cheap / Costly
  / Hard / Prohibited / Foci-rule) replacing the prior compressed
  prose.
- 2d6 resolution reminder: 2×2 cell grid + doubles strip at the
  bottom of page 1.
- Section-overflow-aware pagination: when the post-magic cursor falls
  below the advancement-strip floor + bonds-min-height, the entire
  prose tail (bonds + backstory) flows to page 2.  Page 1 stays the
  table-glance "cockpit"; page 2 is the long-form record.
- Slim footer on continuation pages (`name · page X of Y`); the 2d6
  reminder lives on page 1 only.
- Backstory header bound to its body — never orphans at the bottom of
  page 1.
- Section header gray bumped to ~#555 (WCAG-AA on white).
- DM dossier banner full-width amber band + white warning text,
  passes the paper-shuffle test.

**4 edge-case fixtures added** (TTRPG-expert recommendation):
- `SLOT_6_VETERAN` (Vance Sato) — session-15: 6 advancements, 3 foci
  with state badges (active/broken/transformed), 3 conditions, 7
  inventory items, layered backstory.
- `SLOT_7_STORM` (Iris Chen) — 5 active conditions on a harm-3 PC.
- `SLOT_8_LONG_BACKSTORY` (Eleanor Vasquez-Marsh) — ~1100-word
  backstory across 7 paragraphs, 4 bonds.
- `SLOT_9_SPARSE` (Kit) — minimal everything, tests empty-state.

**Render shape under load (verified empirically):**
- Sparse (Marcus, Hadrian, Iris, Eleanor early, Kit) → 1 page.
- Medium / post-Realization (Yui, Rae, Sam) → 2 pages (cockpit +
  prose tail).
- Dense veteran (Vance) → 2 pages with multi-col foci on page 1.

**Multi-sheet flow strategy** (per TTRPG + visual designer briefs):
- Page 1: live-state cockpit — identity / harm / stress / stats /
  skills+tags / foci / magic (when revealed) / conditions / inventory
  / money + languages / advancement strip / 2d6 crib.
- Page 2+: prose record — bonds, backstory, slim footer with page
  number.
- DM audience appends a dossier sheet AFTER the player content.

**v3 (deferred, tracked in this doc):**
- True fold-rule curve (still straight strokes).
- Stacked-arcs Quire mark (still nested circles).
- Botanical marginal sprig (Underleaf motif).
- Quiet dot-grid backdrop on prose pages.
- TTRPG-expert's 4-page double-sided choreography (1F/1B/2F/2B with
  distinct per-page motifs).
- `selfExport: true` flag to make cross-PC self-knowledge explicit.
- DM dossier surfaces `advancementHistory`.
- Bond name resolver — surface PC display names instead of slot ids.
- Section-floor-aware pagination for conditions / inventory / money
  + languages (currently page-1 advancement strip can clip a dense
  money rule).

## v1.1 critique outcomes (2026-06-06)

Four parallel critics (TTRPG/UX, visual designer, print/accessibility,
adversarial firewall) reviewed the rendered fixtures. Convergent P0
findings fixed in v1.1:

- **DM dossier title collision** — warning text was rendering behind
  the PC name (paper-shuffle test fail). Fix: full-width amber band
  at the page top, white "DM DOSSIER · DO NOT SHOW PLAYER" 14pt bold.
- **Harm/stress penalty cribs unreadable** at ~5pt. Bumped to 7pt
  with extra leading and raised position.
- **"The Quiet" magic block was compressed prose**, not a quick
  reference. Restructured as a 2-column tier table (tier × resolution)
  with intent reminder above and focus rule below.
- **Foci unscannable** as inline prose. Refactored to bulleted list
  with bold name + status badge for non-active states + secondary
  subline with domain + bound-for.
- **Footer clipped on Letter** (Letter is 18mm shorter than A4).
  Bumped marginY 18mm → 20mm.
- **Side margins** widened 15mm → 16mm so hairlines survive cheap
  inkjet margins.

Convergent P1 fixed in v1.1:
- Conditions header always renders (even when empty).
- Bonds prefix with the target identifier so relationships are
  scannable.
- Section header gray darkened to ~#555 (≥4.5:1 contrast for WCAG-AA).
- Stat numbers demoted from 18pt bold → 13pt regular (prime-directive:
  stats are reference, not the star).
- Filled track boxes use a check-glyph instead of diagonal hatch
  (reads as pencil-applied, not pre-printed).
- `foci[].notes` stripped on player audience (defense-in-depth — Rae's
  fixture carried "Pier 14 cast" cast-vocabulary in notes; layout
  did not render it but the firewall now strips it regardless).

Deferred to v2 (still ship-now):
- OFL font upgrade (Inter + Source Serif via fontkit embed).
- True fold-rule curve (currently straight strokes).
- Stacked-arcs Quire mark (currently nested circles).
- Botanical marginal sprig (Underleaf motif).
- Quiet dot-grid behind backstory prose.
- `selfExport: true` flag to make cross-PC export defense-in-depth
  explicit at the API layer.
- DM dossier surfaces `advancementHistory`.

## Open questions for critique-phase

After v1 ships, ask critics:

1. Does the portrait layout work, or does the paired harm/stress band feel
   cramped at top? (TTRPG expert assumed landscape; visual designer
   recommended portrait — synthesized as portrait, needs validation.)
2. StandardFonts (Helvetica/Times) — acceptable for v1, or does it look
   cheap and we need to invest in embedded OFL fonts?
3. Do the 2 motifs (fold-rule + Quire mark) carry the brand, or do we need
   the deferred sprig + dot-grid?
4. Is the DM dossier as a separate sheet correct, or back-of-player-sheet?
5. Conditional magic section: does the reflow look intentional or like a
   missing chunk?
