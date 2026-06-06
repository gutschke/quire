// @vitest-environment happy-dom

/**
 * Test that writes the 5 fixture PDFs to
 * /home/markus/src/ttrpg/tmp/pdf-out/ so we (and pdftotext, and
 * the visual critic) can inspect them.  Gated on PDF_GENERATE=1
 * so it doesn't run in the normal vitest suite — opt-in via:
 *
 *   PDF_GENERATE=1 npx vitest run src/pdf/print-pc.generate
 *
 * Also serves as the entry point for the firewall regression
 * check (which calls pdftotext on the emitted files).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPcPdf } from './print-pc';
import {
  ALL_FIXTURES,
  DM_ONLY_FIXTURE_PHRASES
} from './print-pc-fixtures';
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

const OUT_DIR = '/home/markus/src/ttrpg/tmp/pdf-out';
const ENABLED = process.env.PDF_GENERATE === '1';

function slugify(name: string): string {
  return name.replace(/[^\w]+/g, '_').toLowerCase();
}

describe.runIf(ENABLED)('PDF generation + firewall inspection', () => {
  it('emits fixture PDFs (N PCs * 2 audiences) to tmp/pdf-out/', { timeout: 60000 }, async () => {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    for (const pc of ALL_FIXTURES) {
      const slug = slugify(pc.name);
      for (const audience of ['player', 'dm'] as const) {
        const bytes = await renderPcPdf(pc, { audience, pageSize: 'A4', fontBytes });
        const out = join(OUT_DIR, `${slug}-${audience}.pdf`);
        writeFileSync(out, bytes);
        // eslint-disable-next-line no-console
        console.log(`  wrote ${out}  (${bytes.byteLength.toLocaleString()} bytes)`);
      }
    }
  });

  it('every player PDF passes pdfinfo (no parse errors)', () => {
    for (const pc of ALL_FIXTURES) {
      const slug = slugify(pc.name);
      const file = join(OUT_DIR, `${slug}-player.pdf`);
      const info = execFileSync('pdfinfo', [file], {
        encoding: 'utf8'
      });
      expect(info).toMatch(/Pages:\s+\d+/);
      expect(info).toMatch(/Page size:\s+595\.28 x 841\.89/); // A4
    }
  });

  it('every player PDF contains the PC name and key player-visible content', () => {
    for (const pc of ALL_FIXTURES) {
      const slug = slugify(pc.name);
      const file = join(OUT_DIR, `${slug}-player.pdf`);
      const text = execFileSync('pdftotext', [file, '-'], {
        encoding: 'utf8'
      });
      expect(text).toContain(pc.name);
      // Stats labels always print.
      expect(text).toContain('STR');
      expect(text).toContain('CHA');
      // Bonds, if present, print player-visible text.
      for (const bond of pc.bonds ?? []) {
        const firstFew = bond.text.split(' ').slice(0, 3).join(' ');
        expect(text).toContain(firstFew);
      }
    }
  });

  it('FIREWALL: NO player PDF contains any DM-only fixture phrase', () => {
    for (const pc of ALL_FIXTURES) {
      const slug = slugify(pc.name);
      const file = join(OUT_DIR, `${slug}-player.pdf`);
      const text = execFileSync('pdftotext', [file, '-'], {
        encoding: 'utf8'
      });
      for (const phrase of DM_ONLY_FIXTURE_PHRASES) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          throw new Error(
            `FIREWALL BREACH: player PDF "${slug}" contains DM-only phrase ` +
              `"${phrase}".\nFull text:\n${text}`
          );
        }
      }
    }
  });

  it('FIREWALL: accidental-phase PCs have NO magic section on player PDF', () => {
    // Marcus (slot 1) and Hadrian (slot 4) are accidental-phase.
    // Their player PDFs must not contain the magic-section header
    // or any of the cast-tier vocabulary.
    const accidentalSlugs = ['marcus_vance', 'hadrian_wells'];
    for (const slug of accidentalSlugs) {
      const file = join(OUT_DIR, `${slug}-player.pdf`);
      const text = execFileSync('pdftotext', [file, '-'], {
        encoding: 'utf8'
      });
      expect(text).not.toContain('THE QUIET');
      expect(text).not.toContain('Costly');
      expect(text).not.toContain('Prohibited');
    }
  });

  it('post-Realization PCs DO show the magic section on player PDF', () => {
    // Yui, Rae, Sam are realization/tax/free phase — knowsTheyCanCast === true.
    const knowingSlugs = ['yui_tanaka', 'rae_park', 'sam_reyes'];
    for (const slug of knowingSlugs) {
      const file = join(OUT_DIR, `${slug}-player.pdf`);
      const text = execFileSync('pdftotext', [file, '-'], {
        encoding: 'utf8'
      });
      expect(text).toContain('THE QUIET');
    }
  });

  it('DM PDF DOES include the DM-only phrases', () => {
    // The DM audience export should INCLUDE everything player export
    // omits — this is the positive control proving the firewall is
    // selectively scrubbing (vs. just refusing to render the data).
    const marcusDm = execFileSync(
      'pdftotext',
      [join(OUT_DIR, 'marcus_vance-dm.pdf'), '-'],
      { encoding: 'utf8' }
    );
    expect(marcusDm).toContain('cheap-nudge social camouflage');
    expect(marcusDm).toContain('DM DOSSIER');
  });
});
