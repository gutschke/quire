/**
 * CC-3 / F1 (M4 char-creation): invite-token encoder/decoder.
 *
 * **Threat-model framing.**  Per `prioritized-backlog.md` §"Phase 2
 * design notes", invite tokens are UNSIGNED base64url-encoded JSON.
 * The payload carries `{slot, issuedAt, campaignFingerprint}` and
 * deliberately omits `archetypeHint` / `displayHint` — those leak
 * DM intent if the URL is screenshot / forwarded, which is the
 * accidental-DM-disclosure attack the project's threat model
 * cares about.  The DM communicates archetype hints in the email
 * body alongside the URL.
 *
 * What an outsider with a token URL can do:
 *   - Start chargen locally (no impact — their data stays on their
 *     device unless the DM imports the resulting "pack my character"
 *     file at session 1; the DM has full social-engineering control
 *     over which tokens land at the table).
 *   - See which slot the token addresses (low-information leak; the
 *     DM probably told the intended recipient anyway).
 *
 * What an outsider CANNOT do:
 *   - Impersonate a player at the table — the DM physically imports
 *     each pack-file or paste-token at session 1; an outsider's
 *     local state never reaches the DM's machine.
 *   - Modify the campaign — the chargen flow doesn't write to the
 *     campaign repo.
 *
 * **Expiry.**  Tokens carry `issuedAt` (epoch ms); the validator
 * accepts tokens up to `DEFAULT_MAX_AGE_MS` past `issuedAt`.
 * Expired tokens prompt the player to ask the DM for a fresh link.
 *
 * **Cross-campaign protection.**  Tokens carry a
 * `campaignFingerprint` derived from the campaign's `{owner, repo, ref}`
 * — at decode time the validator confirms the fingerprint matches
 * the currently-loaded campaign.  Prevents the accidental "paste
 * the wrong invite link into the wrong campaign" failure mode.
 *
 * This module is intentionally narrow: encode, decode, validate.
 * The DM-side ledger (which slot the DM has issued tokens for) and
 * the player-side IndexedDB key (`{campaignSlug}:{slotIndex}`)
 * live elsewhere.
 */

/**
 * Payload shape of an invite token.  Mirror this in `routing.ts`'s
 * `kind: 'character-creation'` consumer.
 */
export interface InviteTokenPayload {
  /** Slot number in [1, 9].  Matches `state.pcSlots` keys. */
  slot: number;
  /** Epoch ms when the DM issued this token. */
  issuedAt: number;
  /**
   * Campaign fingerprint: short opaque hash of `{owner, repo, ref}`.
   * The decoder cross-checks against the loaded campaign so a
   * stray paste into the wrong campaign fails closed.
   */
  campaignFingerprint: string;
}

/**
 * Default token lifetime: 30 days.  Override at decode time when
 * the campaign has a different policy.  Long enough to send invites
 * a few weeks before session 1; short enough that old links don't
 * float around indefinitely.
 */
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Bounds on the slot value (matches `state.pcSlots` and the
 * `{{pc:N}}` substitution range).  Out-of-bounds slots are rejected.
 */
const MIN_SLOT = 1;
const MAX_SLOT = 9;

/**
 * Cap on raw fingerprint length.  Fingerprints are short
 * hex/base32 strings (~12-16 chars); 64 is generous.  Bound
 * defensively against a hostile payload trying to bloat the
 * structure.
 */
const MAX_FINGERPRINT_LEN = 64;

/**
 * Errors decode() may throw.  Callers catch + surface as a friendly
 * "this invite link is invalid / expired / for a different campaign"
 * banner per the F2 critique finding.
 */
export class InviteTokenError extends Error {
  override readonly name = 'InviteTokenError';
  constructor(
    public readonly code:
      | 'malformed'
      | 'expired'
      | 'campaign-mismatch'
      | 'invalid-slot',
    message: string
  ) {
    super(message);
  }
}

/**
 * Compute a stable, opaque-ish fingerprint for a campaign source.
 * Not cryptographic — purely a "did the URL get pasted into the
 * wrong campaign" check.  djb2 hash truncated to 12 hex chars
 * (~48 bits).  Independent of the platform's crypto.subtle
 * availability so it works in insecure-context contexts.
 */
export function campaignFingerprint(source: {
  owner: string;
  repo: string;
  ref: string;
}): string {
  const input = `${source.owner}/${source.repo}@${source.ref}`;
  // djb2 — h = h * 33 + ch; classic non-crypto hash.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // Force into unsigned 32-bit and pad.  Then concatenate a
  // second pass over the input (offset by half its length) so
  // we get 48 bits of distinguishing power, not 32.
  const h1 = (h >>> 0).toString(16).padStart(8, '0');
  let h2 = 5381;
  const half = Math.floor(input.length / 2);
  for (let i = 0; i < input.length; i++) {
    h2 = (h2 * 33) ^ input.charCodeAt((i + half) % input.length);
  }
  const h2Str = ((h2 >>> 0) & 0xffff).toString(16).padStart(4, '0');
  return `${h1}${h2Str}`;
}

/**
 * Encode an invite-token payload into a URL-safe string.  Uses
 * base64url (no `=` padding) so the token sits cleanly in a query
 * parameter.
 */
export function encodeInviteToken(payload: InviteTokenPayload): string {
  if (!Number.isInteger(payload.slot)) {
    throw new InviteTokenError(
      'invalid-slot',
      `Invite slot must be an integer; got ${payload.slot}`
    );
  }
  if (payload.slot < MIN_SLOT || payload.slot > MAX_SLOT) {
    throw new InviteTokenError(
      'invalid-slot',
      `Invite slot must be in [${MIN_SLOT}, ${MAX_SLOT}]; got ${payload.slot}`
    );
  }
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

/**
 * Decode + validate an invite token.  Returns the parsed payload on
 * success; throws `InviteTokenError` with a typed `code` for the
 * various failure modes.
 *
 * - `malformed` — base64url decode failed, JSON parse failed, or
 *   required fields are missing / wrong-typed.
 * - `expired` — `now - issuedAt > maxAgeMs`.
 * - `campaign-mismatch` — `expectedFingerprint` (when provided)
 *   doesn't match the token's `campaignFingerprint`.
 * - `invalid-slot` — slot is non-integer or out of [1, 9].
 */
export function decodeInviteToken(
  raw: string,
  options: {
    expectedFingerprint?: string;
    nowMs?: number;
    maxAgeMs?: number;
  } = {}
): InviteTokenPayload {
  const now = options.nowMs ?? Date.now();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  let json: string;
  try {
    json = fromBase64Url(raw);
  } catch {
    throw new InviteTokenError('malformed', 'Invite token is not valid base64.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InviteTokenError(
      'malformed',
      'Invite token payload is not valid JSON.'
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new InviteTokenError(
      'malformed',
      'Invite token payload must be a JSON object.'
    );
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.slot !== 'number' || !Number.isInteger(p.slot)) {
    throw new InviteTokenError(
      'invalid-slot',
      'Invite token slot must be an integer.'
    );
  }
  if (p.slot < MIN_SLOT || p.slot > MAX_SLOT) {
    throw new InviteTokenError(
      'invalid-slot',
      `Invite token slot is out of range [${MIN_SLOT}, ${MAX_SLOT}].`
    );
  }
  if (typeof p.issuedAt !== 'number' || !Number.isFinite(p.issuedAt)) {
    throw new InviteTokenError(
      'malformed',
      'Invite token issuedAt must be a finite number.'
    );
  }
  if (
    typeof p.campaignFingerprint !== 'string' ||
    p.campaignFingerprint.length === 0 ||
    p.campaignFingerprint.length > MAX_FINGERPRINT_LEN
  ) {
    throw new InviteTokenError(
      'malformed',
      'Invite token campaignFingerprint must be a non-empty short string.'
    );
  }
  // Expiry check: issuedAt FAR in the future (e.g., clock-skew, hostile
  // payload) is treated as malformed, not expired.  A token from the
  // future shouldn't paper-over the clock issue.
  if (p.issuedAt - now > 24 * 60 * 60 * 1000) {
    throw new InviteTokenError(
      'malformed',
      'Invite token issuedAt is implausibly in the future.'
    );
  }
  if (now - p.issuedAt > maxAge) {
    throw new InviteTokenError(
      'expired',
      `Invite token expired (issued ${new Date(p.issuedAt).toISOString()}).`
    );
  }
  if (
    options.expectedFingerprint !== undefined &&
    options.expectedFingerprint !== p.campaignFingerprint
  ) {
    throw new InviteTokenError(
      'campaign-mismatch',
      'Invite token is for a different campaign than the one currently loaded.'
    );
  }
  return {
    slot: p.slot,
    issuedAt: p.issuedAt,
    campaignFingerprint: p.campaignFingerprint
  };
}

/**
 * Base64url (RFC 4648 §5) WITHOUT padding.  Wraps the platform's
 * `btoa` / `atob` since we're targeting the browser; SSR / Node
 * usage would need a Buffer fallback (not relevant for the runtime
 * which is browser-only).
 */
function toBase64Url(s: string): string {
  // Use TextEncoder to handle non-ASCII (e.g., emoji in a display
  // name if a future payload ever carries one).
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(s: string): string {
  // Restore padding so atob accepts the input.
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
