// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';

describe('QuireApp.extractJoinCode', () => {
  it('returns the raw code unchanged when given a bare code', () => {
    expect(QuireApp.extractJoinCode('ABCD2345')).toBe('ABCD2345');
  });

  it('uppercases the code', () => {
    expect(QuireApp.extractJoinCode('abcd2345')).toBe('ABCD2345');
  });

  it('caps to 12 chars (the input maxlength)', () => {
    expect(QuireApp.extractJoinCode('A'.repeat(20))).toHaveLength(12);
  });

  it('returns empty string for empty input', () => {
    expect(QuireApp.extractJoinCode('')).toBe('');
    expect(QuireApp.extractJoinCode('   ')).toBe('');
  });

  it('extracts ?join= from a full invite URL (real bug: pasted URL was being mangled to HTTPS://PLAY)', () => {
    expect(
      QuireApp.extractJoinCode(
        'https://play.quire.games/?campaign=gutschke/underleaf&join=M3K7N2PQ'
      )
    ).toBe('M3K7N2PQ');
  });

  it('extracts even when the URL has many other params', () => {
    expect(
      QuireApp.extractJoinCode(
        'https://example.com/?a=1&b=2&join=hello&c=3&episode=ep1'
      )
    ).toBe('HELLO');
  });

  it('falls back to literal handling for a URL without ?join=', () => {
    // Edge case: user pasted a URL that doesn't have a join code at
    // all.  We shouldn't try to be clever; treat the trimmed text as
    // a literal code so the join attempt fails with a clear "no such
    // peer" error rather than producing an empty code field.
    expect(QuireApp.extractJoinCode('https://example.com/no-join-param')).toBe(
      'HTTPS://EXAM'
    );
  });

  it('handles malformed URLs gracefully (no exception)', () => {
    expect(() => QuireApp.extractJoinCode('https://[malformed]')).not.toThrow();
  });

  it('trims surrounding whitespace before processing', () => {
    expect(
      QuireApp.extractJoinCode('  https://x.com/?join=ABCD  ')
    ).toBe('ABCD');
  });
});
