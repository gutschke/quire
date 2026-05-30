/**
 * Cloud-push consent ledger — unit tests (OP-027 / DEC-011 / DEC-020).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONSENT_COPY,
  consentKey,
  hasAcknowledged,
  inMemoryConsentStorage,
  recordAcknowledgment,
  withdrawAcknowledgment,
  type ConsentDestination
} from './cloud-push-consent';

const CAMPAIGN_A = 'owner/repo@main';
const CAMPAIGN_B = 'other/campaign@main';

describe('consentKey — storage key contract', () => {
  it('produces a stable, recognizable key', () => {
    expect(consentKey(CAMPAIGN_A, 'google-drive-appdata')).toBe(
      'quire.cloud-consent.google-drive-appdata.owner%2Frepo%40main'
    );
  });

  it('URL-encodes campaign id components that could collide with the separator', () => {
    // A pathological campaign id that contains both `.` and `:` —
    // encoding handles both via standard URL encoding so the key
    // structure stays parseable.
    const key = consentKey('weird/campaign:1.0', 'github-public');
    // We don't pin the exact encoding (browser encoders may differ
    // on which chars they pass through) — only the safety property:
    // the encoded form must not contain the separator literal in a
    // way that collides with the destination segment.
    expect(key.startsWith('quire.cloud-consent.github-public.')).toBe(
      true
    );
    const suffix = key.slice('quire.cloud-consent.github-public.'.length);
    // The suffix should round-trip through decodeURIComponent.
    expect(decodeURIComponent(suffix)).toBe('weird/campaign:1.0');
  });

  it('different destinations yield different keys for the same campaign', () => {
    expect(
      consentKey(CAMPAIGN_A, 'google-drive-appdata')
    ).not.toBe(consentKey(CAMPAIGN_A, 'github-public'));
  });
});

describe('hasAcknowledged — fresh storage', () => {
  it('returns false when no record exists', () => {
    const s = inMemoryConsentStorage();
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });
});

describe('recordAcknowledgment + hasAcknowledged round-trip', () => {
  it('records and reads back', () => {
    const s = inMemoryConsentStorage();
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_000);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      true
    );
  });

  it('is per-campaign', () => {
    const s = inMemoryConsentStorage();
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_000);
    expect(hasAcknowledged(s, CAMPAIGN_B, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('is per-destination', () => {
    const s = inMemoryConsentStorage();
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_000);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'github-public')).toBe(false);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-file')).toBe(false);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'github-private')).toBe(false);
  });

  it('is idempotent', () => {
    const s = inMemoryConsentStorage();
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_000);
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_001);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      true
    );
  });
});

describe('withdrawAcknowledgment', () => {
  it('flips a previously-acknowledged pair back to unacknowledged', () => {
    const s = inMemoryConsentStorage();
    recordAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata', 1_700_000_000);
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      true
    );
    withdrawAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata');
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('is a no-op on an unacknowledged pair', () => {
    const s = inMemoryConsentStorage();
    expect(() =>
      withdrawAcknowledgment(s, CAMPAIGN_A, 'google-drive-appdata')
    ).not.toThrow();
  });
});

describe('hasAcknowledged — fail-closed defenses', () => {
  it('returns false when JSON is corrupt', () => {
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      '{not valid json'
    );
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('returns false when the version is unknown', () => {
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      JSON.stringify({
        v: 999,
        acknowledgedAt: 1,
        campaignId: CAMPAIGN_A,
        destination: 'google-drive-appdata'
      })
    );
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('returns false when the campaignId inside the record disagrees with the lookup', () => {
    // Defense in depth: an attacker who manages to write a
    // record under campaign A's key with campaign B's id inside
    // shouldn't bypass the prompt for campaign A.
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      JSON.stringify({
        v: 1,
        acknowledgedAt: 1,
        campaignId: CAMPAIGN_B,
        destination: 'google-drive-appdata'
      })
    );
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('returns false when the destination inside the record disagrees with the lookup', () => {
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      JSON.stringify({
        v: 1,
        acknowledgedAt: 1,
        campaignId: CAMPAIGN_A,
        destination: 'github-public'
      })
    );
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('returns false when acknowledgedAt is not a number', () => {
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      JSON.stringify({
        v: 1,
        acknowledgedAt: 'yesterday',
        campaignId: CAMPAIGN_A,
        destination: 'google-drive-appdata'
      })
    );
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });

  it('returns false on NaN acknowledgedAt', () => {
    const s = inMemoryConsentStorage();
    s.write(
      consentKey(CAMPAIGN_A, 'google-drive-appdata'),
      JSON.stringify({
        v: 1,
        acknowledgedAt: Number.NaN,
        campaignId: CAMPAIGN_A,
        destination: 'google-drive-appdata'
      })
    );
    // JSON.stringify(NaN) = "null", so the parsed acknowledgedAt
    // is null/undefined and rejected as "not a number".
    expect(hasAcknowledged(s, CAMPAIGN_A, 'google-drive-appdata')).toBe(
      false
    );
  });
});

describe('per-destination acknowledgment independence', () => {
  const destinations: ConsentDestination[] = [
    'google-drive-appdata',
    'google-drive-file',
    'github-private',
    'github-public'
  ];

  it('acknowledging one destination does not bleed into others', () => {
    for (const target of destinations) {
      const s = inMemoryConsentStorage();
      recordAcknowledgment(s, CAMPAIGN_A, target, 1_700_000_000);
      for (const other of destinations) {
        expect(hasAcknowledged(s, CAMPAIGN_A, other)).toBe(other === target);
      }
    }
  });
});

describe('DEFAULT_CONSENT_COPY — semantic-spec smoke check', () => {
  it('mentions the destination explicitly', () => {
    const allText = [
      DEFAULT_CONSENT_COPY.title,
      ...DEFAULT_CONSENT_COPY.body
    ].join(' ');
    expect(/drive/i.test(allText)).toBe(true);
  });

  it('mentions player-authored content categories', () => {
    const allText = DEFAULT_CONSENT_COPY.body.join(' ');
    expect(/chat/i.test(allText)).toBe(true);
    expect(/character|bond/i.test(allText)).toBe(true);
  });

  it('reassures about player visibility (they can read what they wrote)', () => {
    const allText = DEFAULT_CONSENT_COPY.body.join(' ');
    expect(/players can read/i.test(allText)).toBe(true);
  });

  it('clarifies that the Drive folder is not player-visible', () => {
    const allText = DEFAULT_CONSENT_COPY.body.join(' ');
    expect(/cannot see/i.test(allText)).toBe(true);
  });

  it('has a single non-empty acknowledge label', () => {
    expect(DEFAULT_CONSENT_COPY.acknowledgeLabel.length).toBeGreaterThan(0);
  });

  it('has a non-empty cancel label so the dialog is dismissable', () => {
    expect(DEFAULT_CONSENT_COPY.cancelLabel.length).toBeGreaterThan(0);
  });
});
