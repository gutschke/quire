/**
 * OAuth orchestrator unit tests (M6a code).
 *
 * The popup itself is unobservable in a unit test; we inject a
 * stub `OAuthPopup` that returns synthetic message events.
 * `fetch` is stubbed.  Web Crypto is provided by the test
 * environment (happy-dom).
 *
 * Coverage:
 *   - assertReadyForOAuth refuses on placeholder baseline → typed
 *     `not-configured` failure.
 *   - Happy path: popup returns valid message → state verifies →
 *     fetch succeeds → token + id_token.sub returned.
 *   - Each failure branch from §A12 error matrix:
 *       popup-blocked, popup-closed, user-denied,
 *       network-failure, callback-malformed, state-rejected,
 *       token-exchange-rejected.
 *   - The state envelope binds intent + campaignId + flowId.
 *   - Token exchange asserts `drive.appdata` scope.
 *   - access_token NEVER lands in sessionStorage.
 */

import { describe, expect, it } from 'vitest';
import {
  OAuthOrchestrator,
  inMemorySessionStore,
  parseCallbackMessage,
  type ConnectGoogleArgs,
  type FetchLike,
  type OAuthPopup,
  type OAuthPopupResult,
  type OAuthSessionStore,
  type OrchestratorDeps
} from './oauth-orchestrator';
import type { CanonicalClientIdEntry } from './canonical-client-id';
import { mintState } from './oauth-state';

// ---------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------

const VERIFIED_BASELINE: CanonicalClientIdEntry = {
  provider: 'google',
  status: 'verified',
  clientId: 'test-client.apps.googleusercontent.com',
  consentAppNameFingerprint:
    '1111111111111111111111111111111111111111111111111111111111111111',
  allowDiscoveryOverride: false
};

const PLACEHOLDER_BASELINE: CanonicalClientIdEntry = {
  provider: 'google',
  status: 'placeholder',
  clientId: 'PLACEHOLDER',
  consentAppNameFingerprint:
    '0000000000000000000000000000000000000000000000000000000000000000',
  allowDiscoveryOverride: false
};

const NOW = 1_700_000_000_000;
const ORIGIN = 'https://quire.pages.dev';

/**
 * Build an `OAuthPopup` stub whose `open()` resolves with the
 * provided `OAuthPopupResult`.  The stub also captures the args
 * for assertion.
 */
function stubPopup(
  result: OAuthPopupResult
): OAuthPopup & {
  callArgs: Array<{ url: string; flowId: string; timeoutMs: number }>;
} {
  const callArgs: Array<{ url: string; flowId: string; timeoutMs: number }> =
    [];
  return {
    callArgs,
    async open(args) {
      callArgs.push(args);
      return result;
    }
  };
}

/**
 * Build a `FetchLike` that responds to the token endpoint with a
 * canned JSON body.  Captures call args for assertion.
 */
function stubFetch(
  responseInit:
    | { status: number; jsonBody: unknown }
    | { reject: Error }
    | { status: number; bodyText: string }
): FetchLike & {
  callArgs: Array<{ input: string; init?: RequestInit }>;
} {
  const callArgs: Array<{ input: string; init?: RequestInit }> = [];
  const fn = async (input: string, init?: RequestInit) => {
    callArgs.push({ input, init });
    if ('reject' in responseInit) throw responseInit.reject;
    if ('jsonBody' in responseInit) {
      return new Response(JSON.stringify(responseInit.jsonBody), {
        status: responseInit.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(responseInit.bodyText, {
      status: responseInit.status,
      headers: { 'Content-Type': 'text/plain' }
    });
  };
  (fn as unknown as { callArgs: typeof callArgs }).callArgs = callArgs;
  return fn as FetchLike & {
    callArgs: Array<{ input: string; init?: RequestInit }>;
  };
}

/**
 * Build a fake id_token JWT with a `sub` claim.  The orchestrator
 * doesn't verify signatures — it just decodes the payload — so we
 * can hand-roll one.
 */
function fakeIdToken(sub: string): string {
  const enc = (obj: unknown) => {
    const b64 = btoa(JSON.stringify(obj));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${enc({ alg: 'none' })}.${enc({ sub })}.signature`;
}

/**
 * Compose a callback message payload as the callback page would
 * postMessage it.  The state envelope is real (we mint it with
 * the same secret the orchestrator will use).
 *
 * NOTE: this helper is for tests that want to control the
 * callback-side message INDEPENDENTLY of the orchestrator's
 * internal mint.  For happy-path tests we use the
 * `withGoodCallback` helper below which intercepts the
 * orchestrator's own minted state via a custom popup.
 */
async function makeGoodCallback(args: {
  flowId: string;
  campaignId: string;
  fileRev: string | null;
  intent: 'push' | 'pull' | 'connect';
  secret: Uint8Array;
  now: number;
}) {
  const { stateParam } = await mintState({
    payload: {
      intent: args.intent,
      campaignId: args.campaignId,
      fileRev: args.fileRev,
      flowId: args.flowId
    },
    secret: args.secret,
    now: args.now
  });
  return {
    source: 'quire-oauth',
    code: 'authz-code-abc',
    state: stateParam,
    flowId: args.flowId
  };
}

/**
 * A popup stub that mints a valid callback FROM the orchestrator's
 * own flowId + secret.  It hooks into the session store to read
 * the secret the orchestrator just wrote.
 */
function happyPathPopup(
  sessionStore: OAuthSessionStore,
  args: {
    campaignId: string;
    intent: 'push' | 'pull' | 'connect';
    fileRev: string | null;
    now: number;
  }
): OAuthPopup {
  return {
    async open(openArgs) {
      const secret = sessionStore.read(openArgs.flowId);
      if (!secret) {
        return { kind: 'popup-blocked' };
      }
      const payload = await makeGoodCallback({
        flowId: openArgs.flowId,
        campaignId: args.campaignId,
        fileRev: args.fileRev,
        intent: args.intent,
        secret,
        now: args.now
      });
      return { kind: 'message', data: payload };
    }
  };
}

function tokenResponseHappy(sub: string) {
  return {
    status: 200,
    jsonBody: {
      access_token: 'ya29.test-access-token',
      expires_in: 3599,
      id_token: fakeIdToken(sub),
      scope:
        'https://www.googleapis.com/auth/drive.appdata openid email',
      token_type: 'Bearer'
    }
  };
}

function makeOrchestrator(
  opts: {
    popup: OAuthPopup;
    fetchImpl: FetchLike;
    baseline?: CanonicalClientIdEntry;
    sessionStore?: OAuthSessionStore;
    now?: () => number;
    clientIdEnvOverride?: string;
  }
): { orch: OAuthOrchestrator; store: OAuthSessionStore } {
  const store = opts.sessionStore ?? inMemorySessionStore();
  const deps: OrchestratorDeps = {
    popup: opts.popup,
    fetch: opts.fetchImpl,
    sessionStore: store,
    origin: ORIGIN,
    now: opts.now ?? (() => NOW),
    baseline: opts.baseline ?? VERIFIED_BASELINE,
    clientIdEnvOverride: opts.clientIdEnvOverride
  };
  return { orch: new OAuthOrchestrator(deps), store };
}

const PUSH_ARGS: ConnectGoogleArgs = {
  campaignId: 'owner/repo@main',
  intent: 'push',
  fileRev: 'rev-abc'
};

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('OAuthOrchestrator.connectGoogle — gate checks', () => {
  it('refuses with `not-configured` when baseline is placeholder', async () => {
    const store = inMemorySessionStore();
    const popup = stubPopup({ kind: 'popup-blocked' }); // shouldn't even be reached
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({
      popup,
      fetchImpl,
      baseline: PLACEHOLDER_BASELINE,
      sessionStore: store
    });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-configured');
    // Popup must not have been opened.
    expect(popup.callArgs.length).toBe(0);
    // Session store untouched.
  });
});

describe('OAuthOrchestrator.connectGoogle — happy path', () => {
  it('returns access_token + id_token.sub on a clean flow', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch(tokenResponseHappy('1234567890'));
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe('ya29.test-access-token');
      expect(result.expiresInSec).toBe(3599);
      expect(result.idTokenSub).toBe('1234567890');
      expect(result.intent).toBe('push');
      expect(result.campaignId).toBe('owner/repo@main');
      expect(result.scope).toContain(
        'https://www.googleapis.com/auth/drive.appdata'
      );
    }
  });

  it('opens popup with a Google auth URL carrying the right params', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    }) as OAuthPopup & {
      // The happyPathPopup helper doesn't expose callArgs;
      // re-wrap with a captured popup.
    };
    // Re-instrument: a popup that records args + delegates.
    const recorded: Array<{ url: string; flowId: string; timeoutMs: number }> =
      [];
    const wrapped: OAuthPopup = {
      async open(args) {
        recorded.push(args);
        return popup.open(args);
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({
      popup: wrapped,
      fetchImpl,
      sessionStore: store
    });
    await orch.connectGoogle(PUSH_ARGS);
    expect(recorded.length).toBe(1);
    const url = recorded[0]!.url;
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(
      true
    );
    expect(url).toContain('client_id=test-client.apps.googleusercontent.com');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('prompt=select_account');
    expect(url).toContain('access_type=online');
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent(`${ORIGIN}/auth/google/callback`)}`
    );
    expect(url).toMatch(/scope=[^&]*drive\.appdata/);
    expect(url).toContain('scope=');
    // state param is base64url JSON — verify it's URL-safe.
    expect(url).toMatch(/state=[A-Za-z0-9_-]+/);
  });

  it('honors env override for the client_id (self-host path)', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const recorded: Array<{ url: string; flowId: string; timeoutMs: number }> =
      [];
    const wrapped: OAuthPopup = {
      async open(args) {
        recorded.push(args);
        return popup.open(args);
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({
      popup: wrapped,
      fetchImpl,
      sessionStore: store,
      clientIdEnvOverride: 'selfhost.apps.googleusercontent.com'
    });
    await orch.connectGoogle(PUSH_ARGS);
    expect(recorded[0]!.url).toContain(
      'client_id=selfhost.apps.googleusercontent.com'
    );
  });

  it('uses the requested timeout for the popup', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const recorded: Array<{ url: string; flowId: string; timeoutMs: number }> =
      [];
    const wrapped: OAuthPopup = {
      async open(args) {
        recorded.push(args);
        return popup.open(args);
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({
      popup: wrapped,
      fetchImpl,
      sessionStore: store
    });
    await orch.connectGoogle(PUSH_ARGS);
    expect(recorded[0]!.timeoutMs).toBe(3000); // §A12 row 1 default
  });

  it('wipes the per-flow secret from the session store on success', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    // Intercept the flowId by wrapping popup.open.
    let capturedFlowId: string | null = null;
    const wrapped: OAuthPopup = {
      async open(args) {
        capturedFlowId = args.flowId;
        return popup.open(args);
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({
      popup: wrapped,
      fetchImpl,
      sessionStore: store
    });
    await orch.connectGoogle(PUSH_ARGS);
    expect(capturedFlowId).not.toBeNull();
    expect(store.read(capturedFlowId!)).toBeNull();
  });
});

describe('OAuthOrchestrator.connectGoogle — failure branches', () => {
  it('popup-blocked: surfaces popup-blocked', async () => {
    const popup = stubPopup({ kind: 'popup-blocked' });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('popup-blocked');
  });

  it('popup-closed: surfaces popup-blocked (for fallback routing)', async () => {
    const popup = stubPopup({ kind: 'popup-closed' });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('popup-blocked');
  });

  it('user-denied: callback error access_denied → user-denied', async () => {
    const popup = stubPopup({
      kind: 'message',
      data: { source: 'quire-oauth', error: 'access_denied' }
    });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('user-denied');
    }
  });

  it('non-access_denied callback error → token-exchange-rejected with redacted code', async () => {
    const popup = stubPopup({
      kind: 'message',
      data: { source: 'quire-oauth', error: 'server_error' }
    });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('token-exchange-rejected');
      expect(result.tokenExchangeError).toBe('server_error');
    }
  });

  it('callback-malformed: unknown source key → callback-malformed', async () => {
    const popup = stubPopup({
      kind: 'message',
      data: { source: 'evil', code: 'x', state: 'y' }
    });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('callback-malformed');
  });

  it('callback-malformed: missing code AND error → callback-malformed', async () => {
    const popup = stubPopup({
      kind: 'message',
      data: { source: 'quire-oauth', state: 'orphan' }
    });
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('callback-malformed');
  });

  it('state-rejected: tampered state → reason carried out', async () => {
    // Mint a state with a DIFFERENT secret (simulating tamper).
    const wrongSecret = new Uint8Array(32).fill(99);
    const flowIdSeen = (() => {
      let captured: string | null = null;
      return {
        capture: (f: string) => {
          captured = f;
        },
        get: () => captured
      };
    })();
    const store = inMemorySessionStore();
    const popup: OAuthPopup = {
      async open(args) {
        flowIdSeen.capture(args.flowId);
        const { stateParam } = await mintState({
          payload: {
            intent: 'push',
            campaignId: PUSH_ARGS.campaignId,
            fileRev: PUSH_ARGS.fileRev,
            flowId: args.flowId
          },
          secret: wrongSecret,
          now: NOW
        });
        return {
          kind: 'message',
          data: {
            source: 'quire-oauth',
            code: 'authz-code-abc',
            state: stateParam,
            flowId: args.flowId
          }
        };
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('state-rejected');
      expect(result.stateReason).toBe('bad-signature');
    }
  });

  it('state-rejected: callback claims a different campaign → campaign-mismatch', async () => {
    const store = inMemorySessionStore();
    const popup: OAuthPopup = {
      async open(args) {
        const secret = store.read(args.flowId)!;
        const { stateParam } = await mintState({
          payload: {
            intent: 'push',
            campaignId: 'other/repo@main', // wrong campaign
            fileRev: PUSH_ARGS.fileRev,
            flowId: args.flowId
          },
          secret,
          now: NOW
        });
        return {
          kind: 'message',
          data: {
            source: 'quire-oauth',
            code: 'authz-code-abc',
            state: stateParam,
            flowId: args.flowId
          }
        };
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('state-rejected');
      expect(result.stateReason).toBe('campaign-mismatch');
    }
  });

  it('network-failure: fetch rejects → network-failure', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch({ reject: new Error('DNS failure') });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network-failure');
  });

  it('token-exchange-rejected: 400 invalid_grant → tokenExchangeError redacted code', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch({
      status: 400,
      jsonBody: {
        error: 'invalid_grant',
        error_description: 'leak-email@example.com used a stale code'
      }
    });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('token-exchange-rejected');
      expect(result.tokenExchangeError).toBe('invalid_grant');
      // OP-030 — must NOT forward the description (which carries PII).
      // The typed result has no field for it, so we just confirm we
      // don't accidentally have one.
      expect(JSON.stringify(result)).not.toContain('leak-email');
    }
  });

  it('token-exchange-rejected: 200 but missing access_token', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: { id_token: fakeIdToken('xxx'), scope: 'drive.appdata' }
    });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token-exchange-rejected');
  });

  it('token-exchange-rejected: scope does NOT contain drive.appdata', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        access_token: 'tok',
        expires_in: 3600,
        id_token: fakeIdToken('xxx'),
        scope: 'openid email' // missing drive.appdata
      }
    });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token-exchange-rejected');
  });

  it('token-exchange-rejected: id_token is malformed', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        access_token: 'tok',
        expires_in: 3600,
        id_token: 'not-a-jwt',
        scope: 'https://www.googleapis.com/auth/drive.appdata openid email'
      }
    });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token-exchange-rejected');
  });

  it('wipes the per-flow secret even on failure', async () => {
    const store = inMemorySessionStore();
    let capturedFlowId: string | null = null;
    const popup: OAuthPopup = {
      async open(args) {
        capturedFlowId = args.flowId;
        return { kind: 'popup-blocked' };
      }
    };
    const fetchImpl = stubFetch({ status: 200, jsonBody: {} });
    const { orch } = makeOrchestrator({ popup, fetchImpl, sessionStore: store });
    await orch.connectGoogle(PUSH_ARGS);
    expect(capturedFlowId).not.toBeNull();
    expect(store.read(capturedFlowId!)).toBeNull();
  });
});

describe('OAuthOrchestrator — never persists access_token (DEC-007 C4)', () => {
  it('does not write access_token to the session store', async () => {
    const store = inMemorySessionStore();
    const popup = happyPathPopup(store, {
      campaignId: PUSH_ARGS.campaignId,
      intent: 'push',
      fileRev: PUSH_ARGS.fileRev,
      now: NOW
    });
    const writeCalls: Array<{ flowId: string; secret: Uint8Array }> = [];
    const audited: OAuthSessionStore = {
      read(id) {
        return store.read(id);
      },
      write(id, secret) {
        writeCalls.push({ flowId: id, secret });
        store.write(id, secret);
      },
      remove(id) {
        store.remove(id);
      }
    };
    const fetchImpl = stubFetch(tokenResponseHappy('xxx'));
    const { orch } = makeOrchestrator({
      popup,
      fetchImpl,
      sessionStore: audited
    });
    const result = await orch.connectGoogle(PUSH_ARGS);
    expect(result.ok).toBe(true);
    // The store sees exactly ONE write — the per-flow HMAC secret.
    expect(writeCalls.length).toBe(1);
    // The recorded payload must NOT be the access_token bytes — it's
    // a fresh 32-byte HMAC secret.
    expect(writeCalls[0]!.secret.length).toBe(32);
    // And the access_token string never lands as a stringified write.
    if (result.ok) {
      expect(
        writeCalls.some(
          (c) => new TextDecoder().decode(c.secret) === result.accessToken
        )
      ).toBe(false);
    }
  });
});

describe('parseCallbackMessage shape validator', () => {
  it('accepts a code+state message', () => {
    expect(
      parseCallbackMessage({
        source: 'quire-oauth',
        code: 'c',
        state: 's',
        flowId: 'f'
      })
    ).not.toBeNull();
  });
  it('accepts an error-only message', () => {
    expect(
      parseCallbackMessage({
        source: 'quire-oauth',
        error: 'access_denied'
      })
    ).not.toBeNull();
  });
  it('rejects wrong source', () => {
    expect(
      parseCallbackMessage({
        source: 'something-else',
        code: 'c',
        state: 's'
      })
    ).toBeNull();
  });
  it('rejects null', () => {
    expect(parseCallbackMessage(null)).toBeNull();
  });
  it('rejects non-object', () => {
    expect(parseCallbackMessage('hello')).toBeNull();
    expect(parseCallbackMessage(123)).toBeNull();
  });
  it('rejects code-without-state', () => {
    expect(
      parseCallbackMessage({ source: 'quire-oauth', code: 'c' })
    ).toBeNull();
  });
  it('rejects state-without-code (orphan)', () => {
    expect(
      parseCallbackMessage({ source: 'quire-oauth', state: 's' })
    ).toBeNull();
  });
});
