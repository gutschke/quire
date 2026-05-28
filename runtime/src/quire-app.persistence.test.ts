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

  // ---------------------------------------------------------------
  // Wave A1 (2026-05-26) firewall hardening regression tests.
  // ---------------------------------------------------------------

  it('Wave A1 firewall: DM (coord) autosave doc contains DM-only events (resilience)', async () => {
    // The acting DM's own device keeps the full event log so they
    // can recover from a crash.  buildShareableSaveDocument is
    // identity for the coord viewer.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    await app.startHosting();
    await flush();
    // Append a DM-only event (scratch-note is coord-only).
    (
      app as unknown as { appendScratchNote: (s: string) => boolean }
    ).appendScratchNote('DM private — Mei is the Quiet vessel');
    await flush();
    const doc = (
      app as unknown as { buildShareableSaveDocument: () => { events: Array<{ kind: string }> } | null }
    ).buildShareableSaveDocument()!;
    const kinds = new Set(doc.events.map((e) => e.kind));
    expect(kinds.has('scratch-note')).toBe(true);
  });

  it('Wave D-prep-2-A: player autosave DROPS pc-edit events whose field is DM-only (Finding B)', async () => {
    // Adversarial sweep on build d03f888 found: pc-edit events
    // for dmNotes / magicPhase / tax.* / threadDebt.* /
    // alignmentDrift.* / knowsTheyCanCast flow into non-coord
    // autosaves verbatim.  Materialized state strips these via
    // filterForViewer, but the event log itself wasn't scrubbed.
    // Real "the Quiet is speaking through Mei" dmNotes text was
    // landing in player-autosave-localStorage.json.  Fix in
    // serializeSessionForViewer via scrubEventForPlayer.
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    injectCampaign(host);
    await host.startHosting();
    await flush();
    const player = mountApp(inMemoryFactory(network, 'PLAYER'));
    injectCampaign(player);
    (player as unknown as { sessionFactory: TransportFactory }).sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('PLAYER', network),
        pairingCode: 'PLAYER'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('PLAYER', network)
      })
    };
    player.joinCodeDraft = 'HOST';
    player.joinSession();
    await flush();
    // HOST appends DM-only pc-edits.  Each one carries a different
    // class of DM-only field (top-level, dotted, the long-form
    // dmNotes prose).
    host.submitPcEdit('mei', 'dmNotes', 'the Quiet is speaking through Mei');
    host.submitPcEdit('mei', 'magicPhase', 'realization');
    host.submitPcEdit('mei', 'tax.releaseMoment', 'she let her sister see');
    host.submitPcEdit('mei', 'threadDebt.rung', 'hunted');
    host.submitPcEdit('mei', 'alignmentDrift.marks', 4);
    host.submitPcEdit('mei', 'knowsTheyCanCast', true);
    // #398: knowsTheyCanCast + tax.active are un-stripped in the LIVE
    // projection (filterForViewer) so a realized player perceives
    // their own cast state — but the SAVE log must stay fail-closed
    // (a portable artifact could be shared), so both still strip here.
    host.submitPcEdit('mei', 'tax.active', true);
    // Plus a player-visible pc-edit that MUST land in the player's save.
    host.submitPcEdit('mei', 'harm', 2);
    await flush();
    expect(player.sessionView?.status).toBe('active');
    const doc = player.buildShareableSaveDocument();
    expect(doc).not.toBeNull();
    // Player-visible pc-edit (harm) survived.
    const pcEdits = doc!.events.filter((e) => e.kind === 'pc-edit') as Array<{
      kind: 'pc-edit';
      payload?: { field?: string };
    }>;
    const fieldsLanded = pcEdits.map((e) => e.payload?.field ?? '');
    expect(fieldsLanded).toContain('harm');
    // DM-only fields stripped.
    expect(fieldsLanded).not.toContain('dmNotes');
    expect(fieldsLanded).not.toContain('magicPhase');
    expect(fieldsLanded).not.toContain('tax.releaseMoment');
    expect(fieldsLanded).not.toContain('threadDebt.rung');
    expect(fieldsLanded).not.toContain('alignmentDrift.marks');
    expect(fieldsLanded).not.toContain('knowsTheyCanCast');
    expect(fieldsLanded).not.toContain('tax.active');
    // Belt-and-suspenders: scan all event payloads for the secret text.
    const allTexts = doc!.events.map((e) => JSON.stringify(e)).join(' ');
    expect(allTexts).not.toContain('the Quiet is speaking through Mei');
    expect(allTexts).not.toContain('she let her sister see');
  });

  it('Wave D-prep-2-A: player autosave STRIPS focus-grant boundFor/notes/condition (Finding A)', async () => {
    // Adversarial Finding A: focus-grant carries optional DM-
    // typed boundFor/notes/condition fields verbatim into the
    // event log; D-prep-3 hid boundFor from RENDER but not from
    // SAVE STREAM.  Becomes a real leak the moment T-LT4 (focus
    // condition field UI) ships.  Fix scrubs those 3 fields from
    // the focus-grant payload for non-coord viewers.
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    injectCampaign(host);
    await host.startHosting();
    await flush();
    const player = mountApp(inMemoryFactory(network, 'PLAYER'));
    injectCampaign(player);
    (player as unknown as { sessionFactory: TransportFactory }).sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('PLAYER', network),
        pairingCode: 'PLAYER'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('PLAYER', network)
      })
    };
    player.joinCodeDraft = 'HOST';
    player.joinSession();
    await flush();
    // HOST grants a focus with DM-typed text in the 3 spoiler-
    // shaped optional fields.
    expect(
      host.appendFocusGrant('mei', {
        name: 'pattern-sense',
        domain: 'perception',
        condition: 'bind-on-mother-reveal-ep4',
        notes: 'the Quiet speaks through this',
        boundFor: 'the secret intent to remember'
      })
    ).toBe(true);
    await flush();
    expect(player.sessionView?.status).toBe('active');
    const doc = player.buildShareableSaveDocument();
    expect(doc).not.toBeNull();
    // focus-grant event still lands (foci are player-visible at
    // Realization).
    const focusGrants = doc!.events.filter(
      (e) => e.kind === 'focus-grant'
    ) as Array<{
      kind: 'focus-grant';
      payload?: { focus?: Record<string, unknown> };
    }>;
    expect(focusGrants).toHaveLength(1);
    const focus = focusGrants[0].payload?.focus ?? {};
    // Safe fields survive.
    expect(focus.name).toBe('pattern-sense');
    expect(focus.domain).toBe('perception');
    // Cross-expert resolution: `condition` IS player-visible (the
    // in-fiction trigger the player needs to know about per
    // TTRPG-expert + rules.md:139).  Survives the scrub.
    expect(focus.condition).toBe('bind-on-mother-reveal-ep4');
    // DM-only optional fields stripped from payload.
    expect(focus.boundFor).toBeUndefined();
    expect(focus.notes).toBeUndefined();
    // Belt-and-suspenders: DM-only spoiler text stripped.
    const allTexts = doc!.events.map((e) => JSON.stringify(e)).join(' ');
    expect(allTexts).not.toContain('the Quiet speaks through this');
    expect(allTexts).not.toContain('the secret intent to remember');
  });

  it('Wave D-prep-2-A: DM (coord) save preserves field-granularity DM material', async () => {
    // The scrub is non-coord only.  The DM's own save must retain
    // pc-edit{field:dmNotes} + focus-grant{boundFor} for restore.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    injectCampaign(app);
    await app.startHosting();
    await flush();
    app.submitPcEdit('mei', 'dmNotes', 'DM private');
    app.appendFocusGrant('mei', {
      name: 'f1',
      boundFor: 'DM-private intent'
    });
    await flush();
    const doc = app.buildShareableSaveDocument();
    const pcEdits = doc!.events.filter((e) => e.kind === 'pc-edit') as Array<{
      kind: 'pc-edit';
      payload?: { field?: string };
    }>;
    expect(pcEdits.map((e) => e.payload?.field)).toContain('dmNotes');
    const focusGrants = doc!.events.filter(
      (e) => e.kind === 'focus-grant'
    ) as Array<{
      kind: 'focus-grant';
      payload?: { focus?: Record<string, unknown> };
    }>;
    expect(focusGrants[0].payload?.focus?.boundFor).toBe('DM-private intent');
  });

  it('Wave D-prep-1 firewall: player autosave STRIPS accidental-grant-log (Wave B regression fix)', async () => {
    // Adversarial expert caught this 30 minutes after Wave B
    // shipped: accidental-grant-log was a coord-only event
    // carrying DM-typed silent-grant prose, but was missing from
    // PLAYER_SCOPE_STRIP_KINDS in persistence.ts.  Same class as
    // the Wave A scratch-note leak.  This test pins the fix.
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    injectCampaign(host);
    await host.startHosting();
    await flush();
    const player = mountApp(inMemoryFactory(network, 'PLAYER'));
    injectCampaign(player);
    (player as unknown as { sessionFactory: TransportFactory }).sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('PLAYER', network),
        pairingCode: 'PLAYER'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('PLAYER', network)
      })
    };
    player.joinCodeDraft = 'HOST';
    player.joinSession();
    await flush();
    // HOST emits a silent-grant note (Wave B coord-only event).
    expect(
      host.appendAccidentalGrantLog(
        'mei',
        'DM secret: the keys came to her hand a moment too easily'
      )
    ).toBe(true);
    await flush();
    expect(player.sessionView?.status).toBe('active');
    const doc = player.buildShareableSaveDocument();
    expect(doc).not.toBeNull();
    const kinds = new Set(doc!.events.map((e) => e.kind));
    expect(kinds.has('accidental-grant-log')).toBe(false);
    // Belt-and-suspenders: scan all event payloads for the secret
    // text.  If this matches, the strip skipped the event entirely.
    const allTexts = doc!.events.map((e) => JSON.stringify(e)).join(' ');
    expect(allTexts).not.toContain('the keys came to her hand');
  });

  it('Wave A1 firewall: non-coord (player) autosave doc STRIPS DM-only events', async () => {
    // Two-peer session: HOST (coord) and PLAYER (joined via join
    // code).  HOST appends a scratch-note (DM-only event kind).
    // PLAYER's autosave path now uses buildShareableSaveDocument
    // which filters those events out so the player's localStorage
    // doesn't leak DM material when the device is shared / picked
    // up by a non-player.
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    injectCampaign(host);
    await host.startHosting();
    await flush();
    const player = mountApp(inMemoryFactory(network, 'PLAYER'));
    injectCampaign(player);
    (player as unknown as { sessionFactory: TransportFactory }).sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('PLAYER', network),
        pairingCode: 'PLAYER'
      }),
      createGuest: async () => ({
        transport: new InMemoryTransport('PLAYER', network)
      })
    };
    player.joinCodeDraft = 'HOST';
    player.joinSession();
    await flush();
    // HOST emits a DM-only event.
    (
      host as unknown as { appendScratchNote: (s: string) => boolean }
    ).appendScratchNote('DM secret: the Quiet has a name');
    await flush();
    // Verify the player can see the session as active before
    // building the doc.
    expect(player.sessionView?.status).toBe('active');
    const doc = player.buildShareableSaveDocument();
    expect(doc).not.toBeNull();
    const kinds = new Set(doc!.events.map((e) => e.kind));
    expect(kinds.has('scratch-note')).toBe(false);
    // Belt-and-suspenders: scan event payloads for the secret text.
    const allTexts = doc!.events
      .map((e) => JSON.stringify(e))
      .join(' ');
    expect(allTexts).not.toContain('the Quiet has a name');
  });
});
