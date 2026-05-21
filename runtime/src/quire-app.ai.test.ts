// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

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

function mountApp(): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = inMemoryFactory(new InMemoryNetwork(), 'HOST');
  document.body.appendChild(el);
  return el;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('QuireApp AI panel — visibility', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is visible in solo / idle', () => {
    const app = mountApp();
    expect(app.showAiPanel()).toBe(true);
  });

  it('is visible to coordinator (host) in active session', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    expect(app.showAiPanel()).toBe(true);
  });

  it('is hidden from non-coordinator guests', async () => {
    const network = new InMemoryNetwork();
    const host = document.createElement('quire-app') as QuireApp;
    host.sessionFactory = inMemoryFactory(network, 'HOST');
    document.body.appendChild(host);
    host.startHosting();
    await flush();

    const guest = document.createElement('quire-app') as QuireApp;
    guest.sessionFactory = inMemoryFactory(network, 'GUEST');
    document.body.appendChild(guest);
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    expect(guest.showAiPanel()).toBe(false);
  });
});

describe('QuireApp AI panel — submit flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('refuses to submit without an API key', async () => {
    const app = mountApp();
    const result = await app.submitAiPrompt('hello');
    expect(result).toBeNull();
    expect(app.aiError).toMatch(/api key/i);
  });

  it('rejects empty prompts even with a key', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    const result = await app.submitAiPrompt('   ');
    expect(result).toBeNull();
    expect(app.aiError).toMatch(/empty/i);
  });

  it('happy path: stores response, clears draft and loading', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    app.aiClient = vi.fn().mockResolvedValue('a quiet description.');
    app.aiPromptDraft = 'describe the cabin';
    const result = await app.submitAiPrompt(app.aiPromptDraft);
    expect(result).toBe('a quiet description.');
    expect(app.aiResponse).toBe('a quiet description.');
    expect(app.aiLoading).toBe(false);
    expect(app.aiError).toBeNull();
    expect(app.aiPromptDraft).toBe('');
  });

  it('error path: stores error message and clears loading', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    app.aiClient = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await app.submitAiPrompt('hi');
    expect(result).toBeNull();
    expect(app.aiResponse).toBeNull();
    expect(app.aiError).toMatch(/boom/);
    expect(app.aiLoading).toBe(false);
  });

  it('cancel during in-flight call clears loading and discards result', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    let release: () => void = () => {};
    const pending = new Promise<string>((res) => {
      release = () => res('late response');
    });
    app.aiClient = vi.fn().mockReturnValue(pending);
    const p = app.submitAiPrompt('hi');
    expect(app.aiLoading).toBe(true);
    app.cancelAiPrompt();
    release();
    const result = await p;
    // The aborted call resolves to null and never lands in aiResponse.
    expect(result).toBeNull();
    expect(app.aiResponse).toBeNull();
    expect(app.aiLoading).toBe(false);
  });
});

describe('QuireApp AI panel — settings persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists the API key to localStorage', () => {
    const app = mountApp();
    app.setAiApiKey('sk-persisted');
    expect(window.localStorage.getItem('quire.ai.apiKey')).toBe('sk-persisted');
  });

  it('hydrates the API key from localStorage on mount', () => {
    window.localStorage.setItem('quire.ai.apiKey', 'sk-hydrated');
    const app = mountApp();
    expect(app.aiApiKey).toBe('sk-hydrated');
  });

  it('persists a custom system prompt', () => {
    const app = mountApp();
    app.setAiSystemPrompt('Pirate voice, please.');
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBe(
      'Pirate voice, please.'
    );
  });
});

describe('QuireApp AI share-to-chat', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('refuses to share when no response is staged', () => {
    const app = mountApp();
    expect(app.shareAiResponseToChat()).toBe(false);
  });

  it('shares response into chat with an [AI] marker', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    app.aiClient = vi.fn().mockResolvedValue('the cabin smells like sleep.');
    app.startHosting();
    await flush();
    await app.submitAiPrompt('describe the cabin');
    expect(app.aiResponse).toBe('the cabin smells like sleep.');
    expect(app.shareAiResponseToChat()).toBe(true);
    const chat = app.sessionView!.shared.chat;
    expect(chat[chat.length - 1].text).toBe('[AI] the cabin smells like sleep.');
  });
});
