/**
 * AI schema tests (M3b.1) — AiResponse type guard + parse-failure
 * fallback shape.
 */

import { describe, it, expect } from 'vitest';
import {
  isAiResponse,
  isStateUpdate,
  isPcBackstorySynthesisResponse,
  parseFailureResponse
} from './schema';

describe('isAiResponse', () => {
  it('accepts a minimal well-shaped response', () => {
    expect(
      isAiResponse({
        safe: 'Hello',
        dmOnly: '',
        sources: [],
        raw: '',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'x'
      })
    ).toBe(true);
  });

  it('accepts a response missing the broker-filled fields (raw/tokens/id)', () => {
    // Provider returns just safe / dmOnly / sources; broker fills
    // raw, tokensIn, tokensOut, responseId.
    expect(
      isAiResponse({
        safe: 'Hello',
        dmOnly: 'spoiler',
        sources: [{ label: 'src' }]
      })
    ).toBe(true);
  });

  it('rejects null / non-object', () => {
    expect(isAiResponse(null)).toBe(false);
    expect(isAiResponse(undefined)).toBe(false);
    expect(isAiResponse('text')).toBe(false);
    expect(isAiResponse(42)).toBe(false);
  });

  it('rejects when safe is not a string', () => {
    expect(isAiResponse({ safe: 42, dmOnly: '', sources: [] })).toBe(false);
  });

  it('rejects when dmOnly is missing', () => {
    expect(isAiResponse({ safe: 'x', sources: [] })).toBe(false);
  });

  it('rejects when sources is not an array', () => {
    expect(isAiResponse({ safe: 'x', dmOnly: '', sources: 'no' })).toBe(false);
  });

  it('rejects when a source entry is malformed', () => {
    expect(
      isAiResponse({ safe: 'x', dmOnly: '', sources: [{ label: 42 }] })
    ).toBe(false);
  });

  it('accepts a source entry with optional path', () => {
    expect(
      isAiResponse({
        safe: 'x',
        dmOnly: '',
        sources: [{ label: 'a', path: 'episodes/intro.md' }]
      })
    ).toBe(true);
  });
});

describe('parseFailureResponse', () => {
  it('returns a degraded response with empty safe and an apologetic dmOnly', () => {
    const r = parseFailureResponse('garbage <text> output');
    expect(r.safe).toBe('');
    expect(r.dmOnly).toMatch(/not in the expected format/);
    expect(r.sources).toEqual([]);
    expect(r.raw).toBe('garbage <text> output');
  });

  it('shape is itself a valid AiResponse', () => {
    expect(isAiResponse(parseFailureResponse('x'))).toBe(true);
  });

  it('parseFailureResponse sets stateUpdates to [] (no AI writes on parse failure)', () => {
    expect(parseFailureResponse('x').stateUpdates).toEqual([]);
  });
});

describe('isStateUpdate (M3c.2)', () => {
  it('accepts a well-formed pc-edit', () => {
    expect(
      isStateUpdate({ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 })
    ).toBe(true);
  });

  it('accepts a well-formed dice-roll', () => {
    expect(
      isStateUpdate({
        kind: 'dice-roll',
        purpose: 'coin toss',
        expression: '2d6+2',
        modifierBreakdown: 'Yui DEX +1 + Costly cast +1'
      })
    ).toBe(true);
  });

  it('accepts a well-formed caster-state-set with the clear sentinel', () => {
    expect(
      isStateUpdate({
        kind: 'caster-state-set',
        pcId: 'timmy',
        ladderState: 'clear'
      })
    ).toBe(true);
  });

  it('rejects null / non-object', () => {
    expect(isStateUpdate(null)).toBe(false);
    expect(isStateUpdate('not an object')).toBe(false);
  });

  it('rejects unknown kind', () => {
    expect(isStateUpdate({ kind: 'something-else' })).toBe(false);
  });

  it('rejects pc-edit with missing required field', () => {
    expect(
      isStateUpdate({ kind: 'pc-edit', pcId: 'yui', delta: 1 })
    ).toBe(false);
    expect(
      isStateUpdate({ kind: 'pc-edit', field: 'harm', delta: 1 })
    ).toBe(false);
  });

  it('rejects pc-edit with wrong-type field (only harm/stress)', () => {
    expect(
      isStateUpdate({
        kind: 'pc-edit',
        pcId: 'yui',
        field: 'cha',
        delta: 1
      })
    ).toBe(false);
  });

  it('rejects pc-edit with non-finite or non-integer delta', () => {
    for (const delta of [NaN, Infinity, 1.5, -Infinity]) {
      expect(
        isStateUpdate({ kind: 'pc-edit', pcId: 'yui', field: 'harm', delta })
      ).toBe(false);
    }
  });

  it('rejects dice-roll with empty purpose or expression', () => {
    expect(
      isStateUpdate({ kind: 'dice-roll', purpose: '', expression: '2d6' })
    ).toBe(false);
    expect(
      isStateUpdate({ kind: 'dice-roll', purpose: 'climb', expression: '' })
    ).toBe(false);
  });

  it('rejects caster-state-set with empty-string ladderState (the footgun)', () => {
    expect(
      isStateUpdate({
        kind: 'caster-state-set',
        pcId: 'yui',
        ladderState: ''
      })
    ).toBe(false);
  });

  it('rejects caster-state-set with hostile spamCount (negative, NaN, float)', () => {
    for (const spamCount of [-1, NaN, 1.5, Infinity]) {
      expect(
        isStateUpdate({
          kind: 'caster-state-set',
          pcId: 'yui',
          ladderState: 'quiet',
          spamCount
        })
      ).toBe(false);
    }
  });
});

describe('isAiResponse — M3c.2 stateUpdates field', () => {
  it('accepts a response with no stateUpdates (back-compat)', () => {
    expect(
      isAiResponse({ safe: 'x', dmOnly: '', sources: [] })
    ).toBe(true);
  });

  it('accepts a response with empty stateUpdates array', () => {
    expect(
      isAiResponse({ safe: 'x', dmOnly: '', sources: [], stateUpdates: [] })
    ).toBe(true);
  });

  it('accepts a response with well-formed stateUpdates entries', () => {
    expect(
      isAiResponse({
        safe: 'x',
        dmOnly: '',
        sources: [],
        stateUpdates: [
          { kind: 'pc-edit', pcId: 'yui', field: 'harm', delta: 1 },
          {
            kind: 'caster-state-set',
            pcId: 'timmy',
            ladderState: 'noticed'
          }
        ]
      })
    ).toBe(true);
  });

  it('rejects when stateUpdates is wrong-typed (string)', () => {
    expect(
      isAiResponse({
        safe: 'x',
        dmOnly: '',
        sources: [],
        stateUpdates: 'not an array'
      })
    ).toBe(false);
  });

  it('rejects when any stateUpdates entry is malformed', () => {
    expect(
      isAiResponse({
        safe: 'x',
        dmOnly: '',
        sources: [],
        stateUpdates: [{ kind: 'unknown' }]
      })
    ).toBe(false);
  });
});

describe('isPcBackstorySynthesisResponse (CC-17)', () => {
  const valid = {
    name: 'Mei Tanaka',
    pronouns: 'she/her',
    tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
    backstory: 'Mei grew up watching ferries.',
    raw: '{}',
    tokensIn: 100,
    tokensOut: 250,
    responseId: 'syn-1'
  };

  it('accepts a well-shaped response', () => {
    expect(isPcBackstorySynthesisResponse(valid)).toBe(true);
  });

  it('rejects when name is empty', () => {
    expect(isPcBackstorySynthesisResponse({ ...valid, name: '' })).toBe(false);
  });

  it('rejects when name is missing', () => {
    const { name: _name, ...withoutName } = valid;
    void _name;
    expect(isPcBackstorySynthesisResponse(withoutName)).toBe(false);
  });

  it('rejects when pronouns is non-string', () => {
    expect(isPcBackstorySynthesisResponse({ ...valid, pronouns: null })).toBe(
      false
    );
  });

  it('accepts empty-string pronouns', () => {
    // Some players may decline to set pronouns; the guard accepts
    // empty (the structural validator at CC-21 may treat this as a
    // soft warning, not a hard reject).
    expect(isPcBackstorySynthesisResponse({ ...valid, pronouns: '' })).toBe(
      true
    );
  });

  it('rejects when backstory is empty', () => {
    expect(isPcBackstorySynthesisResponse({ ...valid, backstory: '' })).toBe(
      false
    );
  });

  it('rejects when tags is not an array', () => {
    expect(isPcBackstorySynthesisResponse({ ...valid, tags: 'a,b,c' })).toBe(
      false
    );
  });

  it('rejects when tags array is empty', () => {
    expect(isPcBackstorySynthesisResponse({ ...valid, tags: [] })).toBe(false);
  });

  it('rejects when any tag is non-string', () => {
    expect(
      isPcBackstorySynthesisResponse({ ...valid, tags: ['ok', 42, 'ok2'] })
    ).toBe(false);
  });

  it('rejects when any tag is empty string', () => {
    expect(
      isPcBackstorySynthesisResponse({ ...valid, tags: ['ok', '', 'ok2'] })
    ).toBe(false);
  });

  it('tolerates absence of broker-filled fields', () => {
    // raw/tokens/responseId are filled by the broker AFTER parsing;
    // a provider-side parse should satisfy the shape without them.
    const { raw: _r, tokensIn: _i, tokensOut: _o, responseId: _id, ...providerSide } = valid;
    void _r; void _i; void _o; void _id;
    expect(isPcBackstorySynthesisResponse(providerSide)).toBe(true);
  });

  it('rejects non-object inputs', () => {
    expect(isPcBackstorySynthesisResponse(null)).toBe(false);
    expect(isPcBackstorySynthesisResponse(undefined)).toBe(false);
    expect(isPcBackstorySynthesisResponse('string')).toBe(false);
    expect(isPcBackstorySynthesisResponse(42)).toBe(false);
  });
});
