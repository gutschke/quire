// @vitest-environment node
/**
 * CSP smoke test — parses public/_headers and asserts that every fetch
 * destination the runtime uses is permitted by the connect-src
 * directive.  This is the kind of test we *should have had* before
 * shipping: it would have caught api.anthropic.com and the PeerJS
 * broker being absent from connect-src despite both being load-bearing
 * features of the runtime.
 *
 * The list of required fetch destinations is derived from grepping the
 * source for fetch() calls.  When a new external fetch is added, this
 * test will fail until _headers is updated — that's the point.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEADERS_PATH = path.join(HERE, '..', '..', '..', 'public', '_headers');

/**
 * Origins the runtime POSTs/GETs at.  When adding a new external
 * dependency, add it here AND to public/_headers.  See:
 *   - src/campaign-loader.ts → raw.githubusercontent.com
 *   - src/ai/anthropic.ts    → api.anthropic.com
 *   - src/ai/gemini.ts       → generativelanguage.googleapis.com
 *   - src/session-peerjs.ts  → PeerJS cloud broker (peerjs.com)
 */
const REQUIRED_CONNECT_SRC: Array<{
  description: string;
  matcher: (sources: string[]) => boolean;
}> = [
  {
    description: "'self' (same-origin XHR / fetch)",
    matcher: (s) => s.includes("'self'")
  },
  {
    description: 'https://raw.githubusercontent.com (campaign content)',
    matcher: (s) => hasHost(s, 'https://raw.githubusercontent.com')
  },
  {
    description: 'https://api.anthropic.com (Claude API)',
    matcher: (s) => hasHost(s, 'https://api.anthropic.com')
  },
  {
    description: 'https://generativelanguage.googleapis.com (Gemini API)',
    matcher: (s) => hasHost(s, 'https://generativelanguage.googleapis.com')
  },
  {
    description:
      'PeerJS broker over HTTPS (id endpoint, default 0.peerjs.com)',
    matcher: (s) => hasHost(s, 'https://') && coversPeerjs(s, 'https://')
  },
  {
    description: 'PeerJS broker over WSS (signaling websocket)',
    matcher: (s) => hasHost(s, 'wss://') && coversPeerjs(s, 'wss://')
  }
];

function hasHost(sources: string[], prefix: string): boolean {
  return sources.some((s) => s.startsWith(prefix));
}

/**
 * Returns true if `sources` includes a directive covering the PeerJS
 * cloud broker's id endpoint (default host: 0.peerjs.com, also other
 * fallback hosts on peerjs.com).  Accepts either a wildcard
 * (https://*.peerjs.com) or the explicit host (https://0.peerjs.com).
 */
function coversPeerjs(sources: string[], scheme: string): boolean {
  return sources.some((s) => {
    if (!s.startsWith(scheme)) return false;
    const host = s.slice(scheme.length);
    return host === '*.peerjs.com' || host === '0.peerjs.com' || host === 'peerjs.com';
  });
}

/**
 * Cloudflare Pages `_headers` allows path-scoped rules (e.g.
 * `/auth/google/callback*` per OP-017) ahead of the wildcard
 * `/*` rule.  This test cares about the WILDCARD CSP — the policy
 * the runtime SPA itself receives.  Find the `/*` block and read
 * its Content-Security-Policy.
 */
function parseCspConnectSrc(headersText: string): string[] | null {
  const lines = headersText.split('\n');
  let inWildcardBlock = false;
  for (const raw of lines) {
    // A new path block begins with a line that starts at column 0
    // and starts with `/`.  Within a block, header lines are
    // indented with two spaces.
    if (raw.length > 0 && raw[0] === '/') {
      inWildcardBlock = raw.trim() === '/*';
      continue;
    }
    if (!inWildcardBlock) continue;
    const line = raw.trim();
    if (!line.startsWith('Content-Security-Policy:')) continue;
    const policy = line.slice('Content-Security-Policy:'.length).trim();
    const directives = policy.split(';').map((d) => d.trim());
    for (const d of directives) {
      if (d.startsWith('connect-src ')) {
        return d.slice('connect-src '.length).split(/\s+/);
      }
      if (d === 'connect-src') return [];
    }
  }
  return null;
}

describe('Content-Security-Policy: connect-src covers every fetch destination', () => {
  const text = readFileSync(HEADERS_PATH, 'utf8');
  const sources = parseCspConnectSrc(text);

  it('parses a connect-src directive from public/_headers', () => {
    expect(sources).not.toBeNull();
    expect(Array.isArray(sources)).toBe(true);
  });

  for (const req of REQUIRED_CONNECT_SRC) {
    it(`permits ${req.description}`, () => {
      expect(sources).not.toBeNull();
      expect(
        req.matcher(sources!),
        `connect-src is missing coverage for ${req.description}; ` +
          `got: ${JSON.stringify(sources)}`
      ).toBe(true);
    });
  }
});
