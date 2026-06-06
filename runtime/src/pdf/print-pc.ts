/**
 * Public entry for the printable-PDF feature.  Lazy-loaded by the
 * UI affordance so the pdf-lib bytes never enter the main bundle.
 *
 *   const { renderPcPdf, downloadPdf } = await import('./pdf/print-pc');
 *   const bytes = await renderPcPdf(pc, { audience, pageSize: 'A4' });
 *   downloadPdf(bytes, `${pc.name}-sheet.pdf`);
 *
 * The chunk name `print-pc-<hash>.js` falls into the bundle-gate's
 * "other" classification (uncapped) — see check-bundle-size.mjs
 * and the regression test in bundle-gate.test.ts.
 */

import { PDFDocument } from 'pdf-lib';
import type { CharacterRecord } from '../character-loader';
import { scrubForAudience, type Audience } from './print-pc-firewall';
import {
  embedFonts,
  makePage,
  drawIdentityBand,
  drawHarmStressBand,
  drawStatsStrip,
  drawSkillsTags,
  drawFoci,
  drawMagicSection,
  drawConditionsInventory,
  drawMoneyAndLanguages,
  drawBonds,
  drawAdvancement,
  drawBackstory,
  drawFooter,
  drawDmDossier,
  type PageSize
} from './print-pc-layout';

export interface RenderOptions {
  audience: Audience;
  pageSize?: PageSize;
  /** For golden-byte tests: zero out timestamps + metadata. Default true. */
  deterministic?: boolean;
}

export async function renderPcPdf(
  pc: CharacterRecord,
  options: RenderOptions
): Promise<Uint8Array> {
  const pageSize: PageSize = options.pageSize ?? 'A4';
  const deterministic = options.deterministic ?? true;

  // Firewall — DM-only fields are stripped BEFORE layout runs for
  // player audience.  DM audience sees the unmodified record.
  const scrubbed = scrubForAudience(pc, options.audience) as CharacterRecord;

  const doc = await PDFDocument.create();

  if (deterministic) {
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    doc.setProducer('');
    doc.setCreator('');
    doc.setAuthor('');
    doc.setSubject('');
    // Title is fixed (no PC name in metadata - PII surface).
    doc.setTitle('PC Sheet');
  }

  const fonts = await embedFonts(doc);
  const ctx = makePage(doc, pageSize, fonts);

  // Player-audience page (the player sheet — the DM gets this too
  // verbatim as the first page of their export so they can see
  // exactly what the player sees).
  let cursorY = ctx.height - ctx.marginY;
  cursorY = drawIdentityBand(ctx, scrubbed, cursorY);
  cursorY = drawHarmStressBand(ctx, scrubbed, cursorY);
  cursorY = drawStatsStrip(ctx, scrubbed, cursorY);
  cursorY = drawSkillsTags(ctx, scrubbed, cursorY);
  cursorY = drawFoci(ctx, scrubbed, cursorY);
  cursorY = drawMagicSection(ctx, scrubbed, cursorY);
  cursorY = drawConditionsInventory(ctx, scrubbed, cursorY);
  cursorY = drawMoneyAndLanguages(ctx, scrubbed, cursorY);
  cursorY = drawBonds(ctx, scrubbed, cursorY);

  // Reserve space for advancement strip + footer at the bottom.
  const footerReserve = ctx.marginY + 14 * 2.834645669; // 14mm for footer + reminder
  const advancementReserve = footerReserve + 8 * 2.834645669;
  const backstoryFloor = advancementReserve + 8 * 2.834645669;

  const backstoryResult = drawBackstory(
    doc,
    ctx,
    scrubbed,
    cursorY,
    backstoryFloor
  );
  // After backstory may have flowed to additional pages; advancement
  // strip lives on the FIRST page only (it is the at-a-glance
  // status, not the prose).  Use the original ctx.
  drawAdvancement(ctx, scrubbed, ctx.marginY + 16 * 2.834645669);
  drawFooter(ctx);

  // If backstory overflowed, give the continuation page its own
  // footer too so the page-frame is consistent.
  if (backstoryResult.ctx !== ctx) {
    drawFooter(backstoryResult.ctx);
  }

  if (options.audience === 'dm') {
    drawDmDossier(doc, pc, pageSize, fonts);
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
  // Re-wrap so the Blob ctor's BlobPart typing matches across TS
  // versions (Uint8Array<ArrayBufferLike> vs ArrayBuffer).
  const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on next tick — Safari aborts the download if revoked
  // synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
