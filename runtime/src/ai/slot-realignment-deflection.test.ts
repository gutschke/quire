// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  validateRealignmentResponse,
  type RealignmentBinding
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

describe('validateRealignmentResponse — deflection detector', () => {
  it.each([
    'This is a fragment from the episode\'s raw construction notes',
    'The "suggest pc renumbering" line appears to be a DM to-do item from the design phase',
    'You don\'t need to act on this now',
    'The renumbering will sort itself once your real players fill the PCs',
    'when you run the session, you\'ll mentally map them to your actual players',
    'The episode material uses {{pc:1}} through {{pc:5}} as placeholders',
    'a post-play task, not a pre-play one'
  ])('rejects meta-commentary (%s)', (excerpt) => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: true,
        reasoning: excerpt,
        permutation: []
      },
      BINDINGS
    );
    expect(
      issues.some((i) => i.toLowerCase().includes('deflected'))
    ).toBe(true);
  });

  it('accepts a concrete no-change rationale', () => {
    const issues = validateRealignmentResponse(
      {
        noChangeNeeded: true,
        reasoning:
          'Marcus Vance fits slot 1\'s bag-owner fingerprint well; Yui Tanaka fits slot 3\'s medic role.  No reassignment improves the overall fit.',
        permutation: []
      },
      BINDINGS
    );
    expect(issues).toEqual([]);
  });
});
