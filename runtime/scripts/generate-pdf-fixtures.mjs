#!/usr/bin/env node
/**
 * Generate the 5 fixture PDFs (player + DM audiences each) to
 * /home/markus/src/ttrpg/tmp/pdf-out/.  Used by the inspection
 * harness and the firewall regression test.
 *
 * Run from runtime/:
 *   node scripts/generate-pdf-fixtures.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use ts-node-style on-the-fly via Vite's loader?  Simpler: use
// the tsx loader if it's installed, else compile fixtures.ts +
// print-pc*.ts ahead of time.  We have neither — so use Node's
// experimental loader via `--import=tsx/esm` invocation.  But to
// keep this script self-contained, we'll do it via dynamic
// import after registering the tsx hook if available.

try {
  register('tsx/esm', pathToFileURL('./'));
} catch {
  // Fall back to a child process below.
  console.error('tsx loader not available; trying via vitest runner instead.');
  process.exit(2);
}

const { renderPcPdf } = await import('../src/pdf/print-pc.ts');
const { ALL_FIXTURES } = await import('../src/pdf/print-pc-fixtures.ts');

const outDir = '/home/markus/src/ttrpg/tmp/pdf-out';
await mkdir(outDir, { recursive: true });

for (const pc of ALL_FIXTURES) {
  const slug = pc.name.replace(/[^\w]+/g, '_').toLowerCase();
  for (const audience of ['player', 'dm']) {
    const bytes = await renderPcPdf(pc, { audience, pageSize: 'A4' });
    const out = join(outDir, `${slug}-${audience}.pdf`);
    await writeFile(out, bytes);
    console.log(`wrote ${out}  (${bytes.byteLength.toLocaleString()} bytes)`);
  }
}
