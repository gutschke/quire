import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AiKeyStore,
  AI_DEFAULTS,
  AI_DEFAULT_SYSTEM
} from './ai-key-store';

/**
 * Minimal ReactiveControllerHost stub.  Tracks requestUpdate calls
 * so tests can assert the controller properly notifies the host on
 * every mutation.
 */
function makeHost() {
  const calls: number[] = [];
  return {
    requestUpdate: vi.fn(() => calls.push(Date.now())),
    addController: vi.fn(),
    removeController: vi.fn(),
    updateComplete: Promise.resolve(true),
    calls
  };
}

function clearStorage() {
  try { window.localStorage?.clear(); } catch {}
}

describe('AiKeyStore — initial state', () => {
  beforeEach(clearStorage);

  it('defaults to claude provider and AI_DEFAULTS model values', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    expect(s.provider).toBe('claude');
    expect(s.apiKeys).toEqual({ claude: '', gemini: '' });
    expect(s.models.claude).toBe(AI_DEFAULTS.claude.model);
    expect(s.models.gemini).toBe(AI_DEFAULTS.gemini.model);
    expect(s.systemPrompt).toBe(AI_DEFAULT_SYSTEM);
  });

  it('registers itself with the host on construction', () => {
    const host = makeHost();
    new AiKeyStore(host);
    expect(host.addController).toHaveBeenCalledTimes(1);
  });

  it('triggers a requestUpdate on hostConnected (initial load)', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    expect(host.requestUpdate).toHaveBeenCalledTimes(0);
    s.hostConnected();
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('AiKeyStore — localStorage load', () => {
  beforeEach(clearStorage);

  it('reads stored provider', () => {
    window.localStorage.setItem('quire.ai.provider', 'gemini');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.provider).toBe('gemini');
  });

  it('reads per-provider keys', () => {
    window.localStorage.setItem('quire.ai.claude.apiKey', 'sk-ant-XXX');
    window.localStorage.setItem('quire.ai.gemini.apiKey', 'aiza-YYY');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.apiKeys.claude).toBe('sk-ant-XXX');
    expect(s.apiKeys.gemini).toBe('aiza-YYY');
  });

  it('migrates the legacy key into the claude slot when no claude key exists', () => {
    window.localStorage.setItem('quire.ai.apiKey', 'sk-legacy');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.apiKeys.claude).toBe('sk-legacy');
  });

  it('does NOT overwrite an existing claude key with the legacy key', () => {
    window.localStorage.setItem('quire.ai.claude.apiKey', 'sk-current');
    window.localStorage.setItem('quire.ai.apiKey', 'sk-legacy');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.apiKeys.claude).toBe('sk-current');
  });

  it('does NOT migrate legacy into the gemini slot', () => {
    window.localStorage.setItem('quire.ai.apiKey', 'sk-legacy');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.apiKeys.gemini).toBe('');
  });

  it('reads per-provider models', () => {
    window.localStorage.setItem('quire.ai.claude.model', 'claude-sonnet-4-6');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.models.claude).toBe('claude-sonnet-4-6');
  });

  it('reads stored system prompt', () => {
    window.localStorage.setItem('quire.ai.systemPrompt', 'custom prompt');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.systemPrompt).toBe('custom prompt');
  });

  it('falls back to default system prompt when nothing stored', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.systemPrompt).toBe(AI_DEFAULT_SYSTEM);
  });

  it('ignores invalid provider strings in storage', () => {
    window.localStorage.setItem('quire.ai.provider', 'gpt');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    expect(s.provider).toBe('claude'); // falls back to default
  });
});

describe('AiKeyStore — setters', () => {
  beforeEach(clearStorage);

  it('setProvider persists and notifies', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    host.requestUpdate.mockClear();
    s.setProvider('gemini');
    expect(s.provider).toBe('gemini');
    expect(window.localStorage.getItem('quire.ai.provider')).toBe('gemini');
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it('setApiKey persists for the current provider and clears the legacy key', () => {
    window.localStorage.setItem('quire.ai.apiKey', 'sk-legacy');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setApiKey('sk-new');
    expect(s.apiKeys.claude).toBe('sk-new');
    expect(window.localStorage.getItem('quire.ai.claude.apiKey')).toBe('sk-new');
    expect(window.localStorage.getItem('quire.ai.apiKey')).toBeNull();
  });

  it('setApiKey accepts an explicit provider', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setApiKey('aiza-X', 'gemini');
    expect(s.apiKeys.gemini).toBe('aiza-X');
    expect(s.apiKeys.claude).toBe('');
  });

  it('setApiKey("") removes the storage entry', () => {
    window.localStorage.setItem('quire.ai.claude.apiKey', 'sk-old');
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setApiKey('');
    expect(window.localStorage.getItem('quire.ai.claude.apiKey')).toBeNull();
  });

  it('setModel persists for the current provider', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setModel('claude-opus-4-7');
    expect(s.models.claude).toBe('claude-opus-4-7');
    expect(window.localStorage.getItem('quire.ai.claude.model')).toBe('claude-opus-4-7');
  });

  it('setSystemPrompt persists non-default; removes storage when set to default', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setSystemPrompt('custom');
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBe('custom');
    s.setSystemPrompt(AI_DEFAULT_SYSTEM);
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBeNull();
    s.setSystemPrompt('again');
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBe('again');
    s.setSystemPrompt('');
    expect(window.localStorage.getItem('quire.ai.systemPrompt')).toBeNull();
  });
});

describe('AiKeyStore — applyCampaignDefault', () => {
  beforeEach(clearStorage);

  it('applies the manifest provider when the user has no stored choice', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    host.requestUpdate.mockClear();
    s.applyCampaignDefault('gemini');
    expect(s.provider).toBe('gemini');
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it('respects an explicit stored user choice over the manifest hint', () => {
    window.localStorage.setItem('quire.ai.provider', 'claude');
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    host.requestUpdate.mockClear();
    s.applyCampaignDefault('gemini');
    expect(s.provider).toBe('claude');
    expect(host.requestUpdate).toHaveBeenCalledTimes(0);
  });

  it('no-ops on manifest === "none" or undefined', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    host.requestUpdate.mockClear();
    s.applyCampaignDefault('none');
    s.applyCampaignDefault(undefined);
    expect(s.provider).toBe('claude');
    expect(host.requestUpdate).toHaveBeenCalledTimes(0);
  });

  it('does not redundantly request update when manifest matches current provider', () => {
    const host = makeHost();
    const s = new AiKeyStore(host);
    s.hostConnected();
    host.requestUpdate.mockClear();
    s.applyCampaignDefault('claude'); // already claude
    expect(host.requestUpdate).toHaveBeenCalledTimes(0);
  });
});

describe('AiKeyStore — derived getters', () => {
  beforeEach(clearStorage);

  it('apiKey returns the current provider’s key', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setApiKey('sk-c', 'claude');
    s.setApiKey('aiza-g', 'gemini');
    expect(s.apiKey).toBe('sk-c');
    s.setProvider('gemini');
    expect(s.apiKey).toBe('aiza-g');
  });

  it('model returns the current provider’s model', () => {
    const s = new AiKeyStore(makeHost());
    s.hostConnected();
    s.setProvider('gemini');
    expect(s.model).toBe(AI_DEFAULTS.gemini.model);
  });
});
