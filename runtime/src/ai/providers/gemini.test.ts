/**
 * Gemini provider parser tests (M3b.2).
 *
 * Same contract as anthropicProvider.parse: well-formed JSON →
 * Partial<AiResponse>; everything else → null.
 */

import { describe, it, expect } from 'vitest';
import { geminiProvider } from './gemini';

describe('geminiProvider.parse', () => {
  it('parses a well-formed JSON response', () => {
    const raw = JSON.stringify({
      safe: 'Hello',
      dmOnly: 'spoiler',
      sources: [{ label: 'src' }]
    });
    expect(geminiProvider.parse(raw)).toEqual({
      safe: 'Hello',
      dmOnly: 'spoiler',
      sources: [{ label: 'src' }]
    });
  });

  it('returns null for empty input', () => {
    expect(geminiProvider.parse('')).toBeNull();
  });

  it('returns null for non-JSON', () => {
    expect(geminiProvider.parse('plain prose')).toBeNull();
  });

  it('returns null when fields are missing or wrong-typed', () => {
    expect(geminiProvider.parse(JSON.stringify({ safe: 'x' }))).toBeNull();
    expect(
      geminiProvider.parse(JSON.stringify({ safe: 1, dmOnly: '', sources: [] }))
    ).toBeNull();
    expect(
      geminiProvider.parse(
        JSON.stringify({ safe: 'x', dmOnly: '', sources: {} })
      )
    ).toBeNull();
  });
});
