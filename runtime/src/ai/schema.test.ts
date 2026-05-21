/**
 * AI schema tests (M3b.1) — AiResponse type guard + parse-failure
 * fallback shape.
 */

import { describe, it, expect } from 'vitest';
import { isAiResponse, parseFailureResponse } from './schema';

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
});
