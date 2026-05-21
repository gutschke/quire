/**
 * Anthropic provider parser tests (M3b.2).
 *
 * Fetch-level integration is exercised separately; this file
 * locks the parse() contract:
 *   - well-formed tool input → Partial<AiResponse>
 *   - malformed input / missing fields / wrong types → null
 *   - the broker uses null → parseFailureResponse fallback
 */

import { describe, it, expect } from 'vitest';
import { anthropicProvider } from './anthropic';

describe('anthropicProvider.parse', () => {
  it('parses a well-formed JSON tool input', () => {
    const raw = JSON.stringify({
      safe: 'Hello',
      dmOnly: 'spoiler',
      sources: [{ label: 'src', path: 'intro.md' }]
    });
    expect(anthropicProvider.parse(raw)).toEqual({
      safe: 'Hello',
      dmOnly: 'spoiler',
      sources: [{ label: 'src', path: 'intro.md' }]
    });
  });

  it('returns null for empty input', () => {
    expect(anthropicProvider.parse('')).toBeNull();
  });

  it('returns null for non-JSON', () => {
    expect(anthropicProvider.parse('not json')).toBeNull();
  });

  it('returns null when safe is missing', () => {
    expect(
      anthropicProvider.parse(JSON.stringify({ dmOnly: 'x', sources: [] }))
    ).toBeNull();
  });

  it('returns null when dmOnly is wrong type', () => {
    expect(
      anthropicProvider.parse(
        JSON.stringify({ safe: 'x', dmOnly: 42, sources: [] })
      )
    ).toBeNull();
  });

  it('returns null when sources is not an array', () => {
    expect(
      anthropicProvider.parse(
        JSON.stringify({ safe: 'x', dmOnly: '', sources: 'not array' })
      )
    ).toBeNull();
  });

  it('accepts empty strings for safe / dmOnly', () => {
    expect(
      anthropicProvider.parse(
        JSON.stringify({ safe: '', dmOnly: '', sources: [] })
      )
    ).toEqual({ safe: '', dmOnly: '', sources: [] });
  });
});
