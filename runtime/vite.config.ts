/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { execSync } from 'node:child_process';

/**
 * Build-time version stamp.  Used by the runtime to render a discrete
 * corner badge so a user can tell at a glance which build Cloudflare
 * has deployed.  Format: "<commit-sha>" plus a "+dirty" suffix when
 * the working tree has uncommitted changes.
 */
function readVersionStamp(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim();
    const dirty =
      execSync('git status --porcelain', { cwd: __dirname }).toString().trim()
        .length > 0;
    return dirty ? `${sha}+dirty` : sha;
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
