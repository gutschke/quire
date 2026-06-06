// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  buildSlotRealignmentPrompt,
  validateRealignmentResponse,
  type RealignmentBinding,
  type RealignmentPcSheet
} from './slot-realignment-prompt';

const BINDINGS: RealignmentBinding[] = [
  {
    slot: 1,
    playerName: 'Markus',
    pcId: 'pc-marcus',
    pcName: 'Marcus Vance',
    peerId: 'peer-markus'
  },
  {
    slot: 3,
    playerName: 'Yui',
    pcId: 'pc-yui',
    pcName: 'Yui Tanaka',
    peerId: 'peer-yui'
  }
];

const PCS: RealignmentPcSheet[] = [
  {
    pcId: 'pc-marcus',
    name: 'Marcus Vance',
    backstory: 'A hacker with a Flipper Zero who ran red-team work.',
    tags: ['hacker', 'ex-government'],
    alignment: 'chaotic-good',
    pronouns: 'he/him'
  },
  {
    pcId: 'pc-yui',
    name: 'Yui Tanaka',
    backstory: 'A nurse who stabilized a man on the highway.',
    tags: ['nurse'],
    alignment: 'chaotic-neutral',
    pronouns: 'she/her'
  }
];

describe('buildSlotRealignmentPrompt (v2 pair-atomic)', () => {
  it('renders bindings with both names AND peerIds (pairs as atomic)', () => {
    const { system, user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      slotFingerprints: [],
      playerSamples: []
    });
    expect(system).toContain('Pairs are ATOMIC');
    expect(system).toContain('slot LABEL');
    expect(user).toContain('peer-markus');
    expect(user).toContain('peer-yui');
    expect(user).toContain('player "Markus"');
    expect(user).toContain('PC "Marcus Vance"');
  });

  it('includes slot fingerprints with excerpts when provided', () => {
    const { user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      slotFingerprints: [
        {
          slot: 3,
          mentions: 2,
          excerpts: [
            {
              path: 'scenes/03-the-hack.md',
              excerpt: '{{pc:3}} carries a small SDR and runs an open-source decoder.'
            }
          ]
        }
      ],
      playerSamples: []
    });
    expect(user).toContain('# Slot fingerprints');
    expect(user).toContain('scenes/03-the-hack.md');
    expect(user).toContain('SDR');
    expect(user).toContain('slot 3');
  });

  it('tells AI to default to noChangeNeeded when there are no fingerprints', () => {
    const { user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      slotFingerprints: [],
      playerSamples: []
    });
    expect(user).toContain('Default to noChangeNeeded=true');
  });
});

describe('validateRealignmentResponse (v2 pair-atomic)', () => {
  it('accepts a valid swap permutation', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: 'The hack scene is slot 3; Marcus fits slot 3.',
        permutation: [
          {
            newSlot: 3,
            pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
            currentSlot: 1,
            slotFingerprintMatched: 'SDR / radio hobbyist',
            rationale: 'Marcus is the hacker; pc:3 carries the SDR.'
          },
          {
            newSlot: 1,
            pairKey: { pcId: 'pc-yui', peerId: 'peer-yui' },
            currentSlot: 3,
            slotFingerprintMatched: 'bag carrier at the gate',
            rationale: 'Yui can carry the kit; pc:1 holds the bag.'
          }
        ]
      },
      BINDINGS
    );
    expect(issues).toEqual([]);
  });

  it('rejects splitting a pair (currentSlot pairKey mismatch)', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        permutation: [
          {
            newSlot: 3,
            // pair-split attempt — slot 1 actually has pc-marcus + peer-markus
            pairKey: { pcId: 'pc-yui', peerId: 'peer-markus' },
            currentSlot: 1,
            slotFingerprintMatched: '',
            rationale: ''
          }
        ]
      },
      BINDINGS
    );
    expect(
      issues.some((i) => i.includes('pair mismatch'))
    ).toBe(true);
  });

  it('rejects when noChangeNeeded conflicts with non-empty permutation', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: true,
        reasoning: '',
        permutation: [
          {
            newSlot: 3,
            pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
            currentSlot: 1,
            slotFingerprintMatched: '',
            rationale: ''
          }
        ]
      },
      BINDINGS
    );
    expect(
      issues.some((i) => i.includes('noChangeNeeded=true'))
    ).toBe(true);
  });

  it('rejects duplicate newSlots (invalid bijection)', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        permutation: [
          {
            newSlot: 3,
            pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
            currentSlot: 1,
            slotFingerprintMatched: '',
            rationale: ''
          },
          {
            newSlot: 3, // duplicate
            pairKey: { pcId: 'pc-yui', peerId: 'peer-yui' },
            currentSlot: 3,
            slotFingerprintMatched: '',
            rationale: ''
          }
        ]
      },
      BINDINGS
    );
    expect(
      issues.some((i) => i.includes('newSlot 3 appears more than once'))
    ).toBe(true);
  });

  it('rejects unknown slot indices', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        permutation: [
          {
            newSlot: 99,
            pairKey: { pcId: 'pc-marcus', peerId: 'peer-markus' },
            currentSlot: 1,
            slotFingerprintMatched: '',
            rationale: ''
          }
        ]
      },
      BINDINGS
    );
    expect(
      issues.some((i) => i.includes('newSlot 99 is not a known slot'))
    ).toBe(true);
  });
});
