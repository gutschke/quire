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

  it('parses ?campaign=...&pc=... as a character route', () => {
    expect(
      parseRoute('?campaign=gutschke/underleaf&pc=example-character')
    ).toEqual({
      kind: 'character',
      slug: 'gutschke/underleaf',
      characterKind: 'pc',
      characterId: 'example-character'
    });
  });

  it('parses ?campaign=...&npc=... as a character route', () => {
    expect(
      parseRoute('?campaign=gutschke/underleaf&npc=yui-tanaka')
    ).toEqual({
      kind: 'character',
      slug: 'gutschke/underleaf',
      characterKind: 'npc',
      characterId: 'yui-tanaka'
    });
  });

  it('character route wins when both pc and npc are set (pc wins)', () => {
    expect(
      parseRoute('?campaign=g/u&pc=alice&npc=bob')
    ).toEqual({
      kind: 'character',
      slug: 'g/u',
      characterKind: 'pc',
      characterId: 'alice'
    });
  });

  it('character route wins over episode/scene when both present', () => {
    expect(
      parseRoute('?campaign=g/u&episode=001&pc=alice')
    ).toEqual({
      kind: 'character',
      slug: 'g/u',
      characterKind: 'pc',
      characterId: 'alice'
    });
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

  it('roundtrips scene route through parseRoute', () => {
    const original = {
      kind: 'scene' as const,
      slug: 'a/b',
      episode: 'ep1',
      scene: 'scenes/01.md'
    };
    expect(parseRoute(routeToSearch(original))).toEqual(original);
  });

  it('serializes pc character route', () => {
    expect(
      routeToSearch({
        kind: 'character',
        slug: 'g/u',
        characterKind: 'pc',
        characterId: 'alice'
      })
    ).toBe('?campaign=g%2Fu&pc=alice');
  });

  it('serializes npc character route', () => {
    expect(
      routeToSearch({
        kind: 'character',
        slug: 'g/u',
        characterKind: 'npc',
        characterId: 'yui-tanaka'
      })
    ).toBe('?campaign=g%2Fu&npc=yui-tanaka');
  });

  it('roundtrips character route through parseRoute', () => {
    const original = {
      kind: 'character' as const,
      slug: 'g/u',
      characterKind: 'npc' as const,
      characterId: 'yui-tanaka'
    };
    expect(parseRoute(routeToSearch(original))).toEqual(original);
  });

  describe('CC-3 character-creation route', () => {
    it('parses ?campaign=...&invite=... into a character-creation route', () => {
      expect(
        parseRoute('?campaign=g/u&invite=opaque-token-here')
      ).toEqual({
        kind: 'character-creation',
        slug: 'g/u',
        inviteToken: 'opaque-token-here'
      });
    });

    it('invite takes precedence over episode / scene / pc / npc', () => {
      // A token URL must land on chargen, not on the campaign
      // overview, episode, scene, or character views — even if
      // the URL accidentally carries other params.
      expect(
        parseRoute(
          '?campaign=g/u&invite=tok&episode=001&scene=intro.md&pc=mei&npc=yui'
        ).kind
      ).toBe('character-creation');
    });

    it('roundtrips through routeToSearch', () => {
      const original = {
        kind: 'character-creation' as const,
        slug: 'g/u',
        inviteToken: 'abc123-def456'
      };
      expect(parseRoute(routeToSearch(original))).toEqual(original);
    });

    it('routeToSearch emits the invite param', () => {
      expect(
        routeToSearch({
          kind: 'character-creation',
          slug: 'g/u',
          inviteToken: 'xyz'
        })
      ).toBe('?campaign=g%2Fu&invite=xyz');
    });

    it('omits character-creation when invite is empty (falls back to campaign)', () => {
      // ?invite= with empty value shouldn't accidentally claim
      // the chargen route — that's a URL-construction error, not
      // an intentional chargen visit.
      expect(parseRoute('?campaign=g/u&invite=').kind).toBe('campaign');
    });
  });
});
