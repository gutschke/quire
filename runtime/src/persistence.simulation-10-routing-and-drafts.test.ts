// @vitest-environment happy-dom

/**
 * Mock Campaign 10 — Routing + drafts (run #15).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-10-
 * routing-and-drafts.md`.
 *
 * Per WS-G's UI-iteration safety playbook + the run #14 lesson
 * (UX-3 false positive: tests that forced `appMode` from outside
 * the production routing path passed even though the production
 * routing was broken).  This mock walks the REAL production paths
 * for the three run-#15 surfaces:
 *
 *   - UX-3 routing: player joins after a digest exists; the
 *     auto-trigger in applySessionViewChange flips the player to
 *     session-open mode WITHOUT test-side mutation.
 *   - UX-3 dismiss: player clicks the dismiss button; the
 *     localStorage seen-marker is set; next session-view change
 *     does NOT re-flip.
 *   - UX-5 digest draft persistence: DM types a digest draft;
 *     the component disconnects (tab close emulation); a fresh
 *     component re-load picks up the persisted draft.
 *   - FC-2 cross-device divergence: a "Tax" rename round-trips
 *     through the player projection.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { ensureMarkdownPipeline } from './markdown';
import {
  loadDigestDraft,
  saveDigestDraft,
  clearDigestDraft,
  digestDraftStorageKey
} from './digest-draft-persistence';

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

function mountApp(id: string, net: InMemoryNetwork): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = inMemoryFactory(net, id);
  document.body.appendChild(el);
  return el;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeAll(async () => {
  await ensureMarkdownPipeline();
});

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Mock Campaign 10 — routing + drafts (run #15)', () => {
  // --- Scenario 1: UX-3 player auto-trigger via PRODUCTION path ---
  it('Scenario 1: player joining a session with a digest auto-flips to session-open mode (NO test-side appMode mutation)', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM10-1', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: '# Last week\n\nThe party met an old friend.'
    });
    await flush();

    const player = mountApp('PLAYER10-1', net);
    player.joinCodeDraft = 'DM10-1';
    player.displayNameDraft = 'Player';
    player.joinSession();
    await flush();
    await flush();
    await flush();

    // CRITICAL: the production auto-trigger fired without
    // test-side mutation.  If this assertion fails, the trigger
    // is broken and the run #14 UX-3 false-positive shape
    // re-emerged.
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'session-open'
    );
    // And the recap surface renders (markdown-rendered, not <pre>).
    const text =
      (player.shadowRoot?.textContent ?? '') + (player.textContent ?? '');
    expect(text).toContain('Previously, at the table');
    expect(text).toContain('old friend');
  });

  // --- Scenario 2: UX-3 dismiss + persistence ---
  it('Scenario 2: clicking Dismiss persists the seen-marker; subsequent session-view changes do NOT re-flip', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM10-2', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 'Last week recap.'
    });
    await flush();

    const player = mountApp('PLAYER10-2', net);
    player.joinCodeDraft = 'DM10-2';
    player.displayNameDraft = 'Player';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'session-open'
    );

    // Click Dismiss.
    const dismiss = player.shadowRoot!.querySelector(
      '.session-open-player-recap-dismiss'
    ) as HTMLButtonElement | null;
    expect(dismiss).toBeTruthy();
    dismiss!.click();
    await flush();

    expect((player as unknown as { appMode: string }).appMode).toBe(
      'in-session'
    );

    // Fire another session-view change (e.g. a chat event).
    dmSession.append('chat', {
      text: 'hello',
      author: 'P',
      ts: 1_700_000_000_001
    });
    await flush();
    await flush();

    // The trigger does NOT re-flip — the seen-marker stops it.
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'in-session'
    );
  });

  // --- Scenario 3: UX-3 NEWER digest re-flips even after dismiss ---
  it('Scenario 3: a STRICTLY NEWER digest after a dismiss re-flips the player back to session-open', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM10-3', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 'Old recap.'
    });
    await flush();

    const player = mountApp('PLAYER10-3', net);
    player.joinCodeDraft = 'DM10-3';
    player.displayNameDraft = 'Player';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'session-open'
    );

    const dismiss = player.shadowRoot!.querySelector(
      '.session-open-player-recap-dismiss'
    ) as HTMLButtonElement | null;
    expect(dismiss).toBeTruthy();
    dismiss!.click();
    await flush();
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'in-session'
    );

    // DM authors a NEWER digest (later ts).  Wait for it to be
    // gossiped to the player.
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_010_000,
      markdown: 'Even newer recap.'
    });
    await flush();
    await flush();
    await flush();

    // The trigger fires again because the digest's ts > seen-marker.
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'session-open'
    );
  });

  // --- Scenario 4: UX-5 digest draft persistence pure-helper path ---
  it('Scenario 4: digest-draft persistence helpers round-trip a draft via localStorage', () => {
    const slug = 'underleaf-quire';
    // No persisted draft initially.
    expect(loadDigestDraft(slug)).toBeNull();

    const ok = saveDigestDraft(slug, {
      markdown: '# Recap\n\nThe party crossed a bridge.',
      generatedByResponseId: 'r-1234'
    });
    expect(ok).toBe(true);

    const loaded = loadDigestDraft(slug);
    expect(loaded).not.toBeNull();
    expect(loaded!.markdown).toContain('crossed a bridge');
    expect(loaded!.generatedByResponseId).toBe('r-1234');
    expect(typeof loaded!.updatedAt).toBe('number');

    // Clear wipes the entry.
    clearDigestDraft(slug);
    expect(loadDigestDraft(slug)).toBeNull();
  });

  // --- Scenario 5: UX-5 storage-key shape pins for cross-campaign isolation ---
  it('Scenario 5: digest-draft storage keys are campaign-scoped (no cross-campaign leak)', () => {
    const k1 = digestDraftStorageKey('owner-A-repo-1');
    const k2 = digestDraftStorageKey('owner-B-repo-2');
    expect(k1).not.toBe(k2);
    expect(k1.startsWith('quire.digest-draft.')).toBe(true);

    saveDigestDraft('owner-A-repo-1', { markdown: 'A draft' });
    saveDigestDraft('owner-B-repo-2', { markdown: 'B draft' });

    expect(loadDigestDraft('owner-A-repo-1')!.markdown).toBe('A draft');
    expect(loadDigestDraft('owner-B-repo-2')!.markdown).toBe('B draft');
  });

  // --- Scenario 6: UX-5 component-level persistence via session-digest element ---
  it('Scenario 6: <session-digest> picks up a persisted draft on connect when campaignSlug is wired', async () => {
    await import('./ui/regions/session-digest');
    const slug = 'mock10-campaign';
    // Seed a persisted draft BEFORE mount.
    saveDigestDraft(slug, { markdown: 'In-progress recap text' });

    // Mount the component with the campaignSlug wired; the
    // connect lifecycle should load the persisted draft.
    const dlg = document.createElement('session-digest') as unknown as {
      priorDigests: unknown[];
      onGenerate: (() => Promise<unknown>) | null;
      onSave: ((md: string, rid?: string) => boolean) | null;
      campaignSlug: string;
    };
    Object.assign(dlg, {
      priorDigests: [],
      onGenerate: async () => ({
        ok: true,
        markdown: '',
        responseId: ''
      }),
      onSave: () => true,
      campaignSlug: slug
    });
    document.body.appendChild(dlg as unknown as Element);
    await flush();
    await flush();

    // After load, the textarea exists and carries the persisted
    // draft value (set via Lit `.value=${this.draft}`).
    const textarea = (dlg as unknown as Element).querySelector(
      'textarea.session-digest-draft'
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe('In-progress recap text');
  });

  // --- Scenario 8: H-2 cross-campaign digest-draft leak (run #16) ---
  it('Scenario 8: <session-digest> on a campaign-slug change discards the prior in-memory draft AND does NOT persist it under the new slug (H-2 fix)', async () => {
    await import('./ui/regions/session-digest');
    const slugA = 'campaign-A-slug';
    const slugB = 'campaign-B-slug';

    // Seed a persisted draft for slug B (so we can confirm load).
    saveDigestDraft(slugB, { markdown: 'B existing draft' });

    // Mount with slug A; type a dirty draft.
    const dlg = document.createElement('session-digest') as unknown as {
      priorDigests: unknown[];
      onGenerate: (() => Promise<unknown>) | null;
      onSave: ((md: string, rid?: string) => boolean) | null;
      campaignSlug: string;
    };
    Object.assign(dlg, {
      priorDigests: [],
      onGenerate: async () => ({ ok: true, markdown: '', responseId: '' }),
      onSave: () => true,
      campaignSlug: slugA
    });
    document.body.appendChild(dlg as unknown as Element);
    await flush();
    await flush();

    // Simulate the DM typing a draft for campaign A.
    const textarea1 = (dlg as unknown as Element).querySelector(
      'textarea.session-digest-draft'
    ) as HTMLTextAreaElement | null;
    // Empty drafts render no textarea; type via the property + input.
    // Instead, drive the draft state through the property update
    // shape used by the generate path.
    const internal = dlg as unknown as { draft: string };
    internal.draft = 'A IN-PROGRESS spoiler-adjacent recap';
    (dlg as unknown as { requestUpdate?: () => void }).requestUpdate?.();
    await flush();

    // Now the DM "switches campaigns" — host re-renders with slug B.
    (dlg as unknown as { campaignSlug: string }).campaignSlug = slugB;
    await flush();
    await flush();

    // The new render must show CAMPAIGN B's draft, not A's.
    const textarea2 = (dlg as unknown as Element).querySelector(
      'textarea.session-digest-draft'
    ) as HTMLTextAreaElement | null;
    expect(textarea2).toBeTruthy();
    expect(textarea2!.value).toBe('B existing draft');
    expect(textarea2!.value).not.toContain('A IN-PROGRESS');

    // And localStorage MUST NOT have campaign A's text under
    // campaign B's storage key — the H-2 hazard.
    const persistedB = loadDigestDraft(slugB);
    expect(persistedB!.markdown).toBe('B existing draft');
    expect(persistedB!.markdown).not.toContain('A IN-PROGRESS');

    // Defensive: campaign A's own key should be UNTOUCHED — we
    // didn't trigger a persist for it (the @input handler never
    // fired in this test path), so it should remain whatever
    // localStorage had for it (null).  We do NOT assert A was
    // persisted; the design call is that mid-edit transitions
    // without a persist tick = data loss for A (acceptable;
    // matches the "tab close before debounce" boundary already
    // documented in DEC-035 below).
    void textarea1;
  });

  // --- Scenario 9: H-1 in-memory mirror cross-campaign reset (run #16) ---
  it('Scenario 9: playerLastSeenDigestTsInMemory resets on navigateToRoute slug-mismatch + leaveSession (H-1 fix)', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM10-9', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    // Author a LATE digest (high ts).
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 2_000_000_000_000,
      markdown: 'Campaign A late digest.'
    });
    await flush();

    const player = mountApp('PLAYER10-9', net);
    player.joinCodeDraft = 'DM10-9';
    player.displayNameDraft = 'Player';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    // Dismiss to set the seen-marker AND the in-memory mirror.
    const dismiss = player.shadowRoot!.querySelector(
      '.session-open-player-recap-dismiss'
    ) as HTMLButtonElement | null;
    expect(dismiss).toBeTruthy();
    dismiss!.click();
    await flush();

    const mirror1 = (
      player as unknown as { playerLastSeenDigestTsInMemory: number }
    ).playerLastSeenDigestTsInMemory;
    // Mirror records the digest event's ts (wall-clock at append),
    // not the payload's sessionStartTs.  Just confirm it advanced.
    expect(mirror1).toBeGreaterThan(0);

    // Simulate the player navigating to a DIFFERENT campaign URL.
    // navigateToRoute with a mismatched slug must reset the
    // in-memory mirror so the new campaign's digest doesn't get
    // suppressed by the prior campaign's seen-ts.
    (
      player as unknown as { navigateToRoute: (route: unknown) => void }
    ).navigateToRoute({
      kind: 'campaign',
      owner: 'other-owner',
      repo: 'other-repo',
      ref: 'main'
    });
    await flush();
    const mirror2 = (
      player as unknown as { playerLastSeenDigestTsInMemory: number }
    ).playerLastSeenDigestTsInMemory;
    expect(mirror2).toBe(0);

    // Also test the leaveSession reset path (covers home-route /
    // session shutdown).
    (
      player as unknown as { playerLastSeenDigestTsInMemory: number }
    ).playerLastSeenDigestTsInMemory = 9_000_000_000_000;
    (player as unknown as { leaveSession: () => void }).leaveSession();
    await flush();
    const mirror3 = (
      player as unknown as { playerLastSeenDigestTsInMemory: number }
    ).playerLastSeenDigestTsInMemory;
    expect(mirror3).toBe(0);
  });

  // --- Scenario 7: FC-2 narrowing — "Tax" rename round-trips ---
  it('Scenario 7: a pc-edit { field:name, value:Tax } SURVIVES the player projection (FC-2 narrowing fix)', async () => {
    const { projectSaveForViewer, SAVE_SCHEMA_VERSION } = await import(
      './persistence'
    );
    const event = {
      id: 'dm-peer:1',
      peerId: 'dm-peer',
      seq: 1,
      kind: 'pc-edit',
      payload: { v: 1, pcId: 'pc-1', field: 'name', value: 'Tax' },
      ts: 1_700_000_000_000,
      clock: { 'dm-peer': 1 }
    };
    const doc = {
      $schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: '2026-05-30T00:00:00.000Z',
      campaign: { owner: 'o', repo: 'r', ref: 'main' },
      savedByPeerId: 'dm-peer',
      events: [event]
    };
    const projected = projectSaveForViewer(doc, false);
    expect(projected.events).toHaveLength(1);
    const payload = projected.events[0].payload as Record<string, unknown>;
    expect(payload.field).toBe('name');
    expect(payload.value).toBe('Tax');
  });
});
