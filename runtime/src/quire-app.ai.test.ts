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

  // M3b.5: AI submit now goes through AiBroker → aiProviders.
  // Helper to stub a structured provider with the given safe text.
  function stubClaudeReturning(
    app: ReturnType<typeof mountApp>,
    safe: string,
    extras: { dmOnly?: string; tokensIn?: number; tokensOut?: number } = {}
  ): void {
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: vi.fn().mockResolvedValue({
          raw: JSON.stringify({
            safe,
            dmOnly: extras.dmOnly ?? '',
            sources: []
          }),
          tokensIn: extras.tokensIn ?? 0,
          tokensOut: extras.tokensOut ?? 0,
          responseId: 'test-resp'
        }),
        parse: (raw: string) => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
      }
    };
  }

  function stubClaudeThrowing(
    app: ReturnType<typeof mountApp>,
    err: Error
  ): void {
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: vi.fn().mockRejectedValue(err),
        parse: () => null
      }
    };
  }

  it('happy path: stores response, clears draft and loading', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    stubClaudeReturning(app, 'a quiet description.');
    app.aiPromptDraft = 'describe the cabin';
    const result = await app.submitAiPrompt(app.aiPromptDraft);
    expect(result).toBe('a quiet description.');
    expect(app.aiResponse).toBe('a quiet description.');
    expect(app.aiResponseStructured?.safe).toBe('a quiet description.');
    expect(app.aiLoading).toBe(false);
    expect(app.aiError).toBeNull();
    expect(app.aiPromptDraft).toBe('');
  });

  it('error path: stores error message and clears loading', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    stubClaudeThrowing(app, new Error('boom'));
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
    const pending = new Promise<{
      raw: string;
      tokensIn: number;
      tokensOut: number;
      responseId: string;
    }>((res) => {
      release = () =>
        res({
          raw: JSON.stringify({ safe: 'late', dmOnly: '', sources: [] }),
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'late'
        });
    });
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: vi.fn().mockReturnValue(pending),
        parse: (raw: string) => JSON.parse(raw)
      }
    };
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

  it('scope toggle resets to public after submit (M3b.5)', async () => {
    const app = mountApp();
    app.setAiApiKey('sk-test');
    stubClaudeReturning(app, 'ok');
    app.aiScope = 'dm';
    await app.submitAiPrompt('hi');
    expect(app.aiScope).toBe('public');
  });
});

describe('QuireApp AI panel — settings persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists the API key under the current provider', () => {
    const app = mountApp();
    app.setAiApiKey('sk-persisted');
    app.flushAiKeyStore();
    expect(window.localStorage.getItem('quire.ai.claude.apiKey')).toBe(
      'sk-persisted'
    );
  });

  it('hydrates the API key from per-provider storage on mount', () => {
    window.localStorage.setItem('quire.ai.claude.apiKey', 'sk-hydrated');
    const app = mountApp();
    expect(app.aiApiKey).toBe('sk-hydrated');
  });

  it('hydrates from the pre-split legacy key when no per-provider key exists', () => {
    window.localStorage.setItem('quire.ai.apiKey', 'sk-legacy');
    const app = mountApp();
    expect(app.aiApiKey).toBe('sk-legacy');
  });

  it('persists a custom system prompt', () => {
    const app = mountApp();
    app.setAiSystemPrompt('Pirate voice, please.');
    app.flushAiKeyStore();
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBe(
      'Pirate voice, please.'
    );
  });
});

describe('QuireApp AI panel — provider switching', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('default provider is claude when nothing is stored', () => {
    const app = mountApp();
    expect(app.aiProvider).toBe('claude');
  });

  it('setAiProvider persists and changes the active key/model', () => {
    const app = mountApp();
    app.setAiApiKey('sk-claude', 'claude');
    app.setAiApiKey('AIza-gemini', 'gemini');
    app.setAiProvider('gemini');
    expect(app.aiProvider).toBe('gemini');
    expect(app.aiApiKey).toBe('AIza-gemini');
    expect(app.aiModel).toMatch(/^gemini-/);
    expect(window.localStorage.getItem('quire.ai.provider')).toBe('gemini');
  });

  it('per-provider API keys are kept separately', () => {
    const app = mountApp();
    app.setAiApiKey('sk-claude', 'claude');
    app.setAiApiKey('AIza-gemini', 'gemini');
    app.flushAiKeyStore();
    expect(window.localStorage.getItem('quire.ai.claude.apiKey')).toBe('sk-claude');
    expect(window.localStorage.getItem('quire.ai.gemini.apiKey')).toBe(
      'AIza-gemini'
    );
  });

  it('submitAiPrompt picks the provider matching aiProvider', async () => {
    const app = mountApp();
    const stub = (safe: string) => ({
      id: 'claude' as const,
      call: vi.fn().mockResolvedValue({
        raw: JSON.stringify({ safe, dmOnly: '', sources: [] }),
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'r'
      }),
      parse: (raw: string) => JSON.parse(raw)
    });
    const claudeStub = stub('claude says hi');
    const geminiStub = { ...stub('gemini says hi'), id: 'gemini' as const };
    app.aiProviders = { claude: claudeStub, gemini: geminiStub };
    app.setAiApiKey('sk-claude', 'claude');
    app.setAiApiKey('AIza', 'gemini');

    app.setAiProvider('claude');
    await app.submitAiPrompt('hello');
    expect(claudeStub.call).toHaveBeenCalled();
    expect(geminiStub.call).not.toHaveBeenCalled();
    expect(app.aiResponse).toBe('claude says hi');

    app.setAiProvider('gemini');
    await app.submitAiPrompt('hello again');
    expect(geminiStub.call).toHaveBeenCalled();
    expect(app.aiResponse).toBe('gemini says hi');
  });

  it('model setting is per-provider', () => {
    const app = mountApp();
    app.setAiModel('claude-opus-4-7', 'claude');
    app.setAiModel('gemini-2.5-pro', 'gemini');
    app.setAiProvider('claude');
    expect(app.aiModel).toBe('claude-opus-4-7');
    app.setAiProvider('gemini');
    expect(app.aiModel).toBe('gemini-2.5-pro');
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
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: vi.fn().mockResolvedValue({
          raw: JSON.stringify({
            safe: 'the cabin smells like sleep.',
            dmOnly: '',
            sources: []
          }),
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r'
        }),
        parse: (raw: string) => JSON.parse(raw)
      }
    };
    app.startHosting();
    await flush();
    await app.submitAiPrompt('describe the cabin');
    expect(app.aiResponse).toBe('the cabin smells like sleep.');
    expect(app.shareAiResponseToChat()).toBe(true);
    const chat = app.sessionView!.shared.chat;
    expect(chat[chat.length - 1].text).toBe('[AI] the cabin smells like sleep.');
  });
});
