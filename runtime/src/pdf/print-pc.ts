/**
 * Public entry for the printable-PDF feature.  Lazy-loaded by the
 * UI affordance so pdf-lib + fontkit + the embedded Liberation
 * fonts never enter the main bundle.
 *
 *   const { renderPcPdf, downloadPdf } = await import('./pdf/print-pc');
 *   const bytes = await renderPcPdf(pc, { audience, pageSize: 'A4' });
 *   downloadPdf(bytes, `${pc.name}-sheet.pdf`);
 *
 * The chunk name `print-pc-<hash>.js` falls into the bundle-gate's
 * "other" classification (uncapped) — see check-bundle-size.mjs and
 * the regression test in bundle-gate.test.ts.
 */

import { PDFDocument } from 'pdf-lib';
import type { CharacterRecord } from '../character-loader';
import { scrubForAudience, type Audience } from './print-pc-firewall';
import { loadFontBytes, type FontBytes } from './print-pc-fonts';
import {
  embedFonts,
  makePage,
  drawIdentityBand,
  drawHarmStressBand,
  drawStatsStrip,
  drawSkillsTagsChips,
  drawFoci,
  drawMagicSection,
  drawConditionsInventory,
  drawMoneyAndLanguages,
  drawBonds,
  drawAdvancement,
  drawBackstoryWithEmphasis,
  drawResolutionCrib,
  drawSlimFooter,
  drawDmDossier,
  decorateProsePage,
  MM,
  type PageContext,
  type PageSize
} from './print-pc-layout';

export interface RenderOptions {
  audience: Audience;
  pageSize?: PageSize;
  /** For golden-byte tests: zero out timestamps + metadata. Default true. */
  deterministic?: boolean;
  /** Override font bytes — tests pass these directly. */
  fontBytes?: FontBytes;
  /**
   * v3: when audience='player', controls scrub strength.
   *   - selfExport=true (default): narrow scrub — preserves the PC's
   *     own knowsTheyCanCast + tax (Realization self-knowledge).
   *   - selfExport=false: broader scrub — also strips
   *     knowsTheyCanCast + tax, for cross-PC export (player printing
   *     another player's PC).
   * Ignored when audience='dm'.
   */
  selfExport?: boolean;
  /**
   * v3: resolve bond targetPcId → display name.  Surfaces a real
   * name on the printed sheet instead of the slot-id slug.  Falls
   * back to the slug if the resolver returns undefined.
   *
   * Example: `{ 'slot-5-sam-msg_01Gn': 'Sam' }`.
   */
  pcNames?: Record<string, string>;
}

export async function renderPcPdf(
  pc: CharacterRecord,
  options: RenderOptions
): Promise<Uint8Array> {
  const pageSize: PageSize = options.pageSize ?? 'A4';
  const deterministic = options.deterministic ?? true;

  // Firewall — DM-only fields stripped BEFORE layout for player
  // audience.  DM audience sees the unmodified record.
  const scrubbed = scrubForAudience(
    pc,
    options.audience,
    options.selfExport ?? true
  ) as CharacterRecord;
  const resolveName = options.pcNames
    ? (id: string): string => options.pcNames?.[id] ?? id
    : (id: string): string => id;

  const doc = await PDFDocument.create();
  if (deterministic) {
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    doc.setProducer('');
    doc.setCreator('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setTitle('PC Sheet');
  }

  const fontBytes = options.fontBytes ?? (await loadFontBytes());
  const fonts = await embedFonts(doc, fontBytes);

  // Track all pages so the footer pass knows the page count for the
  // "page X of Y" slim footer.
  const allPages: PageContext[] = [];
  const page0 = makePage(doc, pageSize, fonts, 0);
  allPages.push(page0);

  // Page-1 fixtures live at fixed Y near the bottom: advancement
  // strip + resolution crib.  Live-state sections above must stop
  // before these reservations; bonds + backstory flow to page 2
  // when page 1 is full (TTRPG expert + visual designer v2 brief).
  const cribReserve = page0.marginY + 18 * MM;
  const advanceReserve = cribReserve + 8 * MM;
  const sectionFloor = advanceReserve + 6 * MM;
  // Minimum vertical needed for the bonds section to fit on the
  // current page without bleeding into the advancement strip.  If
  // the bonds-or-larger payload won't fit here, the entire prose
  // tail (bonds + backstory) moves to page 2.
  const BONDS_MIN_HEIGHT = 28 * MM;

  let currentCtx = page0;
  let cursorY = page0.height - page0.marginY;
  cursorY = drawIdentityBand(page0, scrubbed, cursorY);
  cursorY = drawHarmStressBand(page0, scrubbed, cursorY);
  cursorY = drawStatsStrip(page0, scrubbed, cursorY);
  cursorY = drawSkillsTagsChips(page0, scrubbed, cursorY);
  cursorY = drawFoci(page0, scrubbed, cursorY);
  cursorY = drawMagicSection(page0, scrubbed, cursorY);

  // v3: section-floor cascade.  Each section below "magic" gets a
  // pre-draw fit check; if it would draw into the advancement strip
  // territory, everything from that section onward flows to a new
  // page.  Once we've left page 0, the new pages have no advancement
  // strip — they use a smaller floor.
  const COND_INV_MIN_HEIGHT = 30 * MM;
  const MONEY_MIN_HEIGHT = 16 * MM;
  const BONDS_MIN_HEIGHT_GATE = BONDS_MIN_HEIGHT;
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function ensureSpace(minHeight: number) {
    const onP0 = currentCtx === page0;
    const floor = onP0 ? sectionFloor : currentCtx.marginY + 8 * MM;
    if (cursorY < floor + minHeight) {
      currentCtx = makePage(doc, pageSize, fonts, allPages.length);
      allPages.push(currentCtx);
      cursorY = currentCtx.height - currentCtx.marginY;
    }
  }

  ensureSpace(COND_INV_MIN_HEIGHT);
  cursorY = drawConditionsInventory(currentCtx, scrubbed, cursorY);
  ensureSpace(MONEY_MIN_HEIGHT);
  cursorY = drawMoneyAndLanguages(currentCtx, scrubbed, cursorY);
  ensureSpace(BONDS_MIN_HEIGHT_GATE);
  cursorY = drawBonds(currentCtx, scrubbed, cursorY, resolveName);

  // Backstory floor is the advancement strip only when we're still
  // on page 0; otherwise it's the page bottom margin (continuation
  // pages have no advancement strip).
  const backstoryFloor =
    currentCtx === page0 ? sectionFloor : currentCtx.marginY + 8 * MM;
  drawBackstoryWithEmphasis(
    doc,
    currentCtx,
    scrubbed,
    cursorY,
    backstoryFloor,
    allPages
  );

  // Advancement strip + resolution crib live on page 0 only.
  drawAdvancement(page0, scrubbed, page0.marginY + 16 * MM);
  drawResolutionCrib(page0);

  // v3: decorate every non-cockpit prose page (sprig + dot-grid)
  // BEFORE the DM dossier appends.  The dossier has its own amber
  // chrome and should not receive the Underleaf prose motifs.
  for (let i = 1; i < allPages.length; i++) {
    decorateProsePage(allPages[i]);
  }

  if (options.audience === 'dm') {
    drawDmDossier(doc, pc, pageSize, fonts, allPages.length, allPages);
  }

  // Slim footer on every page beyond the first (and on the DM
  // dossier).  The first page has its own resolution crib in lieu
  // of a footer-meta band — the crib IS the footer.
  const pageCount = allPages.length;
  if (pageCount > 1) {
    for (let i = 1; i < pageCount; i++) {
      drawSlimFooter(allPages[i], pc.name ?? 'PC', i + 1, pageCount);
    }
  }

  return doc.save({ useObjectStreams: false });
}

/**
 * Trigger a browser download for a generated PDF.  Handles Safari
 * race + filename sanitation gotchas.
 */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const safeBase =
    filename.replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'pc.pdf';
  const safe = safeBase.endsWith('.pdf') ? safeBase : `${safeBase}.pdf`;
  const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
