// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(
  network: InMemoryNetwork,
  forcedId?: string
): TransportFactory {
  let n = 0;
  return {
    createHost: async () => {
      const id = forcedId ?? `host-${++n}`;
      const transport = new InMemoryTransport(id, network);
      return { transport, pairingCode: id };
    },
    createGuest: async (code) => {
      const id = `guest-${++n}`;
      const transport = new InMemoryTransport(id, network);
      void code;
      return { transport };
    }
  };
}

function mountApp(factory: TransportFactory): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  document.body.appendChild(el);
  return el;
}

describe('QuireApp session wiring', () => {
  it('starts in solo/idle', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork()));
    expect(app.sessionView?.mode).toBe('solo');
    expect(app.sessionView?.status).toBe('idle');
  });

  it('hosting transitions to active and exposes pairing code', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST1'));
    app.startHosting();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.sessionView?.status).toBe('active');
    expect(app.sessionView?.mode).toBe('host');
    expect(app.sessionView?.pairingCode).toBe('HOST1');
  });

  it('submitRoll publishes a dice-roll event when in session', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST1'));
    app.rngForRoll = () => 0.5;
    app.startHosting();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.sessionView?.status).toBe('active');
    app.submitRoll('2d6+1');
    expect(app.sessionView?.shared.diceRolls).toHaveLength(1);
    expect(app.sessionView?.shared.diceRolls[0].expression).toBe('2d6+1');
  });

  it('leaving returns to solo/idle and clears shared state', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST1'));
    app.startHosting();
    await Promise.resolve();
    await Promise.resolve();
    app.leaveSession();
    expect(app.sessionView?.mode).toBe('solo');
    expect(app.sessionView?.status).toBe('idle');
    expect(app.sessionView?.shared.chat).toEqual([]);
  });

  it('local rolls happen even in solo mode (no session.append)', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork()));
    app.rngForRoll = () => 0.5;
    const r = app.submitRoll('2d6');
    expect(r).not.toBeNull();
    expect(app.rolls).toHaveLength(1);
    expect(app.sessionView?.shared.diceRolls).toEqual([]);
  });
});
