// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { type AiProviderStructuredResult } from './ai/broker';

/**
 * Phase 3b-X step 9: mock providers no longer have call()/parse() —
 * callStructured is the sole interface.  These helpers build the
 * typed result envelopes the tests need without repeating boilerplate.
 */
function structuredOk(
  safe: string,
  extras: { dmOnly?: string; tokensIn?: number; tokensOut?: number; responseId?: string } = {}
): AiProviderStructuredResult<unknown> {
  const value = { safe, dmOnly: extras.dmOnly ?? '', sources: [] };
  return {
    ok: true,
    value,
    raw: JSON.stringify(value),
    tokensIn: extras.tokensIn ?? 0,
    tokensOut: extras.tokensOut ?? 0,
    responseId: extras.responseId ?? 'test-resp'
  };
}

function structuredProviderError(message: string): AiProviderStructuredResult<unknown> {
  return {
    ok: false,
    refusal: { kind: 'provider-error', message },
    raw: '',
    tokensIn: 0,
    tokensOut: 0,
    responseId: ''
  };
}

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
        callStructured: vi.fn().mockResolvedValue(structuredOk(safe, extras))
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
        callStructured: vi.fn().mockResolvedValue(structuredProviderError(err.message))
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
    const pending = new Promise<AiProviderStructuredResult<unknown>>((res) => {
      release = () => res(structuredOk('late', { responseId: 'late' }));
    });
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockReturnValue(pending)
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

  it('records ai-prompt + ai-response with REAL tokensIn / tokensOut (M3b.7 unblock)', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockResolvedValue(
          structuredOk('hi', { tokensIn: 42, tokensOut: 17, responseId: 'r-1' })
        )
      }
    };
    await app.submitAiPrompt('hi');
    await flush();
    const audit = app.sessionView!.shared.aiAudit;
    const prompt = audit.find((e) => e.kind === 'prompt');
    const response = audit.find((e) => e.kind === 'response');
    expect(prompt?.tokensIn).toBe(42);
    expect(response?.tokensOut).toBe(17);
  });

  it('Accept verdict sets aiVerdictResponseId + kind (M3b.7 unblock)', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.acceptAiResponse('r-42');
    expect(app.aiVerdictResponseId).toBe('r-42');
    expect(app.aiVerdictKind).toBe('accept');
  });

  it('Reject verdict sets the matching state', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.rejectAiResponse('r-99', 'too-spoilery');
    expect(app.aiVerdictResponseId).toBe('r-99');
    expect(app.aiVerdictKind).toBe('reject');
  });

  it('new response clears the prior verdict so its buttons are hot again', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockResolvedValue(
          structuredOk('a', { responseId: 'r-new' })
        )
      }
    };
    app.acceptAiResponse('r-old');
    expect(app.aiVerdictKind).toBe('accept');
    await app.submitAiPrompt('hi');
    expect(app.aiVerdictKind).toBe('');
    expect(app.aiVerdictResponseId).toBe('');
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
    const stub = (safe: string, id: 'claude' | 'gemini') => ({
      id,
      callStructured: vi.fn().mockResolvedValue(structuredOk(safe, { responseId: 'r' }))
    });
    const claudeStub = stub('claude says hi', 'claude');
    const geminiStub = stub('gemini says hi', 'gemini');
    app.aiProviders = { claude: claudeStub, gemini: geminiStub };
    app.setAiApiKey('sk-claude', 'claude');
    app.setAiApiKey('AIza', 'gemini');

    app.setAiProvider('claude');
    await app.submitAiPrompt('hello');
    expect(claudeStub.callStructured).toHaveBeenCalled();
    expect(geminiStub.callStructured).not.toHaveBeenCalled();
    expect(app.aiResponse).toBe('claude says hi');

    app.setAiProvider('gemini');
    await app.submitAiPrompt('hello again');
    expect(geminiStub.callStructured).toHaveBeenCalled();
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

describe('QuireApp AI campaign-context (M3b followup)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes the user prompt unchanged when no campaign is loaded', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    let receivedPrompt = '';
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockImplementation((req: { prompt: string }) => {
          receivedPrompt = req.prompt;
          return Promise.resolve(structuredOk('ok', { responseId: 'r' }));
        })
      }
    };
    await app.submitAiPrompt('hello, no context');
    expect(receivedPrompt).toBe('hello, no context');
  });

  it('prepends wrapped campaign content when an episode is loaded (public scope)', async () => {
    // Stub fetch so any campaign fetch returns a marker; the
    // tested behavior is that the marker text appears in the
    // prompt passed to the provider, wrapped in untrusted_content.
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('campaign.json')) {
          return new Response('{"name":"X"}', { status: 200 });
        }
        if (url.endsWith('world/overview.md')) {
          return new Response('WORLD_OVERVIEW_MARKER', { status: 200 });
        }
        if (url.endsWith('episodes/E1/episode.json')) {
          return new Response('{"name":"Ep"}', { status: 200 });
        }
        if (url.endsWith('episodes/E1/scenes/01.md')) {
          return new Response('SCENE_ONE_MARKER', { status: 200 });
        }
        // dm/* should NOT be fetched at scope=public.
        return new Response('', { status: 404 });
      }
    );
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    // Inject episode state — bypasses real campaign loader.
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'episode',
      campaign: {
        base: {
          source: { owner: 'g', repo: 'u', ref: 'main' },
          manifest: {
            name: 'X',
            $schemaVersion: '0.1.0',
            episodes: ['E1']
          }
        }
      },
      episode: {
        slug: 'E1',
        manifest: { name: 'Ep', scenes: ['scenes/01.md'] }
      }
    };
    let receivedPrompt = '';
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockImplementation((req: { prompt: string }) => {
          receivedPrompt = req.prompt;
          return Promise.resolve(structuredOk('ok', { responseId: 'r' }));
        })
      }
    };
    await app.submitAiPrompt('what happens in scene 1?');
    expect(receivedPrompt).toContain('WORLD_OVERVIEW_MARKER');
    expect(receivedPrompt).toContain('SCENE_ONE_MARKER');
    expect(receivedPrompt).toContain('<untrusted_content');
    expect(receivedPrompt).toContain('what happens in scene 1?');
    // The user prompt sits AFTER the context block.
    const ctxEnd = receivedPrompt.indexOf('</untrusted_content>');
    const userIdx = receivedPrompt.indexOf('what happens in scene 1?');
    expect(userIdx).toBeGreaterThan(ctxEnd);
  });

  it('includes dm/* content when scope=dm (DM-only material reaches the model)', async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('campaign.json'))
          return new Response('{}', { status: 200 });
        if (url.endsWith('world/overview.md'))
          return new Response('', { status: 200 });
        if (url.endsWith('episodes/E1/episode.json'))
          return new Response('{}', { status: 200 });
        if (url.endsWith('episodes/E1/dm/the-cable.md')) {
          return new Response('CABLE_IS_BEHIND_PANEL', { status: 200 });
        }
        return new Response('', { status: 404 });
      }
    );
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'episode',
      campaign: {
        base: {
          source: { owner: 'g', repo: 'u', ref: 'main' },
          manifest: {
            name: 'X',
            $schemaVersion: '0.1.0',
            episodes: ['E1']
          }
        }
      },
      episode: {
        slug: 'E1',
        manifest: { name: 'Ep', scenes: [] }
      }
    };
    app.aiScope = 'dm';
    let receivedPrompt = '';
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        callStructured: vi.fn().mockImplementation((req: { prompt: string }) => {
          receivedPrompt = req.prompt;
          // dm-scope test wants `dmOnly` populated and `safe` empty.
          return Promise.resolve({
            ok: true,
            value: { safe: '', dmOnly: 'ok', sources: [] },
            raw: JSON.stringify({ safe: '', dmOnly: 'ok', sources: [] }),
            tokensIn: 0,
            tokensOut: 0,
            responseId: 'r'
          } satisfies AiProviderStructuredResult<unknown>);
        })
      }
    };
    await app.submitAiPrompt('where is the cable?');
    expect(receivedPrompt).toContain('CABLE_IS_BEHIND_PANEL');
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
        callStructured: vi
          .fn()
          .mockResolvedValue(
            structuredOk('the cabin smells like sleep.', { responseId: 'r' })
          )
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
