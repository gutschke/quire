/**
 * invite-token tests (CC-3 / F1).
 */

import { describe, it, expect } from 'vitest';
import {
  encodeInviteToken,
  decodeInviteToken,
  campaignFingerprint,
  DEFAULT_MAX_AGE_MS,
  InviteTokenError
} from './invite-token';

describe('campaignFingerprint', () => {
  it('returns a stable, non-empty hex string', () => {
    const fp = campaignFingerprint({
      owner: 'gutschke',
      repo: 'underleaf',
      ref: 'main'
    });
    expect(fp.length).toBeGreaterThan(8);
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic across calls', () => {
    const a = campaignFingerprint({ owner: 'a', repo: 'b', ref: 'c' });
    const b = campaignFingerprint({ owner: 'a', repo: 'b', ref: 'c' });
    expect(a).toBe(b);
  });

  it('changes when any source field changes', () => {
    const base = campaignFingerprint({ owner: 'a', repo: 'b', ref: 'c' });
    expect(campaignFingerprint({ owner: 'a2', repo: 'b', ref: 'c' })).not.toBe(
      base
    );
    expect(campaignFingerprint({ owner: 'a', repo: 'b2', ref: 'c' })).not.toBe(
      base
    );
    expect(campaignFingerprint({ owner: 'a', repo: 'b', ref: 'c2' })).not.toBe(
      base
    );
  });
});

describe('encodeInviteToken', () => {
  const SOURCE = { owner: 'g', repo: 'u', ref: 'main' };
  const fp = campaignFingerprint(SOURCE);

  it('produces a URL-safe string (no +, /, =, no whitespace)', () => {
    const t = encodeInviteToken({
      slot: 1,
      issuedAt: 1700000000000,
      campaignFingerprint: fp
    });
    expect(t).not.toMatch(/[+/=\s]/);
  });

  it('rejects non-integer slots', () => {
    expect(() =>
      encodeInviteToken({
        slot: 1.5,
        issuedAt: 0,
        campaignFingerprint: fp
      })
    ).toThrow(InviteTokenError);
  });

  it('rejects slots out of [1, 9]', () => {
    for (const slot of [0, 10, -1, 100]) {
      expect(() =>
        encodeInviteToken({ slot, issuedAt: 0, campaignFingerprint: fp })
      ).toThrow(InviteTokenError);
    }
  });

  it('round-trips through decodeInviteToken', () => {
    const payload = { slot: 3, issuedAt: 1700000000000, campaignFingerprint: fp };
    const t = encodeInviteToken(payload);
    expect(
      decodeInviteToken(t, { nowMs: 1700000000000, expectedFingerprint: fp })
    ).toEqual(payload);
  });

  it('handles all 9 slot values', () => {
    for (let slot = 1; slot <= 9; slot++) {
      const t = encodeInviteToken({
        slot,
        issuedAt: 1700000000000,
        campaignFingerprint: fp
      });
      expect(
        decodeInviteToken(t, { nowMs: 1700000000000 }).slot
      ).toBe(slot);
    }
  });
});

describe('decodeInviteToken', () => {
  const fp = campaignFingerprint({ owner: 'g', repo: 'u', ref: 'main' });
  const now = 1700000000000;
  const goodToken = encodeInviteToken({
    slot: 2,
    issuedAt: now,
    campaignFingerprint: fp
  });

  it('decodes a valid fresh token', () => {
    const out = decodeInviteToken(goodToken, {
      nowMs: now,
      expectedFingerprint: fp
    });
    expect(out.slot).toBe(2);
    expect(out.issuedAt).toBe(now);
  });

  it('throws malformed for non-base64 input', () => {
    try {
      decodeInviteToken('not!!base64$$$', { nowMs: now });
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteTokenError);
      expect((e as InviteTokenError).code).toBe('malformed');
    }
  });

  it('throws malformed for valid base64 of non-JSON', () => {
    // Encode the literal string 'not json' as base64url.
    const garbage = btoa('not json')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    try {
      decodeInviteToken(garbage, { nowMs: now });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('malformed');
    }
  });

  it('throws invalid-slot for slot outside [1, 9] in payload', () => {
    // Manually construct a token bypassing the encoder's slot check
    // to verify the decoder catches the same error.
    const evilPayload = {
      slot: 999,
      issuedAt: now,
      campaignFingerprint: fp
    };
    const evil = btoa(JSON.stringify(evilPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    try {
      decodeInviteToken(evil, { nowMs: now });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('invalid-slot');
    }
  });

  it('throws expired when token is older than maxAgeMs', () => {
    const old = encodeInviteToken({
      slot: 1,
      issuedAt: now - DEFAULT_MAX_AGE_MS - 1000,
      campaignFingerprint: fp
    });
    try {
      decodeInviteToken(old, { nowMs: now });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('expired');
    }
  });

  it('accepts a token at the edge of maxAgeMs (not expired yet)', () => {
    const onTheEdge = encodeInviteToken({
      slot: 1,
      issuedAt: now - DEFAULT_MAX_AGE_MS + 100,
      campaignFingerprint: fp
    });
    expect(() => decodeInviteToken(onTheEdge, { nowMs: now })).not.toThrow();
  });

  it('throws campaign-mismatch when expectedFingerprint differs', () => {
    try {
      decodeInviteToken(goodToken, {
        nowMs: now,
        expectedFingerprint: 'different-campaign'
      });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('campaign-mismatch');
    }
  });

  it('does NOT throw campaign-mismatch when expectedFingerprint is omitted', () => {
    // The fingerprint check is opt-in.  Useful for the player-side
    // flow before the campaign has loaded — we still want to
    // surface 'invalid-slot' / 'malformed' early.
    expect(() => decodeInviteToken(goodToken, { nowMs: now })).not.toThrow();
  });

  it('throws malformed when issuedAt is implausibly in the future', () => {
    const futureToken = encodeInviteToken({
      slot: 1,
      // 2 days in the future.
      issuedAt: now + 2 * 24 * 60 * 60 * 1000,
      campaignFingerprint: fp
    });
    try {
      decodeInviteToken(futureToken, { nowMs: now });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('malformed');
    }
  });

  it('tolerates a small clock-skew window into the future', () => {
    // < 24h in the future — accepted.  Outside the test's expiry
    // bounds but inside the "implausibly future" guard.
    const slightlyFuture = encodeInviteToken({
      slot: 1,
      issuedAt: now + 60 * 60 * 1000, // 1 hour ahead
      campaignFingerprint: fp
    });
    expect(() => decodeInviteToken(slightlyFuture, { nowMs: now })).not.toThrow();
  });

  it('honors a custom maxAgeMs override', () => {
    const tenMinToken = encodeInviteToken({
      slot: 1,
      issuedAt: now - 20 * 60 * 1000, // 20 min ago
      campaignFingerprint: fp
    });
    try {
      decodeInviteToken(tenMinToken, {
        nowMs: now,
        maxAgeMs: 10 * 60 * 1000 // 10 min cap
      });
      throw new Error('expected to throw');
    } catch (e) {
      expect((e as InviteTokenError).code).toBe('expired');
    }
  });
});
