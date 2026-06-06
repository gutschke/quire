// @vitest-environment happy-dom

/**
 * Unit tests for the PDF generator.
 *
 * Verifies:
 *   - renderPcPdf returns a Uint8Array that begins with the %PDF-
 *     magic and ends with %%EOF.
 *   - Same fixture renders to byte-identical output across runs
 *     (determinism for the CI golden test).
 *   - The bundle-gate classifier treats `print-pc-<hash>.js` as
 *     "other" (uncapped).
 *
 * Firewall regressions live in print-pc.firewall.test.ts, which
 * requires pdftotext and is gated behind PDF_TOOLS=1.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { renderPcPdf } from './print-pc';
import { ALL_FIXTURES, SLOT_1_MARCUS } from './print-pc-fixtures';
import { classifyChunk } from '../bundle-gate';
import type { FontBytes } from './print-pc-fonts';

let fontBytes: FontBytes;

beforeAll(async () => {
  const fontsDir = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
  const read = async (name: string): Promise<Uint8Array> =>
    new Uint8Array(await readFile(join(fontsDir, name)));
  fontBytes = {
    sansRegular: await read('LiberationSans-Regular.ttf'),
    sansBold: await read('LiberationSans-Bold.ttf'),
    serifRegular: await read('LiberationSerif-Regular.ttf'),
    serifItalic: await read('LiberationSerif-Italic.ttf')
  };
});

const PDF_MAGIC = '%PDF-';
const PDF_TRAILER = '%%EOF';

function asString(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

describe('renderPcPdf', () => {
  it('emits a valid PDF stream for each fixture (player audience)', { timeout: 30000 }, async () => {
    for (const pc of ALL_FIXTURES) {
      const bytes = await renderPcPdf(pc, { audience: 'player', fontBytes });
      const s = asString(bytes);
      expect(s.startsWith(PDF_MAGIC)).toBe(true);
      // Trailer must be near the end (may have trailing newline).
      expect(s.includes(PDF_TRAILER)).toBe(true);
      // Sanity: not absurdly small (we draw a lot of stuff).
      expect(bytes.byteLength).toBeGreaterThan(4 * 1024);
    }
  });

  it('emits a DM-audience PDF that includes a second page', async () => {
    const bytes = await renderPcPdf(SLOT_1_MARCUS, { audience: 'dm', fontBytes });
    // pdf-lib emits one /Type /Page per page; count for a quick check.
    const s = asString(bytes);
    const pageCount = (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic for a fixed fixture (same bytes across runs)', async () => {
    const a = await renderPcPdf(SLOT_1_MARCUS, {
      audience: 'player',
      deterministic: true,
      fontBytes
    });
    const b = await renderPcPdf(SLOT_1_MARCUS, {
      audience: 'player',
      deterministic: true,
      fontBytes
    });
    expect(a.byteLength).toBe(b.byteLength);
    // Byte-for-byte equality.
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`PDFs differ at byte ${i}`);
      }
    }
  });

  it('player export has fixed-string /Title (PC name is NOT in metadata)', async () => {
    const bytes = await renderPcPdf(SLOT_1_MARCUS, { audience: 'player', fontBytes });
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getTitle()).toBe('PC Sheet');
    expect(loaded.getTitle()).not.toContain(SLOT_1_MARCUS.name);
    expect(loaded.getAuthor() ?? '').toBe('');
  });

  it('pcNames resolves bond targets to display names', async () => {
    // Subset fonts encode glyphs as opaque indices, so the literal
    // name string won't appear in the raw bytes.  Verify the
    // resolver runs by comparing two renders that differ ONLY by
    // the bond display string — different glyph sequences produce
    // different byte sizes.
    const withoutResolver = await renderPcPdf(SLOT_1_MARCUS, {
      audience: 'player',
      fontBytes
    });
    const withResolver = await renderPcPdf(SLOT_1_MARCUS, {
      audience: 'player',
      fontBytes,
      pcNames: { 'slot-5-sam': 'Sam Reyes' }
    });
    expect(withResolver.byteLength).not.toBe(withoutResolver.byteLength);
  });

  it('selfExport=false strips knowsTheyCanCast + tax', async () => {
    // Use Yui (post-Realization, tax active).  With selfExport=true
    // (default), the magic section + tax appear on the player PDF.
    // With selfExport=false, the broader scrub kicks in and the
    // magic section is absent (knowsTheyCanCast stripped).
    const own = await renderPcPdf(ALL_FIXTURES[1], {
      audience: 'player',
      fontBytes,
      selfExport: true
    });
    const cross = await renderPcPdf(ALL_FIXTURES[1], {
      audience: 'player',
      fontBytes,
      selfExport: false
    });
    // Cross-PC export should be smaller (no magic section).
    expect(cross.byteLength).toBeLessThan(own.byteLength);
  });

  it('handles a PC with no foci, no inventory, no bonds gracefully', async () => {
    const minimal = {
      $schemaVersion: '0.1.0',
      name: 'Empty PC',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
    } as typeof SLOT_1_MARCUS;
    const bytes = await renderPcPdf(minimal, { audience: 'player', fontBytes });
    expect(bytes.byteLength).toBeGreaterThan(2 * 1024);
  });
});

describe('bundle-gate classification', () => {
  it('treats print-pc-<hash>.js as "other" (uncapped)', () => {
    expect(classifyChunk('print-pc-AbCd1234.js')).toBe('other');
    expect(classifyChunk('assets/print-pc-xyz.js')).toBe('other');
  });
});
