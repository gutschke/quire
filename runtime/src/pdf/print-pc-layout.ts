/**
 * PDF layout helpers + per-section drawing for the printable
 * character sheet.  See design/playtest-readiness/pdf-design-
 * synthesis.md for the contract these implement.
 *
 * pdf-lib uses bottom-up Y coordinates (origin at the bottom-left
 * of the page).  This module tracks a `cursorY` that starts near
 * the top of the page (=`pageHeight - topMargin`) and decrements
 * as sections are drawn down the page.  Each `drawXxx` helper
 * returns the new cursor.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB
} from 'pdf-lib';

import type { CharacterRecord } from '../character-loader';

/** 1mm in PDF points. */
export const MM = 2.834645669;

/** Page sizes in PDF points (1pt = 1/72 in). */
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

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic)
  };
}

/** Ink colors for print (light-mode palette, darkened ~10% for ink). */
export const COLORS = {
  ink: rgb(0.17, 0.18, 0.20), // ~#2A2E33
  // v1.1: darkened from 0.41/0.43/0.45 (~#6A6E74, ~3.5:1 contrast) to
  // ~#555 (~5:1) — print critic flagged section headers failing WCAG-AA.
  inkSecondary: rgb(0.33, 0.33, 0.33), // ~#555555 — ≥4.5:1 on white
  rule: rgb(0.78, 0.79, 0.81), // ~#C8CACE — section dividers
  accent: rgb(0.12, 0.43, 0.47), // ~#1F6E78 — darkened teal
  harm: rgb(0.61, 0.23, 0.14), // ~#9B3A24 — darkened harm-red
  stress: rgb(0.37, 0.23, 0.56), // ~#5E3A8E — darkened stress-violet
  quiet: rgb(0.29, 0.31, 0.34), // ~#4A5058 — neutral cool-gray
  dmAmber: rgb(0.63, 0.42, 0.12) // ~#A06A1F — darkened DM-amber
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
}

export function makePage(
  doc: PDFDocument,
  pageSize: PageSize,
  fonts: Fonts
): PageContext {
  const size = PAGE_SIZES[pageSize];
  const page = doc.addPage([size.width, size.height]);
  // A4 has 12mm-safe sides; Letter wants 15mm to avoid the wider
  // Letter-margin clipping on cheap printers.  15mm is the safe
  // common choice; the content area sits centered.
  // v1.1: bumped from 15 → 16mm; print critic showed rules came
  // close to the 14.4mm margin and risked clipping on cheap inkjets.
  const marginX = 16 * MM;
  // v1.1: bumped from 18 → 20mm; print critic showed footer would
  // clip on Letter (18mm shorter than A4) — anchored to bottom-safe.
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
    fonts
  };
}

// ---------- text helpers ----------

/** Replace unicode glyphs StandardFonts cannot render with ASCII fallbacks. */
function asciify(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/·/g, '*')
    .replace(/•/g, '*')
    .replace(/[←-⇿]/g, '->')
    .replace(/±/g, '+/-')
    .replace(/×/g, 'x')
    .replace(/°/g, ' deg ')
    // strip any remaining non-Latin-1 char so embed-font doesn't throw
    .replace(/[^\x00-\xFF]/g, '?');
}

export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const rawPara of text.split(/\n+/)) {
    const para = asciify(rawPara).trim();
    if (!para) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        // long single word — break by chars if it exceeds maxWidth on its own
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = '';
          for (const ch of w) {
            const next = chunk + ch;
            if (font.widthOfTextAtSize(next, size) > maxWidth) {
              if (chunk) lines.push(chunk);
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
    if (line) lines.push(line);
  }
  return lines;
}

export interface DrawTextOptions {
  x: number;
  y: number;
  text: string;
  font: PDFFont;
  size: number;
  color?: RGB;
  maxWidth?: number;
  lineGap?: number;
}

/**
 * Draws text at (x, y) — y is the BASELINE of the first line.  If
 * `maxWidth` is given, wraps; each subsequent line drops by
 * `size + lineGap`.  Returns the y-coordinate AFTER the block
 * (baseline of where the next line would be).
 */
export function drawText(page: PDFPage, opts: DrawTextOptions): number {
  const { x, y, text, font, size, color, maxWidth, lineGap = 2 } = opts;
  const lines = maxWidth
    ? wrapText(text, font, size, maxWidth)
    : [asciify(text)];
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, font, size, color: color ?? COLORS.ink });
    cursor -= size + lineGap;
  }
  return cursor + lineGap; // baseline below last drawn line
}

// ---------- decorative motifs ----------

/**
 * Fold-rule hairline between sections — straight across with a
 * gentle 1.5mm upward curve at both ends.  Approximated as three
 * line segments because pdf-lib does not have Bezier shortcut.
 */
export function drawFoldRule(page: PDFPage, ctx: PageContext, y: number): void {
  const curveLen = 6 * MM;
  const rise = 1.5 * MM;
  const flatLeft = ctx.contentLeft + curveLen;
  const flatRight = ctx.contentRight - curveLen;
  // flat segment
  page.drawLine({
    start: { x: flatLeft, y },
    end: { x: flatRight, y },
    thickness: 0.5,
    color: COLORS.rule
  });
  // left curve approximated
  page.drawLine({
    start: { x: ctx.contentLeft, y: y + rise },
    end: { x: flatLeft, y },
    thickness: 0.5,
    color: COLORS.rule
  });
  // right curve approximated
  page.drawLine({
    start: { x: flatRight, y },
    end: { x: ctx.contentRight, y: y + rise },
    thickness: 0.5,
    color: COLORS.rule
  });
}

/**
 * Quire mark — 3 nested arcs approximated as 3 nested rounded
 * rectangles (pdf-lib has no arc primitive without Bezier).  Sits
 * at top-right of the identity band.  Inner arc gets a small
 * accent fill.
 */
export function drawQuireMark(
  page: PDFPage,
  centerX: number,
  centerY: number
): void {
  const baseR = 2 * MM;
  for (let i = 0; i < 3; i++) {
    const r = baseR - i * 0.5 * MM;
    page.drawCircle({
      x: centerX,
      y: centerY,
      size: r,
      borderColor: COLORS.accent,
      borderWidth: 0.6,
      color: i === 2 ? COLORS.accent : undefined,
      opacity: i === 2 ? 0.2 : 1
    });
  }
}

// ---------- section drawers ----------

const SECTION_HEADER_SIZE = 8.5;
const SECTION_LABEL_LINE_GAP = 4 * MM;

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
    color: COLORS.inkSecondary
  });
  return cursorY - SECTION_LABEL_LINE_GAP;
}

export function drawIdentityBand(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  // PC name (22pt sans bold)
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: startY - 22,
    text: pc.name,
    font: ctx.fonts.sansBold,
    size: 22
  });

  // Sub-band: pronouns + alignment, comma-joined
  const sub = [
    pc.pronouns ? `(${pc.pronouns})` : '',
    pc.alignment ? pc.alignment : ''
  ]
    .filter(Boolean)
    .join('  *  ');
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

  // Quire mark glyph top-right
  drawQuireMark(ctx.page, ctx.contentRight - 3 * MM, startY - 4 * MM);

  const endY = startY - 22 * MM;
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
): { width: number } {
  // v1.1: bump label to 9pt + boxes to 7.5mm + crib to 8pt (was
  // 8.5/6.5/6.5).  Critic feedback: cribs were ~5pt-equivalent and
  // smudged on inkjet.  Also raise crib higher above the box so it
  // does not look like the box label.
  const labelWidth = 16 * MM;
  const boxSize = 7.5 * MM;
  const gap = 2 * MM;
  // More vertical room for the larger crib + box.
  const trackY = topY - boxSize - 12;

  // Label — vertically center on the box.
  drawText(ctx.page, {
    x,
    y: trackY + boxSize / 2 - 3,
    text: label.toUpperCase(),
    font: ctx.fonts.sansBold,
    size: 9,
    color: COLORS.inkSecondary
  });

  // Penalty cribs above each box — bumped to 8pt with extra leading.
  let cribX = x + labelWidth;
  for (const crib of penalties) {
    ctx.page.drawText(asciify(crib), {
      x: cribX + 1,
      y: trackY + boxSize + 4,
      font: ctx.fonts.sans,
      size: 7,
      color: COLORS.inkSecondary
    });
    cribX += boxSize + gap;
  }

  // Boxes
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
      // 1mm inner offset rule for stress — B&W redundancy
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
      // v1.1: replaced diagonal hatch (which read as pre-printed)
      // with a centered check-mark glyph — reads as pencil-applied.
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

  const usedWidth = labelWidth + 4 * (boxSize + gap);
  return { width: usedWidth };
}

export function drawHarmStressBand(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  const trackTopY = startY;
  const half = ctx.contentWidth / 2;
  drawTrack(
    ctx,
    ctx.contentLeft,
    trackTopY,
    'Harm',
    ['ok', '-1 phys', '-1 all', 'out'],
    pc.harm ?? 0,
    COLORS.harm,
    false
  );
  drawTrack(
    ctx,
    ctx.contentLeft + half,
    trackTopY,
    'Stress',
    ['ok', '-1 wis', '-2 wis', 'no cast'],
    pc.stress ?? 0,
    COLORS.stress,
    true
  );
  // v1.1: more vertical (32 → 33mm) to accommodate the bigger boxes
  // + raised cribs.
  const endY = trackTopY - 32 * MM;
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
  // v1.1: demoted stat number from 18pt bold → 13pt regular per
  // prime-directive critic.  Stats are reference, not the star.
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
  if (n === undefined) return '-';
  if (n > 0) return `+${n}`;
  if (n === 0) return '0';
  return `${n}`;
}

export function drawSkillsTags(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Skills + Tags');
  const all = [...(pc.skills ?? []), ...(pc.tags ?? [])];
  if (all.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: '(none yet)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
  } else {
    const joined = all.join('  *  ');
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: joined,
      font: ctx.fonts.serif,
      size: 10.5,
      maxWidth: ctx.contentWidth,
      lineGap: 2
    });
  }
  cursor -= 3 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

export function drawFoci(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Foci');
  if (!pc.foci || pc.foci.length === 0) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: '(no foci yet)',
      font: ctx.fonts.serifItalic,
      size: 10,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
  } else {
    // v1.1: structured bullet list with name on its own line and a
    // status badge for non-active foci.  TTRPG critic flagged that
    // foci drive cast tiers and were unscannable as inline prose.
    for (const f of pc.foci) {
      // First line: bullet glyph + name (bold) + status badge
      const bullet = '> ';
      ctx.page.drawText(bullet, {
        x: ctx.contentLeft,
        y: cursor,
        font: ctx.fonts.sansBold,
        size: 10
      });
      const bulletW = ctx.fonts.sansBold.widthOfTextAtSize(bullet, 10);
      ctx.page.drawText(asciify(f.name), {
        x: ctx.contentLeft + bulletW,
        y: cursor,
        font: ctx.fonts.sansBold,
        size: 10.5
      });
      const nameW = ctx.fonts.sansBold.widthOfTextAtSize(f.name, 10.5);
      // Status badge for non-active states (broken / faded / etc.)
      if (f.status && f.status !== 'active') {
        const badge = ` [${f.status}]`;
        ctx.page.drawText(asciify(badge), {
          x: ctx.contentLeft + bulletW + nameW + 4,
          y: cursor,
          font: ctx.fonts.sansBold,
          size: 9,
          color: COLORS.harm
        });
      }
      cursor -= 12;
      // Subline: domain * for: bound-purpose
      const sub: string[] = [];
      if (f.domain) sub.push(`domain: ${f.domain}`);
      if (f.boundFor) sub.push(`for: ${f.boundFor}`);
      if (f.condition) sub.push(`(${f.condition})`);
      if (sub.length > 0) {
        cursor = drawText(ctx.page, {
          x: ctx.contentLeft + 4 * MM,
          y: cursor,
          text: sub.join('  *  '),
          font: ctx.fonts.serif,
          size: 9.5,
          color: COLORS.inkSecondary,
          maxWidth: ctx.contentWidth - 4 * MM,
          lineGap: 2
        });
      }
      cursor -= 4;
    }
  }
  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

/**
 * Conditional magic section.  Drawn ONLY if `pc.knowsTheyCanCast`
 * is exactly `true`.  When false/undefined, returns the input
 * cursor unchanged — no header, no placeholder, no glyph.  This
 * is the silent-player-firewall rule expressed in print form.
 */
export function drawMagicSection(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  if (pc.knowsTheyCanCast !== true) return startY;
  let cursor = drawSectionHeader(ctx, startY, 'The Quiet');

  // v1.1: TTRPG critic flagged the previous compressed prose as
  // unreadable mid-cast.  Restructured as a 2-column tier table with
  // a one-line intent reminder above and a one-line focus rule below.
  const intent = 'Cast = (right way to ask) + (authentic intent).';
  cursor = drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: intent,
    font: ctx.fonts.serifItalic,
    size: 9.5,
    color: COLORS.quiet,
    maxWidth: ctx.contentWidth
  });
  cursor -= 4;

  // Tier table: 2 columns x 5 rows.  Left = tier name (bold), right
  // = resolution + cost summary.
  const tiers: ReadonlyArray<[string, string]> = [
    ['Free', 'no roll; succeeds.'],
    ['Cheap', 'no roll; minor thread debt.'],
    ['Costly', '2d6 + WIS. 10+ clean / 7-9 partial / <=6 fail. +1 stress.'],
    ['Hard', '2d6 + WIS, -1 to -2. Backlash on miss. +2 stress.'],
    ['Prohibited', 'cannot. The Quiet does not parse.']
  ];
  const tierColW = 20 * MM;
  const rowH = 11;
  for (const [name, rule] of tiers) {
    ctx.page.drawText(asciify(name), {
      x: ctx.contentLeft,
      y: cursor,
      font: ctx.fonts.sansBold,
      size: 9,
      color: COLORS.quiet
    });
    drawText(ctx.page, {
      x: ctx.contentLeft + tierColW,
      y: cursor,
      text: rule,
      font: ctx.fonts.sans,
      size: 9,
      color: COLORS.ink,
      maxWidth: ctx.contentWidth - tierColW
    });
    cursor -= rowH;
  }
  cursor -= 2;
  // Footer rule.
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: 'Foci shift in-domain casts one tier easier.',
    font: ctx.fonts.serifItalic,
    size: 9,
    color: COLORS.quiet,
    maxWidth: ctx.contentWidth
  });
  cursor -= 12;
  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
}

export function drawConditionsInventory(
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number
): number {
  // Two columns.  Left: conditions.  Right: inventory.
  const half = ctx.contentWidth / 2;
  const leftMax = half - 4 * MM;
  const rightX = ctx.contentLeft + half + 4 * MM;
  const rightMax = ctx.contentWidth - half - 4 * MM;

  // v1.1: always render the Conditions header so the layout stays
  // structurally identical PC-to-PC.  TTRPG critic flagged that a
  // missing section reads as "something is missing".
  let cursorL = drawSectionHeader(ctx, startY, 'Conditions');
  if (!pc.conditions || pc.conditions.length === 0) {
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
    for (const c of pc.conditions) {
      const line = `${c.name}: ${c.effect}`;
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

  // Right: inventory
  let cursorR = drawSectionHeader(
    {
      ...ctx,
      contentLeft: rightX
    },
    startY,
    'Inventory'
  );
  if (!pc.inventory || pc.inventory.length === 0) {
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
    for (const it of pc.inventory) {
      const tail = it.notes ? ` (${it.notes})` : '';
      const carry =
        it.carriedBy === 'stowed' ? ' [stowed]' : '';
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

  const cursor = Math.min(cursorL, cursorR) - 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  return cursor - 3 * MM;
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
  let cursor = drawSectionHeader(ctx, startY, 'Money + Languages');
  const current = pc.moneyBand;
  let x = ctx.contentLeft;
  ctx.page.drawText('Money:', {
    x,
    y: cursor,
    font: ctx.fonts.sansBold,
    size: 8.5,
    color: COLORS.inkSecondary
  });
  x += ctx.fonts.sansBold.widthOfTextAtSize('Money:', 8.5) + 4;
  for (const b of bands) {
    const isCurrent = b === current;
    const w = ctx.fonts.sans.widthOfTextAtSize(b, 9.5);
    if (isCurrent) {
      // circle the current band
      ctx.page.drawRectangle({
        x: x - 2,
        y: cursor - 3,
        width: w + 4,
        height: 12,
        borderColor: COLORS.accent,
        borderWidth: 0.6
      });
    }
    ctx.page.drawText(asciify(b), {
      x,
      y: cursor,
      font: isCurrent ? ctx.fonts.sansBold : ctx.fonts.sans,
      size: 9.5,
      color: COLORS.ink
    });
    x += w + 8;
  }

  cursor -= 14;

  if (pc.languages && pc.languages.length > 0) {
    const langText = `Languages: ${pc.languages.join(', ')}`;
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: langText,
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
  startY: number
): number {
  let cursor = drawSectionHeader(ctx, startY, 'Bonds');
  if (!pc.bonds || pc.bonds.length === 0) {
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
    // v1.1: TTRPG critic flagged bonds had no relationship label.
    // Lead each entry with the target id (rendered until v2 adds a
    // resolver lookup) in sans-bold, then the prose in serif.
    for (const b of pc.bonds) {
      const target = b.targetPcId || 'unknown';
      ctx.page.drawText(asciify(`> ${target}: `), {
        x: ctx.contentLeft,
        y: cursor,
        font: ctx.fonts.sansBold,
        size: 9.5,
        color: COLORS.inkSecondary
      });
      const prefixW = ctx.fonts.sansBold.widthOfTextAtSize(
        `> ${target}: `,
        9.5
      );
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
    color: COLORS.inkSecondary
  });
  const labelW = ctx.fonts.sansBold.widthOfTextAtSize('ADVANCEMENT', 8.5);
  // 5 bullet squares
  const bullets = pc.markBullets ?? {};
  const bulletKeys = [
    'hardMoment',
    'learned',
    'risk',
    'against',
    'complication'
  ] as const;
  const bulletLabels = ['hard moment', 'learned', 'risk', 'against', 'complic'];
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
      // diagonal tick
      ctx.page.drawLine({
        start: { x, y: startY - 2 + boxSize },
        end: { x: x + boxSize, y: startY - 2 },
        thickness: 0.6,
        color: COLORS.accent
      });
      ctx.page.drawLine({
        start: { x, y: startY - 2 },
        end: { x: x + boxSize, y: startY - 2 + boxSize },
        thickness: 0.6,
        color: COLORS.accent
      });
    }
    ctx.page.drawText(asciify(bulletLabels[i]), {
      x: x + boxSize + 2,
      y: startY,
      font: ctx.fonts.sans,
      size: 7,
      color: COLORS.inkSecondary
    });
    x += boxSize + 2 + ctx.fonts.sans.widthOfTextAtSize(bulletLabels[i], 7) + 6;
  }
  // Lifetime count, right-aligned
  const counter = `${pc.advancements ?? 0} of 8 advancements`;
  const counterW = ctx.fonts.sans.widthOfTextAtSize(counter, 9);
  ctx.page.drawText(asciify(counter), {
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
 * Backstory prose — flows top-down from `startY` and can overflow
 * to a new page.  Returns the final cursor and the active page in
 * case the caller wants to keep drawing.
 */
export function drawBackstory(
  doc: PDFDocument,
  ctx: PageContext,
  pc: CharacterRecord,
  startY: number,
  bottomFloor: number
): { ctx: PageContext; cursorY: number } {
  let currentCtx = ctx;
  let cursor = drawSectionHeader(currentCtx, startY, 'Backstory');

  const text = pc.backstory ?? '';
  const lines = wrapText(text, currentCtx.fonts.serif, 10.5, currentCtx.contentWidth);
  const lineHeight = 10.5 + 3;

  for (const line of lines) {
    if (cursor < bottomFloor) {
      // overflow to a new page
      currentCtx = makePage(doc, currentCtx.pageSize, currentCtx.fonts);
      cursor = currentCtx.height - currentCtx.marginY;
      cursor = drawSectionHeader(currentCtx, cursor, 'Backstory (continued)');
    }
    currentCtx.page.drawText(line, {
      x: currentCtx.contentLeft,
      y: cursor,
      font: currentCtx.fonts.serif,
      size: 10.5,
      color: COLORS.ink
    });
    cursor -= lineHeight;
  }
  return { ctx: currentCtx, cursorY: cursor };
}

export function drawFooter(ctx: PageContext): void {
  const y = ctx.marginY - 6 * MM;
  const reminder =
    'Roll 2d6 + stat.  <= 6 miss  *  7-9 partial  *  10+ hit  *  ' +
    '12+ exceptional.  Double 6: you narrate a bonus detail.  ' +
    'Double 1: DM adds a twist.';
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y,
    text: reminder,
    font: ctx.fonts.serifItalic,
    size: 8,
    color: COLORS.inkSecondary,
    maxWidth: ctx.contentWidth
  });
}

// ---------- DM dossier page ----------

export function drawDmDossier(
  doc: PDFDocument,
  pc: CharacterRecord,
  pageSize: PageSize,
  fonts: Fonts
): void {
  const ctx = makePage(doc, pageSize, fonts);
  // amber bleed bar on the left edge of content area
  ctx.page.drawRectangle({
    x: ctx.contentLeft - 6 * MM,
    y: ctx.marginY,
    width: 1.5 * MM,
    height: ctx.height - 2 * ctx.marginY,
    color: COLORS.dmAmber
  });

  // Vertical "DM" text on the bar — drawn rotated 90deg using
  // pdf-lib's rotate option.  Lift a few mm up from bottom.
  ctx.page.drawText('DM', {
    x: ctx.contentLeft - 5.5 * MM,
    y: ctx.marginY + 12 * MM,
    font: fonts.sansBold,
    size: 9,
    color: COLORS.dmAmber,
    rotate: { type: 'degrees', angle: 90 } as any
  });

  // v1.1: visual critic + print critic + TTRPG critic ALL flagged
  // that the DM warning text was rendering BEHIND the PC name and
  // failing the paper-shuffle test.  Fixes:
  //   (a) draw a full-width amber band at the top of the page so the
  //       dossier is obviously not the player sheet at a glance
  //   (b) place the warning IN the amber band, white on amber, large
  //       and bold — the dominant element on the page
  //   (c) push the PC name well below the band, no overlap
  const cursor0 = ctx.height - ctx.marginY;
  const bandH = 14 * MM;
  ctx.page.drawRectangle({
    x: ctx.contentLeft - 2 * MM,
    y: cursor0 - bandH,
    width: ctx.contentWidth + 4 * MM,
    height: bandH,
    color: COLORS.dmAmber
  });
  // White warning text on amber.
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor0 - 9 * MM,
    text: 'DM DOSSIER  -  DO NOT SHOW PLAYER',
    font: fonts.sansBold,
    size: 14,
    color: rgb(1, 1, 1)
  });
  let cursor = cursor0 - bandH - 10;
  drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: `${pc.name}  -  per-PC private notes`,
    font: fonts.sansBold,
    size: 14
  });
  cursor -= 22;

  // Magic phase + knows-they-can-cast + tax
  cursor = drawSectionHeader(ctx, cursor, 'Magic state');
  const magicLine = [
    `phase: ${pc.magicPhase ?? '-'}`,
    `knows they can cast: ${pc.knowsTheyCanCast ? 'yes' : 'no'}`,
    pc.tax
      ? `tax: ${pc.tax.active ? 'active' : 'released'}` +
        (pc.tax.sessionsRemaining
          ? `, ${pc.tax.sessionsRemaining} session(s) left`
          : '') +
        (pc.tax.releaseMoment ? `, release: ${pc.tax.releaseMoment}` : '')
      : 'tax: not yet'
  ].join('   |   ');
  cursor = drawText(ctx.page, {
    x: ctx.contentLeft,
    y: cursor,
    text: magicLine,
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
    ctx.page.drawText(asciify(ladder[i]), {
      x,
      y: cursor,
      font: isCurrent ? fonts.sansBold : fonts.sans,
      size: 9
    });
    x += w + 14;
    if (i < ladder.length - 1) {
      ctx.page.drawText('->', {
        x: x - 10,
        y: cursor,
        font: fonts.sans,
        size: 9,
        color: COLORS.inkSecondary
      });
    }
  }
  cursor -= 14;
  if (pc.threadDebt?.spamCount !== undefined) {
    drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: `(spam-count this scene: ${pc.threadDebt.spamCount})`,
      font: fonts.serifItalic,
      size: 9,
      color: COLORS.inkSecondary
    });
    cursor -= 14;
  }
  cursor -= 2 * MM;
  drawFoldRule(ctx.page, ctx, cursor);
  cursor -= 3 * MM;

  // Alignment drift
  if (pc.alignmentDrift) {
    cursor = drawSectionHeader(ctx, cursor, 'Alignment drift');
    const driftLine = `marks: ${pc.alignmentDrift.marks} / 5`;
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: driftLine,
      font: fonts.sans,
      size: 10
    });
    cursor -= 4 * MM;
    drawFoldRule(ctx.page, ctx, cursor);
    cursor -= 3 * MM;
  }

  // Accidental grants log
  if (pc.accidentalGrants && pc.accidentalGrants.length > 0) {
    cursor = drawSectionHeader(ctx, cursor, 'Accidental grants (DM log)');
    for (const g of pc.accidentalGrants) {
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursor,
        text: `- ${g.note}`,
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

  // DM notes prose
  if (pc.dmNotes) {
    cursor = drawSectionHeader(ctx, cursor, 'DM notes');
    cursor = drawText(ctx.page, {
      x: ctx.contentLeft,
      y: cursor,
      text: pc.dmNotes,
      font: fonts.serif,
      size: 10.5,
      maxWidth: ctx.contentWidth,
      lineGap: 3
    });
    cursor -= 3 * MM;
  }

  // Bond DM notes (per-entry)
  const bondsWithNotes = (pc.bonds ?? []).filter((b) => b.dmNotes);
  if (bondsWithNotes.length > 0) {
    cursor = drawSectionHeader(ctx, cursor, 'Bonds (DM-only annotations)');
    for (const b of bondsWithNotes) {
      cursor = drawText(ctx.page, {
        x: ctx.contentLeft,
        y: cursor,
        text: `- to ${b.targetPcId}: ${b.dmNotes}`,
        font: fonts.serif,
        size: 10,
        maxWidth: ctx.contentWidth,
        lineGap: 2
      });
      cursor -= 2;
    }
  }
}
