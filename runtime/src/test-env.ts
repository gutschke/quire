/**
 * Test-env helpers shared by lazy-chunk loaders.
 *
 * Vitest tears the test env down between files; when a fire-and-
 * forget `void ensureXyzChunk()` lazy-load is still resolving, its
 * inner imports try to load after teardown + reject with
 * `EnvironmentTeardownError`.  That isn't a production failure but
 * vitest surfaces it as an unhandled rejection + exits non-zero.
 *
 * Each lazy-loader attaches an onRejection handler that uses
 * `isVitestTeardownError` to suppress the noise + reset the cache
 * so a subsequent caller retries cleanly.  Real load failures
 * (network errors, syntax errors in the loaded module) still
 * re-throw + surface to the caller.
 *
 * SCOPE (verified 2026-05-28): this set + helper ONLY catch
 * rejections that flow through the lazy-chunk `.then` handlers
 * (ensureWrapModeChunk / ensureMarkdownPipeline) — i.e. dynamic-
 * import rejections.  Adding a name here is a one-line fix for
 * THAT path only.
 *
 * It does NOT catch the separate, intermittent happy-dom
 * `AbortError` / "AsyncTaskManager destroyed" noise: those come
 * from bare `fetch()` calls (campaign / character / context loads
 * hitting raw.githubusercontent) that happy-dom aborts when it
 * tears the window down — they never reach this helper.  That
 * flake can bump the local full-run EXIT CODE on an otherwise-
 * green run, but it's CI-tolerated (all tests still pass).  The
 * only real fix is a global unhandled-rejection filter in a
 * vitest setupFile, which risks masking genuine rejections — not
 * worth it until the flake actually breaks CI.  Do NOT try to
 * "fix" it by adding AbortError to the set below; that won't work.
 */

const KNOWN_TEARDOWN_ERROR_NAMES = new Set<string>([
  'EnvironmentTeardownError'
]);

export function isVitestTeardownError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' && KNOWN_TEARDOWN_ERROR_NAMES.has(name);
}
