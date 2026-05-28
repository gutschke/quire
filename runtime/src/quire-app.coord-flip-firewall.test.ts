// @vitest-environment happy-dom

/**
 * COORD-FLIP FIREWALL INVARIANT TEST (2026-05-27).
 *
 * Three firewall bugs this session (#392 chat-spoiler-lint, #393
 * pcCharacterCache, #395 boundCharacter) were ALL the same class:
 * a local cache / @state mirror holds character data with a strip
 * decision baked in at write time, then is NOT re-derived when the
 * local peer loses (or gains) coordinator status — so a coord→player
 * transition leaves unstripped DM-only fields readable by a now-
 * player viewer.  A static read-lint (Q-LT4) cannot catch this
 * class; this consolidated invariant test is the guard.
 *
 * ⚠️ When you add a NEW character-bearing cache/@state mirror to
 * QuireApp, clear it in `invalidateViewerScopedCachesOnCoordChange`
 * AND assert it here.  The individual fixes also have focused tests
 * (quire-app.synthesized-pc.test.ts); this file is the canonical
 * "did we miss a mirror" tripwire.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(
  network: InMemoryNetwork,
  id: string
): TransportFactory {
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

function injectCampaign(app: QuireApp): void {
  const campaign = {
    base: {
      manifest: { $schemaVersion: '0.1.0', name: 'TestCampaign' },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    },
    worldOverview: null
  };
  (
    app as unknown as { _appState: { kind: string; campaign: unknown } }
  )._appState = { kind: 'campaign', campaign };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('coord-flip firewall invariant', () => {
  /**
   * Canonical guard: `invalidateViewerScopedCachesOnCoordChange`
   * must clear EVERY registered character-bearing mirror.  Calling
   * it directly (no re-population interference from the subscriber's
   * refreshBoundCharacter) is the tripwire: a future mirror added
   * to QuireApp but NOT to the invariant method leaves a populated
   * field here + fails this test.
   */
  it('the invariant method clears every registered mirror', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (app as unknown as {
      session: { append: Function };
    }).session;
    session.append('pc-create', {
      v: 1,
      pcId: 'pc-dm',
      name: 'Maria',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech'],
      backstory: 'x',
      causedByResponseId: 'syn-r1'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'pc-dm' });
    await flush();

    const appAny = app as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, unknown>;
      pcCharacterInFlight: Set<string>;
      boundCharacterFor: string;
      invalidateViewerScopedCachesOnCoordChange: () => void;
    };
    appAny.loadCharacterByPcId('pc-dm');
    appAny.boundCharacterFor = 'x/y|pc-dm';
    expect(appAny.pcCharacterCache.has('pc-dm')).toBe(true);

    appAny.invalidateViewerScopedCachesOnCoordChange();

    // Every registered mirror is now clear.  ADD NEW MIRRORS HERE.
    expect(appAny.pcCharacterCache.size).toBe(0);
    expect(appAny.pcCharacterInFlight.size).toBe(0);
    expect(appAny.boundCharacterFor).toBe('');
  });

  /**
   * Wiring guard: a real coord→player transition (coordinator-yield)
   * RE-DERIVES boundCharacter rather than serving the stale mirror.
   * The cache may legitimately re-populate via refreshBoundCharacter
   * — but with the NEW (stripped) strip decision, proven by the
   * @state object identity changing across the flip (mirrors #395).
   */
  it('coord→player transition re-derives boundCharacter (not stale)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (app as unknown as {
      session: { append: Function; rename: Function };
    }).session;
    session.append('pc-create', {
      v: 1,
      pcId: 'pc-dm',
      name: 'Maria',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech'],
      backstory: 'x',
      causedByResponseId: 'syn-r1'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'pc-dm' });
    session.rename({ pcId: 'pc-dm' });
    await flush();
    const appAny = app as unknown as {
      boundCharacter: { record: unknown } | null;
    };
    const before = appAny.boundCharacter;
    expect(before).not.toBeNull();
    session.append('coordinator-yield', {});
    await flush();
    // Re-derived: a fresh wrapper (the short-circuit key was reset
    // by the invariant, forcing refreshBoundCharacter to re-resolve
    // with the now-player strip decision).
    expect(appAny.boundCharacter).not.toBe(before);
  });

  /**
   * Defense-in-depth (Adversarial review 2026-05-28): the in-memory
   * AI response (aiResponse / aiResponseStructured, which carries a
   * dmOnly slice) is deliberately NOT cleared on a coord→player flip.
   * That is safe ONLY because the render gate `showAiPanel()` checks
   * LIVE isCoordinator() — so a now-player viewer's panel renders
   * empty even though the DM's AI output still sits in memory.  This
   * pins that render gate as the firewall; if a refactor ever makes
   * the panel render on stale state, this fails.
   */
  it('coord→player flip gates the AI panel off even with lingering aiResponseStructured', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const appAny = app as unknown as {
      aiResponse: string | null;
      aiResponseStructured: unknown;
      showAiPanel: () => boolean;
    };
    // Coord holds an AI response in memory (dmOnly populated).
    appAny.aiResponse = 'safe summary';
    appAny.aiResponseStructured = {
      safe: 'safe summary',
      dmOnly: 'the cult planted the relic'
    };
    expect(app.isCoordinator()).toBe(true);
    expect(appAny.showAiPanel()).toBe(true);

    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('coordinator-yield', {});
    await flush();

    expect(app.isCoordinator()).toBe(false);
    // The data lingers (documented) …
    expect(appAny.aiResponseStructured).not.toBeNull();
    // … but the render gate is the firewall: panel is off for a player.
    expect(appAny.showAiPanel()).toBe(false);
  });
});
