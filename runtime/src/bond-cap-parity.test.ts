// @vitest-environment node

/**
 * D5.5-B review round-3 guard (2026-05-27): the chargen-pack bond
 * draft caps and the engine bond caps are defined in two separate
 * modules (chargen-pack.ts is a player-device module that can't
 * import the engine core without coupling).  They were kept in
 * sync only by hand-written "matches the engine cap" comments —
 * nothing failed if someone bumped one side.  This guard asserts
 * the two stay equal so a future desync is caught at CI rather
 * than as a silent over-cap drop at the materializer boundary.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_BOND_TARGET_LEN,
  MAX_BOND_TEXT_LEN
} from './chargen-pack';
import {
  BOND_TARGET_PLACEHOLDER_MAX,
  BOND_TEXT_MAX
} from './core/state';

describe('bond cap parity (chargen-pack ↔ engine)', () => {
  it('placeholder/target length cap matches', () => {
    expect(MAX_BOND_TARGET_LEN).toBe(BOND_TARGET_PLACEHOLDER_MAX);
  });

  it('bond text length cap matches', () => {
    expect(MAX_BOND_TEXT_LEN).toBe(BOND_TEXT_MAX);
  });
});
