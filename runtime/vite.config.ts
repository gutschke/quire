/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { execSync } from 'node:child_process';

/**
 * Build-time version stamp.  Used by the runtime to render a discrete
 * corner badge so a user can tell at a glance which build Cloudflare
 * has deployed.  Format: "<commit-sha>" plus a "+dirty(N:firstFile)"
 * suffix when the working tree has uncommitted changes to TRACKED
 * files.
 *
 * Pass `--untracked-files=no` so files Cloudflare's build environment
 * generates (`.wrangler/`, transient build artifacts) don't trigger a
 * perpetual "+dirty" on every deploy.  Tracked-file mods still count
 * — that's the signal we actually care about.
 *
 * Diagnostic suffix (2026-05-23): when dirty fires, surface the
 * first modified file's path + total count so we can debug what
 * Cloudflare's build is touching.  Format: `+dirty(3:src/foo.ts)`.
 * Previous "+dirty" was opaque — couldn't tell whether it was
 * legitimate (developer forgot to push) or noise (build env
 * artifact).  Cap the file path to avoid bloating the badge.
 */
function readVersionStamp(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim();
    // Cloudflare's `npm install` step rewrites package-lock.json
    // during the build (lockfile content-hash differs from what
    // we have locally even when versions match).  Live-confirmed
    // 2026-05-23: the diagnostic showed `+dirty(1:package-lock.json)`
    // on a freshly-deployed clean commit.  Exclude the lockfile
    // from the dirty check — its mutations are build-env noise,
    // not developer-source-of-truth changes.
    const dirtyOut = execSync(
      "git status --porcelain --untracked-files=no -- . ':!package-lock.json'",
      { cwd: __dirname }
    )
      .toString()
      .trim();
    if (dirtyOut.length === 0) return sha;
    const lines = dirtyOut.split('\n');
    // Porcelain format: "XY <path>" (XY is the 2-char status code).
    const first = lines[0]?.slice(3).trim() ?? '';
    const firstShort = first.length > 30 ? first.slice(0, 27) + '…' : first;
    return `${sha}+dirty(${lines.length}:${firstShort})`;
  } catch {
    return 'unknown';
  }
}

// @cloudflare/vite-plugin transitively depends on wrangler/undici which
// requires Node 20+ for its globalThis.File reference.  We only need the
// plugin when actually building for Cloudflare's deploy environment, where
// CF_PAGES=1 is set automatically.  Local development on Node 18 builds
// fine without it (the output is a plain static SPA either way).
const plugins: Plugin[] = [];
if (process.env.CF_PAGES === '1') {
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  plugins.push(cloudflare());
}

export default defineConfig({
  plugins,
  define: {
    __QUIRE_VERSION__: JSON.stringify(readVersionStamp()),
    __QUIRE_BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: {
    target: 'es2022',
    sourcemap: true
  },
  publicDir: 'public',
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    globals: false
  }
});
