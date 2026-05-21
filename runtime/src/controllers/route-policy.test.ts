import { describe, it, expect } from 'vitest';
import { decideRoute, scenePath } from './route-policy';
import type { SessionView } from '../session-controller';
import type { AppRoute } from '../routing';
import { emptyState } from '../core/state';

function mkSession(
  opts: {
    peerId?: string;
    coordinator?: string;
    revealedScenes?: string[];
    status?: 'idle' | 'connecting' | 'active' | 'error';
  } = {}
): SessionView {
  const shared = emptyState();
  if (opts.coordinator) shared.coordinator = opts.coordinator;
  if (opts.revealedScenes) shared.revealedScenes = opts.revealedScenes;
  return {
    mode: 'host',
    status: opts.status ?? 'active',
    peerId: opts.peerId ?? 'dm',
    pairingCode: 'ABC123',
    connectedPeers: [],
    shared,
    filteredShared: shared,
    error: null
  };
}

describe('scenePath', () => {
  it('encodes episode + scene', () => {
    expect(scenePath('001', 'scenes/01.md')).toBe('episodes/001/scenes/01.md');
  });
});

describe('decideRoute — home + campaign always allowed', () => {
  it('home is allowed pre-session', () => {
    expect(decideRoute({ kind: 'home' }, null)).toEqual({ kind: 'allow' });
  });
  it('campaign is allowed pre-session', () => {
    expect(
      decideRoute({ kind: 'campaign', slug: 'x/y' }, null)
    ).toEqual({ kind: 'allow' });
  });
});

describe('decideRoute — NPC DM-only gate', () => {
  it('allows NPC routes in solo (no session)', () => {
    const r: AppRoute = {
      kind: 'character',
      slug: 'x/y',
      characterKind: 'npc',
      characterId: 'yui'
    };
    expect(decideRoute(r, null).kind).toBe('allow');
  });

  it('allows NPC routes for the coordinator in active session', () => {
    const r: AppRoute = {
      kind: 'character',
      slug: 'x/y',
      characterKind: 'npc',
      characterId: 'yui'
    };
    const v = mkSession({ peerId: 'dm', coordinator: 'dm' });
    expect(decideRoute(r, v).kind).toBe('allow');
  });

  it('denies NPC routes for non-coord in active session', () => {
    const r: AppRoute = {
      kind: 'character',
      slug: 'x/y',
      characterKind: 'npc',
      characterId: 'yui'
    };
    const v = mkSession({ peerId: 'alice', coordinator: 'dm' });
    const d = decideRoute(r, v);
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.errorClass).toBe('character');
      expect(d.message).toMatch(/NPC sheets are only visible to the DM/);
      expect(d.details).toMatch(/Requested NPC: yui/);
    }
  });

  it('allows PC routes always (no NPC gate applies)', () => {
    const r: AppRoute = {
      kind: 'character',
      slug: 'x/y',
      characterKind: 'pc',
      characterId: 'jules'
    };
    expect(decideRoute(r, null).kind).toBe('allow');
    const v = mkSession({ peerId: 'alice', coordinator: 'dm' });
    expect(decideRoute(r, v).kind).toBe('allow');
  });
});

describe('decideRoute — R3-A pre-session gate', () => {
  it('blocks scene routes pre-session', () => {
    const r: AppRoute = {
      kind: 'scene',
      slug: 'x/y',
      episode: '001',
      scene: 'scenes/01.md'
    };
    const d = decideRoute(r, null);
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.errorClass).toBe('campaign');
      expect(d.message).toMatch(/inside an active session/i);
      expect(d.details).toMatch(/001\/scenes\/01\.md/);
    }
  });

  it('blocks episode routes pre-session', () => {
    const r: AppRoute = {
      kind: 'episode',
      slug: 'x/y',
      episode: '001'
    };
    const d = decideRoute(r, null);
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.errorClass).toBe('campaign');
      expect(d.details).toMatch(/Requested route: 001/);
    }
  });

  it('blocks scene routes when sessionView.status is idle / connecting / error', () => {
    const r: AppRoute = {
      kind: 'scene',
      slug: 'x/y',
      episode: '001',
      scene: 'scenes/01.md'
    };
    for (const status of ['idle', 'connecting', 'error'] as const) {
      const v = mkSession({ status });
      expect(decideRoute(r, v).kind).toBe('deny');
    }
  });
});

describe('decideRoute — non-coordinator gates', () => {
  it('blocks episode routes for non-coord in active session', () => {
    const r: AppRoute = {
      kind: 'episode',
      slug: 'x/y',
      episode: '001'
    };
    const v = mkSession({ peerId: 'alice', coordinator: 'dm' });
    const d = decideRoute(r, v);
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.errorClass).toBe('campaign');
      expect(d.message).toMatch(/Episode lists are only visible to the DM/);
    }
  });

  it('allows episode routes for coord in active session', () => {
    const r: AppRoute = {
      kind: 'episode',
      slug: 'x/y',
      episode: '001'
    };
    const v = mkSession({ peerId: 'dm', coordinator: 'dm' });
    expect(decideRoute(r, v).kind).toBe('allow');
  });

  it('blocks scene routes for non-coord when scene is not revealed', () => {
    const r: AppRoute = {
      kind: 'scene',
      slug: 'x/y',
      episode: '001',
      scene: 'scenes/01.md'
    };
    const v = mkSession({
      peerId: 'alice',
      coordinator: 'dm',
      revealedScenes: []
    });
    const d = decideRoute(r, v);
    expect(d.kind).toBe('deny');
    if (d.kind === 'deny') {
      expect(d.errorClass).toBe('campaign');
      expect(d.message).toMatch(/has not been revealed/);
    }
  });

  it('allows scene routes for non-coord when scene IS revealed', () => {
    const r: AppRoute = {
      kind: 'scene',
      slug: 'x/y',
      episode: '001',
      scene: 'scenes/01.md'
    };
    const v = mkSession({
      peerId: 'alice',
      coordinator: 'dm',
      revealedScenes: ['episodes/001/scenes/01.md']
    });
    expect(decideRoute(r, v).kind).toBe('allow');
  });

  it('allows scene routes for coord regardless of reveal state', () => {
    const r: AppRoute = {
      kind: 'scene',
      slug: 'x/y',
      episode: '001',
      scene: 'scenes/01.md'
    };
    const v = mkSession({
      peerId: 'dm',
      coordinator: 'dm',
      revealedScenes: [] // unrevealed
    });
    expect(decideRoute(r, v).kind).toBe('allow');
  });
});
