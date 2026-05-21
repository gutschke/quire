import { describe, it, expect } from 'vitest';
import { generatePairingCode } from './session-peerjs';

describe('generatePairingCode', () => {
  it('returns a string of the requested length (default 6 — see DEFAULT_PAIRING_CODE_LENGTH)', () => {
    expect(generatePairingCode().length).toBe(6);
    expect(generatePairingCode(12).length).toBe(12);
  });

  it('uses only confusion-safe base32 alphabet', () => {
    for (let i = 0; i < 100; i++) {
      expect(generatePairingCode()).toMatch(/^[A-Z2-9]+$/);
      // Must NOT contain easily-confused chars.
      expect(generatePairingCode()).not.toMatch(/[0OIL1]/);
    }
  });

  it('produces varied codes (entropy sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generatePairingCode());
    // 50 draws from 31^6 = ~840M should essentially never collide.
    expect(seen.size).toBe(50);
  });
});
