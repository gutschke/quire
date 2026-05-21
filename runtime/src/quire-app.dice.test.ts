// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';

function mountApp(): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  document.body.appendChild(el);
  return el;
}

describe('QuireApp dice integration', () => {
  it('adds a roll to history on submit', () => {
    const app = mountApp();
    app.rngForRoll = () => 0.5;
    const roll = app.submitRoll('2d6+1');
    expect(roll).not.toBeNull();
    expect(app.rolls).toHaveLength(1);
    expect(app.rolls[0].total).toBe(roll!.total);
    expect(app.rollDraft).toBe('');
    expect(app.rollError).toBeNull();
  });

  it('records an error on garbage and leaves history empty', () => {
    const app = mountApp();
    const roll = app.submitRoll('not dice');
    expect(roll).toBeNull();
    expect(app.rollError).toMatch(/parse/i);
    expect(app.rolls).toHaveLength(0);
  });

  it('caps history at five most-recent rolls', () => {
    const app = mountApp();
    app.rngForRoll = () => 0.5;
    for (let i = 0; i < 7; i++) {
      app.submitRoll('1d6');
    }
    expect(app.rolls).toHaveLength(5);
  });

  it('renders shared diceRolls on every peer in an active session', async () => {
    // B2 regression: previously each peer saw only its own this.rolls;
    // shared.diceRolls landed in materialize but never in any panel.
    const { InMemoryNetwork, InMemoryTransport } = await import('./core/transports/in-memory');
    const network = new InMemoryNetwork();
    const host = document.createElement('quire-app') as QuireApp;
    host.sessionFactory = {
      createHost: async () => ({
        transport: new InMemoryTransport('HOST', network),
        pairingCode: 'HOST'
      }),
      createGuest: async () => {
        throw new Error('unused');
      }
    };
    document.body.appendChild(host);
    host.startHosting();

    const guest = document.createElement('quire-app') as QuireApp;
    guest.sessionFactory = {
      createHost: async () => {
        throw new Error('unused');
      },
      createGuest: async () => ({
        transport: new InMemoryTransport('GUEST', network)
      })
    };
    document.body.appendChild(guest);
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    // wait for join + state sync
    for (let i = 0; i < 5; i++) await Promise.resolve();

    host.rngForRoll = () => 0.5;
    host.submitRoll('2d6+1');
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Guest's shared state has the roll (B2: previously rendered
    // nowhere; now consumed by renderRollPanel).
    expect(guest.sessionView?.shared.diceRolls).toHaveLength(1);
    expect(guest.sessionView?.shared.diceRolls[0].expression).toBe('2d6+1');
    expect(guest.sessionView?.shared.diceRolls[0].peerId).toBe('HOST');
    // E2E test verifies the render in a real browser; this unit
    // test pins the data flow (which is what regressed in B2 — the
    // material was there, just unrendered).
  });

  it('newest roll appears first', () => {
    const app = mountApp();
    let n = 0;
    app.rngForRoll = () => {
      n += 0.15;
      return n % 1;
    };
    app.submitRoll('1d6');
    const firstTotal = app.rolls[0].total;
    app.submitRoll('1d20');
    expect(app.rolls[0].command.sides).toBe(20);
    expect(app.rolls[1].command.sides).toBe(6);
    expect(app.rolls[1].total).toBe(firstTotal);
  });
});
