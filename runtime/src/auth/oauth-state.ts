/**
 * OAuth state nonce + intent binding (M6a ship-gate OP-021 / DEC-012).
 *
 * # Why state isn't just a CSRF nonce
 *
 * Classic OAuth `state` answers "did this auth response correspond
 * to MY request?" via a random nonce.  That's necessary but
 * insufficient for Quire's threat model: a two-flow race in the
 * same tab (push X started, pull Y fired before X auth completed)
 * lets the returning auth token write to the WRONG CAMPAIGN
 * because the in-memory "what was the user doing" variable was
 * overwritten between flow start and flow finish.  Per
 * NEW-SEC-2 + DEC-012, we embed the user's INTENT in `state` so
 * the opener can verify on return that the auth response matches
 * the campaign + action the user was looking at when they
 * clicked.
 *
 * Per OP-020 + DEC-012, every "Push to Drive" / "Pull from Drive"
 * click also mints a per-flow UUID so a second concurrent flow
 * in another tab cannot overwrite the first's listener / verifier.
 *
 * # state encoding
 *
 * `state` is `base64url(JSON.stringify({nonce, intent, campaignId,
 * fileRev, ts, flowId, sig}))` where `sig` is an HMAC-SHA-256 over
 * the intent-binding fields keyed by a per-tab session secret.
 *
 *   - `nonce`: 32 random bytes, hex.  Classic CSRF defense — even
 *     if an attacker convinces a DM's browser to make a request
 *     to the callback URL, they need the random nonce we issued.
 *   - `intent`: one of `'push' | 'pull' | 'connect'`.  Defines
 *     what the runtime should do AFTER the auth completes.  An
 *     attacker who flips this (e.g. tricks the DM into auth-ing
 *     against a "connect" flow and then uses the token for
 *     "push") wastes the user's time but doesn't get a useful
 *     attack — the runtime re-checks intent against current
 *     UI state on return.
 *   - `campaignId`: the campaign the user was looking at at flow
 *     start.  Defends against the two-flow race ("push X
 *     started, pull Y returned").
 *   - `fileRev`: the Drive revision_id the runtime expects to
 *     pull-rebase-push against.  Defends against a stale-state
 *     race where the auth completes against a file that's been
 *     updated by another co-DM since flow start.  `null` for
 *     `'connect'` intent.
 *   - `ts`: milliseconds-since-epoch at flow start.  Defends
 *     against stale-state replay (a discarded popup that
 *     completes auth 30 minutes later).  10-minute window.
 *   - `flowId`: per-flow UUID (OP-020).  Defends against the
 *     two-tab race: a returning postMessage carries the flowId
 *     and the opener's listener accepts only its own.
 *   - `sig`: HMAC-SHA-256(secret, `${nonce}|${intent}|${campaignId}|${fileRev}|${ts}|${flowId}`).
 *     Defends against tampering: an attacker who modifies any
 *     intent field MUST also forge the HMAC, which requires the
 *     per-tab session secret they don't have.
 *
 * The per-tab session secret is generated at first `mintState`
 * call within a tab and persists in `sessionStorage` until the
 * tab closes.  This means a popup-completed flow returning to
 * the SAME tab can verify; a flow that completes AFTER a tab
 * reload necessarily fails (the secret is regenerated; the HMAC
 * mismatches).  That's the right trade — auth completed after a
 * tab reload SHOULD be re-attempted from scratch.
 *
 * # Civilized-peer threat model accepts campaign-id in URL bar
 *
 * The `state` parameter rides in the OAuth URL and lands in the
 * browser's URL bar / history during the flow.  campaignId thus
 * lands in browser history.  Per DEC-012 + DEC-023, this is
 * acceptable for Quire's civilized-peer model — campaign IDs are
 * not spoiler-relevant disclosures.
 *
 * # Module shape
 *
 * Pure functions, no I/O, no Web Crypto imports at module top
 * level — Crypto is reached via the standard browser global
 * `crypto.subtle` which is required by the runtime.  Caller
 * passes in a `RandomSource` for testability (default:
 * `crypto.getRandomValues`).
 */

/**
 * The user's intent at flow start.  Restricted to the three
 * verbs the OAuth flow can serve.
 */
export type OAuthIntent = 'push' | 'pull' | 'connect';

/**
 * The intent payload — everything the runtime needs to bind
 * the auth response to the user's clicked action.
 */
export interface OAuthIntentPayload {
  readonly intent: OAuthIntent;
  /**
   * Stable identifier for the campaign.  Same format the rest of
   * the runtime uses (e.g. `<owner>/<repo>@<ref>` for Underleaf-
   * hosted campaigns).
   */
  readonly campaignId: string;
  /**
   * Drive file revision_id the runtime expects to operate
   * against.  `null` for `'connect'` intent (no file yet).
   */
  readonly fileRev: string | null;
  /**
   * Per-flow UUID (OP-020).  Set by `mintState`; honored by the
   * opener's listener on return.
   */
  readonly flowId: string;
}

/**
 * The full state envelope as serialized into the OAuth state
 * parameter.  After base64url-encoding, this is what rides on
 * the URL.
 */
export interface OAuthStateEnvelope extends OAuthIntentPayload {
  /**
   * 32 random bytes, hex (64 chars).
   */
  readonly nonce: string;
  /**
   * Milliseconds-since-epoch at flow start.  Used for the
   * 10-minute staleness window.
   */
  readonly ts: number;
  /**
   * HMAC-SHA-256(secret, intent-binding-fields).  Hex (64 chars).
   */
  readonly sig: string;
}

/**
 * Pluggable random source for testability.
 */
export interface RandomSource {
  randomBytes(n: number): Uint8Array;
}

/**
 * Pluggable HMAC primitive.  In the browser this is
 * `crypto.subtle.sign('HMAC', ...)`.  In tests we can substitute
 * a deterministic mock.  The function returns the HMAC tag as
 * a lowercase hex string for stable cross-implementation
 * comparison.
 */
export type HmacSha256Hex = (
  secret: Uint8Array,
  message: string
) => Promise<string>;

/**
 * Production HMAC via Web Crypto.  Returns lowercase hex.
 */
export async function webCryptoHmacSha256Hex(
  secret: Uint8Array,
  message: string
): Promise<string> {
  const subtle =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { crypto?: Crypto }).crypto !== 'undefined'
      ? (globalThis as { crypto: Crypto }).crypto.subtle
      : undefined;
  if (!subtle) {
    throw new Error('Web Crypto SubtleCrypto unavailable');
  }
  const key = await subtle.importKey(
    'raw',
    // BufferSource — clone into a fresh ArrayBuffer to avoid
    // any concerns about caller mutation after import.
    new Uint8Array(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    /* extractable */ false,
    ['sign']
  );
  const tag = await subtle.sign(
    { name: 'HMAC' },
    key,
    new TextEncoder().encode(message)
  );
  return bytesToHex(new Uint8Array(tag));
}

/**
 * Production random source via Web Crypto.
 */
export const webCryptoRandom: RandomSource = {
  randomBytes(n: number): Uint8Array {
    const cryptoObj =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { crypto?: Crypto }).crypto !== 'undefined'
        ? (globalThis as { crypto: Crypto }).crypto
        : undefined;
    if (!cryptoObj) {
      throw new Error('Web Crypto unavailable');
    }
    const out = new Uint8Array(n);
    cryptoObj.getRandomValues(out);
    return out;
  }
};

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * base64url without padding.  Standard for OAuth state.
 */
function base64UrlEncode(s: string): string {
  // Use the browser's btoa; in tests with happy-dom or Node we
  // rely on the same global.  Encode UTF-8 first.
  const utf8 = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) {
    binary += String.fromCharCode(utf8[i]!);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Compose the signing message exactly the same way on mint +
 * verify.  Stable order, no extra whitespace, separator `|` is
 * unambiguous because every field is either a fixed-vocabulary
 * enum, a hex digest, a URL-safe identifier, an integer, or
 * `null`.
 */
export function signingMessage(env: {
  readonly nonce: string;
  readonly intent: OAuthIntent;
  readonly campaignId: string;
  readonly fileRev: string | null;
  readonly ts: number;
  readonly flowId: string;
}): string {
  return [
    env.nonce,
    env.intent,
    env.campaignId,
    env.fileRev === null ? '' : env.fileRev,
    env.ts.toString(10),
    env.flowId
  ].join('|');
}

/**
 * Mint a fresh state envelope for an OAuth flow.  Caller is
 * responsible for storing the secret somewhere accessible to
 * the verify call (sessionStorage in production).  Returns the
 * envelope + the base64url-encoded `state` parameter string.
 */
export async function mintState(args: {
  readonly payload: OAuthIntentPayload;
  readonly secret: Uint8Array;
  readonly now: number;
  readonly random?: RandomSource;
  readonly hmac?: HmacSha256Hex;
}): Promise<{
  envelope: OAuthStateEnvelope;
  stateParam: string;
}> {
  const random = args.random ?? webCryptoRandom;
  const hmac = args.hmac ?? webCryptoHmacSha256Hex;
  const nonce = bytesToHex(random.randomBytes(32));
  const ts = args.now;
  const sig = await hmac(
    args.secret,
    signingMessage({
      nonce,
      intent: args.payload.intent,
      campaignId: args.payload.campaignId,
      fileRev: args.payload.fileRev,
      ts,
      flowId: args.payload.flowId
    })
  );
  const envelope: OAuthStateEnvelope = {
    nonce,
    intent: args.payload.intent,
    campaignId: args.payload.campaignId,
    fileRev: args.payload.fileRev,
    ts,
    flowId: args.payload.flowId,
    sig
  };
  const stateParam = base64UrlEncode(JSON.stringify(envelope));
  return { envelope, stateParam };
}

/**
 * Maximum age of a state envelope before we treat it as stale
 * and refuse the auth response.  Per DEC-012, 10 minutes is the
 * window — covers slow popup auth (e.g. user adds a 2FA method
 * mid-flow) without leaving stale state actionable.
 */
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The reasons a state verification can fail.  The runtime maps
 * each to a UX-matrix entry (§A11 of auth-strategy.md).
 */
export type StateVerifyFailureReason =
  | 'malformed' // base64 / json parse failed
  | 'missing-field' // required field absent or wrong type
  | 'bad-intent' // intent not in {push, pull, connect}
  | 'bad-signature' // HMAC mismatch — tamper or wrong secret
  | 'stale' // ts older than STATE_MAX_AGE_MS
  | 'future-ts' // ts in the future (clock skew or forged)
  | 'flow-mismatch' // flowId doesn't match opener's current flow
  | 'campaign-mismatch'; // campaignId doesn't match current UI campaign

export interface VerifyStateContext {
  /**
   * The flow UUID the opener minted when it started this flow.
   * Defends against the two-tab race (OP-020).
   */
  readonly expectedFlowId: string;
  /**
   * The campaign the user is currently looking at (DEC-012
   * intent binding).
   */
  readonly currentCampaignId: string;
  /**
   * Clock-now in ms.  Pass `Date.now()` in production.
   */
  readonly now: number;
  /**
   * Per-tab session secret.  Same bytes the corresponding
   * `mintState` call used.
   */
  readonly secret: Uint8Array;
  /**
   * Pluggable HMAC for tests.
   */
  readonly hmac?: HmacSha256Hex;
}

export type VerifyStateResult =
  | { ok: true; envelope: OAuthStateEnvelope }
  | { ok: false; reason: StateVerifyFailureReason };

const VALID_INTENTS: ReadonlySet<OAuthIntent> = new Set([
  'push',
  'pull',
  'connect'
]);

/**
 * Verify a state parameter as received in the OAuth callback.
 * The verification is total: every field is validated, the HMAC
 * is recomputed and constant-time-compared, freshness is
 * checked, and the flowId + campaignId are matched against the
 * opener's current context.
 *
 * Any failure returns `{ ok: false, reason }` rather than
 * throwing — the runtime branches on `reason` to surface the
 * right UX-matrix copy.
 *
 * Implementation note: we DELIBERATELY do NOT log the reason or
 * the envelope.  The OAuth error path can carry PII (per OP-030);
 * the same caution applies to state-failure paths.  Caller is
 * responsible for logging only a redacted reason string.
 */
export async function verifyState(args: {
  readonly stateParam: string;
  readonly ctx: VerifyStateContext;
}): Promise<VerifyStateResult> {
  let envelope: Partial<OAuthStateEnvelope>;
  try {
    const json = base64UrlDecode(args.stateParam);
    envelope = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Field presence + types.
  if (
    typeof envelope.nonce !== 'string' ||
    envelope.nonce.length === 0 ||
    typeof envelope.intent !== 'string' ||
    typeof envelope.campaignId !== 'string' ||
    envelope.campaignId.length === 0 ||
    !(typeof envelope.fileRev === 'string' || envelope.fileRev === null) ||
    typeof envelope.ts !== 'number' ||
    !Number.isFinite(envelope.ts) ||
    typeof envelope.flowId !== 'string' ||
    envelope.flowId.length === 0 ||
    typeof envelope.sig !== 'string' ||
    envelope.sig.length === 0
  ) {
    return { ok: false, reason: 'missing-field' };
  }
  if (!VALID_INTENTS.has(envelope.intent as OAuthIntent)) {
    return { ok: false, reason: 'bad-intent' };
  }
  // Freshness.
  const age = args.ctx.now - envelope.ts;
  if (age > STATE_MAX_AGE_MS) {
    return { ok: false, reason: 'stale' };
  }
  // Allow up to 60 seconds of future-skew (client clock fast),
  // refuse anything beyond.
  if (age < -60 * 1000) {
    return { ok: false, reason: 'future-ts' };
  }
  // Flow + campaign binding.
  if (envelope.flowId !== args.ctx.expectedFlowId) {
    return { ok: false, reason: 'flow-mismatch' };
  }
  if (envelope.campaignId !== args.ctx.currentCampaignId) {
    return { ok: false, reason: 'campaign-mismatch' };
  }
  // HMAC.
  const hmac = args.ctx.hmac ?? webCryptoHmacSha256Hex;
  const expectedSig = await hmac(
    args.ctx.secret,
    signingMessage({
      nonce: envelope.nonce,
      intent: envelope.intent as OAuthIntent,
      campaignId: envelope.campaignId,
      fileRev: envelope.fileRev,
      ts: envelope.ts,
      flowId: envelope.flowId
    })
  );
  if (!constantTimeEqualHex(expectedSig, envelope.sig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return {
    ok: true,
    envelope: envelope as OAuthStateEnvelope
  };
}

/**
 * Constant-time hex comparison.  We compare the strings byte by
 * byte over their full length, never short-circuiting.  Both
 * inputs are expected to be the same length (64 chars for
 * SHA-256); if not we still walk the full length to avoid
 * leaking the length-mismatch via timing.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/**
 * Generate a fresh per-tab session secret.  Caller stores in
 * sessionStorage as base64url; the secret persists for the tab's
 * lifetime.  256 bits (32 bytes) of entropy.
 */
export function freshSessionSecret(random?: RandomSource): Uint8Array {
  return (random ?? webCryptoRandom).randomBytes(32);
}

/**
 * Generate a fresh per-flow UUID for the OP-020 listener pattern.
 * Format: 8-4-4-4-12 hex (UUID v4-shaped); the exact byte
 * pattern doesn't have to be RFC-compliant since we use it
 * only as an opaque identifier.
 */
export function freshFlowId(random?: RandomSource): string {
  const b = (random ?? webCryptoRandom).randomBytes(16);
  // Set version (4) and variant (10xx) bits so consumers that
  // parse this as a UUID don't reject it.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
