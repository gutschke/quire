// @vitest-environment happy-dom

/**
 * P-R10 (2026-05-25) integration test for NPC→PC promotion.
 *
 * Sanity-check pass during the #302 cycle caught that the original
 * P-R10 implementation emitted `pc-create` with a nested `record:
 * {...}` payload — the materializer expects FLAT fields and
 * silently dropped the event.  The UI-layer tests in
 * stage-roster.test.ts didn't catch this because they only
 * exercised the dropdown surface, not the actual promote path.
 *
 * This test verifies end-to-end: after promoteNpcToPc resolves,
 * the new PC IS in synthesizedPcs with the expected name + tags +
 * stats, and the seat IS bound-active.
 */

import { describe, it, expect, vi } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import * as charLoader from './character-loader';

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

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function injectCampaign(app: QuireApp, npcIds: string[]): void {
  const campaign = {
    base: {
      manifest: {
        $schemaVersion: '0.1.0',
        name: 'TestCampaign',
        characters: { npcs: npcIds }
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    },
    worldOverview: null
  };
  (
    app as unknown as { _appState: { kind: string; campaign: unknown } }
  )._appState = { kind: 'campaign', campaign };
}

describe('QuireApp P-R10 — promoteNpcToPc integration', () => {
  it('promotes to a HIDDEN seat (player firewall) — QA sanity-check BLOCKING-1', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app, ['yui']);
    const loadSpy = vi.spyOn(charLoader, 'loadCharacter').mockResolvedValue({
      kind: 'npc',
      id: 'yui',
      record: {
        $schemaVersion: '0.1.0',
        name: 'Yui',
        // DM-private framing the player must NOT see.
        backstory: 'Secretly Mei\'s sister; works for The Quiet.',
        description: 'Hidden agenda: betray the table in episode 5.',
        stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    });
    const slot = await app.promoteNpcToPc('yui');
    expect(slot).toBe(1);
    await flush();
    const v = app.sessionView!;
    // Seat is hidden until the DM clicks Reveal.
    expect(v.shared.pcSlots[1]?.revealed).toBe(false);
    // Backstory does NOT contain the DM-private framing — replaced
    // with a neutral placeholder.
    const newPcId = Object.keys(v.shared.synthesizedPcs).find((id) =>
      id.startsWith('pc-from-yui-')
    )!;
    const rec = v.shared.synthesizedPcs[newPcId];
    expect(rec.backstory).not.toMatch(/Secretly Mei/);
    expect(rec.backstory).not.toMatch(/Hidden agenda/);
    expect(rec.backstory).not.toMatch(/The Quiet/);
    expect(rec.backstory).toMatch(/Promoted from NPC/);
    loadSpy.mockRestore();
  });

  it('materializes the new PC into synthesizedPcs (regression for nested-record bug)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app, ['yui']);
    // Stub the loadCharacter network call.
    const loadSpy = vi
      .spyOn(charLoader, 'loadCharacter')
      .mockResolvedValue({
        kind: 'npc',
        id: 'yui',
        record: {
          $schemaVersion: '0.1.0',
          name: 'Yui Tanaka',
          pronouns: 'she/her',
          stats: { str: 1, dex: 0, con: 0, int: 2, wis: 0, cha: 1 },
          tags: ['archivist'],
          backstory: 'A wiry archivist who claims she does not remember.',
          description: 'A wiry archivist who claims she does not remember.'
        },
        source: { owner: 'x', repo: 'y', ref: 'main' }
      });
    const slot = await app.promoteNpcToPc('yui');
    expect(slot).toBe(1);
    await flush();
    const v = app.sessionView!;
    // Find the new pcId — generated with `pc-from-yui-<rand>` suffix.
    const newPcId = Object.keys(v.shared.synthesizedPcs).find((id) =>
      id.startsWith('pc-from-yui-')
    );
    expect(newPcId).toBeDefined();
    const rec = v.shared.synthesizedPcs[newPcId!];
    expect(rec.name).toBe('Yui Tanaka');
    expect(rec.stats?.int).toBe(2);
    // Tags padded to >= 3 (NPC had 1).
    expect((rec.tags ?? []).length).toBeGreaterThanOrEqual(3);
    // Seat is bound-active in slot 1.
    expect(v.shared.pcSlots[1]?.state).toBe('bound-active');
    expect(v.shared.pcSlots[1]?.pcId).toBe(newPcId);
    loadSpy.mockRestore();
  });

  it('coord-only: non-coord returns null without dispatching', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    // No startHosting → not coord.
    expect(await app.promoteNpcToPc('yui')).toBeNull();
  });

  it('handles NPC load failure (returns null + sets aiError)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app, ['missing']);
    const loadSpy = vi
      .spyOn(charLoader, 'loadCharacter')
      .mockRejectedValue(new Error('404'));
    const slot = await app.promoteNpcToPc('missing');
    expect(slot).toBeNull();
    expect((app as unknown as { aiError: string }).aiError).toMatch(/404/);
    loadSpy.mockRestore();
  });

  it('allocates next free slot when slot 1 already bound', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Manually bind slot 1.
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'preexisting',
      name: 'Preexisting',
      pronouns: '',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: [],
      backstory: 'X'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'preexisting' });
    await flush();
    injectCampaign(app, ['yui']);
    const loadSpy = vi
      .spyOn(charLoader, 'loadCharacter')
      .mockResolvedValue({
        kind: 'npc',
        id: 'yui',
        record: {
          $schemaVersion: '0.1.0',
          name: 'Yui',
          stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
        },
        source: { owner: 'x', repo: 'y', ref: 'main' }
      });
    const slot = await app.promoteNpcToPc('yui');
    expect(slot).toBe(2);
    loadSpy.mockRestore();
  });
});
