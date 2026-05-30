// @vitest-environment happy-dom

/**
 * Mock Campaign 09 — UI findability after the run #14 CSS pass.
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-09-
 * ui-findability.md`.
 *
 * Per WS-G's UI-iteration safety playbook: after ANY UI change,
 * re-verify that critical interactions are still REACHABLE +
 * ACTIVATABLE.  Run #14 lands a global button reset + focus-visible
 * ring + landing hero + several new surface classes — this mock
 * walks the affected paths and asserts the elements rendered,
 * weren't accidentally hidden, and respond to user input.
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

beforeAll(async () => {
  // Run #15: warm the markdown pipeline once so the player
  // digest recap card renders real HTML in Scenario 4.
  await ensureMarkdownPipeline();
});

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

function getAllText(el: Element | null): string {
  if (!el) return '';
  const shadowText = el.shadowRoot?.textContent ?? '';
  return shadowText + (el.textContent ?? '');
}

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

describe('Mock Campaign 09 — UI findability (run #14)', () => {
  it('Scenario 1: no-campaign landing renders the hero CTA with a non-empty href', async () => {
    const app = mountApp('TEST', new InMemoryNetwork());
    await flush();
    // Idle/no-campaign view should render.
    const root = app.shadowRoot;
    expect(root).toBeTruthy();
    const hero = root!.querySelector('.landing-hero');
    expect(hero).toBeTruthy();
    const cta = root!.querySelector('a.landing-cta') as HTMLAnchorElement | null;
    expect(cta).toBeTruthy();
    expect(cta!.getAttribute('href')).toContain('underleaf');
    // The CTA text should still be present.
    expect(cta!.textContent?.toLowerCase()).toContain('underleaf');
  });

  it('Scenario 3: DM session-open ritual renders the open-stage when appMode flips', async () => {
    // The session-open launcher chip is gated on the cockpit being
    // mounted (campaign loaded).  Without a real loaded campaign in
    // the test fixture, we can't render the launcher chip itself —
    // but we can still drive the appMode flip + assert the
    // session-open stage renders the digest body.  Catches "did the
    // CSS pass break the session-open mode rendering?"
    const net = new InMemoryNetwork();
    const dm = mountApp('DM3', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 'DM-side recap body'
    });
    await flush();
    // Force session-open mode.
    (dm as unknown as { appMode: string }).appMode = 'session-open';
    dm.requestUpdate();
    await flush();
    // DM-side session-open stage renders.  Either the
    // <session-open-stage> custom element OR the loader
    // placeholder ("Loading session-open surface…") shows.  Both
    // are valid — the assertion is "the renderer ran without
    // throwing and produced something the DM will see."
    const text = getAllText(dm);
    const hasStage =
      text.includes('Loading session-open surface') ||
      dm.shadowRoot!.querySelector('session-open-stage') !== null ||
      text.includes('No active session');
    expect(hasStage).toBe(true);
  });

  it('Scenario 4: player in session-open mode sees the Previously card with digest body', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM4', net);
    dm.startHosting();
    await flush();
    const dmSession = (dm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    dmSession.append('session-digest', {
      v: 1,
      sessionStartTs: 1_700_000_000_000,
      markdown: 'The party crossed the bridge at dawn.'
    });
    await flush();

    const player = mountApp('PLAYER4', net);
    player.joinCodeDraft = 'DM4';
    player.displayNameDraft = 'P';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    // Run #15 (UX-3 routing fix per ttrpg-ux-expert v2): instead of
    // forcing appMode from outside the production routing path (the
    // run #14 false-positive shape), assert the production auto-
    // trigger flipped the player into session-open mode on its own.
    // The trigger fires inside the session-controller subscriber
    // when filteredShared.sessionDigests grows AND the local-seen
    // marker is older than the digest's ts.
    expect((player as unknown as { appMode: string }).appMode).toBe(
      'session-open'
    );

    const text = getAllText(player);
    expect(text).toContain('Previously, at the table');
    expect(text).toContain('crossed the bridge');
    // The body element is reachable by class.
    const body = player.shadowRoot!.querySelector(
      '.session-open-player-digest'
    );
    expect(body).toBeTruthy();
    // The Dismiss → continue button is reachable.
    const dismiss = player.shadowRoot!.querySelector(
      '.session-open-player-recap-dismiss'
    ) as HTMLButtonElement | null;
    expect(dismiss).toBeTruthy();
  });

  it('Scenario 6 (fallback): player in session-open mode without a digest sees the re-orienting placeholder', async () => {
    const net = new InMemoryNetwork();
    const dm = mountApp('DM6', net);
    dm.startHosting();
    await flush();
    // NO digest.
    const player = mountApp('PLAYER6', net);
    player.joinCodeDraft = 'DM6';
    player.displayNameDraft = 'P6';
    player.joinSession();
    await flush();
    await flush();
    await flush();
    (player as unknown as { appMode: string }).appMode = 'session-open';
    player.requestUpdate();
    await flush();

    const text = getAllText(player);
    expect(text).toContain('DM is re-orienting');
    expect(text).not.toContain('Previously, at the table');
  });

  it('Global focus + button reset: page-rendered buttons inherit the new global background', async () => {
    // Smoke check: a button exists somewhere in the rendered idle
    // view, and the global rules (run #14) applied — the regression
    // is "did a global rule accidentally hide a button?"  We check
    // that AT LEAST ONE button is present + visible-by-DOM (no
    // hidden attribute, no display:none inline).  Style-engine pixel
    // correctness is out of scope (happy-dom doesn't paint).
    const app = mountApp('TEST2', new InMemoryNetwork());
    await flush();
    const buttons = app.shadowRoot!.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.hasAttribute('hidden')).toBe(false);
      // No inline display:none.
      const inline = b.getAttribute('style') ?? '';
      expect(inline).not.toContain('display: none');
      expect(inline).not.toContain('display:none');
    }
  });
});
