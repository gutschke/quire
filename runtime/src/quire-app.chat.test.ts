// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import { SessionController, type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(
  network: InMemoryNetwork,
  forcedId: string
): TransportFactory {
  return {
    createHost: async () => {
      const transport = new InMemoryTransport(forcedId, network);
      return { transport, pairingCode: forcedId };
    },
    createGuest: async () => {
      const transport = new InMemoryTransport(forcedId, network);
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('QuireApp chat surface', () => {
  it('submitChat is a no-op when not in active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    expect(app.submitChat('hello')).toBe(false);
  });

  it('submitChat appends a chat event when in active session', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    app.startHosting();
    await flush();
    expect(app.sessionView?.status).toBe('active');
    expect(app.submitChat('  hello, world  ')).toBe(true);
    const chat = app.sessionView!.shared.chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].text).toBe('hello, world');
    expect(chat[0].peerId).toBe('HOST');
  });

  it('clears the draft after a successful send', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    app.chatDraft = 'pending';
    app.submitChat(app.chatDraft);
    expect(app.chatDraft).toBe('');
  });

  it('ignores empty / whitespace-only messages', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    expect(app.submitChat('')).toBe(false);
    expect(app.submitChat('   ')).toBe(false);
    expect(app.sessionView?.shared.chat).toEqual([]);
  });

  it('rejects messages longer than the cap', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const tooLong = 'x'.repeat(501);
    expect(app.submitChat(tooLong)).toBe(false);
    expect(app.sessionView?.shared.chat).toEqual([]);
  });

  it('shareAiResponseToChat truncates a too-long AI response with an ellipsis', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    (app as unknown as { aiResponse: string }).aiResponse = 'a'.repeat(5000);
    expect(app.shareAiResponseToChat()).toBe(true);
    const chat = app.sessionView!.shared.chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].text.length).toBeLessThanOrEqual(500);
    expect(chat[0].text.startsWith('[AI] ')).toBe(true);
    expect(chat[0].text.endsWith('…')).toBe(true);
  });

  it('routes /roll prefix through the dice flow, not chat', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.rngForRoll = () => 0.5;
    app.startHosting();
    await flush();
    const result = app.submitChat('/roll 2d6+1');
    expect(result).toBe(true);
    // No chat entry; instead, a dice-roll event in shared state.
    expect(app.sessionView!.shared.chat).toEqual([]);
    expect(app.sessionView!.shared.diceRolls).toHaveLength(1);
    expect(app.sessionView!.shared.diceRolls[0].expression).toBe('2d6+1');
  });

  it('falls through unparseable /roll to chat (literal, not silent no-op)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    app.submitChat('/roll xyzzy');
    // User sees their own message rather than a silent failure.
    const chat = app.sessionView!.shared.chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].text).toBe('/roll xyzzy');
  });

  it('receives messages from a remote peer', async () => {
    const network = new InMemoryNetwork();
    // App acts as host.
    const app = mountApp(inMemoryFactory(network, 'HOST'));
    app.displayNameDraft = 'DM';
    app.startHosting();
    await flush();

    // Stand up a separate SessionController as the "remote" guest.
    const remote = new SessionController({
      createHost: async () => {
        throw new Error('unused');
      },
      createGuest: async () => {
        const transport = new InMemoryTransport('GUEST', network);
        return { transport };
      }
    });
    await remote.join('HOST', 'Player');
    await flush();

    remote.append('chat', { text: 'hi from guest' });
    await flush();

    const texts = app.sessionView!.shared.chat.map((c) => c.text);
    expect(texts).toContain('hi from guest');
  });
});
