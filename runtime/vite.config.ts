/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

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
  build: {
    target: 'es2022',
    sourcemap: true
  },
  publicDir: 'public',
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: false
  }
});
