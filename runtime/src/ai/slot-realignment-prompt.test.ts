// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  buildSlotRealignmentPrompt,
  validateRealignmentResponse,
  type SlotRealignmentBinding,
  type SlotRealignmentPcSheet
} from './slot-realignment-prompt';

const BINDINGS: SlotRealignmentBinding[] = [
  { slot: 1, playerName: 'Markus', pcId: 'pc-marcus', pcName: 'Marcus Vance' },
  { slot: 2, playerName: 'Yui', pcId: 'pc-yui', pcName: 'Yui Tanaka' }
];

const PCS: SlotRealignmentPcSheet[] = [
  {
    pcId: 'pc-marcus',
    name: 'Marcus Vance',
    backstory: 'A hacker who learned to hold intent under government pressure.',
    tags: ['hacker', 'ex-government'],
    alignment: 'chaotic-good',
    pronouns: 'he/him'
  },
  {
    pcId: 'pc-yui',
    name: 'Yui Tanaka',
    backstory:
      'A nurse who stabilized a man on the highway when bystanders insisted she stop.',
    tags: ['nurse', 'first responder'],
    alignment: 'chaotic-neutral',
    pronouns: 'she/her'
  }
];

describe('buildSlotRealignmentPrompt', () => {
  it('includes both players, both PCs, and the digest in the user prompt', () => {
    const { system, user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      playerSamples: [
        {
          playerName: 'Markus',
          chatLines: ['I check his vitals first', 'I stabilize him']
        },
        {
          playerName: 'Yui',
          chatLines: ['I look for an open SSH port']
        }
      ],
      recentDigestMarkdown: 'Markus stabilized the man on the highway.'
    });
    expect(system).toContain('co-DM');
    expect(user).toContain('Slot 1');
    expect(user).toContain('Marcus Vance');
    expect(user).toContain('Yui Tanaka');
    expect(user).toContain('Markus');
    expect(user).toContain('I check his vitals');
    expect(user).toContain('I look for an open SSH port');
    expect(user).toContain('stabilized the man on the highway');
  });

  it('wraps dmGuidance in untrusted_content', () => {
    const { user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      playerSamples: [],
      dmGuidance: 'Markus seems frustrated — try a different PC.'
    });
    expect(user).toContain('<untrusted_content source="dm-realignment-guidance">');
    expect(user).toContain('Markus seems frustrated');
  });

  it('omits sections when inputs are absent', () => {
    const { user } = buildSlotRealignmentPrompt({
      bindings: BINDINGS,
      pcs: PCS,
      playerSamples: []
    });
    expect(user).not.toContain('# Recent session digest');
    expect(user).not.toContain('# Player voice samples');
    expect(user).not.toContain('# DM guidance');
  });
});

describe('validateRealignmentResponse', () => {
  it('accepts a valid swap', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: 'Markus played the medic, Yui played the hacker.',
        proposals: [
          {
            slot: 1,
            currentPcId: 'pc-marcus',
            proposedPcId: 'pc-yui',
            rationale: 'Markus kept stabilizing patients.'
          },
          {
            slot: 2,
            currentPcId: 'pc-yui',
            proposedPcId: 'pc-marcus',
            rationale: 'Yui kept opening SSH sessions.'
          }
        ]
      },
      BINDINGS,
      PCS
    );
    expect(issues).toEqual([]);
  });

  it('rejects a proposal that introduces an unknown pcId', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        proposals: [
          {
            slot: 1,
            currentPcId: 'pc-marcus',
            proposedPcId: 'pc-invented',
            rationale: 'AI hallucinated.'
          }
        ]
      },
      BINDINGS,
      PCS
    );
    expect(issues.some((i) => i.includes('pc-invented'))).toBe(true);
  });

  it('rejects duplicate proposed pcIds (invalid permutation)', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        proposals: [
          {
            slot: 1,
            currentPcId: 'pc-marcus',
            proposedPcId: 'pc-yui',
            rationale: 'a'
          },
          {
            slot: 2,
            currentPcId: 'pc-yui',
            proposedPcId: 'pc-yui',
            rationale: 'b'
          }
        ]
      },
      BINDINGS,
      PCS
    );
    expect(
      issues.some((i) => i.includes('multiple proposals') && i.includes('pc-yui'))
    ).toBe(true);
  });

  it('rejects currentPcId mismatch (AI mislabeled current state)', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: false,
        reasoning: '',
        proposals: [
          {
            slot: 1,
            currentPcId: 'pc-WRONG',
            proposedPcId: 'pc-yui',
            rationale: ''
          }
        ]
      },
      BINDINGS,
      PCS
    );
    expect(issues.some((i) => i.includes('mismatch'))).toBe(true);
  });
});
