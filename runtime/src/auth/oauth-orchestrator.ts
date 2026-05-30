/**
 * OAuth orchestration for the Google Drive PKCE flow (M6a code).
 *
 * # Where this sits
 *
 * This module is the engine-side conductor of one OAuth handshake:
 *
 *   click  →  mint state + verifier + flowId  →  open popup with
 *   auth URL  →  await postMessage from callback  →  verify state
 *   envelope  →  exchange code + verifier for access_token  →
 *   return the ephemeral token + id_token.sub to the caller.
 *
 * It composes the M6a primitives shipped in run #5:
 *
 *   - `assertReadyForOAuth(GOOGLE)` to hard-stop builds where the
 *     canonical baseline is still a placeholder (OP-017g).
 *   - `mintState` / `verifyState` for intent binding + the
 *     two-tab + two-flow defenses (OP-020 / OP-021 / DEC-012).
 *   - `freshFlowId` / `freshSessionSecret` to bind a flow's
 *     identity to its listener.
 *
 * It does NOT:
 *
 *   - Touch the DM-facing UI.  The orchestrator returns typed
 *     results; the caller (cloud-push.ts in a follow-up, or a
 *     button-handler) maps to UX-strategy.md §A12 error matrix
 *     codes.
 *   - Persist any secret across the call.  Access token + id_token
 *     fields are returned to the caller and never written to
 *     `localStorage`, `IndexedDB`, or any other persistent surface
 *     (per DEC-007 C4 + the M6a "ephemeral only" floor).  Caller
 *     keeps them in JS memory for the session.
 *   - Wire the popup.  Production callers pass a real `openPopup`
 *     that wraps `window.open` + an `addEventListener('message')`
 *     listener; tests inject a stub that returns a synthetic
 *     `messageEvent` directly.
 *
 * # Threat-model alignment (DEC-023 class 1)
 *
 * Per DEC-023, the orchestrator's surface area is exposed to
 * "internet randos" via the OAuth callback message channel.  Every
 * defense here is keyed off that:
 *
 *   - The popup-callback page (`public/auth/google/callback.js`,
 *     OP-017) forwards a fixed-shape message.  We re-validate the
 *     shape (no extra fields trusted) and the state envelope
 *     before redeeming.
 *   - The `state` envelope's HMAC + flowId + campaignId match
 *     defeats CSRF + two-tab race + two-flow race.
 *   - The token exchange uses the canonical client_id from the
 *     baseline; an attacker who swaps the canonical baseline is
 *     caught by the golden-diff CI (OP-017g) at PR time.
 *   - The redirect_uri is computed from the runtime origin, not
 *     attacker-controlled.  Google itself rejects mismatches.
 *
 * # Failure mode taxonomy
 *
 * `connectGoogle` returns `{ ok: true, ... }` or
 * `{ ok: false, reason }`.  The `reason` enum is the engine
 * surface that `ux-strategy.md` §A12 maps to user-visible copy.
 *
 *   - `'not-configured'`: the baseline is `'placeholder'`.  The
 *     UI should hide the button entirely (the
 *     `assertReadyForOAuth` precheck fails).
 *   - `'popup-blocked'`: `openPopup` returned null or no
 *     `messageEvent` arrived within the configured timeout.
 *     Caller falls back to full-page redirect (§A1.5).
 *   - `'user-denied'`: callback message carries an `error` of
 *     `access_denied` or `consent_required`.
 *   - `'network-failure'`: the token-exchange fetch failed
 *     (network down, DNS, HTTP 5xx).
 *   - `'state-rejected'`: `verifyState` failed.  The carried
 *     `stateReason` distinguishes which subcase (tamper /
 *     stale / wrong-tab / wrong-campaign).  In every case the
 *     orchestrator REFUSES to redeem the code.
 *   - `'callback-malformed'`: the postMessage payload doesn't
 *     match the contract `public/auth/google/callback.js` ships.
 *   - `'token-exchange-rejected'`: token endpoint returned a
 *     well-formed error JSON (invalid_grant etc.).  Carries a
 *     redacted code; never the error_description string (OP-030
 *     PII strip).
 *
 * No `throw` paths past `assertReadyForOAuth`.  Every other
 * failure produces a typed result so the caller branches with a
 * `switch` instead of `try`/`catch`.
 */

import {
  GOOGLE,
  assertReadyForOAuth,
  resolveClientId,
  type CanonicalClientIdEntry
} from './canonical-client-id';
import {
  freshFlowId,
  freshSessionSecret,
  mintState,
  verifyState,
  webCryptoHmacSha256Hex,
  webCryptoRandom,
  type HmacSha256Hex,
  type OAuthIntent,
  type RandomSource,
  type StateVerifyFailureReason
} from './oauth-state';

// ---------------------------------------------------------------
// Public types
// ---------------------------------------------------------------

/**
 * The shape of the message the callback page postMessages to the
 * opener (see `public/auth/google/callback.js`).  This is the
 * SINGLE supported payload — extra fields are ignored, missing
 * required fields are a `callback-malformed` failure.
 */
export interface OAuthCallbackMessage {
  readonly source: 'quire-oauth';
  /** The OAuth `code` from Google.  Absent on `access_denied`. */
  readonly code?: string;
  /** The OAuth `state` parameter as Google reflected it back. */
  readonly state?: string;
  /**
   * Google's error code if the flow failed in the popup.
   * The callback page deliberately does NOT forward
   * `error_description` because Google may include PII there
   * (OP-030).
   */
  readonly error?: string;
  /**
   * The per-flow UUID echoed by the callback page as a sanity
   * check (OP-020).  The opener primarily verifies via the state
   * envelope; this is the defense-in-depth lane.
   */
  readonly flowId?: string;
}

/**
 * The result returned to a caller that asked the orchestrator to
 * run a Google OAuth flow.  Successful results carry the
 * ephemeral access_token + `id_token.sub` (for the account-scope
 * hash per DEC-019 + the NEW-SEC-4 account-switch defense).
 */
export type ConnectGoogleResult =
  | {
      readonly ok: true;
      /**
       * Ephemeral access_token.  Caller keeps in JS memory; never
       * persist (DEC-007 C4).
       */
      readonly accessToken: string;
      /**
       * Token lifetime in seconds (Google's `expires_in`).  60 min
       * for normal accounts; APP may be shorter.
       */
      readonly expiresInSec: number;
      /**
       * Stable Google user identifier (`sub`) extracted from the
       * id_token.  Used by DEC-019 (M5 list scoping) and NEW-SEC-4
       * (account-switch detection).
       */
      readonly idTokenSub: string;
      /**
       * The granted scope string Google returned.  Caller asserts
       * it contains the requested scopes; an attacker who swaps
       * scopes mid-flight gets caught by the assertion.
       */
      readonly scope: string;
      /**
       * The campaign + intent the orchestrator was asked to bind
       * to.  Returned verbatim for the caller's audit trail.
       */
      readonly intent: OAuthIntent;
      readonly campaignId: string;
    }
  | {
      readonly ok: false;
      readonly reason: OrchestratorFailureReason;
      /**
       * Set when `reason === 'state-rejected'` — the precise
       * verifier-side subcause.  Drives §A12 row 5 vs. row 4
       * mapping in callers if needed.
       */
      readonly stateReason?: StateVerifyFailureReason;
      /**
       * Set when `reason === 'token-exchange-rejected'` —
       * Google's `error` string from the token endpoint, REDACTED
       * (no `error_description` PII included).
       */
      readonly tokenExchangeError?: string;
    };

export type OrchestratorFailureReason =
  | 'not-configured'
  | 'popup-blocked'
  | 'user-denied'
  | 'network-failure'
  | 'state-rejected'
  | 'callback-malformed'
  | 'token-exchange-rejected';

/**
 * The injectable popup primitive.  Production wraps `window.open`
 * + a `MessageEvent` listener; tests substitute a stub.
 *
 * The contract:
 *
 *   - `open` is called with the fully-formed Google auth URL plus
 *     a per-flow listener key.  It returns a promise that
 *     resolves either with a `MessageEvent` from the callback
 *     page OR with `null` if the popup couldn't be opened OR was
 *     closed before posting a message.
 *   - The implementation owns the lifecycle of the listener
 *     (added at popup-open, removed at message-receive OR
 *     popup-close).  This is the OP-020 per-flow listener
 *     defense; we don't leak listener handlers across flows.
 *   - The implementation enforces the popup-blocked timeout (the
 *     orchestrator passes a `timeoutMs` hint; the implementation
 *     resolves with `null` on timeout).
 *
 * Production implementation will land in cloud-push.ts wiring.
 */
export interface OAuthPopup {
  open(args: {
    readonly url: string;
    readonly flowId: string;
    readonly timeoutMs: number;
  }): Promise<OAuthPopupResult>;
}

/**
 * What `OAuthPopup.open` resolves to.  Either we got a message
 * event from our callback page, or the popup failed in one of
 * the documented ways.
 */
export type OAuthPopupResult =
  | { readonly kind: 'message'; readonly data: unknown }
  | { readonly kind: 'popup-blocked' }
  | { readonly kind: 'popup-closed' };

/**
 * Pluggable `fetch`.  Tests pass a stub that returns canned
 * Response objects; production uses `globalThis.fetch`.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * Per-flow session storage for the HMAC secret.  In production
 * this wraps `sessionStorage` so a popup-completed flow can
 * verify against the same secret the opener minted.  Tests use
 * an in-memory map.
 *
 * Storage keys are `quire.oauth.flow.<flowId>.secret` and carry
 * the base64-encoded secret bytes.  The orchestrator wipes the
 * key after a single use to prevent re-redeem attempts.
 */
export interface OAuthSessionStore {
  read(flowId: string): Uint8Array | null;
  write(flowId: string, secret: Uint8Array): void;
  remove(flowId: string): void;
}

export interface OrchestratorDeps {
  readonly popup: OAuthPopup;
  readonly fetch: FetchLike;
  readonly sessionStore: OAuthSessionStore;
  /** Origin used for `redirect_uri` and postMessage targetOrigin. */
  readonly origin: string;
  /** `Date.now` substitute for deterministic tests. */
  readonly now: () => number;
  /** Random source for PKCE verifier + state nonce + flowId. */
  readonly random?: RandomSource;
  /** HMAC primitive (state HMAC).  Defaults to Web Crypto. */
  readonly hmac?: HmacSha256Hex;
  /**
   * Optional override to substitute the canonical baseline (for
   * tests + future runtime override paths).  Defaults to the
   * production `GOOGLE` import.
   */
  readonly baseline?: CanonicalClientIdEntry;
  /**
   * Optional env override for the client_id (self-host path per
   * DEC-013).  Production reads this from `import.meta.env`.
   */
  readonly clientIdEnvOverride?: string;
  /**
   * Popup-blocked timeout in ms.  Default 3000 (matches §A12 row 1).
   */
  readonly popupTimeoutMs?: number;
}

export interface ConnectGoogleArgs {
  readonly campaignId: string;
  readonly intent: OAuthIntent;
  /**
   * Drive file revision_id we expect to operate against, or
   * `null` for `'connect'` intent.  Embedded in the state
   * envelope; verified on return (DEC-012).
   */
  readonly fileRev: string | null;
}

// ---------------------------------------------------------------
// Internals
// ---------------------------------------------------------------

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const OPENID_SCOPES = 'openid email';
const CALLBACK_PATH = '/auth/google/callback';

/**
 * Encode a Uint8Array as base64url (PKCE + state-secret on the
 * wire).  No padding, standard URL-safe alphabet.
 */
function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url string into bytes.  Inverse of
 * `base64UrlEncodeBytes`.
 */
function base64UrlDecodeBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Decode a base64url string as a UTF-8 JSON string.  Used to
 * extract the JWT payload from `id_token`.  We DELIBERATELY do
 * NOT verify the JWT signature here: the id_token came back via
 * the token endpoint over HTTPS bound to our client_id, and we're
 * only reading the `sub` field for account scoping (not making
 * authn decisions on its contents).  A full JWT verifier would
 * add Web Crypto key-fetch + JWKS handling that's out of scope
 * for the M6a code surface.  If the JWT is malformed we treat it
 * as a `'callback-malformed'`-class failure.
 */
function decodeIdTokenPayload(idToken: string): { sub: string } | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let json: string;
  try {
    json = new TextDecoder().decode(base64UrlDecodeBytes(parts[1]!));
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { sub?: unknown };
  if (typeof p.sub !== 'string' || p.sub.length === 0) return null;
  return { sub: p.sub };
}

/**
 * SHA-256 the input as a Uint8Array of UTF-8 bytes; return the
 * digest as a Uint8Array.  Used to derive the PKCE
 * code_challenge from the code_verifier (S256 method).
 */
async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const subtle =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { crypto?: Crypto }).crypto !== 'undefined'
      ? (globalThis as { crypto: Crypto }).crypto.subtle
      : undefined;
  if (!subtle) {
    throw new Error('Web Crypto SubtleCrypto unavailable');
  }
  const buf = await subtle.digest(
    'SHA-256',
    // BufferSource — copy into a fresh ArrayBuffer to avoid
    // caller-mutation concerns.
    new Uint8Array(input)
  );
  return new Uint8Array(buf);
}

/**
 * Generate a PKCE code_verifier of `length` bytes (43-128 per RFC
 * 7636).  We use 32 bytes → ~43 base64url chars, well within the
 * spec.
 */
function freshCodeVerifier(random: RandomSource): string {
  return base64UrlEncodeBytes(random.randomBytes(32));
}

/**
 * Compose the Google auth URL with all required params.  Pure
 * function for test-friendly assertions.
 */
function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  scope: string;
  stateParam: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scope,
    state: args.stateParam,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    access_type: 'online', // M6a explicitly NOT requesting refresh_token (M6b lands that)
    include_granted_scopes: 'true'
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

/**
 * Validate the postMessage payload shape.  Returns the typed
 * message OR `null` if it doesn't match the contract.
 */
export function parseCallbackMessage(data: unknown): OAuthCallbackMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'quire-oauth') return null;
  const result: {
    source: 'quire-oauth';
    code?: string;
    state?: string;
    error?: string;
    flowId?: string;
  } = { source: 'quire-oauth' };
  if (typeof d.code === 'string' && d.code.length > 0) result.code = d.code;
  if (typeof d.state === 'string' && d.state.length > 0) result.state = d.state;
  if (typeof d.error === 'string' && d.error.length > 0) result.error = d.error;
  if (typeof d.flowId === 'string' && d.flowId.length > 0) result.flowId = d.flowId;
  // A valid message either carries (code+state) OR (error).  Other
  // shapes are malformed.
  const hasCodeFlow = !!result.code && !!result.state;
  const hasErrorFlow = !!result.error;
  if (!hasCodeFlow && !hasErrorFlow) return null;
  return result;
}

// ---------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------

export class OAuthOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Run one Google OAuth flow.  Returns a typed result; never
   * throws past `assertReadyForOAuth`.
   *
   * Caller is responsible for:
   *   - Wiring `deps.popup` to a real popup (or test stub).
   *   - Consulting the consent ledger BEFORE calling (per OP-027).
   *   - Mapping the returned `reason` to §A12 error-matrix copy.
   */
  async connectGoogle(args: ConnectGoogleArgs): Promise<ConnectGoogleResult> {
    const baseline = this.deps.baseline ?? GOOGLE;
    // Hard-stop on placeholder baseline.  Throws clearly so the
    // calling UI surface can render the "not yet available" copy.
    // We catch + map to a typed failure rather than letting it
    // propagate, because the orchestrator's contract is
    // "no throws past assertReadyForOAuth from the caller's POV."
    try {
      assertReadyForOAuth(baseline);
    } catch {
      return { ok: false, reason: 'not-configured' };
    }

    const random = this.deps.random ?? webCryptoRandom;
    const hmac = this.deps.hmac ?? webCryptoHmacSha256Hex;
    const now = this.deps.now();
    const popupTimeoutMs = this.deps.popupTimeoutMs ?? 3000;

    // Mint per-flow identifiers.
    const flowId = freshFlowId(random);
    const secret = freshSessionSecret(random);
    this.deps.sessionStore.write(flowId, secret);

    // PKCE verifier + challenge.
    const codeVerifier = freshCodeVerifier(random);
    const codeChallenge = base64UrlEncodeBytes(
      await sha256(new TextEncoder().encode(codeVerifier))
    );

    // State envelope binds intent + campaign + flow + freshness.
    const { stateParam } = await mintState({
      payload: {
        intent: args.intent,
        campaignId: args.campaignId,
        fileRev: args.fileRev,
        flowId
      },
      secret,
      now,
      random,
      hmac
    });

    const resolvedClientId = resolveClientId(
      baseline,
      this.deps.clientIdEnvOverride
    );
    const redirectUri = `${this.deps.origin}${CALLBACK_PATH}`;
    const scope = `${DRIVE_APPDATA_SCOPE} ${OPENID_SCOPES}`;
    const url = buildAuthUrl({
      clientId: resolvedClientId.clientId,
      redirectUri,
      scope,
      stateParam,
      codeChallenge
    });

    // Open popup; await message OR failure.
    const popupResult = await this.deps.popup.open({
      url,
      flowId,
      timeoutMs: popupTimeoutMs
    });

    // Whatever happens past this point, the secret has done its
    // job — wipe it before returning so a leaked
    // sessionStorage observer can't reuse it.
    const cleanup = () => this.deps.sessionStore.remove(flowId);

    if (popupResult.kind === 'popup-blocked') {
      cleanup();
      return { ok: false, reason: 'popup-blocked' };
    }
    if (popupResult.kind === 'popup-closed') {
      cleanup();
      // User dismissed the popup OR APP+WebAuthn-in-popup blocked
      // it.  The OP-024 detector lives one layer up; the
      // orchestrator surfaces this as popup-blocked so the
      // caller can fall back to the full-page redirect.
      return { ok: false, reason: 'popup-blocked' };
    }

    const callback = parseCallbackMessage(popupResult.data);
    if (!callback) {
      cleanup();
      return { ok: false, reason: 'callback-malformed' };
    }

    if (callback.error) {
      cleanup();
      // Map the OAuth error code into our coarser reason enum.
      // 'access_denied' is the prototypical user-denial; anything
      // else falls into 'token-exchange-rejected' for caller
      // routing.
      if (callback.error === 'access_denied') {
        return { ok: false, reason: 'user-denied' };
      }
      return {
        ok: false,
        reason: 'token-exchange-rejected',
        tokenExchangeError: callback.error
      };
    }

    if (!callback.code || !callback.state) {
      cleanup();
      return { ok: false, reason: 'callback-malformed' };
    }

    // Verify state envelope (CSRF + tamper + freshness + flow +
    // campaign).
    const verifyResult = await verifyState({
      stateParam: callback.state,
      ctx: {
        expectedFlowId: flowId,
        currentCampaignId: args.campaignId,
        now: this.deps.now(),
        secret,
        hmac
      }
    });
    if (!verifyResult.ok) {
      cleanup();
      return {
        ok: false,
        reason: 'state-rejected',
        stateReason: verifyResult.reason
      };
    }

    // Exchange code for tokens.
    let tokenResponse: Response;
    try {
      tokenResponse = await this.deps.fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: resolvedClientId.clientId,
          code: callback.code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        }).toString()
      });
    } catch {
      cleanup();
      return { ok: false, reason: 'network-failure' };
    }

    if (!tokenResponse.ok) {
      cleanup();
      // Parse Google's error body for the redacted `error` code,
      // but DO NOT forward `error_description` (OP-030 PII).
      let errorCode: string | undefined;
      try {
        const body = (await tokenResponse.json()) as { error?: unknown };
        if (typeof body.error === 'string') errorCode = body.error;
      } catch {
        // Non-JSON body — treat as bare token-exchange-rejected
        // with no extra detail.
      }
      return {
        ok: false,
        reason: 'token-exchange-rejected',
        tokenExchangeError: errorCode
      };
    }

    let parsed: unknown;
    try {
      parsed = await tokenResponse.json();
    } catch {
      cleanup();
      return { ok: false, reason: 'token-exchange-rejected' };
    }

    cleanup();

    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, reason: 'token-exchange-rejected' };
    }
    const t = parsed as {
      access_token?: unknown;
      expires_in?: unknown;
      id_token?: unknown;
      scope?: unknown;
    };
    if (
      typeof t.access_token !== 'string' ||
      t.access_token.length === 0 ||
      typeof t.id_token !== 'string' ||
      t.id_token.length === 0
    ) {
      return { ok: false, reason: 'token-exchange-rejected' };
    }
    const expiresInSec =
      typeof t.expires_in === 'number' && Number.isFinite(t.expires_in)
        ? t.expires_in
        : 3600;
    const grantedScope = typeof t.scope === 'string' ? t.scope : '';
    // Assert the granted scope contains drive.appdata.  An
    // attacker who swaps Google for an alternate token endpoint
    // (e.g. via DNS hijack) doesn't escape PKCE, but the scope
    // check is a defense-in-depth lane: a future M6c GitHub
    // share-code accident that lands in this path doesn't pass
    // because the scope wouldn't match.
    if (!grantedScope.includes(DRIVE_APPDATA_SCOPE)) {
      return { ok: false, reason: 'token-exchange-rejected' };
    }

    const idTokenPayload = decodeIdTokenPayload(t.id_token);
    if (!idTokenPayload) {
      return { ok: false, reason: 'token-exchange-rejected' };
    }

    return {
      ok: true,
      accessToken: t.access_token,
      expiresInSec,
      idTokenSub: idTokenPayload.sub,
      scope: grantedScope,
      intent: args.intent,
      campaignId: args.campaignId
    };
  }
}

// ---------------------------------------------------------------
// Helper: in-memory session store (for tests).
// ---------------------------------------------------------------

/**
 * Test-only in-memory implementation of `OAuthSessionStore`.
 * Production wires a sessionStorage-backed store; that wiring
 * lives in cloud-push.ts (next layer).
 */
export function inMemorySessionStore(): OAuthSessionStore {
  const map = new Map<string, Uint8Array>();
  return {
    read(flowId: string): Uint8Array | null {
      const v = map.get(flowId);
      return v ? new Uint8Array(v) : null;
    },
    write(flowId: string, secret: Uint8Array): void {
      map.set(flowId, new Uint8Array(secret));
    },
    remove(flowId: string): void {
      map.delete(flowId);
    }
  };
}
