import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  classifyChunk,
  checkBundleSize,
  formatViolations,
  MAIN_CHUNK_CAP_BYTES,
  AUTHORING_CHUNK_CAP_BYTES
} from './bundle-gate';

describe('classifyChunk', () => {
  it('matches index-<hash>.js as the main chunk', () => {
    expect(classifyChunk('index-DLfCh986.js')).toBe('main');
    expect(classifyChunk('assets/index-Bkq_xprm.js')).toBe('main');
    expect(classifyChunk('dist/assets/index-AEofNghq.js')).toBe('main');
  });

  it('matches authoring-<hash>.js as the authoring chunk', () => {
    expect(classifyChunk('authoring-abc123.js')).toBe('authoring');
    expect(classifyChunk('dist/assets/authoring-XYZ_dash-9.js')).toBe('authoring');
  });

  it('classifies other chunks as "other"', () => {
    expect(classifyChunk('bundler-C_ZWe5WE.js')).toBe('other');
    expect(classifyChunk('vendor-abc.js')).toBe('other');
    expect(classifyChunk('chunk-something.js')).toBe('other');
  });

  it('rejects index without hash (e.g. accidental rename to "index.js")', () => {
    // Without the hash, the manifest doesn't reliably identify the
    // built artifact; treat as other so the runner errors with
    // "no main chunk found" rather than misclassifying.
    expect(classifyChunk('index.js')).toBe('other');
  });
});

describe('checkBundleSize', () => {
  it('passes when all chunks are within their caps', () => {
    const r = checkBundleSize([
      { filename: 'index-abc.js', gzipBytes: 60 * 1024, kind: 'main' },
      { filename: 'authoring-xyz.js', gzipBytes: 100 * 1024, kind: 'authoring' }
    ]);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('fails when the main chunk is over the cap', () => {
    const r = checkBundleSize([
      { filename: 'index-abc.js', gzipBytes: MAIN_CHUNK_CAP_BYTES + 1, kind: 'main' }
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].kind).toBe('main');
    expect(r.violations[0].overBy).toBe(1);
  });

  it('fails when the authoring chunk is over the cap', () => {
    const r = checkBundleSize([
      {
        filename: 'authoring-abc.js',
        gzipBytes: AUTHORING_CHUNK_CAP_BYTES + 100,
        kind: 'authoring'
      }
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations[0].kind).toBe('authoring');
    expect(r.violations[0].overBy).toBe(100);
  });

  it('ignores "other" chunks (no cap applied)', () => {
    const r = checkBundleSize([
      // 1 MB vendor chunk — still passes because it's not main/authoring.
      { filename: 'bundler.js', gzipBytes: 1_000_000, kind: 'other' }
    ]);
    expect(r.ok).toBe(true);
  });

  it('reports multiple violations independently', () => {
    const r = checkBundleSize([
      { filename: 'index-x.js', gzipBytes: MAIN_CHUNK_CAP_BYTES + 50, kind: 'main' },
      {
        filename: 'authoring-y.js',
        gzipBytes: AUTHORING_CHUNK_CAP_BYTES + 200,
        kind: 'authoring'
      }
    ]);
    expect(r.violations).toHaveLength(2);
  });

  it('the gate is regression-protected: synthesizing a 110001-byte main chunk fails', () => {
    // This is the test the plan calls out — the gate must trigger on
    // exactly-over-cap input so a future PR can't silently disable
    // it via a typo in classifyChunk or the cap constant.
    const r = checkBundleSize([
      { filename: 'index-x.js', gzipBytes: 110 * 1024 + 1, kind: 'main' }
    ]);
    expect(r.ok).toBe(false);
  });

  it('exactly-at-cap passes (boundary)', () => {
    const r = checkBundleSize([
      { filename: 'index-x.js', gzipBytes: MAIN_CHUNK_CAP_BYTES, kind: 'main' }
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('bundle-gate.mjs runner — drift protection (regression-protected)', () => {
  // The check-bundle-size.mjs runner duplicates the cap constants
  // and the classification regex from bundle-gate.ts (the runner
  // must work in a plain Node process without a TS toolchain).
  // The duplication is documented as deliberate, but without an
  // enforcement test a future PR could bump the cap in one place
  // and leave the other stale, silently downgrading the gate.
  //
  // This test reads the .mjs source and asserts the duplicated
  // constants match the TS source.

  const here = dirname(fileURLToPath(import.meta.url));
  const mjsPath = resolve(here, '../scripts/check-bundle-size.mjs');
  const mjsSource = readFileSync(mjsPath, 'utf8');

  it('exposes MAIN_CHUNK_CAP_BYTES with the same value as bundle-gate.ts', () => {
    // Match either `const MAIN_CHUNK_CAP_BYTES = N * 1024` or a
    // direct byte-literal, then compare to the TS source of truth.
    const match = mjsSource.match(
      /const\s+MAIN_CHUNK_CAP_BYTES\s*=\s*(\d+)\s*\*\s*1024/
    );
    expect(match, 'MAIN_CHUNK_CAP_BYTES not found in runner').not.toBeNull();
    const kb = Number(match![1]);
    expect(kb * 1024).toBe(MAIN_CHUNK_CAP_BYTES);
  });

  it('exposes AUTHORING_CHUNK_CAP_BYTES with the same value as bundle-gate.ts', () => {
    const match = mjsSource.match(
      /const\s+AUTHORING_CHUNK_CAP_BYTES\s*=\s*(\d+)\s*\*\s*1024/
    );
    expect(match, 'AUTHORING_CHUNK_CAP_BYTES not found in runner').not.toBeNull();
    const kb = Number(match![1]);
    expect(kb * 1024).toBe(AUTHORING_CHUNK_CAP_BYTES);
  });

  it('uses the same classification regex pattern for "main"', () => {
    // The TS regex is /^index-[A-Za-z0-9_-]+\.js$/ (after stripping path).
    // The .mjs duplicates the same regex literal.  Assert it appears.
    expect(mjsSource).toMatch(
      /\/\^index-\[A-Za-z0-9_-\]\+\\\.js\$\//
    );
  });

  it('uses the same classification regex pattern for "authoring"', () => {
    expect(mjsSource).toMatch(
      /\/\^authoring-\[A-Za-z0-9_-\]\+\\\.js\$\//
    );
  });

  it('runner exits with non-zero on cap violation (synthetic smoke check)', () => {
    // Sanity: the runner's violation path uses process.exit(1).
    // Verify the literal appears, so a refactor that drops it shows up.
    expect(mjsSource).toContain('process.exit(1)');
    // And the missing-dist path uses exit(2).
    expect(mjsSource).toContain('process.exit(2)');
  });
});

describe('formatViolations', () => {
  it('returns empty string on ok result', () => {
    expect(formatViolations({ ok: true, violations: [] })).toBe('');
  });

  it('formats a human-readable banner per violation', () => {
    const out = formatViolations({
      ok: false,
      violations: [
        {
          kind: 'main',
          filename: 'index-abc.js',
          gzipBytes: 120 * 1024,
          capBytes: 110 * 1024,
          overBy: 10 * 1024
        }
      ]
    });
    expect(out).toContain('Bundle-size gate failed');
    expect(out).toContain('main chunk index-abc.js');
    expect(out).toContain('120.0KB');
    expect(out).toContain('cap 110.0KB');
    expect(out).toContain('over by 10.0KB');
  });
});
