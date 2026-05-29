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
 *
 * FLAKE POLICY (resolved 2026-05-29, #410 Test-Architect P2).  CI
 * runs `vitest run` with NO escape hatch (ci.yml: `npm test`, no
 * `|| true`, no setupFile filter) — by design.  The apparent tension
 * (a flake that "can bump the exit code" vs. a CI with no tolerance)
 * is resolved by evidence: across the last 100 CI runs this flake has
 * NEVER reddened a build — the only red runs were REAL test failures
 * during active development (commit messages like "fix: N blockers"),
 * each since fixed.  So the decision stands: keep CI strict + do NOT
 * add a global rejection filter (it would mask genuine rejections,
 * the higher cost).  The TRIGGER to revisit is concrete: a CI failure
 * on a commit whose tests otherwise pass (e.g. a docs-only commit on a
 * green branch).  If that happens, add a NARROWLY-scoped setupFile
 * `unhandledRejection` handler keyed to the exact `AbortError` /
 * "AsyncTaskManager destroyed" names WITH a guard that fails if the
 * matched message/shape changes (so it can't silently grow into a
 * catch-all).  Until then, strict CI is the correct, honest posture.
 */

const KNOWN_TEARDOWN_ERROR_NAMES = new Set<string>([
  'EnvironmentTeardownError'
]);

export function isVitestTeardownError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' && KNOWN_TEARDOWN_ERROR_NAMES.has(name);
}
