#!/usr/bin/env node
/**
 * Bundle-size gate runner (P0-7).
 *
 * Reads dist/assets/*.js, gzip-compresses each, classifies by
 * filename, and exits non-zero on cap violation.  The classification
 * and check logic is duplicated from `src/bundle-gate.ts` (which is
 * unit-tested in `src/bundle-gate.test.ts`) — the duplication is
 * deliberate.  This script must work in a plain Node process
 * without a TS toolchain so CI can run it after `npm run build`.
 *
 * If you change a constant or the classification regex here, also
 * update src/bundle-gate.ts and its tests (they encode the contract).
 *
 * Usage:
 *   npm run build
 *   npm run check-bundle
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST_ASSETS = 'dist/assets';
const MAIN_CHUNK_CAP_BYTES = 150 * 1024;
const AUTHORING_CHUNK_CAP_BYTES = 200 * 1024;

function classifyChunk(filename) {
  const base = filename.replace(/^.*\//, '');
  if (/^index-[A-Za-z0-9_-]+\.js$/.test(base)) return 'main';
  if (/^authoring-[A-Za-z0-9_-]+\.js$/.test(base)) return 'authoring';
  return 'other';
}

function capFor(kind) {
  if (kind === 'main') return MAIN_CHUNK_CAP_BYTES;
  if (kind === 'authoring') return AUTHORING_CHUNK_CAP_BYTES;
  return null;
}

if (!existsSync(DIST_ASSETS)) {
  console.error(
    `bundle-gate: ${DIST_ASSETS}/ not found.  Run \`npm run build\` first.`
  );
  process.exit(2);
}

const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error(`bundle-gate: no .js files found in ${DIST_ASSETS}/.`);
  process.exit(2);
}

const chunks = files.map((f) => {
  const filepath = join(DIST_ASSETS, f);
  const raw = readFileSync(filepath);
  // Use gzip level 9 to match Vite's reported gzip size (Vite uses
  // rollup-plugin-gzip's max compression).  Node's default level 6
  // reports ~1.5 KB looser than the production CDN-served size.
  // Aligning here so the gate measures what users actually pay.
  const gz = gzipSync(raw, { level: 9 });
  return {
    filename: f,
    gzipBytes: gz.length,
    kind: classifyChunk(f)
  };
});

// Inventory log (useful in CI).
console.log('Bundle inventory (gzipped):');
for (const c of chunks) {
  const kb = (c.gzipBytes / 1024).toFixed(2);
  console.log(`  [${c.kind.padEnd(9)}] ${c.filename.padEnd(40)} ${kb} KB`);
}

const violations = [];
for (const c of chunks) {
  const cap = capFor(c.kind);
  if (cap === null) continue;
  if (c.gzipBytes > cap) {
    violations.push({ ...c, capBytes: cap, overBy: c.gzipBytes - cap });
  }
}

if (violations.length > 0) {
  console.error('');
  console.error('Bundle-size gate failed:');
  for (const v of violations) {
    const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
    console.error(
      `  ${v.kind} chunk ${v.filename}: ${kb(v.gzipBytes)} ` +
        `> cap ${kb(v.capBytes)} (over by ${kb(v.overBy)})`
    );
  }
  process.exit(1);
}
console.log('');
console.log('bundle-gate: OK');
