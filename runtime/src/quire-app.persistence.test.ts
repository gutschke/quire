// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(network: InMemoryNetwork, forcedId: string): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(forcedId, network),
      pairingCode: forcedId
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(forcedId, network)
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

// Helper: pretend a campaign is loaded so getCurrentCampaign returns.
// Uses the private backing field (P0-11-followup-appState made the
// public `appState` a readonly getter); injection through the
// backing field is the test-only escape hatch.
function injectCampaign(app: QuireApp): void {
  (app as unknown as { _appState: unknown })._appState = {
    kind: 'campaign',
    campaign: {
      base: {
        manifest: { $schemaVersion: '0.1.0', name: 'Test' },
        source: { owner: 'test', repo: 'test-camp', ref: 'main' }
      },
      worldOverview: null
    }
  };
}

describe('QuireApp persistence — Save/Load round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('buildSaveDocument returns null when no active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    expect(app.buildSaveDocument()).toBeNull();
  });

  it('buildSaveDocument returns null when no campaign loaded', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    expect(app.buildSaveDocument()).toBeNull();
  });

  it('buildSaveDocument returns a doc with the right campaign + author', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    const doc = app.buildSaveDocument();
    expect(doc).not.toBeNull();
    expect(doc!.campaign.owner).toBe('test');
    expect(doc!.savedByPeerId).toBe('HOST');
    expect(doc!.events.length).toBeGreaterThan(0); // peer-join + coord-claim
  });

  it('saveToFile sets saveStatus to saved with event count', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    const doc = app.saveToFile();
    expect(doc).not.toBeNull();
    expect(app.saveStatus.kind).toBe('saved');
    expect(app.saveStatus.message).toContain(`${doc!.events.length}`);
  });

  it('loadFromString accepts a previously-saved document into the same session', async () => {
    // Round-trip: build, stringify, load, assert state recovered.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    // Add a chat event for variety.
    app.submitChat('hello world');
    const doc = app.buildSaveDocument()!;
    const json = (await import('./persistence')).stringifySave(doc);

    // Tear down and re-create.
    document.body.removeChild(app);
    window.localStorage.clear();
    const app2 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST2'));
    injectCampaign(app2);
    app2.startHosting();
    await flush();
    const result = app2.loadFromString(json);
    expect(result).not.toBeNull();
    expect(result!.applied).toBeGreaterThan(0);
    // The chat event should now be in shared state.
    expect(
      app2.sessionView!.shared.chat.some((c) => c.text === 'hello world')
    ).toBe(true);
  });

  it('loadFromString refuses to load when no session is active', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    // No session yet
    const json = JSON.stringify({
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: { owner: 'test', repo: 'test-camp', ref: 'main' },
      savedByPeerId: 'x',
      events: []
    });
    const r = app.loadFromString(json);
    expect(r).toBeNull();
    expect(app.loadStatus.kind).toBe('error');
    expect(app.loadStatus.message).toMatch(/session/i);
  });

  it('loadFromString refuses cross-campaign loads', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    const json = JSON.stringify({
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: { owner: 'other', repo: 'different', ref: 'main' },
      savedByPeerId: 'x',
      events: []
    });
    const r = app.loadFromString(json);
    expect(r).toBeNull();
    expect(app.loadStatus.kind).toBe('error');
    expect(app.loadStatus.message).toMatch(/other\/different/);
  });

  it('loadFromString surfaces parse errors as loadStatus', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    const r = app.loadFromString('not json');
    expect(r).toBeNull();
    expect(app.loadStatus.kind).toBe('error');
  });

  it('H-4: surfaces a banner when the save contains unknown event kinds (P0-12)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    // Construct a save with one unknown-kind event (simulates loading
    // a save authored by a newer runtime that emitted a kind this one
    // doesn't recognize).  Events from KNOWN_EVENT_KINDS materialize
    // normally; the unknown one is counted.
    const json = JSON.stringify({
      $schemaVersion: '0.1.0',
      savedAt: new Date().toISOString(),
      campaign: { owner: 'test', repo: 'test-camp', ref: 'main' },
      savedByPeerId: 'x',
      events: [
        {
          id: 'evt-1',
          peerId: 'x',
          seq: 1,
          clock: { x: 1 },
          kind: 'chat',
          payload: { text: 'visible' },
          ts: 1
        },
        {
          id: 'evt-2',
          peerId: 'x',
          seq: 2,
          clock: { x: 2 },
          kind: 'future-feature-from-newer-runtime',
          payload: { v: 1 },
          ts: 2
        }
      ]
    });
    const result = app.loadFromString(json);
    expect(result).not.toBeNull();
    expect(result!.unknownKinds).toBe(1);
    expect(app.loadStatus.kind).toBe('loaded');
    // Banner appears at the start of the loadStatus message.
    expect(app.loadStatus.message).toMatch(
      /this runtime doesn't recognize/i
    );
    expect(app.loadStatus.message).toMatch(/1 event kind /);
  });

  it('H-4: no banner when the save is fully understood', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    app.submitChat('hello');
    const doc = app.buildSaveDocument()!;
    const json = (await import('./persistence')).stringifySave(doc);
    document.body.removeChild(app);
    const app2 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST2'));
    injectCampaign(app2);
    app2.startHosting();
    await flush();
    const result = app2.loadFromString(json);
    expect(result!.unknownKinds).toBe(0);
    expect(app2.loadStatus.message ?? '').not.toMatch(
      /doesn't recognize/i
    );
  });
});

describe('QuireApp persistence — Reclaim coordinator', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reclaimCoordinator promotes local peer and surfaces audit chat', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    await flush();
    // Synthesize a different prior coordinator via an event.
    (
      app as unknown as { session: { peer: { append: Function } } }
    ).session.peer.append('coordinator-reclaim', { fromPeerId: 'old-dm' });
    await flush();
    // After this reclaim, HOST is coordinator and audit chat exists.
    expect(app.sessionView!.shared.coordinator).toBe('HOST');
    const audit = app.sessionView!.shared.chat.find((c) =>
      c.text.startsWith('[system]')
    );
    expect(audit).toBeDefined();
    expect(audit?.text).toContain('HOST');
    expect(audit?.text).toContain('old-dm');
  });

  it('two peers racing reclaim resolves deterministically (causal sort)', async () => {
    const network = new InMemoryNetwork();
    const a = mountApp(inMemoryFactory(network, 'PEER-A'));
    const b = mountApp(inMemoryFactory(network, 'PEER-B'));
    a.startHosting();
    await flush();
    // B joins
    (b as unknown as { sessionFactory: TransportFactory }).sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('PEER-B', network),
        pairingCode: 'PEER-B'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('PEER-B', network)
      })
    };
    b.joinCodeDraft = 'PEER-A';
    b.joinSession();
    await flush();
    // Both reclaim in quick succession.
    a.reclaimCoordinator();
    b.reclaimCoordinator();
    await flush();
    // After sync, both peers see the same coordinator (whichever
    // event sorts last in causal order).
    expect(a.sessionView!.shared.coordinator).toBe(
      b.sessionView!.shared.coordinator
    );
  });
});

describe('QuireApp persistence — localStorage autosave', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('writes an autosave to localStorage when session becomes active', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    app.startHosting();
    // Wait past debounce.
    await new Promise((r) => setTimeout(r, 2000));
    const key = 'quire.save.test-test-camp';
    const stored = window.localStorage.getItem(key);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBeGreaterThan(0);
  });

  it('#257: startHosting auto-replays a staged resumePromptDoc', async () => {
    // Session 1: build a session with a recognizable event.
    const app1 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app1);
    await app1.startHosting();
    await flush();
    app1.submitChat('previous-session-marker');
    const doc = app1.buildSaveDocument()!;
    document.body.removeChild(app1);

    // Session 2: start clean, stage the doc, then click Host.
    // The fixed startHosting should replay the doc automatically
    // (no separate loadFromString call needed) — previously this
    // failed silently because loadFromString gated on "no
    // session active".
    const app2 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST2'));
    injectCampaign(app2);
    (app2 as unknown as { resumePromptDoc: unknown }).resumePromptDoc = doc;
    await app2.startHosting();
    await flush();
    expect(
      app2.sessionView!.shared.chat.some(
        (c) => c.text === 'previous-session-marker'
      )
    ).toBe(true);
    // The staged doc should be cleared after replay.
    expect(
      (app2 as unknown as { resumePromptDoc: unknown }).resumePromptDoc
    ).toBeNull();
  });

  it('R6 QA-F6: resumePromptDoc survives a host failure so the DM can retry', async () => {
    // QA-R6 F6: previously startHosting cleared resumePromptDoc
    // BEFORE loadFromString.  If session.host rejected (silently
    // swallowed by doHostSession's catch), loadFromString no-op'd
    // and the prompt was gone — DM had to reload the page.  Now
    // the prompt clears only on a SUCCESSFUL loadFromString.
    const app1 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app1);
    await app1.startHosting();
    await flush();
    app1.submitChat('survives-failure');
    const doc = app1.buildSaveDocument()!;
    document.body.removeChild(app1);

    // Stage the doc on a fresh app — but don't inject a campaign,
    // so doHostSession can run yet loadFromString trips the
    // "Start or host a session first" gate (because the internal
    // session won't actually go active in this contrived setup).
    // Easier: mock loadFromString to return null (failure).
    const app2 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST2'));
    injectCampaign(app2);
    (app2 as unknown as { resumePromptDoc: unknown }).resumePromptDoc = doc;
    // Force loadFromString to fail by deleting the campaign
    // mid-flight (campaign mismatch gate in loadFromString).
    const origLoad = app2.loadFromString.bind(app2);
    (app2 as unknown as { loadFromString: typeof app2.loadFromString }).loadFromString =
      () => null;
    await app2.startHosting();
    await flush();
    // The doc should STILL be staged because the load failed.
    expect(
      (app2 as unknown as { resumePromptDoc: unknown }).resumePromptDoc
    ).toBe(doc);
    // Restore + a successful retry clears it.
    (app2 as unknown as { loadFromString: typeof app2.loadFromString }).loadFromString =
      origLoad;
    await app2.startHosting();
    await flush();
    expect(
      (app2 as unknown as { resumePromptDoc: unknown }).resumePromptDoc
    ).toBeNull();
  });

  it('R6 Engineering: startHosting is re-entrancy-guarded (double-click safe)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    // Fire two startHosting calls in immediate succession (e.g.,
    // double-click on Host).  Without the guard, doHostSession
    // would await session.host() twice.
    const p1 = app.startHosting();
    const p2 = app.startHosting();
    await Promise.all([p1, p2]);
    // Both promises resolve; only one session was actually
    // hosted (we observe a single active session view).
    expect(app.sessionView?.status).toBe('active');
  });

  it('#257: startHosting falls back to localStorage when no doc is staged', async () => {
    // Pre-populate localStorage with a save (simulates a prior
    // session that wrote an autosave then the tab was closed).
    const app1 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app1);
    await app1.startHosting();
    await new Promise((r) => setTimeout(r, 2000)); // past autosave debounce
    app1.submitChat('autosaved-marker');
    await new Promise((r) => setTimeout(r, 2000)); // let next debounce land
    document.body.removeChild(app1);

    // Fresh app, no resumePromptDoc staged.  Clicking Host should
    // still pick up the localStorage save.
    const app2 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST2'));
    injectCampaign(app2);
    await app2.startHosting();
    await flush();
    expect(
      app2.sessionView!.shared.chat.some(
        (c) => c.text === 'autosaved-marker'
      )
    ).toBe(true);
  });
});
