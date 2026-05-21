/**
 * AI audit chain helpers (M3b.3, P2-7).
 *
 * The on-event-log audit is a hash chain: each `ai-response` event
 * carries `prevHash` linking it to the previous response in the
 * chain (or empty for the first).  This module owns the hashing +
 * chain-head bookkeeping the broker uses when emitting events.
 *
 * Full prompt / response text lives in IndexedDB on the DM's
 * machine, keyed by hash.  Events only carry the hash, the chain
 * link, and the token counts — so:
 *   - players who somehow re-materialize a DM-only event still
 *     can't reconstruct the prompt or response text;
 *   - the event log stays small (audit chain heads are tiny).
 *
 * After coord handoff, the new coord reads the chain head from
 * `state.aiAudit` (the last response entry) and appends from
 * there — single appender, strict chain.
 */

import { sha256Hex, sha256HexShort } from './hash';
import type { AiAuditEntry } from '../core/state';

/**
 * Compute the prompt hash used in ai-prompt event payloads + the
 * IndexedDB key for the full prompt text.  Per redesign-plan.md
 * the on-event hash is the 16-hex first-N-chars; the IndexedDB
 * key uses the full 64-char to make collisions vanishingly
 * unlikely even with millions of entries.
 */
export async function promptHashFor(
  prompt: string,
  model: string,
  contextRefs: string[]
): Promise<{ short: string; full: string }> {
  // Include model + contextRefs in the hash so identical prompts
  // issued against different model / context resolve to distinct
  // audit rows (a UX requirement — otherwise the DM can't tell
  // which exchange produced which response).
  const material = [
    'prompt',
    model,
    JSON.stringify(contextRefs ?? []),
    prompt
  ].join('\0');
  const full = await sha256Hex(material);
  return { short: sha256HexShort(full), full };
}

/**
 * Compute the response hash.  The broker hashes the full provider
 * response text (raw); the event's `hash` field is the short form,
 * the IndexedDB key uses the full form.
 */
export async function responseHashFor(
  raw: string
): Promise<{ short: string; full: string }> {
  const full = await sha256Hex('response\0' + raw);
  return { short: sha256HexShort(full), full };
}

/**
 * Read the current chain head from `aiAudit`.  Returns the most
 * recent response entry's responseHash, or an empty string when
 * the chain is unstarted (first response in the session).
 *
 * Skips accept/reject entries — they don't extend the chain.
 */
export function chainHead(aiAudit: readonly AiAuditEntry[]): string {
  for (let i = aiAudit.length - 1; i >= 0; i--) {
    const e = aiAudit[i];
    if (e.kind === 'response' && e.responseHash) {
      return e.responseHash;
    }
  }
  return '';
}
