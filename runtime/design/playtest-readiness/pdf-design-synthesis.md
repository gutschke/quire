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
