// @vitest-environment happy-dom

/**
 * #301 (2026-05-26) integration tests for the hidden-seat
 * spoiler firewall.  Engine-side projection is tested in
 * core/state.test.ts; this file pins the quire-app dispatch
 * methods (addHiddenSeat / revealSeat) end-to-end.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
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

describe('QuireApp #301 hidden seats', () => {
  it('addHiddenSeat dispatches seat-add with revealed:false', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const slot = app.addHiddenSeat();
    expect(slot).toBe(1);
    await flush();
    expect(app.sessionView!.shared.pcSlots[1]?.state).toBe('unbound');
    expect(app.sessionView!.shared.pcSlots[1]?.revealed).toBe(false);
  });

  it('addHiddenSeat allocates next free slot when 1 is taken', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Take slot 1 with a regular (visible) seat.
    (app as unknown as { session: { append: Function } }).session.append(
      'seat-add',
      { v: 1, slot: 1 }
    );
    await flush();
    const slot = app.addHiddenSeat();
    expect(slot).toBe(2);
  });

  it('addHiddenSeat is a no-op outside an active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    expect(app.addHiddenSeat()).toBeNull();
  });

  it('revealSeat flips revealed:false to revealed (and dispatches seat-reveal)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const slot = app.addHiddenSeat()!;
    await flush();
    expect(app.sessionView!.shared.pcSlots[slot]?.revealed).toBe(false);
    expect(app.revealSeat(slot)).toBe(true);
    await flush();
    expect(app.sessionView!.shared.pcSlots[slot]?.revealed).toBeUndefined();
  });

  it('revealSeat is a no-op on an already-revealed seat', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { session: { append: Function } }).session.append(
      'seat-add',
      { v: 1, slot: 1 }
    );
    await flush();
    expect(app.revealSeat(1)).toBe(false);
  });

  it('player projection: guest peer does not see the unrevealed seat', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    host.addHiddenSeat();
    await flush();
    // Stand up a guest app that joins.
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    expect(guest.sessionView?.status).toBe('active');
    expect(guest.isCoordinator()).toBe(false);
    // Host sees the hidden seat in its OWN state.
    expect(host.sessionView!.shared.pcSlots[1]).toBeDefined();
    // Guest's filteredShared has NO slot 1.
    expect(guest.sessionView!.filteredShared.pcSlots[1]).toBeUndefined();
  });

  it('after host clicks Reveal, the guest can now see the seat', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const slot = host.addHiddenSeat()!;
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    await flush();
    // Hidden initially.
    expect(guest.sessionView!.filteredShared.pcSlots[slot]).toBeUndefined();
    // Host reveals.
    host.revealSeat(slot);
    await flush();
    // Guest's filteredShared now contains it.
    expect(guest.sessionView!.filteredShared.pcSlots[slot]).toBeDefined();
  });
});
