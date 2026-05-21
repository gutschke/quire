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

  it('refuses URL paste that has no ?join= param (real leak path)', () => {
    // The user pasted the DM's address-bar URL (campaign + scene
    // params only) into the join input.  Before this fix, the
    // fallback turned it into "HTTPS://EXAM"-style junk that then
    // landed in the clipboard on the next Ctrl+C.  Now: empty.
    expect(QuireApp.extractJoinCode('https://example.com/no-join-param')).toBe('');
    expect(
      QuireApp.extractJoinCode(
        'https://play.quire.games/?campaign=gutschke/underleaf&episode=001'
      )
    ).toBe('');
  });

  it('handles malformed URLs gracefully (no exception, returns empty)', () => {
    expect(() => QuireApp.extractJoinCode('https://[malformed]')).not.toThrow();
    expect(QuireApp.extractJoinCode('https://[malformed]')).toBe('');
  });

  it('trims surrounding whitespace before processing', () => {
    expect(
      QuireApp.extractJoinCode('  https://x.com/?join=ABCD  ')
    ).toBe('ABCD');
  });
});
