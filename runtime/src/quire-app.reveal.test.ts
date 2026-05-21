// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { SessionController, type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import type { SanitizedHtml } from './markdown';
import type { LoadedEpisode } from './episode-loader';

function inMemoryFactory(network: InMemoryNetwork, id: string): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(id, network),
      pairingCode: id
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(id, network)
    })
  };
}

function mountApp(factory: TransportFactory): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  document.body.appendChild(el);
  return el;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeCampaign(): {
  base: {
    manifest: { $schemaVersion: string; name: string };
    source: { owner: string; repo: string; ref: string };
  };
  worldOverview: string | null;
} {
  return {
    base: {
      manifest: { $schemaVersion: '0.1.0', name: 'Test Campaign' },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    },
    worldOverview: null
  };
}

function fakeEpisode(slug: string): LoadedEpisode {
  return {
    slug,
    manifest: {
      $schemaVersion: '0.1.0',
      name: `Episode ${slug}`,
      scenes: ['scenes/01.md']
    },
    source: { owner: 'x', repo: 'y', ref: 'main' }
  };
}

function fakeScene(path: string): {
  path: string;
  blocks: Array<{
    blockHash: string;
    html: SanitizedHtml;
    raw: string;
    index: number;
  }>;
  frontmatter: Record<string, unknown>;
} {
  return {
    path,
    blocks: [
      {
        blockHash: '0123456789abcdef',
        html: '<p>scene body</p>' as SanitizedHtml,
        raw: 'scene body',
        index: 0
      }
    ],
    frontmatter: {}
  };
}

describe('QuireApp scene-reveal', () => {
  it('parseRevealedPath round-trips episode + scene paths', () => {
    expect(QuireApp.parseRevealedPath('episodes/001/scenes/intro.md')).toEqual({
      episode: '001',
      scene: 'scenes/intro.md'
    });
    expect(QuireApp.parseRevealedPath('not/a/reveal')).toBeNull();
    expect(QuireApp.parseRevealedPath('episodes/justanepisode')).toBeNull();
    expect(QuireApp.parseRevealedPath('')).toBeNull();
  });

  it('revealCurrentScene is a no-op outside an active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    // Inject a scene state manually (we're not testing route loading here).
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(app.revealCurrentScene()).toBe(false);
  });

  it('coordinator (host) can reveal; event lands in shared state', async () => {
    const network = new InMemoryNetwork();
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.startHosting();
    await flush();
    expect(app.isCoordinator()).toBe(true);
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(app.revealCurrentScene()).toBe(true);
    expect(app.sessionView!.shared.revealedScenes).toEqual([
      'episodes/001/scenes/intro.md'
    ]);
  });

  it('second reveal of the same scene is suppressed at the app level', async () => {
    const network = new InMemoryNetwork();
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(app.revealCurrentScene()).toBe(true);
    expect(app.revealCurrentScene()).toBe(false);
    expect(app.sessionView!.shared.revealedScenes).toHaveLength(1);
  });

  it('non-coordinator reveals are dropped by the materializer', async () => {
    const network = new InMemoryNetwork();
    // Host claims coordinator.
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();

    // Guest joins.
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    // joinSession reads from the joinCodeDraft.
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    expect(guest.sessionView!.status).toBe('active');
    expect(guest.isCoordinator()).toBe(false);

    // Bypass the UI gate by writing the event directly via the controller.
    // The core materializer must still reject it.
    (
      guest as unknown as { session: SessionController }
    ).session.append('scene-reveal', { scenePath: 'rogue.md' });
    await flush();
    expect(host.sessionView!.shared.revealedScenes).toEqual([]);
    expect(guest.sessionView!.shared.revealedScenes).toEqual([]);
  });

  it("guest sees the host's reveal in shared state", async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();

    (host as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(host.revealCurrentScene()).toBe(true);
    await flush();
    expect(guest.sessionView!.shared.revealedScenes).toEqual([
      'episodes/001/scenes/intro.md'
    ]);
  });

  it('coordinator can reveal a block via toggleBlockReveal (P2-2)', async () => {
    const network = new InMemoryNetwork();
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    const fullPath = 'episodes/001/scenes/intro.md';
    expect(app.toggleBlockReveal(fullPath, '0123456789abcdef')).toBe(true);
    await flush();
    expect(
      app.sessionView!.shared.revealedParagraphs[fullPath]
    ).toEqual(new Set(['0123456789abcdef']));
  });

  it('toggleBlockReveal is symmetric — re-toggle unreveals (P2-2)', async () => {
    const network = new InMemoryNetwork();
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    const fullPath = 'episodes/001/scenes/intro.md';
    app.toggleBlockReveal(fullPath, '0123456789abcdef');
    await flush();
    app.toggleBlockReveal(fullPath, '0123456789abcdef');
    await flush();
    expect(
      app.sessionView!.shared.revealedParagraphs[fullPath]
    ).toBeUndefined();
  });

  it('non-coordinator toggleBlockReveal is a no-op (P2-2)', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    expect(guest.isCoordinator()).toBe(false);
    (guest as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(
      guest.toggleBlockReveal(
        'episodes/001/scenes/intro.md',
        '0123456789abcdef'
      )
    ).toBe(false);
    await flush();
    expect(host.sessionView!.shared.revealedParagraphs).toEqual({});
    expect(guest.sessionView!.shared.revealedParagraphs).toEqual({});
  });

  it('DM broadcastCurrentView emits broadcast-view event (P2-11)', async () => {
    const network = new InMemoryNetwork();
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(app.broadcastCurrentView()).toBe(true);
    await flush();
    const bv = app.sessionView!.shared.broadcastView!;
    // stagePath is the route's URL-encoded search string; round-trip
    // via parseRoute to verify the invariant we actually care about.
    const route = (await import('./routing')).parseRoute(bv.stagePath);
    expect(route).toMatchObject({
      kind: 'scene',
      episode: '001',
      scene: 'scenes/intro.md'
    });
  });

  it('non-coordinator broadcastCurrentView is a no-op (P2-11)', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    (guest as unknown as { _appState: unknown })._appState = {
      kind: 'scene',
      campaign: fakeCampaign(),
      episode: fakeEpisode('001'),
      scene: fakeScene('scenes/intro.md')
    };
    expect(guest.broadcastCurrentView()).toBe(false);
    await flush();
    expect(host.sessionView!.shared.broadcastView).toBeUndefined();
  });

  it('multiple reveals accumulate in order', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    for (const scene of ['a.md', 'b.md', 'c.md']) {
      (host as unknown as { _appState: unknown })._appState = {
        kind: 'scene',
        campaign: fakeCampaign(),
        episode: fakeEpisode('001'),
        scene: fakeScene(scene)
      };
      host.revealCurrentScene();
    }
    expect(host.sessionView!.shared.revealedScenes).toEqual([
      'episodes/001/a.md',
      'episodes/001/b.md',
      'episodes/001/c.md'
    ]);
  });
});
