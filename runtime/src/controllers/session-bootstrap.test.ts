import { describe, it, expect } from 'vitest';
import {
  extractJoinCode,
  parseRevealedPath,
  scenePathFor,
  buildInviteLink
} from './session-bootstrap';

describe('scenePathFor', () => {
  it('encodes episode + scene into a revealedScenes entry', () => {
    expect(scenePathFor('001-unattended-baggage', 'scenes/01-wheels-up.md'))
      .toBe('episodes/001-unattended-baggage/scenes/01-wheels-up.md');
  });
});

describe('parseRevealedPath', () => {
  it('parses a valid path back to components', () => {
    expect(parseRevealedPath('episodes/001/scenes/01.md'))
      .toEqual({ episode: '001', scene: 'scenes/01.md' });
  });

  it('returns null for non-episode prefix', () => {
    expect(parseRevealedPath('characters/pc/jules.json')).toBeNull();
  });

  it('returns null for missing scene part', () => {
    expect(parseRevealedPath('episodes/')).toBeNull();
    expect(parseRevealedPath('episodes/001')).toBeNull();
  });

  it('round-trips with scenePathFor', () => {
    const orig = scenePathFor('ep', 'scenes/x.md');
    expect(parseRevealedPath(orig)).toEqual({ episode: 'ep', scene: 'scenes/x.md' });
  });
});

describe('extractJoinCode', () => {
  it('uppercases a bare code', () => {
    expect(extractJoinCode('abcd2345')).toBe('ABCD2345');
    expect(extractJoinCode('ABCD2345')).toBe('ABCD2345');
  });

  it('caps a long bare code at 12 chars', () => {
    expect(extractJoinCode('A'.repeat(20))).toHaveLength(12);
  });

  it('returns empty for empty / whitespace input', () => {
    expect(extractJoinCode('')).toBe('');
    expect(extractJoinCode('   ')).toBe('');
  });

  it('extracts the join code from a full invite URL', () => {
    expect(extractJoinCode('https://play.quire.games/?join=ABCD2345')).toBe('ABCD2345');
    expect(extractJoinCode('https://play.quire.games/?campaign=x&join=hello'))
      .toBe('HELLO');
  });

  it('R3-B: returns empty for a URL with no ?join= (no literal-fallback mangling)', () => {
    expect(extractJoinCode('https://example.com/no-join-param')).toBe('');
    expect(
      extractJoinCode('https://play.quire.games/?campaign=gutschke/underleaf')
    ).toBe('');
  });

  it('returns empty for malformed URLs', () => {
    expect(extractJoinCode('https://[malformed')).toBe('');
  });

  it('caps URL-extracted codes at 12 chars', () => {
    expect(extractJoinCode('https://x/?join=' + 'A'.repeat(20))).toHaveLength(12);
  });
});

describe('buildInviteLink', () => {
  it('returns null without a pairing code', () => {
    expect(buildInviteLink('https://play.quire.games/?campaign=x', null)).toBeNull();
    expect(buildInviteLink('https://play.quire.games/?campaign=x', '')).toBeNull();
    expect(buildInviteLink('https://play.quire.games/?campaign=x', undefined)).toBeNull();
  });

  it('appends ?join= when present', () => {
    const link = buildInviteLink('https://play.quire.games/?campaign=x', 'ABC123');
    expect(link).toContain('campaign=x');
    expect(link).toContain('join=ABC123');
  });

  it('strips episode / scene / pc / npc params from the invite', () => {
    const src =
      'https://play.quire.games/?campaign=x&episode=001&scene=scenes/01.md&pc=jules';
    const link = buildInviteLink(src, 'ABC123');
    expect(link).toContain('campaign=x');
    expect(link).toContain('join=ABC123');
    expect(link).not.toContain('episode=');
    expect(link).not.toContain('scene=');
    expect(link).not.toContain('pc=');
  });

  it('returns null on malformed currentUrl', () => {
    expect(buildInviteLink('not a url', 'ABC123')).toBeNull();
  });
});
