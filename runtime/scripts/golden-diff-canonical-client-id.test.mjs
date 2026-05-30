/**
 * Canonical OAuth client_id baseline + discovery doc golden-diff
 * test (M6a, OP-017g + OP-018).
 *
 * # Why this exists
 *
 * Per DEC-023 + OP-017g: the shipped `client_id` is a security
 * primitive.  An attacker who swaps it for theirs — via
 * compromised Cloudflare deploy, npm package, Underleaf bundle,
 * or a "harmless-looking" PR — makes Quire request OAuth consent
 * against THEIR Google app and steals every save the legitimate
 * client_id had access to (Google's per-app isolation is keyed
 * on the creating client_id).
 *
 * The golden-diff makes every change to:
 *
 *   - `src/auth/canonical-client-id.ts` (build-time baseline)
 *   - `public/.well-known/quire-oauth.json` (CDN discovery doc)
 *
 * LOAD-BEARING.  You cannot edit either file without ALSO
 * updating the golden-diff hash in this test — making the
 * reviewer notice intentional vs. accidental changes.
 *
 * # How to intentionally rotate the canonical client_id
 *
 * See `design/save-restore-program/maintainer-ops.md` for the
 * full rotation runbook.  The short version of the test-side
 * step:
 *
 *   1. Edit src/auth/canonical-client-id.ts + the discovery doc.
 *   2. Run `node scripts/golden-diff-canonical-client-id.test.mjs --update`.
 *   3. Paste the printed hashes into the GOLDEN_HASHES constant
 *      below.
 *   4. Verify the diff in the PR includes BOTH the file changes
 *      AND the hash updates.  Reviewers MUST call out the hash
 *      change in the PR description.
 *
 * # Sister golden-diff: callback page
 *
 * `scripts/golden-diff-callback.test.mjs` is the same pattern
 * for the OAuth callback page.  The two tests together cover
 * the static-asset supply-chain attack surface for cloud sync.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_ROOT = join(__dirname, '..');

const CANONICAL_TS = join(RUNTIME_ROOT, 'src/auth/canonical-client-id.ts');
const DISCOVERY_JSON = join(
  RUNTIME_ROOT,
  'public/.well-known/quire-oauth.json'
);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Golden hashes — update IN THE SAME PR as the file change, and
 * call out the hash change in the PR description.
 */
const GOLDEN_HASHES = {
  // src/auth/canonical-client-id.ts
  canonicalTs:
    '188c055f5a4d35265bfc2df7e7803e3dc4be6f4b8a05775648974c55dbed24e1',
  // public/.well-known/quire-oauth.json
  discoveryJson:
    '4c322645ba2ebe81e6fe9b69d3cc24433783a67a7ac8779661224e6657349e03'
};

describe('Canonical client_id golden-diff (OP-017g)', () => {
  it('src/auth/canonical-client-id.ts exists', () => {
    expect(existsSync(CANONICAL_TS)).toBe(true);
  });

  it('public/.well-known/quire-oauth.json exists', () => {
    expect(existsSync(DISCOVERY_JSON)).toBe(true);
  });

  it('canonical-client-id.ts matches the golden hash', () => {
    const buf = readFileSync(CANONICAL_TS);
    const hash = sha256(buf);
    if (hash !== GOLDEN_HASHES.canonicalTs) {
      throw new Error(
        `Canonical client_id baseline hash changed.\n` +
          `  Expected: ${GOLDEN_HASHES.canonicalTs}\n` +
          `  Actual:   ${hash}\n` +
          `\n` +
          `The file src/auth/canonical-client-id.ts is a security\n` +
          `primitive (DEC-023 class 1 / OP-017g).  Any change must\n` +
          `update the GOLDEN_HASHES constant in\n` +
          `scripts/golden-diff-canonical-client-id.test.mjs to match.\n` +
          `Reviewers: the hash change SHOULD appear in the same PR\n` +
          `as the file change and SHOULD be called out in the PR\n` +
          `description.  See design/save-restore-program/maintainer-ops.md\n` +
          `for the rotation runbook.`
      );
    }
  });

  it('discovery JSON matches the golden hash', () => {
    const buf = readFileSync(DISCOVERY_JSON);
    const hash = sha256(buf);
    if (hash !== GOLDEN_HASHES.discoveryJson) {
      throw new Error(
        `OAuth discovery document hash changed.\n` +
          `  Expected: ${GOLDEN_HASHES.discoveryJson}\n` +
          `  Actual:   ${hash}\n` +
          `\n` +
          `The file public/.well-known/quire-oauth.json is served\n` +
          `as a CDN static asset and acts as an emergency-rotation\n` +
          `channel for the canonical client_id.  Any change must\n` +
          `update the GOLDEN_HASHES constant in\n` +
          `scripts/golden-diff-canonical-client-id.test.mjs.\n` +
          `See DEC-025 + maintainer-ops.md.`
      );
    }
  });
});

describe('Canonical client_id structural defenses', () => {
  it('canonical-client-id.ts exports GOOGLE and GITHUB constants', () => {
    const ts = readFileSync(CANONICAL_TS, 'utf8');
    expect(ts.includes('export const GOOGLE')).toBe(true);
    expect(ts.includes('export const GITHUB')).toBe(true);
  });

  it('canonical-client-id.ts exports assertReadyForOAuth + isReadyForOAuth + resolveClientId', () => {
    const ts = readFileSync(CANONICAL_TS, 'utf8');
    expect(ts.includes('export function assertReadyForOAuth')).toBe(true);
    expect(ts.includes('export function isReadyForOAuth')).toBe(true);
    expect(ts.includes('export function resolveClientId')).toBe(true);
  });

  it('discovery JSON is parseable + has providers.google + providers.github', () => {
    const text = readFileSync(DISCOVERY_JSON, 'utf8');
    const doc = JSON.parse(text);
    expect(doc.providers).toBeTypeOf('object');
    expect(doc.providers.google).toBeTypeOf('object');
    expect(doc.providers.github).toBeTypeOf('object');
    expect(typeof doc.providers.google.client_id).toBe('string');
    expect(typeof doc.providers.google.status).toBe('string');
    expect(typeof doc.providers.google.fingerprint_sha256).toBe('string');
  });

  it('discovery JSON status values are within the known vocabulary', () => {
    // Defense in depth: if a future commit adds a new status
    // value (e.g. 'experimental') without thinking through what
    // the runtime should do with it, this catches the regression
    // at CI time.
    const text = readFileSync(DISCOVERY_JSON, 'utf8');
    const doc = JSON.parse(text);
    const known = new Set(['verified', 'placeholder', 'unavailable']);
    expect(known.has(doc.providers.google.status)).toBe(true);
    expect(known.has(doc.providers.github.status)).toBe(true);
  });

  it('discovery JSON fingerprint is 64 hex chars (SHA-256 length)', () => {
    const text = readFileSync(DISCOVERY_JSON, 'utf8');
    const doc = JSON.parse(text);
    expect(doc.providers.google.fingerprint_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.providers.github.fingerprint_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Optional CLI mode for "I changed the files, recompute the hashes".
// Usage: node scripts/golden-diff-canonical-client-id.test.mjs --update
if (
  import.meta.url.startsWith('file://') &&
  process.argv[1] &&
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv.includes('--update')
) {
  const tsHash = sha256(readFileSync(CANONICAL_TS));
  const jsonHash = sha256(readFileSync(DISCOVERY_JSON));
  console.log('To update GOLDEN_HASHES, set:');
  console.log(`  canonicalTs:   '${tsHash}'`);
  console.log(`  discoveryJson: '${jsonHash}'`);
}
