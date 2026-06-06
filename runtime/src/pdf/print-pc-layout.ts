/**
 * PDF layout helpers + per-section drawing for the printable
 * character sheet — v2 (2026-06-06).
 *
 * v2 changes over v1.1, per the converged critic synthesis at
 * design/playtest-readiness/pdf-design-synthesis.md:
 *
 *   - Embedded Liberation Sans + Serif via fontkit instead of
 *     StandardFonts.  Eliminates the `asciify` table (the source
 *     of literal `*` separators that looked like leftover markdown)
 *     and unlocks Unicode glyphs (·, →, ≤, —, …) and real italic
 *     for parsed markdown emphasis.
 *   - Markdown `*…*` emphasis in backstory parses to italic runs.
 *   - Skills + Tags rendered as a chip cluster with subtle mint
 *     tint, not an inline asterisk-separated list.
 *   - Foci promote to two columns when count ≥ 3.
 *   - "The Quiet" magic block rendered as a 2×3 grid of tier cards
 *     (Free / Cheap / Costly / Hard / Prohibited + Foci-shift rule)
 *     instead of a left-label / right-rule table.
 *   - 2d6 resolution reminder rendered as a 2×2 grid + doubles strip
 *     instead of a single justified footer line.
 *   - Look-ahead pagination: when the remaining backstory fits in
 *     < N lines, the section is pre-tightened to keep it on page 1
 *     and avoid a near-empty continuation page.
 *   - Continuation pages get a slim footer (`name · page X of Y`),
 *     not the full 2d6 reminder.
 *   - Subtle palette expansion: paper tint, mint chip background,
 *     Quiet violet for the magic section, soft rule color.
 *   - Bond entries prefix the target id (placeholder until v3 wires
 *     a name resolver) in colored sans-bold + the prose in serif.
 *
 * pdf-lib uses bottom-up Y coordinates (origin at the bottom-left).
 * Each `drawXxx` helper takes a top-of-section Y and returns the new
 * cursor (lower Y).
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  type RGB
} from 'pdf-lib';
// Optional ESM-only import; fontkit registers the OTF/TTF embed path
// on pdf-lib's PDFDocument.  The require is at runtime to keep the
// import statement under happy-dom while still letting Vite tree-
// shake when the chunk isn't loaded.
import fontkit from '@pdf-lib/fontkit';

import type { CharacterRecord } from '../character-loader';
import type { FontBytes } from './print-pc-fonts';

/** 1mm in PDF points. */
export const MM = 2.834645669;

export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 } as const,
  Letter: { width: 612, height: 792 } as const
};
export type PageSize = keyof typeof PAGE_SIZES;

export interface Fonts {
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifItalic: PDFFont;
}

export async function embedFonts(
  doc: PDFDocument,
  bytes: FontBytes
): Promise<Fonts> {
  doc.registerFontkit(fontkit as Parameters<typeof doc.registerFontkit>[0]);
  const [sans, sansBold, serif, serifItalic] = await Promise.all([
    doc.embedFont(bytes.sansRegular, { subset: true }),
    doc.embedFont(bytes.sansBold, { subset: true }),
    doc.embedFont(bytes.serifRegular, { subset: true }),
    doc.embedFont(bytes.serifItalic, { subset: true })
  ]);
  return { sans, sansBold, serif, serifItalic };
}

/** Ink colors for print (light-mode palette, darkened ~10% for ink). */
export const COLORS = {
  ink: rgb(0.17, 0.18, 0.20), // ~#2A2E33 — body text
  inkSecondary: rgb(0.33, 0.33, 0.33), // ~#555 — labels, hairlines
  rule: rgb(0.78, 0.79, 0.81), // ~#C8CACE — section dividers
  accent: rgb(0.12, 0.43, 0.47), // ~#1F6E78 — darkened teal
  harm: rgb(0.61, 0.23, 0.14), // ~#9B3A24
  stress: rgb(0.37, 0.23, 0.56), // ~#5E3A8E
  quiet: rgb(0.29, 0.24, 0.36), // ~#4A3E5C — Underleaf "Quiet" violet
  dmAmber: rgb(0.63, 0.42, 0.12), // ~#A06A1F
  paper: rgb(0.985, 0.975, 0.949), // ~#FBF8F2 — very light paper tint
  mintTint: rgb(0.933, 0.961, 0.945), // ~#EEF5F1 — chip background
  underleafGreen: rgb(0.184, 0.290, 0.227) // ~#2F4A3A — section headers
};

export interface PageContext {
  page: PDFPage;
  pageSize: PageSize;
  width: number;
  height: number;
  marginX: number;
  marginY: number;
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
  fonts: Fonts;
  pageIndex: number;
}

export function makePage(
  doc: PDFDocument,
  pageSize: PageSize,
  fonts: Fonts,
  pageIndex: number
): PageContext {
  const size = PAGE_SIZES[pageSize];
  const page = doc.addPage([size.width, size.height]);
  const marginX = 16 * MM;
  const marginY = 20 * MM;
  return {
    page,
    pageSize,
    width: size.width,
    height: size.height,
    marginX,
    marginY,
    contentLeft: marginX,
    contentRight: size.width - marginX,
    contentWidth: size.width - 2 * marginX,
    fonts,
    pageIndex
  };
}

// ============================================================
// Text helpers
// ============================================================

/**
 * Markdown emphasis run.  `italic=true` segments came from `*text*`
 * markup; rendered in serif-italic.  Bold-emphasis (`**text**`) is
 * NOT supported intentionally — Quire chargen uses single-asterisk
 * only and the lookup is simpler with one delimiter.
 */
export interface TextRun {
  text: string;
  italic: boolean;
}

/**
 * Parse a paragraph for `*…*` italic emphasis.  Returns an ordered
 * sequence of runs.  Unmatched `*` characters are preserved as
 * literal text — the parser is permissive.
 */
export function parseEmphasis(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) {
      runs.push({ text: input.slice(last, m.index), italic: false });
    }
    runs.push({ text: m[1], italic: true });
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    runs.push({ text: input.slice(last), italic: false });
  }
  return runs.length > 0 ? runs : [{ text: input, italic: false }];
}

/**
 * Wrap an array of mixed-font text runs into lines that each fit
 * within `maxWidth`.  Returns an array of lines, each line being
 * an array of `{text, italic}` runs.  Hard-wraps long single words.
 */
export function wrapRuns(
  runs: TextRun[],
  serif: PDFFont,
  serifItalic: PDFFont,
  size: number,
  maxWidth: number
): TextRun[][] {
  const measure = (text: string, italic: boolean): number =>
    (italic ? serifItalic : serif).widthOfTextAtSize(text, size);

  // Split run text into atoms separated by whitespace so we can
  // greedy-pack words while preserving italic state.
  type Atom = { text: string; italic: boolean; trailingSpace: boolean };
  const atoms: Atom[] = [];
  for (const run of runs) {
    for (const para of run.text.split('\n')) {
      const words = para.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w) continue;
        if (/^\s+$/.test(w)) {
          if (atoms.length > 0) atoms[atoms.length - 1].trailingSpace = true;
        } else {
          atoms.push({ text: w, italic: run.italic, trailingSpace: false });
        }
      }
      atoms.push({ text: '\n', italic: false, trailingSpace: false });
    }
  }

  const lines: TextRun[][] = [];
  let lineRuns: TextRun[] = [];
  let lineWidth = 0;

  const flush = (): void => {
    lines.push(lineRuns);
    lineRuns = [];
    lineWidth = 0;
  };

  for (const atom of atoms) {
    if (atom.text === '\n') {
      flush();
      continue;
    }
    const wordW = measure(atom.text, atom.italic);
    const spaceW = atom.trailingSpace
      ? measure(' ', atom.italic)
      : 0;
    if (lineWidth + wordW > maxWidth && lineRuns.length > 0) {
      flush();
    }
    if (wordW > maxWidth) {
      // Hard-break a single oversized word.
      let chunk = '';
      let chunkW = 0;
      for (const ch of atom.text) {
        const chW = measure(ch, atom.italic);
        if (chunkW + chW > maxWidth) {
          lineRuns.push({ text: chunk, italic: atom.italic });
          lines.push(lineRuns);
          lineRuns = [];
          chunk = ch;
          chunkW = chW;
        } else {
          chunk += ch;
          chunkW += chW;
        }
      }
      if (chunk) {
        lineRuns.push({ text: chunk, italic: atom.italic });
        lineWidth = chunkW;
      }
    } else {
      lineRuns.push({ text: atom.text, italic: atom.italic });
      lineWidth += wordW;
    }
    if (atom.trailingSpace) {
      lineRuns.push({ text: ' ', italic: atom.italic });
      lineWidth += spaceW;
    }
  }
  if (lineRuns.length > 0) flush();
  return lines;
}

/** Draw a single line of runs at baseline y; returns total width. */
function drawRunLine(
  page: PDFPage,
  runs: TextRun[],
  x: number,
  y: number,
  size: number,
  fonts: { serif: PDFFont; serifItalic: PDFFont },
  color: RGB
): number {
  let cx = x;
  for (const run of runs) {
    if (!run.text) continue;
    const font = run.italic ? fonts.serifItalic : fonts.serif;
    page.drawText(run.text, { x: cx, y, font, size, color });
    cx += font.widthOfTextAtSize(run.text, size);
  }
  return cx - x;
}

/**
 * Plain wrap for non-emphasis text — wraps a single string into
 * lines that each fit within maxWidth.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const rawPara of text.split(/\n+/)) {
    const para = rawPara.trim();
    if (!para) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        line = test;
      } else {
        if (line) out.push(line);
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = '';
          for (const ch of w) {
            const next = chunk + ch;
            if (font.widthOfTextAtSize(next, size) > maxWidth) {
              if (chunk) out.push(chunk);
              chunk = ch;
            } else {
              chunk = next;
            }
          }
          line = chunk;
        } else {
          line = w;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

interface DrawTextOptions {
  x: number;
  y: number;
  text: string;
  font: PDFFont;
  size: number;
  color?: RGB;
  maxWidth?: number;
  lineGap?: number;
}

/** Draw plain text starting at baseline y, returning final cursor. */
export function drawText(page: PDFPage, opts: DrawTextOptions): number {
  const { x, y, text, font, size, color, maxWidth, lineGap = 2 } = opts;
  const lines = maxWidth ? wrapText(text, font, size, maxWidth) : [text];
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, font, size, color: color ?? COLORS.ink });
    cursor -= size + lineGap;
  }
  return cursor + lineGap;
}

// ============================================================
// Decorative motifs
// ============================================================

/**
 * Section hairline with a true 1.2mm upward bezier curve at each
 * margin end — mimics the spine-curve of a folded page about to be
 * turned (v1 shipped straight strokes; visual-designer P1 fix).
 * Implemented as `drawSvgPath` with a quadratic bezier at each end
 * because pdf-lib's drawLine cannot produce curves.
 *
 * pdf-lib's drawSvgPath inverts the y-axis: a positive y in the SVG
 * path moves DOWN the page from the (x, y) anchor.  So an "upward"
 * curve in PDF orientation needs negative y in the path.
 */
export function drawFoldRule(
  page: PDFPage,
  ctx: PageContext,
  y: number
): void {
  const curveLen = 6 * MM;
  const rise = 1.2 * MM;
  const flatRight = ctx.contentRight - curveLen;
  // Quadratic bezier ends + flat middle.
  // The SVG path coordinate system here starts at (contentLeft, y);
  // y values are PDF-relative (positive y = up, but drawSvgPath
  // flips, so SVG-negative y = PDF-up).
  const d =
    `M 0 0 ` +
    `Q ${curveLen / 2} ${-rise} ${curveLen} 0 ` +
    `L ${flatRight - ctx.contentLeft} 0 ` +
    `Q ${flatRight - ctx.contentLeft + curveLen / 2} ${-rise} ${ctx.contentRight - ctx.contentLeft} 0`;
  page.drawSvgPath(d, {
    x: ctx.contentLeft,
    y,
    borderColor: COLORS.rule,
    borderWidth: 0.5
  });
}

/**
 * Quire mark — three stacked arcs evoking the cross-section of a
 * folded gathering of pages.  Each arc is a thin quadratic bezier
 * opening downward; the innermost gets a small accent fill.
 *
 * Sits top-right of the identity band on every page.
 */
export function drawQuireMark(
  page: PDFPage,
  centerX: number,
  centerY: number
): void {
  const radii = [3.0 * MM, 2.1 * MM, 1.3 * MM];
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    const arcDepth = r * 0.55;
    // Arc opening downward: from (-r, 0) up over (0, -arcDepth) down to (r, 0)
    const d = `M ${-r} 0 Q 0 ${-arcDepth} ${r} 0`;
    page.drawSvgPath(d, {
      x: centerX,
      y: centerY - 0.5 * MM,
      borderColor: COLORS.accent,
      borderWidth: 0.7
    });
  }
  // Innermost: a small filled glyph anchoring the mark.
  page.drawCircle({
    x: centerX,
    y: centerY - 0.5 * MM + 0.4 * MM,
    size: 0.45 * MM,
    color: COLORS.accent
  });
}

/**
 * Botanical marginal sprig — Underleaf motif.  A thin stem with
 * three small leaflets, drawn as quadratic-bezier petals.  Used
 * on prose (continuation) pages only, low-right margin; signals
 * "this is the long-form / writable side".
 */
export function drawBotanicalSprig(
  page: PDFPage,
  baseX: number,
  baseY: number
): void {
  // Stem: a gentle S-curve going up.  pdf-lib's drawSvgPath flips
  // the y-axis, so negative path-y moves UP on the printed page.
  const stemHeight = 12 * MM;
  page.drawSvgPath(
    `M 0 0 C ${1.5 * MM} ${-stemHeight / 4} ${-1 * MM} ${-stemHeight / 2} ${1 * MM} ${-stemHeight}`,
    {
      x: baseX,
      y: baseY,
      borderColor: COLORS.underleafGreen,
      borderWidth: 0.7,
      opacity: 0.55
    }
  );
  // Three leaflets — alternating sides along the stem, sized to fan
  // outward.  Drawn as quadratic-bezier almond shapes with stroke +
  // light fill.
  const leaf = (
    offsetY: number,
    lobeLength: number,
    mirror: boolean
  ): void => {
    const sign = mirror ? -1 : 1;
    const stemPivot = mirror ? -0.5 * MM : 0.5 * MM;
    const d =
      `M ${stemPivot} 0 ` +
      `Q ${sign * (lobeLength / 2)} ${-lobeLength * 0.6} ${sign * lobeLength} 0 ` +
      `Q ${sign * (lobeLength / 2)} ${lobeLength * 0.5} ${stemPivot} 0 ` +
      `Z`;
    page.drawSvgPath(d, {
      x: baseX,
      y: baseY - offsetY,
      borderColor: COLORS.underleafGreen,
      borderWidth: 0.6,
      color: COLORS.underleafGreen,
      opacity: 0.35
    });
  };
  leaf(3 * MM, 4 * MM, false);
  leaf(6.5 * MM, 3.5 * MM, true);
  leaf(9.5 * MM, 2.8 * MM, false);
}

/**
 * Quiet dot-grid backdrop — a faint 2mm orthogonal grid of small
 * dots under prose blocks.  Signals the Underleaf "Quiet" motif:
 * implicit order beneath visible content.  Drawn at low opacity so
 * it does not compete with the body text.
 */
export function drawDotGrid(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const spacing = 2.4 * MM;
  const cols = Math.floor(width / spacing);
  const rows = Math.floor(height / spacing);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      page.drawCircle({
        x: x + c * spacing,
        y: y - r * spacing,
        size: 0.35,
        color: COLORS.quiet,
        opacity: 0.18
      });
    }
  }
}

// ============================================================
// Section drawing
// ============================================================

const SECTION_HEADER_SIZE = 8.5;
const SECTION_HEADER_GAP = 4 * MM;

function drawSectionHeader(
  ctx: PageContext,
  cursorY: number,
  label: string
): number {
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursorY,
    text: label.toUpperCase(),
    font: ctx.fonts.sansBold,
    size: SECTION_HEADER_SIZE,
    color: COLORS.underleafGreen
  });
  return cursorY - SECTION_HEADER_GAP;
}

export function drawIdentityBand(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number,
  playerName?: string
): number {
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: startY - 22,
    text: pc.name,
    font: ctx.fonts.sansBold,
    size: 22,
    color: COLORS.underleafGreen
  });
  // 2026-06-06 (feedback_show_both_names): when a player is bound,
  // surface "played by <playerName>" inline next to the PC name so
  // every printed sheet carries both identities visibly.
  if (playerName && playerName.length > 0) {
    const pcNameW = ctx.fonts.sansBold.widthOfTextAtSize(pc.name, 22);
    ctx.page.drawText(`  played by ${playerName}`, {
      x: ctx.contentLeft + pcNameW + 4,
      y: startY - 22 + 4,
      font: ctx.fonts.sans,
      size: 10,
      color: COLORS.inkSecondary
    });
  }
  const subParts: string[] = [];
  if (pc.pronouns) subParts.push(pc.pronouns);
  if (pc.alignment) subParts.push(pc.alignment);
  const sub = subParts.join(' · ');
  if (sub) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: startY - 22 - 12,
      text: sub,
      font: ctx.fonts.sans,
      size: 9,
      color: COLORS.inkSecondary
    });
  }
  drawQuireMark(ctx.page, ctx.contentRight - 3 * MM, startY - 4 * MM);
  const endY = startY - 20 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

function drawTrack(
  ctx: PageContext,
  x: number,
  topY: number,
  label: string,
  penalties: ReadonlyArray<string>,
  currentValue: number,
  signal: RGB,
  innerOffset: boolean
): void {
  const labelWidth = 16 * MM;
  const boxSize = 7.5 * MM;
  const gap = 2 * MM;
  const trackY = topY - boxSize - 12;

  drawText(ctx.page, {
    x,
    y: trackY + boxSize / 2 - 3,
    text: label.toUpperCase(),
    font: ctx.fonts.sansBold,
    size: 9,
    color: COLORS.inkSecondary
  });

  let cribX = x + labelWidth;
  for (const crib of penalties) {
    ctx.page.drawText(crib, {
      x: cribX + 1,
      y: trackY + boxSize + 4,
      font: ctx.fonts.sans,
      size: 7,
      color: COLORS.inkSecondary
    });
    cribX += boxSize + gap;
  }

  for (let i = 0; i < 4; i++) {
    const bx = x + labelWidth + i * (boxSize + gap);
    const filled = i < currentValue;
    ctx.page.drawRectangle({
      x: bx,
      y: trackY,
      width: boxSize,
      height: boxSize,
      borderColor: signal,
      borderWidth: 0.8
    });
    if (innerOffset) {
      ctx.page.drawRectangle({
        x: bx + 1 * MM,
        y: trackY + 1 * MM,
        width: boxSize - 2 * MM,
        height: boxSize - 2 * MM,
        borderColor: signal,
        borderWidth: 0.5
      });
    }
    if (filled) {
      const cx = bx + boxSize / 2;
      const cy = trackY + boxSize / 2;
      const armShort = boxSize * 0.18;
      const armLong = boxSize * 0.32;
      ctx.page.drawLine({
        start: { x: cx - armShort, y: cy + armShort * 0.3 },
        end: { x: cx - armShort * 0.2, y: cy - armShort * 0.6 },
        thickness: 1.1,
        color: signal
      });
      ctx.page.drawLine({
        start: { x: cx - armShort * 0.2, y: cy - armShort * 0.6 },
        end: { x: cx + armLong, y: cy + armShort * 0.9 },
        thickness: 1.1,
        color: signal
      });
    }
  }
}

export function drawHarmStressBand(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  const half = ctx.contentWidth / 2;
  drawTrack(
    ctx,
    ctx.contentLeft,
    startY,
    'Harm',
    ['ok', '−1 phys', '−1 all', 'out'],
    pc.harm ?? 0,
    COLORS.harm,
    false
  );
  drawTrack(
    ctx,
    ctx.contentLeft + half,
    startY,
    'Stress',
    ['ok', '−1 wis', '−2 wis', 'no cast'],
    pc.stress ?? 0,
    COLORS.stress,
    true
  );
  const endY = startY - 32 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

export function drawStatsStrip(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  const stats = pc.stats ?? {};
  const labels: ReadonlyArray<[string, number | undefined]> = [
    ['STR', stats.str],
    ['DEX', stats.dex],
    ['CON', stats.con],
    ['INT', stats.int],
    ['WIS', stats.wis],
    ['CHA', stats.cha]
  ];
  const cellWidth = ctx.contentWidth / 6;
  const y = startY - 14;
  const STAT_NUM_SIZE = 13;
  for (let i = 0; i < labels.length; i++) {
    const [name, val] = labels[i];
    const cellX = ctx.contentLeft + i * cellWidth;
    drawText(ctx.page, {
      x: cellX + cellWidth / 2 - ctx.fonts.sans.widthOfTextAtSize(name, 8) / 2,
      y,
      text: name,
      font: ctx.fonts.sans,
      size: 8,
      color: COLORS.inkSecondary
    });
    const numText = formatStatNum(val);
    drawText(ctx.page, {
      x:
        cellX +
        cellWidth / 2 -
        ctx.fonts.sans.widthOfTextAtSize(numText, STAT_NUM_SIZE) / 2,
      y: y - STAT_NUM_SIZE - 2,
      text: numText,
      font: ctx.fonts.sans,
      size: STAT_NUM_SIZE
    });
  }
  const endY = startY - 12 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

function formatStatNum(n: number | undefined): string {
  if (n === undefined) return '−';
  if (n > 0) return `+${n}`;
  if (n === 0) return '0';
  return `−${Math.abs(n)}`;
}

/**
 * Chip cluster for skills + tags: each item rendered in a faint
 * mint-tinted rounded rectangle.  Wraps lines automatically.
 */
export function drawSkillsTagsChips(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Skills & Tags');
  const skills = pc.skills ?? [];
  const tags = pc.tags ?? [];
  const items = [
    ...skills.map((t) => ({ text: t, bold: true })),
    ...tags.map((t) => ({ text: t, bold: false }))
  ];
  if (items.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: '(none yet)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    return cursor - 14 - 3 * MM;
  }

  const chipPadX = 2 * MM;
  const chipPadY = 1.2 * MM;
  const chipSpacing = 1.5 * MM;
  const chipFontSize = 8.5;
  const chipHeight = chipFontSize + 2 * chipPadY;
  const rowGap = 2 * MM;
  let lineX = ctx.contentLeft;
  let lineY = cursor - chipHeight;

  for (const item of items) {
    const font = item.bold ? ctx.fonts.sansBold : ctx.fonts.sans;
    const textW = font.widthOfTextAtSize(item.text, chipFontSize);
    const chipW = textW + 2 * chipPadX;
    if (lineX + chipW > ctx.contentRight && lineX > ctx.contentLeft) {
      lineX = ctx.contentLeft;
      lineY -= chipHeight + rowGap;
    }
    ctx.page.drawRectangle({
      x: lineX,
      y: lineY,
      width: chipW,
      height: chipHeight,
      color: COLORS.mintTint,
      borderColor: COLORS.rule,
      borderWidth: 0.4
    });
    ctx.page.drawText(item.text, {
      x: lineX + chipPadX,
      y: lineY + chipPadY + 1,
      font,
      size: chipFontSize,
      color: item.bold ? COLORS.underleafGreen : COLORS.ink
    });
    lineX += chipW + chipSpacing;
  }

  const endY = lineY - 2 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

/**
 * Foci — single column at <3, two columns at ≥3.  Each focus shows
 * a status glyph + name (bold) + a secondary line with domain + for.
 */
export function drawFoci(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Foci');
  const foci = pc.foci ?? [];
  if (foci.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: '(no foci yet)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
    cursor -= 2 * MM;
    drawFoldRule(ctx.page, ctx, cursor);
    return cursor - 3 * MM;
  }

  const twoColumn = foci.length >= 3;
  const colWidth = twoColumn ? ctx.contentWidth / 2 - 3 * MM : ctx.contentWidth;
  const colXs = twoColumn
    ? [ctx.contentLeft, ctx.contentLeft + ctx.contentWidth / 2 + 3 * MM]
    : [ctx.contentLeft];
  let colY = [cursor, cursor];
  for (let i = 0; i < foci.length; i++) {
    const f = foci[i];
    const col = twoColumn ? i % 2 : 0;
    const x = colXs[col];
    // Draw a small status glyph as a primitive shape — Liberation
    // Sans lacks U+25C6 ◆ and related geometric shapes, so a Unicode
    // glyph would render as the missing-glyph box.  4-shape system:
    // active = filled diamond, broken = X, faded = open circle,
    // corrupted = filled circle, transformed = small rotated square.
    drawFocusStatusShape(
      ctx.page,
      x + 1.5,
      colY[col] + 3,
      f.status,
      focusStatusColor(f.status)
    );
    const glyphW = 4 * MM;
    ctx.page.drawText(f.name, {
      x: x + glyphW,
      y: colY[col],
      font: ctx.fonts.sansBold,
      size: 10.5,
      color: COLORS.ink
    });
    if (f.status && f.status !== 'active') {
      const statusBadge = ` [${f.status}]`;
      const nameW = ctx.fonts.sansBold.widthOfTextAtSize(f.name, 10.5);
      ctx.page.drawText(statusBadge, {
        x: x + glyphW + nameW + 1,
        y: colY[col],
        font: ctx.fonts.sansBold,
        size: 8.5,
        color: focusStatusColor(f.status)
      });
    }
    colY[col] -= 12;
    const sub: string[] = [];
    if (f.domain) sub.push(`domain: ${f.domain}`);
    if (f.boundFor) sub.push(`for: ${f.boundFor}`);
    if (f.condition) sub.push(`(${f.condition})`);
    if (sub.length > 0) {
      colY[col] = drawText(ctx.page, {
        x: x + 4 * MM,
        y: colY[col],
        text: sub.join(' · '),
        font: ctx.fonts.serif,
        size: 9.5,
        color: COLORS.inkSecondary,
        maxWidth: colWidth - 4 * MM,
        lineGap: 2
      });
    }
    colY[col] -= 4;
  }
  const cursorOut = Math.min(colY[0], colY[1]);
  const endY = cursorOut - 2 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

/**
 * Draw a small (≈3mm) shape representing a focus's status.  The
 * shapes are vector-drawn primitives so they render identically
 * regardless of font glyph coverage:
 *   active      → filled diamond
 *   broken      → X (two stroked diagonals)
 *   faded       → empty (stroke-only) circle
 *   corrupted   → filled circle
 *   transformed → square rotated 45° (open diamond)
 */
function drawFocusStatusShape(
  page: PDFPage,
  x: number,
  y: number,
  status: string | undefined,
  color: RGB
): void {
  const r = 1.5 * MM;
  switch (status) {
    case 'broken': {
      page.drawLine({
        start: { x: x - r, y: y - r },
        end: { x: x + r, y: y + r },
        thickness: 1.1,
        color
      });
      page.drawLine({
        start: { x: x - r, y: y + r },
        end: { x: x + r, y: y - r },
        thickness: 1.1,
        color
      });
      return;
    }
    case 'faded': {
      page.drawCircle({
        x,
        y,
        size: r,
        borderColor: color,
        borderWidth: 0.6
      });
      return;
    }
    case 'corrupted': {
      page.drawCircle({ x, y, size: r, color });
      return;
    }
    case 'transformed': {
      // Open diamond (4-point outline)
      page.drawLine({
        start: { x: x, y: y + r },
        end: { x: x + r, y: y },
        thickness: 0.7,
        color
      });
      page.drawLine({
        start: { x: x + r, y: y },
        end: { x: x, y: y - r },
        thickness: 0.7,
        color
      });
      page.drawLine({
        start: { x: x, y: y - r },
        end: { x: x - r, y: y },
        thickness: 0.7,
        color
      });
      page.drawLine({
        start: { x: x - r, y: y },
        end: { x: x, y: y + r },
        thickness: 0.7,
        color
      });
      return;
    }
    case 'active':
    default: {
      // Filled diamond
      const path = [
        { x: x, y: y + r },
        { x: x + r, y: y },
        { x: x, y: y - r },
        { x: x - r, y: y }
      ];
      // Approximate fill by drawing many thin horizontal strokes.
      const slices = 10;
      for (let i = 0; i <= slices; i++) {
        const t = i / slices;
        const yy = y - r + 2 * r * t;
        const halfW = r * (1 - Math.abs(2 * t - 1));
        page.drawLine({
          start: { x: x - halfW, y: yy },
          end: { x: x + halfW, y: yy },
          thickness: 0.5,
          color
        });
      }
      // Outline so the diamond stays crisp at small size
      for (let i = 0; i < 4; i++) {
        const a = path[i];
        const b = path[(i + 1) % 4];
        page.drawLine({
          start: a,
          end: b,
          thickness: 0.6,
          color
        });
      }
      return;
    }
  }
}

function focusStatusColor(s: string | undefined): RGB {
  switch (s) {
    case 'broken':
    case 'corrupted':
      return COLORS.harm;
    case 'faded':
      return COLORS.inkSecondary;
    case 'transformed':
      return COLORS.quiet;
    case 'active':
    default:
      return COLORS.accent;
  }
}

/**
 * The Quiet magic block — rendered ONLY if knowsTheyCanCast===true.
 * v2: 2×3 grid of tier cards.  Player-facing reference, not a
 * compressed prose block.
 */
export function drawMagicSection(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  if (pc.knowsTheyCanCast !== true) return startY;
  let cursor = drawSectionHeader(ctx, startY, 'The Quiet');
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: 'Cast = (the right way to ask) + (an authentic intent).',
    font: ctx.fonts.serifItalic,
    size: 9.5,
    color: COLORS.quiet,
    maxWidth: ctx.contentWidth
  });
  cursor -= 14;

  const tiers: ReadonlyArray<[string, string]> = [
    ['Free', 'no roll; succeeds.'],
    ['Cheap', 'no roll; minor thread debt.'],
    ['Costly', '2d6 + WIS. 10+ clean, 7–9 partial. +1 stress.'],
    ['Hard', '2d6 + WIS −1 to −2. Backlash on miss. +2 stress.'],
    ['Prohibited', 'The Quiet does not parse.'],
    ['Foci', 'shift in-domain casts one tier easier.']
  ];

  const colW = ctx.contentWidth / 2 - 2 * MM;
  const cardH = 14 * MM;
  const cardGap = 2 * MM;
  for (let i = 0; i < tiers.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = ctx.contentLeft + col * (colW + 4 * MM);
    const y = cursor - row * (cardH + cardGap) - cardH;
    ctx.page.drawRectangle({
      x,
      y,
      width: colW,
      height: cardH,
      color: COLORS.mintTint,
      borderColor: COLORS.quiet,
      borderWidth: 0.4,
      opacity: 0.4
    });
    const [name, rule] = tiers[i];
    ctx.page.drawText(name, {
      x: x + 3 * MM,
      y: y + cardH - 11,
      font: ctx.fonts.sansBold,
      size: 9.5,
      color: COLORS.quiet
    });
    drawText(ctx.page, {
      x: x + 3 * MM,
      y: y + cardH - 22,
      text: rule,
      font: ctx.fonts.sans,
      size: 8.5,
      color: COLORS.ink,
      maxWidth: colW - 6 * MM,
      lineGap: 1
    });
  }
  cursor -= 3 * (cardH + cardGap) + 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

export function drawConditionsInventory(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  const half = ctx.contentWidth / 2;
  const rightX = ctx.contentLeft + half + 4 * MM;
  const leftMax = half - 4 * MM;
  const rightMax = ctx.contentWidth - half - 4 * MM;

  let cursorL = drawSectionHeader(ctx, startY, 'Conditions');
  const conditions = pc.conditions ?? [];
  if (conditions.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursorL,
      text: '(none active)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursorL -= 14;
  } else {
    for (const c of conditions) {
      const line = `${c.name} — ${c.effect}`;
      cursorL = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursorL,
        text: line,
        font: ctx.fonts.serif,
        size: 9.5,
        maxWidth: leftMax,
        lineGap: 1
      });
      cursorL -= 2;
    }
  }

  let cursorR = drawSectionHeader(
    { ...ctx, contentLeft: rightX },
    startY,
    'Inventory'
  );
  const inv = pc.inventory ?? [];
  if (inv.length === 0) {
    drawText(ctx.page, {
      x: rightX,
      y: cursorR,
      text: '(empty)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursorR -= 14;
  } else {
    for (const it of inv) {
      const tail = it.notes ? ` (${it.notes})` : '';
      const carry = it.carriedBy === 'stowed' ? ' [stowed]' : '';
      const line = `${it.name}${carry}${tail}`;
      cursorR = drawText(ctx.page, {
        x: rightX,
        y: cursorR,
        text: line,
        font: ctx.fonts.serif,
        size: 9.5,
        maxWidth: rightMax,
        lineGap: 1
      });
      cursorR -= 2;
    }
  }

  const endY = Math.min(cursorL, cursorR) - 2 * MM;
  drawFoldRule(ctx.page, ctx, endY);
  return endY - 3 * MM;
}

export function drawMoneyAndLanguages(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  const bands: ReadonlyArray<string> = [
    'broke',
    'tight',
    'comfortable',
    'well-off',
    'wealthy'
  ];
  let cursor = drawSectionHeader(ctx, startY, 'Money & Languages');
  const current = pc.moneyBand;
  let x = ctx.contentLeft;
  ctx.page.drawText('Money:', {
    x,
    y: cursor,
    font: ctx.fonts.sansBold,
    size: 8.5,
    color: COLORS.inkSecondary
  });
  x += ctx.fonts.sansBold.widthOfTextAtSize('Money:', 8.5) + 6;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const isCurrent = b === current;
    const w = ctx.fonts.sans.widthOfTextAtSize(b, 9.5);
    if (isCurrent) {
      ctx.page.drawRectangle({
        x: x - 3,
        y: cursor - 3,
        width: w + 6,
        height: 14,
        borderColor: COLORS.accent,
        borderWidth: 0.6
      });
    }
    ctx.page.drawText(b, {
      x,
      y: cursor,
      font: isCurrent ? ctx.fonts.sansBold : ctx.fonts.sans,
      size: 9.5,
      color: COLORS.ink
    });
    x += w + 4;
    if (i < bands.length - 1) {
      ctx.page.drawText('·', {
        x: x,
        y: cursor,
        font: ctx.fonts.sans,
        size: 9.5,
        color: COLORS.inkSecondary
      });
      x += ctx.fonts.sans.widthOfTextAtSize('·', 9.5) + 4;
    }
  }
  cursor -= 14;

  if (pc.languages && pc.languages.length > 0) {
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: `Languages: ${pc.languages.join(', ')}`,
      font: ctx.fonts.sans,
      size: 9,
      color: COLORS.inkSecondary,
      maxWidth: ctx.contentWidth
    });
  }

  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

export function drawBonds(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number,
  resolveName: (targetPcId: string) => string = (id) => id
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Bonds');
  const bonds = pc.bonds ?? [];
  if (bonds.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: '(no bonds yet)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
  } else {
    for (const b of bonds) {
      const target = b.targetPcId || 'unknown';
      const display = resolveName(target);
      const prefix = `→ ${display}: `;
      ctx.page.drawText(prefix, {
        x: ctx.contentLeft,
        y: cursor,
        font: ctx.fonts.sansBold,
        size: 9.5,
        color: COLORS.accent
      });
      const prefixW = ctx.fonts.sansBold.widthOfTextAtSize(prefix, 9.5);
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft + prefixW,
        y: cursor,
        text: b.text,
        font: ctx.fonts.serif,
        size: 10,
        maxWidth: ctx.contentWidth - prefixW,
        lineGap: 2
      });
      cursor -= 4;
    }
  }
  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

export function drawAdvancement(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: startY,
    text: 'ADVANCEMENT',
    font: ctx.fonts.sansBold,
    size: 8.5,
    color: COLORS.underleafGreen
  });
  const labelW = ctx.fonts.sansBold.widthOfTextAtSize('ADVANCEMENT', 8.5);
  const bullets = pc.markBullets ?? {};
  const bulletKeys = [
    'hardMoment',
    'learned',
    'risk',
    'against',
    'complication'
  ] as const;
  const bulletLabels = [
    'hard moment',
    'learned',
    'risk',
    'against',
    'complic.'
  ];
  let x = ctx.contentLeft + labelW + 8;
  const boxSize = 3 * MM;
  for (let i = 0; i < 5; i++) {
    const filled = bullets[bulletKeys[i]] === true;
    ctx.page.drawRectangle({
      x,
      y: startY - 2,
      width: boxSize,
      height: boxSize,
      borderColor: COLORS.accent,
      borderWidth: 0.6
    });
    if (filled) {
      const cx = x + boxSize / 2;
      const cy = startY - 2 + boxSize / 2;
      ctx.page.drawLine({
        start: { x: cx - boxSize * 0.3, y: cy + boxSize * 0.05 },
        end: { x: cx - boxSize * 0.05, y: cy - boxSize * 0.2 },
        thickness: 0.9,
        color: COLORS.accent
      });
      ctx.page.drawLine({
        start: { x: cx - boxSize * 0.05, y: cy - boxSize * 0.2 },
        end: { x: cx + boxSize * 0.3, y: cy + boxSize * 0.3 },
        thickness: 0.9,
        color: COLORS.accent
      });
    }
    ctx.page.drawText(bulletLabels[i], {
      x: x + boxSize + 2,
      y: startY,
      font: ctx.fonts.sans,
      size: 7,
      color: COLORS.inkSecondary
    });
    x += boxSize + 2 + ctx.fonts.sans.widthOfTextAtSize(bulletLabels[i], 7) + 6;
  }
  const counter = `${pc.advancements ?? 0} of 8 advancements`;
  const counterW = ctx.fonts.sans.widthOfTextAtSize(counter, 9);
  ctx.page.drawText(counter, {
    x: ctx.contentRight - counterW,
    y: startY,
    font: ctx.fonts.sans,
    size: 9,
    color: COLORS.inkSecondary
  });
  const cursor = startY - 8 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

/**
 * 2d6 resolution reminder as a 2×2 grid + doubles strip below.
 * Lives in the page-1 footer only.
 */
export function drawResolutionCrib(ctx: PageContext): void {
  const baseY = ctx.marginY + 11 * MM;
  const colW = ctx.contentWidth / 2 - 2 * MM;
  const cellH = 9;
  const cells: ReadonlyArray<[string, string]> = [
    ['≤ 6', 'miss'],
    ['7–9', 'partial success'],
    ['10+', 'hit'],
    ['12+', 'exceptional']
  ];
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = ctx.contentLeft + col * (colW + 4 * MM);
    const y = baseY - row * (cellH + 2);
    const [tier, outcome] = cells[i];
    ctx.page.drawText(tier, {
      x,
      y,
      font: ctx.fonts.sansBold,
      size: 8.5,
      color: COLORS.accent
    });
    const tw = ctx.fonts.sansBold.widthOfTextAtSize(tier, 8.5);
    ctx.page.drawText(outcome, {
      x: x + tw + 4,
      y,
      font: ctx.fonts.sans,
      size: 8.5,
      color: COLORS.ink
    });
  }
  ctx.page.drawText(
    'Double 6 — you narrate a bonus detail.  Double 1 — the DM adds a twist.',
    {
      x: ctx.contentLeft,
      y: baseY - 2 * (cellH + 2) - 4,
      font: ctx.fonts.serifItalic,
      size: 8,
      color: COLORS.inkSecondary
    }
  );
}

/**
 * Slim footer for continuation pages — name + page X of Y, no
 * resolution reminder.  Set `pageNum` and `pageCount` 1-indexed.
 */
export function drawSlimFooter(
  ctx: PageContext,
  pcName: string,
  pageNum: number,
  pageCount: number
): void {
  const y = ctx.marginY - 8 * MM;
  const left = `${pcName} · page ${pageNum} of ${pageCount}`;
  ctx.page.drawText(left, {
    x: ctx.contentLeft,
    y,
    font: ctx.fonts.sans,
    size: 7.5,
    color: COLORS.inkSecondary
  });
}

/**
 * Backstory prose with markdown emphasis parsing.  When the
 * remaining content fits in `< MIN_OVERFLOW_LINES`, the section is
 * tightened on the source page rather than overflowing to a near-
 * empty continuation page (visual-designer P0).
 */
const MIN_OVERFLOW_LINES = 8;

export function drawBackstoryWithEmphasis(
  doc: PDFDocument,
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number,
  bottomFloor: number,
  allPages: PageContext[]
): { ctx: PageContext } {
  const text = pc.backstory ?? '';
  if (!text) return { ctx };

  /**
   * Mark prose continuation pages with the Quiet dot-grid backdrop
   * + a marginal botanical sprig.  We tag the ctx so the caller's
   * decoration pass can find them later.
   */
  const proseContinuationPages = new Set<PageContext>();

  let currentCtx = ctx;
  const runs = parseEmphasis(text);
  const bodySize = 10.5;
  const lineHeight = bodySize + 3;
  const lines = wrapRuns(
    runs,
    currentCtx.fonts.serif,
    currentCtx.fonts.serifItalic,
    bodySize,
    currentCtx.contentWidth
  );

  // Page-1 estimate.  The section header costs SECTION_HEADER_GAP
  // of vertical and the first line costs lineHeight.  If startY -
  // headerCost - lineHeight < bottomFloor we cannot fit even the
  // header + 1 line on this page; defer everything to a fresh
  // continuation page so the header NEVER orphans from its body
  // (visual-designer P0 from v2 critique).
  let cursor = startY;
  const headerCost = SECTION_HEADER_GAP;
  if (cursor - headerCost - lineHeight < bottomFloor) {
    currentCtx = makePage(
      doc,
      currentCtx.pageSize,
      currentCtx.fonts,
      currentCtx.pageIndex + 1
    );
    allPages.push(currentCtx);
    cursor = currentCtx.height - currentCtx.marginY;
  }

  cursor = drawSectionHeader(currentCtx, cursor, 'Backstory');

  // Look-ahead: when overflow is tiny (≤ MIN_OVERFLOW_LINES), pull
  // back the section gap.  Doesn't help the orphan case above
  // (which already moved to a new page) but it does compress a 1-2
  // line overflow onto page 1 when feasible.
  const onPageFloor =
    currentCtx === ctx ? bottomFloor : currentCtx.marginY + 8 * MM;
  const availableLines = Math.max(
    0,
    Math.floor((cursor - onPageFloor) / lineHeight)
  );
  const overflow = lines.length - availableLines;
  if (overflow > 0 && overflow < MIN_OVERFLOW_LINES) {
    cursor += 4 * MM;
  }

  for (const line of lines) {
    const floor =
      currentCtx === ctx ? bottomFloor : currentCtx.marginY + 8 * MM;
    if (cursor < floor) {
      currentCtx = makePage(
        doc,
        currentCtx.pageSize,
        currentCtx.fonts,
        currentCtx.pageIndex + 1
      );
      allPages.push(currentCtx);
      proseContinuationPages.add(currentCtx);
      cursor = currentCtx.height - currentCtx.marginY;
      cursor = drawSectionHeader(currentCtx, cursor, 'Backstory (continued)');
    }
    drawRunLine(
      currentCtx.page,
      line,
      currentCtx.contentLeft,
      cursor,
      bodySize,
      {
        serif: currentCtx.fonts.serif,
        serifItalic: currentCtx.fonts.serifItalic
      },
      COLORS.ink
    );
    cursor -= lineHeight;
  }

  // Decorate continuation pages with the Quiet dot-grid + sprig.
  for (const proseCtx of proseContinuationPages) {
    decorateProsePage(proseCtx);
  }

  return { ctx: currentCtx };
}

/**
 * Brand decorations for prose continuation pages.  Each gets a
 * faint Quiet dot-grid backdrop spanning the content area + a
 * small Underleaf sprig in the lower-right margin.  Both render
 * at very low opacity so they tint the page without competing
 * with the body text.
 */
export function decorateProsePage(ctx: PageContext): void {
  // Dot-grid covering the writable content area.
  drawDotGrid(
    ctx.page,
    ctx.contentLeft,
    ctx.height - ctx.marginY,
    ctx.contentWidth,
    ctx.height - 2 * ctx.marginY
  );
  // Marginal botanical sprig in the lower-right gutter.
  drawBotanicalSprig(
    ctx.page,
    ctx.contentRight - 10 * MM,
    ctx.marginY + 22 * MM
  );
}

// ============================================================
// DM dossier page
// ============================================================

export function drawDmDossier(
  doc: PDFDocument,
  pc: CharacterRecord,
  pageSize: PageSize,
  fonts: Fonts,
  pageIndex: number,
  allPages: PageContext[]
): PageContext {
  const ctx = makePage(doc, pageSize, fonts, pageIndex);
  allPages.push(ctx);

  const cursor0 = ctx.height - ctx.marginY;
  const bandH = 14 * MM;
  ctx.page.drawRectangle({
    x: ctx.contentLeft - 2 * MM,
    y: cursor0 - bandH,
    width: ctx.contentWidth + 4 * MM,
    height: bandH,
    color: COLORS.dmAmber
  });
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor0 - 9 * MM,
    text: 'DM DOSSIER — DO NOT SHOW PLAYER',
    font: fonts.sansBold,
    size: 14,
    color: rgb(1, 1, 1)
  });

  let cursor = cursor0 - bandH - 10;
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: `${pc.name} — per-PC private notes`,
    font: fonts.sansBold,
    size: 14,
    color: COLORS.underleafGreen
  });
  cursor -= 22;

  // Magic state line
  cursor = drawSectionHeader(ctx, cursor, 'Magic state');
  const magicParts: string[] = [
    `phase: ${pc.magicPhase ?? '—'}`,
    `knows they can cast: ${pc.knowsTheyCanCast ? 'yes' : 'no'}`
  ];
  if (pc.tax) {
    let tax = `tax: ${pc.tax.active ? 'active' : 'released'}`;
    if (pc.tax.sessionsRemaining)
      tax += `, ${pc.tax.sessionsRemaining} session(s) left`;
    if (pc.tax.releaseMoment)
      tax += `; release: ${pc.tax.releaseMoment}`;
    magicParts.push(tax);
  } else {
    magicParts.push('tax: not yet');
  }
  cursor = drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: magicParts.join('  |  '),
    font: fonts.sans,
    size: 10,
    maxWidth: ctx.contentWidth
  });
  cursor -= 4 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  cursor -= 3 * MM;

  // Thread debt ladder
  cursor = drawSectionHeader(ctx, cursor, 'Thread debt');
  const ladder = ['quiet', 'noticed', 'watched', 'pushing-back', 'hunted'];
  const currentRung = pc.threadDebt?.rung;
  let x = ctx.contentLeft;
  for (let i = 0; i < ladder.length; i++) {
    const isCurrent = ladder[i] === currentRung;
    const w = fonts.sans.widthOfTextAtSize(ladder[i], 9);
    if (isCurrent) {
      ctx.page.drawRectangle({
        x: x - 2,
        y: cursor - 2,
        width: w + 4,
        height: 12,
        borderColor: COLORS.dmAmber,
        borderWidth: 0.6
      });
    }
    ctx.page.drawText(ladder[i], {
      x,
      y: cursor,
      font: isCurrent ? fonts.sansBold : fonts.sans,
      size: 9
    });
    x += w + 10;
    if (i < ladder.length - 1) {
      ctx.page.drawText('→', {
        x: x - 6,
        y: cursor,
        font: fonts.sans,
        size: 9,
        color: COLORS.inkSecondary
      });
      x += 4;
    }
  }
  cursor -= 14;
  if (pc.threadDebt?.spamCount !== undefined) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: `(scene spam-count: ${pc.threadDebt.spamCount})`,
      font: fonts.serifItalic,
      size: 9,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
  }
  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  cursor -= 3 * MM;

  if (pc.alignmentDrift) {
    cursor = drawSectionHeader(ctx, cursor, 'Alignment drift');
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: `marks: ${pc.alignmentDrift.marks} / 5`,
      font: fonts.sans,
      size: 10
    });
    cursor -= 4 * MM;
    drawFoldRule(ctx.page, ctx, cursor);
    cursor -= 3 * MM;
  }

  if (pc.accidentalGrants && pc.accidentalGrants.length > 0) {
    cursor = drawSectionHeader(ctx, cursor, 'Accidental grants (DM log)');
    for (const g of pc.accidentalGrants) {
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursor,
        text: `— ${g.note}`,
        font: fonts.serif,
        size: 10,
        maxWidth: ctx.contentWidth,
        lineGap: 2
      });
      cursor -= 2;
    }
    cursor -= 2 * MM;
    drawFoldRule(ctx.page, ctx, cursor);
    cursor -= 3 * MM;
  }

  if (pc.advancementHistory && pc.advancementHistory.length > 0) {
    cursor = drawSectionHeader(ctx, cursor, 'Advancement history');
    for (const a of pc.advancementHistory) {
      const note = a.note ? ` — ${a.note}` : '';
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursor,
        text: `• ${a.kind}${note}`,
        font: fonts.serif,
        size: 10,
        maxWidth: ctx.contentWidth,
        lineGap: 2
      });
      cursor -= 2;
    }
    cursor -= 2 * MM;
    drawFoldRule(ctx.page, ctx, cursor);
    cursor -= 3 * MM;
  }

  if (pc.dmNotes) {
    cursor = drawSectionHeader(ctx, cursor, 'DM notes');
    const runs = parseEmphasis(pc.dmNotes);
    const lines = wrapRuns(
      runs,
      fonts.serif,
      fonts.serifItalic,
      10.5,
      ctx.contentWidth
    );
    for (const line of lines) {
      drawRunLine(
        ctx.page,
        line,
        ctx.contentLeft,
        cursor,
        10.5,
        { serif: fonts.serif, serifItalic: fonts.serifItalic },
        COLORS.ink
      );
      cursor -= 10.5 + 3;
    }
    cursor -= 3 * MM;
  }

  const bondsWithNotes = (pc.bonds ?? []).filter((b) => b.dmNotes);
  if (bondsWithNotes.length > 0) {
    cursor = drawSectionHeader(ctx, cursor, 'Bonds (DM-only annotations)');
    for (const b of bondsWithNotes) {
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursor,
        text: `— to ${b.targetPcId}: ${b.dmNotes}`,
        font: fonts.serif,
        size: 10,
        maxWidth: ctx.contentWidth,
        lineGap: 2
      });
      cursor -= 2;
    }
  }

  return ctx;
}
