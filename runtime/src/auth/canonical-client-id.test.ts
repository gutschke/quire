/**
 * Canonical OAuth client_id baseline — unit tests (OP-017g, OP-018).
 *
 * Tests the value-resolution + placeholder-refusal semantics of
 * `src/auth/canonical-client-id.ts`.  The golden-diff for the
 * checked-in baseline values lives in
 * `scripts/golden-diff-canonical-client-id.test.mjs`.
 */

import { describe, expect, it } from 'vitest';
import {
  GITHUB,
  GOOGLE,
  assertReadyForOAuth,
  isReadyForOAuth,
  resolveClientId,
  type CanonicalClientIdEntry
} from './canonical-client-id';

describe('canonical-client-id baseline shape', () => {
  it('GOOGLE has the expected provider key', () => {
    expect(GOOGLE.provider).toBe('google');
  });

  it('GITHUB has the expected provider key', () => {
    expect(GITHUB.provider).toBe('github');
  });

  it('GOOGLE.clientId is a non-empty string', () => {
    expect(typeof GOOGLE.clientId).toBe('string');
    expect(GOOGLE.clientId.length).toBeGreaterThan(0);
  });

  it('GOOGLE fingerprint is 64 hex chars (SHA-256 length)', () => {
    expect(GOOGLE.consentAppNameFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GITHUB fingerprint is 64 hex chars (SHA-256 length)', () => {
    expect(GITHUB.consentAppNameFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GOOGLE.allowDiscoveryOverride defaults to false (fail-closed)', () => {
    // The discovery-doc override is opt-in per-entry.  v1 ships
    // closed; if we ever flip this to true the golden-diff catches
    // it as a load-bearing change.
    expect(GOOGLE.allowDiscoveryOverride).toBe(false);
  });

  it('GITHUB.allowDiscoveryOverride defaults to false (fail-closed)', () => {
    expect(GITHUB.allowDiscoveryOverride).toBe(false);
  });
});

describe('assertReadyForOAuth — placeholder refusal', () => {
  it('throws on a placeholder entry (Google)', () => {
    const placeholder: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'placeholder',
      clientId: 'PROBE_BOGUS_CLIENT_ID.apps.googleusercontent.com',
      consentAppNameFingerprint: '0'.repeat(64),
      allowDiscoveryOverride: false
    };
    expect(() => assertReadyForOAuth(placeholder)).toThrow(
      /cloud sync \(google\) is not yet available/i
    );
  });

  it('throws on a placeholder entry (GitHub)', () => {
    expect(() => assertReadyForOAuth(GITHUB)).toThrow(
      /cloud sync \(github\) is not yet available/i
    );
  });

  it('throws on the current GOOGLE baseline (still placeholder pre-M6a)', () => {
    // This test is the M6a code-ship checkpoint: when the
    // maintainer registers the real OAuth app and flips
    // GOOGLE.status to 'verified', this assertion FLIPS — and
    // the failure message tells the program lead to update the
    // test to assert no-throw.  The flip is the moment cloud
    // sync goes live.
    expect(() => assertReadyForOAuth(GOOGLE)).toThrow();
  });

  it('passes for a verified entry', () => {
    const verified: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'verified',
      clientId: '1234567890.apps.googleusercontent.com',
      consentAppNameFingerprint:
        'a'.repeat(64),
      allowDiscoveryOverride: false
    };
    expect(() => assertReadyForOAuth(verified)).not.toThrow();
  });

  it('treats unknown status as fail-closed', () => {
    // Defense in depth: a typo or future-status string must NOT
    // bypass the refusal.  TypeScript would catch this at the
    // type level; the runtime check catches it if a future
    // refactor widens the type.
    const weird = {
      provider: 'google',
      status: 'maybe' as unknown as 'verified',
      clientId: 'x.apps.googleusercontent.com',
      consentAppNameFingerprint: 'a'.repeat(64),
      allowDiscoveryOverride: false
    } as CanonicalClientIdEntry;
    expect(() => assertReadyForOAuth(weird)).toThrow();
  });
});

describe('isReadyForOAuth — UI-friendly predicate', () => {
  it('returns false for the placeholder GOOGLE baseline', () => {
    expect(isReadyForOAuth(GOOGLE)).toBe(false);
  });

  it('returns false for the placeholder GITHUB baseline', () => {
    expect(isReadyForOAuth(GITHUB)).toBe(false);
  });

  it('returns true for a verified entry', () => {
    const verified: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'verified',
      clientId: '1234567890.apps.googleusercontent.com',
      consentAppNameFingerprint: 'b'.repeat(64),
      allowDiscoveryOverride: false
    };
    expect(isReadyForOAuth(verified)).toBe(true);
  });
});

describe('resolveClientId — precedence', () => {
  it('returns the embedded baseline when no override and status verified', () => {
    const verified: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'verified',
      clientId: 'good.apps.googleusercontent.com',
      consentAppNameFingerprint: 'c'.repeat(64),
      allowDiscoveryOverride: false
    };
    const r = resolveClientId(verified, undefined);
    expect(r).toEqual({
      clientId: 'good.apps.googleusercontent.com',
      source: 'baseline'
    });
  });

  it('returns the env override when provided (self-host)', () => {
    const verified: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'verified',
      clientId: 'good.apps.googleusercontent.com',
      consentAppNameFingerprint: 'c'.repeat(64),
      allowDiscoveryOverride: false
    };
    const r = resolveClientId(verified, 'self-host.apps.googleusercontent.com');
    expect(r).toEqual({
      clientId: 'self-host.apps.googleusercontent.com',
      source: 'env-override'
    });
  });

  it('env override takes precedence over baseline regardless of status', () => {
    // A self-hoster who supplied their own client_id should be
    // able to ship the cloud-sync flow against THEIR app, even
    // on a placeholder build.  (The runtime's UI gate uses
    // isReadyForOAuth on the resolved value's source — env-
    // override flips it ready; this test pins the value.)
    const r = resolveClientId(GOOGLE, 'self.apps.googleusercontent.com');
    expect(r.source).toBe('env-override');
    expect(r.clientId).toBe('self.apps.googleusercontent.com');
  });

  it('empty-string env override is ignored (treated as no override)', () => {
    // Defends against an environment variable that's set but
    // empty (`QUIRE_OAUTH_CLIENT_ID_GOOGLE=` in a shell would
    // do this); we want the baseline path, not an empty
    // clientId routed to Google.
    const verified: CanonicalClientIdEntry = {
      provider: 'google',
      status: 'verified',
      clientId: 'good.apps.googleusercontent.com',
      consentAppNameFingerprint: 'c'.repeat(64),
      allowDiscoveryOverride: false
    };
    const r = resolveClientId(verified, '');
    expect(r.source).toBe('baseline');
  });

  it('returns the placeholder client_id with source=placeholder for unverified baseline', () => {
    // Lets the UI surface a discrete "cloud sync not yet live"
    // affordance based on the source field, without needing a
    // separate isReady check.
    const r = resolveClientId(GOOGLE, undefined);
    expect(r.source).toBe('placeholder');
    expect(r.clientId).toBe(GOOGLE.clientId);
  });
});
