/**
 * OAuth callback page golden-diff test (M6a, OP-017).
 *
 * The OAuth callback at /auth/google/callback.{html,js} is the
 * most security-critical static page in the deploy.  An attacker
 * who slips an inline script, a remote import, or a postMessage
 * payload change past code review steals every DM's authorization
 * code.
 *
 * Per DEC-023 (zero attack surface from internet randos):
 * unintentional changes to this page are an injection-risk
 * vector even when authored in good faith.  The golden-diff
 * gate makes every change LOAD-BEARING — you can't update the
 * page without ALSO updating the SHA256 fingerprint here.
 *
 * Failure mode the test catches:
 *   - A future PR adds an inline <script> handler to
 *     callback.html.  CSP would block it at runtime; CI catches
 *     the regression at build time so the reviewer notices.
 *   - A future PR changes the postMessage payload shape; the
 *     opener-side validation in (future) auth code drifts out
 *     of sync.  The hash mismatch forces a coordinated update.
 *   - A future PR adds a remote stylesheet import (the new
 *     CSP would block it; the hash catches the intent earlier).
 *
 * To intentionally change the callback page:
 *   1. Edit public/auth/google/callback.html /
 *      public/auth/google/callback.js as needed.
 *   2. Run `node scripts/golden-diff-callback.test.mjs --update`
 *      (or `npm run update-callback-golden` if we add the alias).
 *   3. Verify the diff in the PR includes BOTH the file change
 *      AND the hash update.  Reviewers should explicitly approve
 *      the hash change.
 *
 * The test runs in `npm test` via the vitest include of
 * scripts/**\/*.test.mjs (see vite.config.ts).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_ROOT = join(__dirname, '..');

const CALLBACK_HTML = join(
  RUNTIME_ROOT,
  'public/auth/google/callback.html'
);
const CALLBACK_JS = join(RUNTIME_ROOT, 'public/auth/google/callback.js');
const HEADERS_FILE = join(RUNTIME_ROOT, 'public/_headers');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Golden hashes.  Update IN THE SAME PR as the file change, and
 * call out the hash update in the PR description.
 */
const GOLDEN_HASHES = {
  // public/auth/google/callback.html
  callbackHtml:
    '38e204d3604fd3626c34493541a955e88eeadbbbd33979d8cc6ce20619191ae9',
  // public/auth/google/callback.js
  callbackJs:
    '44ceef51ed55d8c283dc40f32168dbe4ebc7dbe6a673f51f1560b3b66227592a'
};

describe('OAuth callback page golden-diff (OP-017)', () => {
  it('callback.html exists at the expected path', () => {
    expect(existsSync(CALLBACK_HTML)).toBe(true);
  });

  it('callback.js exists at the expected path', () => {
    expect(existsSync(CALLBACK_JS)).toBe(true);
  });

  it('callback.html matches the golden hash', () => {
    const buf = readFileSync(CALLBACK_HTML);
    const hash = sha256(buf);
    if (hash !== GOLDEN_HASHES.callbackHtml) {
      throw new Error(
        `OAuth callback.html hash changed.\n` +
          `  Expected: ${GOLDEN_HASHES.callbackHtml}\n` +
          `  Actual:   ${hash}\n` +
          `\n` +
          `If you intentionally changed the callback page, update\n` +
          `the GOLDEN_HASHES.callbackHtml constant in\n` +
          `scripts/golden-diff-callback.test.mjs to match. Reviewers:\n` +
          `the hash change SHOULD appear in the same PR as the file\n` +
          `change and SHOULD be called out in the PR description.\n` +
          `(See OP-017 / DEC-023 — zero attack surface goal.)`
      );
    }
  });

  it('callback.js matches the golden hash', () => {
    const buf = readFileSync(CALLBACK_JS);
    const hash = sha256(buf);
    if (hash !== GOLDEN_HASHES.callbackJs) {
      throw new Error(
        `OAuth callback.js hash changed.\n` +
          `  Expected: ${GOLDEN_HASHES.callbackJs}\n` +
          `  Actual:   ${hash}\n` +
          `\n` +
          `If you intentionally changed the callback page, update\n` +
          `the GOLDEN_HASHES.callbackJs constant in\n` +
          `scripts/golden-diff-callback.test.mjs to match. Reviewers:\n` +
          `the hash change SHOULD appear in the same PR as the file\n` +
          `change and SHOULD be called out in the PR description.\n` +
          `(See OP-017 / DEC-023 — zero attack surface goal.)`
      );
    }
  });
});

describe('OAuth callback page static defenses', () => {
  it('callback.html contains no inline event handlers', () => {
    const html = readFileSync(CALLBACK_HTML, 'utf8');
    // Reject `onclick=`, `onload=`, etc.  These would violate
    // the strict CSP at runtime; this catches the regression at
    // CI time so a reviewer sees it before deploy.
    const inlineHandler = /\son[a-z]+\s*=/i;
    expect(inlineHandler.test(html)).toBe(false);
  });

  it('callback.html contains no inline <script> body (only external src)', () => {
    const html = readFileSync(CALLBACK_HTML, 'utf8');
    // Allow <script src="..."> but reject <script>...code...</script>.
    // Pattern: an opening <script ...> tag without a `src` attribute
    // followed by any non-empty body before </script>.
    const inlineScript =
      /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/i;
    expect(inlineScript.test(html)).toBe(false);
  });

  it('callback.html references no remote URLs (default-src none)', () => {
    const html = readFileSync(CALLBACK_HTML, 'utf8');
    // Reject http(s):// in any src/href.  Same-origin (no
    // scheme) and relative paths are allowed.
    const remoteRef = /(src|href)\s*=\s*['"]https?:\/\//i;
    expect(remoteRef.test(html)).toBe(false);
  });

  it('callback.js does not import remote modules', () => {
    const js = readFileSync(CALLBACK_JS, 'utf8');
    const remoteImport = /import\s+[^'";]*['"]https?:\/\//i;
    expect(remoteImport.test(js)).toBe(false);
  });

  it('callback.js validates window.opener before postMessage', () => {
    // Sanity check: the production-critical defense is that the
    // page refuses to act if window.opener is null.  A future
    // refactor that removed this would silently leak the code to
    // any tab that loaded the callback directly.
    const js = readFileSync(CALLBACK_JS, 'utf8');
    expect(js.includes('window.opener')).toBe(true);
  });

  it('callback.js uses explicit targetOrigin (not "*")', () => {
    // postMessage with targetOrigin = "*" would leak the auth
    // code to any cross-origin opener.  The code MUST pass
    // window.location.origin explicitly.
    const js = readFileSync(CALLBACK_JS, 'utf8');
    expect(js.includes('window.location.origin')).toBe(true);
    // And does NOT contain the dangerous "*" form.
    const dangerous = /postMessage\([^)]*,\s*['"]\*['"]/;
    expect(dangerous.test(js)).toBe(false);
  });
});

describe('OAuth callback CSP header (deploy-time intent)', () => {
  it('public/_headers has a stricter callback CSP than the global', () => {
    const headers = readFileSync(HEADERS_FILE, 'utf8');
    // The callback-specific rule must precede the wildcard rule
    // because Cloudflare Pages applies the first matching rule
    // per header name.
    const callbackIdx = headers.indexOf('/auth/google/callback');
    const wildcardIdx = headers.indexOf('\n/*\n');
    expect(callbackIdx).toBeGreaterThan(-1);
    expect(wildcardIdx).toBeGreaterThan(callbackIdx);
  });

  it('callback CSP locks default-src to none', () => {
    const headers = readFileSync(HEADERS_FILE, 'utf8');
    // Extract the block between /auth/google/callback and the
    // next blank line.
    const start = headers.indexOf('/auth/google/callback');
    expect(start).toBeGreaterThan(-1);
    const end = headers.indexOf('\n\n', start);
    const block = headers.slice(start, end === -1 ? undefined : end);
    expect(block).toMatch(/default-src 'none'/);
    expect(block).toMatch(/script-src 'self'/);
    expect(block).toMatch(/connect-src 'none'/);
    expect(block).toMatch(/frame-ancestors 'none'/);
  });
});

// Optional CLI mode for "I changed the page, recompute the hash".
// Usage: node scripts/golden-diff-callback.test.mjs --update
if (
  import.meta.url.startsWith('file://') &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv.includes('--update')
) {
  const htmlHash = sha256(readFileSync(CALLBACK_HTML));
  const jsHash = sha256(readFileSync(CALLBACK_JS));
  console.log('To update GOLDEN_HASHES, set:');
  console.log(`  callbackHtml: '${htmlHash}'`);
  console.log(`  callbackJs:   '${jsHash}'`);
}
