// @vitest-environment happy-dom

/**
 * Player digest surface test — run #14 (FINDING from TTRPG/UX
 * expert's Top-3 #3): players had no "what happened last week"
 * surface in the session-open stage.  The digest was in their
 * `filteredShared.sessionDigests`, but the UI placeholder said
 * only "DM is re-orienting" with no body.
 *
 * Run #14 fix: `renderSessionOpenStage` for non-coord viewers
 * now mounts a "Previously, at the table…" card containing the
 * last digest's markdown.  Firewall: reads from `filteredShared`
 * (NOT `shared`), so DM-only metadata is already stripped by the
 * viewer-scope projection; no `dmGuidance` (that field never
 * lands on the materialized state at all).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { ensureMarkdownPipeline } from './markdown';

beforeAll(async () => {
  // Run #15: the player digest recap now renders via the markdown
  // pipeline (marked + DOMPurify), not a raw `<pre>`.  Warm the
  // pipeline before the suite so renderMarkdown returns real HTML
  // synchronously inside each assertion.
  await ensureMarkdownPipeline();
});

function inMemoryFactory(network: InMemoryNetwork, id: string): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(id, network),
      pairingCode: id
    }),
    createGuest: async (_code: string) => ({
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

describe('Player session-open digest surface (run #14)', () => {
  it('renders the last digest markdown for a non-coord viewer in session-open mode', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM', net);
    dm.startHosting();
    await flush();
    // DM authors a digest event directly via the session controller.
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    expect(dmSession).toBeTruthy();
    const SAMPLE = '# Previously\n\nThe party crossed the bridge at dawn.';
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: SAMPLE
    });
    await flush();

    // Now a player joins.
    const player = mountApp('PLAYER', net);
    player.joinCodeDraft = 'DM';
    player.displayNameDraft = 'Player';
    player.joinSession();
    await flush();
    await flush();
    await flush();

    // Player view should have the digest in filteredShared.
    const playerView = (player as unknown as {
      sessionView: {
        status: string;
        filteredShared?: { sessionDigests: Array<{ markdown: string }> };
      } | null;
    }).sessionView;
    expect(playerView?.status).toBe('active');
    expect(playerView?.filteredShared?.sessionDigests?.length ?? 0).toBe(1);

    // Force the session-open mode on the player.
    (player as unknown as { appMode: string }).appMode = 'session-open';
    player.requestUpdate();
    await flush();

    // The rendered surface should contain the markdown body and the
    // new heading.  The light-DOM cascade means we can search the
    // host element's textContent.
    const text = player.shadowRoot?.textContent ?? player.textContent ?? '';
    expect(text).toContain('Previously, at the table');
    expect(text).toContain('party crossed the bridge');
  });

  it('falls back to the "re-orienting" placeholder when no digest exists yet', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM2', net);
    dm.startHosting();
    await flush();
    // NO digest authored.
    const player = mountApp('PLAYER2', net);
    player.joinCodeDraft = 'DM2';
    player.displayNameDraft = 'Player2';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    (player as unknown as { appMode: string }).appMode = 'session-open';
    player.requestUpdate();
    await flush();

    const text = player.shadowRoot?.textContent ?? player.textContent ?? '';
    expect(text).toContain('DM is re-orienting');
    expect(text).not.toContain('Previously, at the table');
  });
});
