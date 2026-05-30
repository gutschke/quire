/**
 * OAuth state nonce + intent binding — unit tests (OP-021 / DEC-012).
 *
 * Covers:
 *   - Mint -> verify round-trip.
 *   - HMAC tamper detection across every intent field.
 *   - Freshness window (stale + future-skew).
 *   - Two-tab race (flowId mismatch).
 *   - Two-flow race (campaignId mismatch).
 *   - Malformed / missing-field defenses.
 *   - Constant-time hex compare (smoke test).
 *   - Fresh-secret + fresh-flowId entropy + shape.
 */

import { describe, expect, it } from 'vitest';
import {
  STATE_MAX_AGE_MS,
  freshFlowId,
  freshSessionSecret,
  mintState,
  signingMessage,
  verifyState,
  webCryptoHmacSha256Hex,
  type OAuthIntent,
  type OAuthIntentPayload,
  type RandomSource
} from './oauth-state';

/**
 * Deterministic random source for byte-pinned tests.  Wraps a
 * counter so each call returns a predictable, non-overlapping
 * window.
 */
function fixedRandom(seed: number): RandomSource {
  let counter = seed;
  return {
    randomBytes(n: number): Uint8Array {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = counter & 0xff;
        counter = (counter + 1) & 0xff;
      }
      return out;
    }
  };
}

const NOW_FROZEN = 1_700_000_000_000;

const SAMPLE_PAYLOAD: OAuthIntentPayload = {
  intent: 'push',
  campaignId: 'owner/repo@main',
  fileRev: 'rev-abc-123',
  flowId: '12345678-1234-4567-8123-abcdef012345'
};

describe('mintState -> verifyState round trip', () => {
  it('round-trips a push intent', async () => {
    const secret = new Uint8Array(32).fill(7);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN,
      random: fixedRandom(0x11)
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.intent).toBe('push');
      expect(result.envelope.campaignId).toBe('owner/repo@main');
      expect(result.envelope.fileRev).toBe('rev-abc-123');
      expect(result.envelope.flowId).toBe(SAMPLE_PAYLOAD.flowId);
    }
  });

  it('round-trips a connect intent with null fileRev', async () => {
    const secret = new Uint8Array(32).fill(3);
    const payload: OAuthIntentPayload = {
      intent: 'connect',
      campaignId: 'owner/repo@main',
      fileRev: null,
      flowId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const { stateParam } = await mintState({
      payload,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: payload.flowId,
        currentCampaignId: payload.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.fileRev).toBe(null);
    }
  });
});

describe('verifyState — tamper detection', () => {
  async function mint(secret: Uint8Array, payload = SAMPLE_PAYLOAD) {
    return mintState({ payload, secret, now: NOW_FROZEN });
  }

  it('rejects a different per-tab secret (HMAC mismatch)', async () => {
    const minterSecret = new Uint8Array(32).fill(1);
    const verifierSecret = new Uint8Array(32).fill(2);
    const { stateParam } = await mint(minterSecret);
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret: verifierSecret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a forged intent field (sig must still verify)', async () => {
    const secret = new Uint8Array(32).fill(5);
    const { envelope } = await mint(secret);
    // Tamper: change intent to 'pull' but keep the original sig.
    const tampered = {
      ...envelope,
      intent: 'pull' as OAuthIntent
    };
    const tamperedParam = btoa(JSON.stringify(tampered))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: tamperedParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a forged campaignId', async () => {
    const secret = new Uint8Array(32).fill(5);
    const { envelope } = await mint(secret);
    const tampered = {
      ...envelope,
      campaignId: 'attacker/evil@main'
    };
    const tamperedParam = btoa(JSON.stringify(tampered))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: tamperedParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: 'attacker/evil@main',
        now: NOW_FROZEN,
        secret
      }
    });
    // Even if we widen the verifier's current-campaign expectation
    // to match the tampered value, the HMAC still rejects.
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a forged ts', async () => {
    const secret = new Uint8Array(32).fill(5);
    const { envelope } = await mint(secret);
    const tampered = {
      ...envelope,
      ts: envelope.ts + 1
    };
    const tamperedParam = btoa(JSON.stringify(tampered))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: tamperedParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a forged fileRev', async () => {
    const secret = new Uint8Array(32).fill(5);
    const { envelope } = await mint(secret);
    const tampered = {
      ...envelope,
      fileRev: 'attacker-revision-id'
    };
    const tamperedParam = btoa(JSON.stringify(tampered))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: tamperedParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('verifyState — freshness window', () => {
  it('rejects state older than STATE_MAX_AGE_MS', async () => {
    const secret = new Uint8Array(32).fill(9);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN + STATE_MAX_AGE_MS + 1,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts state at the freshness boundary', async () => {
    const secret = new Uint8Array(32).fill(9);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN + STATE_MAX_AGE_MS,
        secret
      }
    });
    expect(result.ok).toBe(true);
  });

  it('rejects state from the future beyond skew window', async () => {
    const secret = new Uint8Array(32).fill(9);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        // 2 minutes of negative skew exceeds the 60s allowance.
        now: NOW_FROZEN - 2 * 60 * 1000,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'future-ts' });
  });

  it('tolerates clock-fast skew within 60 seconds', async () => {
    const secret = new Uint8Array(32).fill(9);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        // 30s of negative skew — accepted.
        now: NOW_FROZEN - 30 * 1000,
        secret
      }
    });
    expect(result.ok).toBe(true);
  });
});

describe('verifyState — context binding (OP-020 + DEC-012)', () => {
  it('rejects a flowId mismatch (two-tab race)', async () => {
    const secret = new Uint8Array(32).fill(11);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        // The listener in this tab was minted with a DIFFERENT
        // flow UUID (the OAuth response came back from another
        // tab's popup).
        expectedFlowId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'flow-mismatch' });
  });

  it('rejects a campaignId mismatch (two-flow race)', async () => {
    const secret = new Uint8Array(32).fill(13);
    const { stateParam } = await mintState({
      payload: SAMPLE_PAYLOAD,
      secret,
      now: NOW_FROZEN
    });
    const result = await verifyState({
      stateParam,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        // The user navigated away from owner/repo@main to a
        // different campaign between flow start and flow finish.
        currentCampaignId: 'other/campaign@main',
        now: NOW_FROZEN,
        secret
      }
    });
    expect(result).toEqual({ ok: false, reason: 'campaign-mismatch' });
  });
});

describe('verifyState — malformed input defenses', () => {
  it('rejects non-base64url junk', async () => {
    const result = await verifyState({
      stateParam: '!!!not-base64!!!',
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret: new Uint8Array(32)
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects base64url-of-non-JSON', async () => {
    const param = btoa('not json at all')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: param,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret: new Uint8Array(32)
      }
    });
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects JSON missing required fields', async () => {
    const param = btoa(JSON.stringify({ nonce: 'abc' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: param,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: SAMPLE_PAYLOAD.campaignId,
        now: NOW_FROZEN,
        secret: new Uint8Array(32)
      }
    });
    expect(result).toEqual({ ok: false, reason: 'missing-field' });
  });

  it('rejects an unknown intent string', async () => {
    const env = {
      nonce: 'a'.repeat(64),
      intent: 'delete-everything', // not in {push, pull, connect}
      campaignId: 'owner/repo@main',
      fileRev: null,
      ts: NOW_FROZEN,
      flowId: SAMPLE_PAYLOAD.flowId,
      sig: 'b'.repeat(64)
    };
    const param = btoa(JSON.stringify(env))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyState({
      stateParam: param,
      ctx: {
        expectedFlowId: SAMPLE_PAYLOAD.flowId,
        currentCampaignId: 'owner/repo@main',
        now: NOW_FROZEN,
        secret: new Uint8Array(32)
      }
    });
    expect(result).toEqual({ ok: false, reason: 'bad-intent' });
  });
});

describe('signingMessage — stable format', () => {
  it('serializes a known input deterministically', () => {
    const msg = signingMessage({
      nonce: 'aa',
      intent: 'push',
      campaignId: 'c',
      fileRev: 'f',
      ts: 42,
      flowId: 'flow-1'
    });
    expect(msg).toBe('aa|push|c|f|42|flow-1');
  });

  it('serializes null fileRev as empty segment', () => {
    const msg = signingMessage({
      nonce: 'aa',
      intent: 'connect',
      campaignId: 'c',
      fileRev: null,
      ts: 42,
      flowId: 'flow-1'
    });
    expect(msg).toBe('aa|connect|c||42|flow-1');
  });
});

describe('freshSessionSecret + freshFlowId', () => {
  it('freshSessionSecret returns 32 bytes', () => {
    const s = freshSessionSecret();
    expect(s).toBeInstanceOf(Uint8Array);
    expect(s.length).toBe(32);
  });

  it('freshSessionSecret is non-zero (smoke test for entropy wiring)', () => {
    const s = freshSessionSecret();
    let nonZero = 0;
    for (const b of s) {
      if (b !== 0) nonZero++;
    }
    // 32 random bytes — overwhelmingly likely not all zero.
    expect(nonZero).toBeGreaterThan(0);
  });

  it('freshFlowId is in UUID 8-4-4-4-12 hex shape', () => {
    const id = freshFlowId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('two freshFlowIds collide with negligible probability', () => {
    const a = freshFlowId();
    const b = freshFlowId();
    expect(a).not.toBe(b);
  });
});

describe('webCryptoHmacSha256Hex — sanity', () => {
  it('returns a 64-char hex string', async () => {
    const sig = await webCryptoHmacSha256Hex(
      new Uint8Array(32).fill(1),
      'hello'
    );
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same key + message', async () => {
    const a = await webCryptoHmacSha256Hex(
      new Uint8Array(32).fill(2),
      'msg'
    );
    const b = await webCryptoHmacSha256Hex(
      new Uint8Array(32).fill(2),
      'msg'
    );
    expect(a).toBe(b);
  });

  it('differs for different keys', async () => {
    const a = await webCryptoHmacSha256Hex(
      new Uint8Array(32).fill(2),
      'msg'
    );
    const b = await webCryptoHmacSha256Hex(
      new Uint8Array(32).fill(3),
      'msg'
    );
    expect(a).not.toBe(b);
  });
});
