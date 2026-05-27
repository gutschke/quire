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
 * When a new vitest error name shows up post-teardown (e.g.
 * `AbortError` from a transitively-aborted fetch), add it to
 * KNOWN_TEARDOWN_ERROR_NAMES — a one-line fix in one place.
 */

const KNOWN_TEARDOWN_ERROR_NAMES = new Set<string>([
  'EnvironmentTeardownError'
]);

export function isVitestTeardownError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' && KNOWN_TEARDOWN_ERROR_NAMES.has(name);
}
