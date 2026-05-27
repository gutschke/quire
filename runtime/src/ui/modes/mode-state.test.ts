import { describe, it, expect } from 'vitest';
import {
  parseMode,
  setMode,
  APP_MODES,
  DEFAULT_APP_MODE,
  type AppMode
} from './mode-state';

describe('parseMode', () => {
  it('defaults to in-session when no ?mode= present', () => {
    expect(parseMode('?campaign=foo/bar')).toBe('in-session');
    expect(parseMode('')).toBe('in-session');
    expect(parseMode('?')).toBe('in-session');
  });

  it('accepts a leading ? or omits it', () => {
    expect(parseMode('?mode=authoring')).toBe('authoring');
    expect(parseMode('mode=authoring')).toBe('authoring');
  });

  it('accepts URLSearchParams directly', () => {
    const sp = new URLSearchParams();
    sp.set('mode', 'post-session');
    expect(parseMode(sp)).toBe('post-session');
  });

  it('parses all five valid modes', () => {
    const modes: AppMode[] = [
      'pre-session',
      'in-session',
      'post-session',
      'authoring',
      'solo-browse'
    ];
    for (const m of modes) {
      expect(parseMode(`?mode=${m}`)).toBe(m);
    }
  });

  it('falls back to default for unknown mode strings (no throw)', () => {
    expect(parseMode('?mode=banana')).toBe('in-session');
    expect(parseMode('?mode=')).toBe('in-session');
    expect(parseMode('?mode=PRE-SESSION')).toBe('in-session'); // case-sensitive
  });

  it('does not confuse mode= with other params', () => {
    expect(parseMode('?campaign=foo&mode=authoring&episode=x')).toBe('authoring');
  });
});

describe('setMode', () => {
  it('omits ?mode= when setting the default mode (cleaner share links)', () => {
    const sp = new URLSearchParams('mode=authoring&campaign=x');
    setMode(sp, 'in-session');
    expect(sp.get('mode')).toBeNull();
    expect(sp.get('campaign')).toBe('x'); // doesn't touch unrelated keys
  });

  it('writes ?mode= for non-default modes', () => {
    const sp = new URLSearchParams('campaign=x');
    setMode(sp, 'authoring');
    expect(sp.get('mode')).toBe('authoring');
  });

  it('overwrites a prior mode value', () => {
    const sp = new URLSearchParams('mode=authoring');
    setMode(sp, 'post-session');
    expect(sp.get('mode')).toBe('post-session');
  });

  it('returns the same params object for chaining', () => {
    const sp = new URLSearchParams();
    expect(setMode(sp, 'authoring')).toBe(sp);
  });
});

describe('APP_MODES + DEFAULT_APP_MODE constants', () => {
  it('APP_MODES contains exactly the seven named modes', () => {
    // Phase B P5 (2026-05-26): added `session-wrap-marks` for the
    // end-of-session marks sheet (rules.md:149-154 advancement bullets).
    // D2 (2026-05-26): added `session-open` for the open ritual.
    expect(APP_MODES.size).toBe(7);
    expect(APP_MODES.has('pre-session')).toBe(true);
    expect(APP_MODES.has('in-session')).toBe(true);
    expect(APP_MODES.has('post-session')).toBe(true);
    expect(APP_MODES.has('session-wrap-marks')).toBe(true);
    expect(APP_MODES.has('session-open')).toBe(true);
    expect(APP_MODES.has('authoring')).toBe(true);
    expect(APP_MODES.has('solo-browse')).toBe(true);
  });

  it('DEFAULT_APP_MODE is in APP_MODES', () => {
    expect(APP_MODES.has(DEFAULT_APP_MODE)).toBe(true);
  });
});
