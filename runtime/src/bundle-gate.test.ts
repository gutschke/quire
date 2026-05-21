import { describe, it, expect } from 'vitest';
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
