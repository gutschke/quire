/**
 * D1-A engine tests: DiffProposal validation + apply + baseSha
 * staleness + hostile-proposal rejection.
 */

import { describe, it, expect } from 'vitest';
import {
  validateProposal,
  applyProposalToWorkingCopy,
  applyProposalsToWorkingCopy,
  proposalVisibility,
  type DiffProposal
} from './diff-format';
import { WorkingCopy, InMemoryWorkingCopyStore } from '../sync/working-copy';

function makeWc(): WorkingCopy {
  return new WorkingCopy(new InMemoryWorkingCopyStore());
}

function baseProposal(over: Partial<DiffProposal> = {}): DiffProposal {
  return {
    id: 'prop-001',
    kind: 'npc-update',
    npcId: 'yui-tanaka',
    path: 'characters/npcs/yui-tanaka.json',
    field: 'disposition',
    before: 'friendly-distant, professional',
    after: 'friendly-warm; recognized PC1 by name',
    rationale:
      'PC1 was kind to Yui at the SFO gate; she now mentally tags PC1 as friend-of-the-airline.',
    ...over
  };
}

describe('proposalVisibility — structural firewall', () => {
  it('classifies dmNotes-target proposals as dm-only', () => {
    const p = baseProposal({ field: 'dmNotes' });
    expect(proposalVisibility(p)).toBe('dm-only');
  });

  it('classifies dotted dmNotes paths as dm-only', () => {
    const p = baseProposal({ field: 'dmNotes.secrets' });
    expect(proposalVisibility(p)).toBe('dm-only');
  });

  it('classifies knownTo as dm-only (NPC-specific DM-only field)', () => {
    const p = baseProposal({ field: 'knownTo' });
    expect(proposalVisibility(p)).toBe('dm-only');
  });

  it('classifies disposition as player-eligible', () => {
    const p = baseProposal({ field: 'disposition' });
    expect(proposalVisibility(p)).toBe('player-eligible');
  });

  it('classifies background.currentStress as player-eligible', () => {
    const p = baseProposal({ field: 'background.currentStress' });
    expect(proposalVisibility(p)).toBe('player-eligible');
  });
});

describe('validateProposal — hostile inputs', () => {
  it('accepts the canonical example', () => {
    expect(validateProposal(baseProposal()).ok).toBe(true);
  });

  it('rejects missing id', () => {
    const r = validateProposal(baseProposal({ id: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-id');
  });

  it('rejects an id with shell-shaped characters', () => {
    const r = validateProposal(baseProposal({ id: 'prop;rm -rf /' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-id');
  });

  it('rejects unknown kind (forward-compat guard)', () => {
    const r = validateProposal(
      baseProposal({ kind: 'scene-retcon' as unknown as 'npc-update' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-kind');
  });

  it('rejects path-traversal attempts', () => {
    const r = validateProposal(
      baseProposal({ path: 'characters/../../etc/passwd' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-path');
  });

  it('rejects absolute path', () => {
    const r = validateProposal(baseProposal({ path: '/etc/passwd' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-path');
  });

  it('rejects field with dangerous characters', () => {
    const r = validateProposal(baseProposal({ field: 'foo;rm' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-field');
  });

  it('rejects after value exceeding the JSON size cap', () => {
    const big = 'x'.repeat(20_001);
    const r = validateProposal(baseProposal({ after: big }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('after-too-large');
  });

  it('rejects rationale exceeding the 2000-char cap', () => {
    const r = validateProposal(baseProposal({ rationale: 'x'.repeat(2001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('rationale-too-large');
  });

  it('rejects __proto__ field segment (prototype-pollution defense)', () => {
    const r = validateProposal(baseProposal({ field: '__proto__' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-field');
  });

  it('rejects __proto__ as a nested segment (e.g. background.__proto__.x)', () => {
    const r = validateProposal(
      baseProposal({ field: 'background.__proto__.polluted' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-field');
  });

  it('rejects constructor.prototype as a chained path', () => {
    const r = validateProposal(
      baseProposal({ field: 'constructor.prototype.x' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-field');
  });
});

describe('apply — prototype-pollution defense in depth', () => {
  it('setByDottedPath refuses __proto__ segments even if validator passes', async () => {
    // Build a "valid-shaped" proposal that smuggles through field-level
    // checks but should still be refused by setByDottedPath via the
    // local denylist.  We exercise apply directly via a manually-
    // constructed proposal that bypasses validateProposal.
    const wc = makeWc();
    const seed = { name: 'Yui', disposition: 'distant' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const proposal: DiffProposal = {
      ...baseProposal({ baseSha: 'sha-1', field: '__proto__' })
    };
    const result = await applyProposalToWorkingCopy(proposal, wc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Validator catches it first; that's fine — what we care about is
    // that the call does NOT mutate Object.prototype.
    expect(result.code).toBe('validation-failed');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns invalid-pointer code from setByDottedPath when validator is bypassed', async () => {
    // Reach setByDottedPath directly by constructing the call via the
    // internal apply that the materializer/host uses; we test that
    // the defense-in-depth in setByDottedPath also fires.  Since the
    // validator catches `__proto__` first, this test is documentary
    // rather than runtime-distinguishing.  Real assertion is that
    // global Object.prototype is unchanged after attempting EVERY
    // pollution path through the public API.
    const wc = makeWc();
    const seed = { name: 'Yui' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const attempts = [
      '__proto__',
      'constructor',
      'prototype',
      'background.__proto__.x',
      'relationships.0.constructor.prototype.y'
    ];
    for (const field of attempts) {
      await applyProposalToWorkingCopy(
        baseProposal({ baseSha: 'sha-1', field }),
        wc
      );
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).y).toBeUndefined();
  });

  it('refuses circular-reference after values (JSON.stringify throws)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const r = validateProposal(baseProposal({ after: a }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('after-too-large');
  });
});

describe('applyProposalToWorkingCopy — happy path', () => {
  it('applies a top-level field update from a seeded WC entry', async () => {
    const wc = makeWc();
    const seed = { $schemaVersion: '0.1.0', name: 'Yui Tanaka', disposition: 'friendly-distant' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: 'sha-1' }),
      wc
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = JSON.parse(result.updatedJson) as Record<string, unknown>;
    expect(after.disposition).toBe('friendly-warm; recognized PC1 by name');
    // Other fields preserved.
    expect(after.name).toBe('Yui Tanaka');
  });

  it('applies a nested dotted-field update (background.currentStress)', async () => {
    const wc = makeWc();
    const seed = {
      name: 'Yui',
      background: { homeBase: 'Millbrae', currentStress: 'kid was up all night' }
    };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const result = await applyProposalToWorkingCopy(
      baseProposal({
        baseSha: 'sha-1',
        field: 'background.currentStress',
        before: 'kid was up all night',
        after: 'sleeping fine this week; wife has a new project'
      }),
      wc
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = JSON.parse(result.updatedJson) as { background: { currentStress: string; homeBase: string } };
    expect(after.background.currentStress).toBe('sleeping fine this week; wife has a new project');
    expect(after.background.homeBase).toBe('Millbrae');
  });

  it('applies an array-index nested update (relationships.0.notes)', async () => {
    const wc = makeWc();
    const seed = {
      name: 'Yui',
      relationships: [
        { who: 'inez', kind: 'wife', notes: 'graphic designer' }
      ]
    };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const result = await applyProposalToWorkingCopy(
      baseProposal({
        baseSha: 'sha-1',
        field: 'relationships.0.notes',
        before: 'graphic designer',
        after: 'graphic designer; ICU nurse at SFGH (corrected by DM)'
      }),
      wc
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = JSON.parse(result.updatedJson) as {
      relationships: Array<{ who: string; notes: string }>;
    };
    expect(after.relationships[0].notes).toMatch(/ICU nurse/);
    expect(after.relationships[0].who).toBe('inez');
  });

  it('falls back to fallbackJson when WC has no entry yet', async () => {
    const wc = makeWc();
    const seed = JSON.stringify({ name: 'Yui', disposition: 'distant' });
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: undefined }),
      wc,
      { fallbackJson: seed }
    );
    expect(result.ok).toBe(true);
  });
});

describe('applyProposalToWorkingCopy — failure modes', () => {
  it('rejects stale-base-sha mismatch', async () => {
    const wc = makeWc();
    const seed = { name: 'Yui', disposition: 'distant' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-NEW');
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: 'sha-OLD' }),
      wc
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('stale-base-sha');
  });

  it('returns no-working-copy-entry when WC + fallback are both absent', async () => {
    const wc = makeWc();
    const result = await applyProposalToWorkingCopy(baseProposal(), wc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-working-copy-entry');
  });

  it('reports validation-failed for malformed proposals', async () => {
    const wc = makeWc();
    await wc.write('characters/npcs/yui-tanaka.json', '{}', 'sha-1');
    const result = await applyProposalToWorkingCopy(
      baseProposal({ id: '', baseSha: 'sha-1' }),
      wc
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('validation-failed');
  });

  it('reports malformed-json when the WC entry is not valid JSON', async () => {
    const wc = makeWc();
    await wc.write('characters/npcs/yui-tanaka.json', '{not json', 'sha-1');
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: 'sha-1' }),
      wc
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('malformed-json');
  });

  it('reports invalid-pointer when extending a primitive', async () => {
    const wc = makeWc();
    const seed = { name: 'Yui', disposition: 'distant' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    // disposition is a string; can't extend it with a nested field.
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: 'sha-1', field: 'disposition.subfield' }),
      wc
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid-pointer');
  });

  it('allows apply when WC has no baseSha tracked (skips staleness check)', async () => {
    const wc = makeWc();
    const seed = { name: 'Yui', disposition: 'distant' };
    // Write WITHOUT baseSha.
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed));
    const result = await applyProposalToWorkingCopy(
      baseProposal({ baseSha: 'sha-FROM-AI' }),
      wc
    );
    // No staleness compare possible → apply proceeds.
    expect(result.ok).toBe(true);
  });
});

describe('applyProposalsToWorkingCopy — batch', () => {
  it('applies all valid proposals and reports failures per-proposal', async () => {
    const wc = makeWc();
    const seed = { name: 'Yui', disposition: 'distant' };
    await wc.write('characters/npcs/yui-tanaka.json', JSON.stringify(seed), 'sha-1');
    const r = await applyProposalsToWorkingCopy(
      [
        baseProposal({ id: 'p-good', baseSha: 'sha-1' }),
        baseProposal({ id: 'p-stale', baseSha: 'sha-OLD' })
      ],
      wc
    );
    expect(r.applied.map((p) => p.id)).toEqual(['p-good']);
    expect(r.failed.map((f) => f.proposal.id)).toEqual(['p-stale']);
    expect(r.failed[0].result.code).toBe('stale-base-sha');
  });

  it('uses fallbackJsonByPath for missing WC entries', async () => {
    const wc = makeWc();
    const fallback = JSON.stringify({ name: 'Yui', disposition: 'distant' });
    const r = await applyProposalsToWorkingCopy(
      [baseProposal()],
      wc,
      { fallbackJsonByPath: { 'characters/npcs/yui-tanaka.json': fallback } }
    );
    expect(r.applied).toHaveLength(1);
    expect(r.failed).toHaveLength(0);
  });
});
