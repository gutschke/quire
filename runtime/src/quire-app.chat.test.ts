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

  it('B1 (Phase 3b-2A): /ai prefix re-routes to AI, does NOT broadcast to chat', async () => {
    // Per the chat/AI confusion threat-model finding, a DM whose
    // muscle-memory typed an AI-intended message into the chat
    // input gets a slash-command escape hatch: `/ai <question>`
    // routes to submitAiPrompt instead of session.append('chat').
    // Verifies the load-bearing security invariant.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Spy on submitAiPrompt; we don't actually need the AI roundtrip,
    // just confirm the routing decision was made.
    let aiCalledWith = '';
    const origSubmit = app.submitAiPrompt.bind(app);
    app.submitAiPrompt = async (p: string) => {
      aiCalledWith = p;
      return null;
    };
    const result = app.submitChat('/ai can you create the pcs for me');
    expect(result).toBe(true);
    expect(aiCalledWith).toBe('can you create the pcs for me');
    // Critically: no chat event was appended.  This is the bug.
    expect(app.sessionView!.shared.chat).toEqual([]);
    app.submitAiPrompt = origSubmit;
  });

  it('B1: @ai prefix also re-routes (muscle-memory tolerance)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    let aiCalledWith = '';
    app.submitAiPrompt = async (p: string) => {
      aiCalledWith = p;
      return null;
    };
    app.submitChat('@ai what is the antagonist hiding?');
    expect(aiCalledWith).toBe('what is the antagonist hiding?');
    expect(app.sessionView!.shared.chat).toEqual([]);
  });

  it('B1: /airplane does NOT match the /ai pattern (precise prefix)', async () => {
    // The regex requires `/ai` followed by whitespace, not just
    // `/ai...`.  Defensive against a DM typing "/airplane" as
    // chat literal — should land in chat, not get truncated to
    // an AI call with "plane" as the prompt.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    let aiCalledWith: string | null = null;
    app.submitAiPrompt = async (p: string) => {
      aiCalledWith = p;
      return null;
    };
    app.submitChat('/airplane is a chat word');
    expect(aiCalledWith).toBeNull();
    expect(app.sessionView!.shared.chat).toHaveLength(1);
    expect(app.sessionView!.shared.chat[0].text).toBe(
      '/airplane is a chat word'
    );
  });

  it('B1: /ai with no message body lands in chat (literal, prompts user)', async () => {
    // `/ai` alone (no trailing whitespace + text) doesn't match the
    // re-route regex; falls through to chat as a literal so the user
    // sees their typo and corrects.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    let aiCalledWith: string | null = null;
    app.submitAiPrompt = async (p: string) => {
      aiCalledWith = p;
      return null;
    };
    app.submitChat('/ai');
    expect(aiCalledWith).toBeNull();
    // The literal goes through to chat.
    expect(app.sessionView!.shared.chat).toHaveLength(1);
    expect(app.sessionView!.shared.chat[0].text).toBe('/ai');
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
