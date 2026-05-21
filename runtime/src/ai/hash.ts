/**
 * Hashing helpers for the AI audit chain (M3b.3).
 *
 * Wraps the platform's Web Crypto sha256 with the same shape used
 * by per-paragraph block hashes (markdown.ts) — full 64-hex output
 * plus a short-form 16-hex variant for event payloads.  Single
 * source of truth so a future hash-length change (or a fallback
 * impl on insecure contexts) lives in one place.
 */

import { CryptoUnavailableError } from '../markdown';

/** Full 64-hex sha256 of an input string. */
export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new CryptoUnavailableError();
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Short-form 16-hex hash for event payloads.  Same first-N-chars
 * convention as `blockHash` in markdown.ts — see redesign-plan.md
 * `BLOCK_HASH_LENGTH = 16`.
 */
export function sha256HexShort(fullHex: string): string {
  return fullHex.slice(0, 16);
}
