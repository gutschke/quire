// @vitest-environment happy-dom

/**
 * #302 (2026-05-26): yield-time PC-fate prompt — voluntary +
 * reactive paths.
 *
 * Voluntary: the DM clicks "Yield DM role".  When they have a
 * bound PC, the modal asks Keep / Sideline / Retire; submit emits
 * the matching event (peer-rename / pc-retire / nothing) FIRST,
 * then coordinator-yield.
 *
 * Reactive: another peer reclaims while the DM had a PC.  The
 * coord transition is detected in `updated()`; the same modal
 * opens with `voluntary=false` so the outgoing DM can still pick
 * their PC's fate after the fact (no coordinator-yield emitted —
 * already done by the reclaim).
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { SessionController, type TransportFactory } from './session-controller';
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

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function bindMeiToHost(app: QuireApp): void {
  const session = (app as unknown as { session: { append: Function; rename: Function } })
    .session;
  session.append('seat-add', { v: 1, slot: 1 });
  // pc-create payload is FLAT (not nested under `record`) — the
  // materializer in core/state.ts validates name/pronouns/tags/
  // stats/skills/backstory at the top level.
  session.append('pc-create', {
    v: 1,
    pcId: 'mei',
    name: 'Mei',
    pronouns: 'she/her',
    tags: ['archivist', 'reluctant', 'sister-of-a-pilot'],
    stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 },
    skills: ['Tech'],
    backstory: 'A test PC for the yield-fate flow.'
  });
  session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
  session.rename({ pcId: 'mei' });
}

describe('QuireApp #302 yield PC-fate prompt', () => {
  describe('voluntary yield', () => {
    it('without bound PC, the prompt opens without radios', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      // Simulate clicking the Yield DM button.
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      expect(app.yieldPcFatePrompt).not.toBeNull();
      expect(app.yieldPcFatePrompt!.pcId).toBe('');
      expect(app.yieldPcFatePrompt!.voluntary).toBe(true);
    });

    it('with bound PC, opens with PC name + default Keep', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      expect(app.yieldPcFatePrompt!.pcId).toBe('mei');
      expect(app.yieldPcFatePrompt!.pcName).toBe('Mei');
      expect(app.yieldPcFatePrompt!.fate).toBe('keep');
    });

    it('submit with fate=keep emits ONLY coordinator-yield', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      const before = (
        app as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      expect(app.submitYieldPcFatePrompt()).toBe(true);
      await flush();
      const events = (
        app as unknown as {
          session: { getEvents: () => ReadonlyArray<{ kind: string }> };
        }
      ).session.getEvents();
      const newKinds = events.slice(before).map((e) => e.kind);
      expect(newKinds).toContain('coordinator-yield');
      expect(newKinds).not.toContain('pc-retire');
      expect(newKinds).not.toContain('peer-rename'); // no sideline
      expect(app.yieldPcFatePrompt).toBeNull();
    });

    it('submit with fate=sideline emits peer-rename(pcId="") + yield', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      app.setYieldPcFate('sideline');
      const before = (
        app as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      expect(app.submitYieldPcFatePrompt()).toBe(true);
      await flush();
      const events = (
        app as unknown as {
          session: {
            getEvents: () => ReadonlyArray<{
              kind: string;
              payload?: { pcId?: unknown };
            }>;
          };
        }
      ).session.getEvents();
      const newEvents = events.slice(before);
      const yieldIdx = newEvents.findIndex((e) => e.kind === 'coordinator-yield');
      const renameIdx = newEvents.findIndex(
        (e) =>
          e.kind === 'peer-rename' &&
          (e.payload as { pcId?: unknown })?.pcId === ''
      );
      expect(renameIdx).toBeGreaterThanOrEqual(0);
      expect(yieldIdx).toBeGreaterThan(renameIdx); // rename FIRST
      // After materialize, host's peer.pcId is cleared.
      expect(app.sessionView!.shared.peers['HOST']?.pcId).toBeUndefined();
    });

    it('submit with fate=retire emits pc-retire + yield', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      app.setYieldPcFate('retire');
      // Submitting without a reason should fail (UI also guards).
      // We set the reason and resubmit.
      app.setYieldRetireReason('She stepped back to care for her sister');
      const before = (
        app as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      expect(app.submitYieldPcFatePrompt()).toBe(true);
      await flush();
      const events = (
        app as unknown as {
          session: { getEvents: () => ReadonlyArray<{ kind: string }> };
        }
      ).session.getEvents();
      const newKinds = events.slice(before).map((e) => e.kind);
      expect(newKinds).toContain('pc-retire');
      expect(newKinds).toContain('coordinator-yield');
      // Seat flips to bound-retired.
      expect(app.sessionView!.shared.pcSlots[1]?.state).toBe('bound-retired');
    });

    it('submit fate=retire with empty reason is rejected', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      app.setYieldPcFate('retire');
      // No reason set.
      expect(app.submitYieldPcFatePrompt()).toBe(false);
      // Prompt stays open so the DM can fill in the reason.
      expect(app.yieldPcFatePrompt).not.toBeNull();
    });

    it('dismissYieldPcFatePrompt closes without emitting', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      bindMeiToHost(app);
      await flush();
      (
        app as unknown as { openYieldPrompt: () => void }
      ).openYieldPrompt();
      const before = (
        app as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      app.dismissYieldPcFatePrompt();
      const after = (
        app as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      expect(after).toBe(before);
      expect(app.yieldPcFatePrompt).toBeNull();
    });
  });

  describe('reactive yield (someone reclaimed me)', () => {
    it('coord-loss with bound PC opens the prompt with voluntary=false', async () => {
      const network = new InMemoryNetwork();
      const host = mountApp(inMemoryFactory(network, 'HOST'));
      host.startHosting();
      await flush();
      bindMeiToHost(host);
      await flush();
      // Confirm host is coord with bound PC.
      expect(host.sessionView!.filteredShared.coordinator).toBe('HOST');
      expect(host.sessionView!.shared.peers['HOST']?.pcId).toBe('mei');
      // Remote peer joins + reclaims.
      const remote = new SessionController({
        createHost: async () => ({
          transport: new InMemoryTransport('unused', network),
          pairingCode: 'unused'
        }),
        createGuest: async () => ({
          transport: new InMemoryTransport('GUEST', network)
        })
      });
      await remote.join('HOST', 'Bob');
      await flush();
      remote.reclaimCoordinator();
      await flush();
      await flush();
      // Host's coord status should now be non-coord.
      expect(host.sessionView!.filteredShared.coordinator).toBe('GUEST');
      // Reactive prompt should have opened.
      expect(host.yieldPcFatePrompt).not.toBeNull();
      expect(host.yieldPcFatePrompt!.voluntary).toBe(false);
      expect(host.yieldPcFatePrompt!.pcId).toBe('mei');
    });

    it('reactive submit emits ONLY the PC-fate action (no yield event)', async () => {
      const network = new InMemoryNetwork();
      const host = mountApp(inMemoryFactory(network, 'HOST'));
      host.startHosting();
      await flush();
      bindMeiToHost(host);
      await flush();
      const remote = new SessionController({
        createHost: async () => ({
          transport: new InMemoryTransport('unused', network),
          pairingCode: 'unused'
        }),
        createGuest: async () => ({
          transport: new InMemoryTransport('GUEST', network)
        })
      });
      await remote.join('HOST', 'Bob');
      await flush();
      remote.reclaimCoordinator();
      await flush();
      await flush();
      // Pick Sideline + submit.
      host.setYieldPcFate('sideline');
      const before = (
        host as unknown as { session: { getEvents: () => readonly unknown[] } }
      ).session.getEvents().length;
      expect(host.submitYieldPcFatePrompt()).toBe(true);
      await flush();
      const events = (
        host as unknown as {
          session: { getEvents: () => ReadonlyArray<{ kind: string }> };
        }
      ).session.getEvents();
      const newKinds = events.slice(before).map((e) => e.kind);
      // The reclaim already removed coord — this path should NOT
      // also emit coordinator-yield.
      expect(newKinds).not.toContain('coordinator-yield');
      expect(newKinds).toContain('peer-rename');
    });

    it('does NOT open reactive prompt when local peer had no bound PC', async () => {
      const network = new InMemoryNetwork();
      const host = mountApp(inMemoryFactory(network, 'HOST'));
      host.startHosting();
      await flush();
      // Host is coord but no pcId.
      const remote = new SessionController({
        createHost: async () => ({
          transport: new InMemoryTransport('unused', network),
          pairingCode: 'unused'
        }),
        createGuest: async () => ({
          transport: new InMemoryTransport('GUEST', network)
        })
      });
      await remote.join('HOST', 'Bob');
      await flush();
      remote.reclaimCoordinator();
      await flush();
      await flush();
      expect(host.sessionView!.filteredShared.coordinator).toBe('GUEST');
      expect(host.yieldPcFatePrompt).toBeNull();
    });
  });
});
