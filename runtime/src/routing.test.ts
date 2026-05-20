import { describe, it, expect } from 'vitest';
import { parseRoute, routeToSearch } from './routing';

describe('parseRoute', () => {
  it('returns home for empty search', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('?')).toEqual({ kind: 'home' });
  });

  it('parses ?campaign=owner/repo', () => {
    expect(parseRoute('?campaign=gutschke/underleaf')).toEqual({
      kind: 'campaign',
      slug: 'gutschke/underleaf'
    });
  });

  it('parses ?campaign=...&episode=...', () => {
    expect(
      parseRoute('?campaign=gutschke/underleaf&episode=001-unattended-baggage')
    ).toEqual({
      kind: 'episode',
      slug: 'gutschke/underleaf',
      episode: '001-unattended-baggage'
    });
  });

  it('parses ?campaign=...&episode=...&scene=...', () => {
    expect(
      parseRoute(
        '?campaign=gutschke/underleaf&episode=001-unattended-baggage&scene=scenes/01-wheels-up.md'
      )
    ).toEqual({
      kind: 'scene',
      slug: 'gutschke/underleaf',
      episode: '001-unattended-baggage',
      scene: 'scenes/01-wheels-up.md'
    });
  });

  it('falls back to campaign when scene given without episode', () => {
    expect(
      parseRoute('?campaign=gutschke/underleaf&scene=scenes/01.md')
    ).toEqual({
      kind: 'campaign',
      slug: 'gutschke/underleaf'
    });
  });

  it('falls back to home when episode given without campaign', () => {
    expect(parseRoute('?episode=001-x')).toEqual({ kind: 'home' });
  });

  it('accepts a URLSearchParams instance', () => {
    const params = new URLSearchParams({
      campaign: 'gutschke/underleaf',
      episode: '001-x'
    });
    expect(parseRoute(params)).toEqual({
      kind: 'episode',
      slug: 'gutschke/underleaf',
      episode: '001-x'
    });
  });

  it('ignores empty strings for campaign/episode/scene', () => {
    expect(parseRoute('?campaign=&episode=&scene=')).toEqual({ kind: 'home' });
  });
});

describe('routeToSearch', () => {
  it('returns empty string for home', () => {
    expect(routeToSearch({ kind: 'home' })).toBe('');
  });

  it('serializes campaign route', () => {
    expect(
      routeToSearch({ kind: 'campaign', slug: 'gutschke/underleaf' })
    ).toBe('?campaign=gutschke%2Funderleaf');
  });

  it('serializes episode route', () => {
    expect(
      routeToSearch({
        kind: 'episode',
        slug: 'gutschke/underleaf',
        episode: '001-x'
      })
    ).toBe('?campaign=gutschke%2Funderleaf&episode=001-x');
  });

  it('serializes scene route', () => {
    expect(
      routeToSearch({
        kind: 'scene',
        slug: 'gutschke/underleaf',
        episode: '001-x',
        scene: 'scenes/01.md'
      })
    ).toBe(
      '?campaign=gutschke%2Funderleaf&episode=001-x&scene=scenes%2F01.md'
    );
  });

  it('roundtrips through parseRoute', () => {
    const original = {
      kind: 'scene' as const,
      slug: 'a/b',
      episode: 'ep1',
      scene: 'scenes/01.md'
    };
    expect(parseRoute(routeToSearch(original))).toEqual(original);
  });
});
