/**
 * Bundle-size gate (P0-7).
 *
 * Enforces the M1+ contract: the in-session bundle's main chunk
 * stays ≤ 110 KB gzipped; the authoring lazy chunk stays ≤ 150 KB.
 * Failing the gate fails CI, so a regression in tree-shaking, an
 * accidental large import, or an in-session pull of CodeMirror is
 * caught at PR time rather than after merge.
 *
 * The gate is intentionally implemented as a pure function the
 * `scripts/check-bundle-size.mjs` runner calls, so its behavior is
 * regression-protected by `src/bundle-gate.test.ts` — without that,
 * a future PR could silently disable the runner script and the
 * caps would erode invisibly.
 *
 * Caps (gzipped, in bytes):
 *   - main chunk:      110 KB  (in-session bundle for player + DM)
 *   - authoring chunk: 150 KB  (lazy-loaded CodeMirror + form + lint)
 *
 * The runner identifies chunks by filename pattern (main chunk: any
 * file matching index-*.js; authoring chunk: any file matching
 * authoring-*.js — naming convention pinned by Vite's
 * rollupOptions.output.manualChunks once authoring lands in M5).
 *
 * Spec: `quire/runtime/design/redesign-plan.md` § "Bundle budget"
 * and `execution-plan.md` § "Cross-cutting expectations".
 */

export const MAIN_CHUNK_CAP_BYTES = 110 * 1024; // 110 KB gzipped
export const AUTHORING_CHUNK_CAP_BYTES = 150 * 1024; // 150 KB gzipped

export type ChunkKind = 'main' | 'authoring' | 'other';

export interface ChunkSizeInfo {
  filename: string;
  gzipBytes: number;
  kind: ChunkKind;
}

export interface BundleGateResult {
  ok: boolean;
  violations: Array<{
    kind: ChunkKind;
    filename: string;
    gzipBytes: number;
    capBytes: number;
    overBy: number;
  }>;
}

/**
 * Classify a built chunk filename into its budget bucket.  Pattern-
 * matches the Vite output convention (`index-<hash>.js`,
 * `authoring-<hash>.js`).  Unknown chunks are 'other' and not
 * checked.
 */
export function classifyChunk(filename: string): ChunkKind {
  // Strip leading dirs / assets/ prefix.
  const base = filename.replace(/^.*\//, '');
  if (/^index-[A-Za-z0-9_-]+\.js$/.test(base)) return 'main';
  if (/^authoring-[A-Za-z0-9_-]+\.js$/.test(base)) return 'authoring';
  return 'other';
}

/**
 * Run the gate over a list of chunk-size records.  Returns
 * `{ ok, violations }`.  `ok` is true iff every checked chunk fits
 * its cap.
 */
export function checkBundleSize(chunks: ChunkSizeInfo[]): BundleGateResult {
  const violations: BundleGateResult['violations'] = [];
  for (const chunk of chunks) {
    let cap: number;
    if (chunk.kind === 'main') cap = MAIN_CHUNK_CAP_BYTES;
    else if (chunk.kind === 'authoring') cap = AUTHORING_CHUNK_CAP_BYTES;
    else continue; // 'other' chunks (bundler vendor split, etc.) aren't checked
    if (chunk.gzipBytes > cap) {
      violations.push({
        kind: chunk.kind,
        filename: chunk.filename,
        gzipBytes: chunk.gzipBytes,
        capBytes: cap,
        overBy: chunk.gzipBytes - cap
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Format a human-readable banner for the violations.  Used by the
 * runner script's stderr output.
 */
export function formatViolations(result: BundleGateResult): string {
  if (result.ok) return '';
  const lines: string[] = ['Bundle-size gate failed:'];
  for (const v of result.violations) {
    const kb = (n: number): string => `${(n / 1024).toFixed(1)}KB`;
    lines.push(
      `  ${v.kind} chunk ${v.filename}: ${kb(v.gzipBytes)} ` +
        `> cap ${kb(v.capBytes)} (over by ${kb(v.overBy)})`
    );
  }
  return lines.join('\n');
}
