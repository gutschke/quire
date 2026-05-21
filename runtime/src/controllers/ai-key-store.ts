/**
 * AiKeyStore — Lit ReactiveController encapsulating AI provider
 * selection, per-provider API keys, model choices, system prompt, and
 * the legacy-key migration.
 *
 * Extracted from `src/quire-app.ts` during M1 (P0-10).  Replaces a
 * stack of @state fields + setter methods + a load block in
 * connectedCallback.  Host (QuireApp) keeps a thin getter API so
 * existing render code (`this.aiProvider`, `this.aiApiKeys[...]`,
 * etc.) continues to work unchanged.
 *
 * Storage layout in localStorage:
 *   quire.ai.apiKey            (legacy, pre-provider-split; migrated away)
 *   quire.ai.provider          ('claude' | 'gemini')
 *   quire.ai.<provider>.apiKey
 *   quire.ai.<provider>.model
 *   quire.ai.systemPrompt
 *
 * The store is constructed in connectedCallback via the host's
 * `addController()` call (which fires `hostConnected()`), where the
 * initial localStorage load happens.  Subsequent mutations write
 * back synchronously and call `host.requestUpdate()` to drive
 * re-render.
 *
 * Note: this controller does not call the AI provider.  Network
 * traffic lives in src/ai/anthropic.ts and src/ai/gemini.ts and is
 * exercised by QuireApp.submitAiPrompt().  The structured-tool
 * AiBroker (M3b) will live in src/ai/broker.ts and consume this
 * store for keys/model/system.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';

export type AiProvider = 'claude' | 'gemini';

export type AiClient = (req: {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  signal?: AbortSignal;
}) => Promise<string>;

interface AiProviderDefaults {
  model: string;
  label: string;
  models: string[];
}

export const AI_DEFAULTS: Record<AiProvider, AiProviderDefaults> = {
  claude: {
    label: 'Anthropic (Claude)',
    model: 'claude-haiku-4-5-20251001',
    models: [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-opus-4-7'
    ]
  },
  gemini: {
    label: 'Google (Gemini)',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro']
  }
};

export const AI_DEFAULT_SYSTEM = `You are a quiet TTRPG-aide voice for a DM running a session of Quire.
Respond in 1–3 short paragraphs, in-fiction when describing scenes or NPC
beats. Avoid meta-commentary, headers, lists, and "as the DM" framing.
The DM will paraphrase your text in their own voice; keep it tight,
sensory, and easy to read aloud.`;

const STORAGE_LEGACY_KEY = 'quire.ai.apiKey';
const STORAGE_PROVIDER = 'quire.ai.provider';
const STORAGE_API_KEY = (p: AiProvider): string => `quire.ai.${p}.apiKey`;
const STORAGE_MODEL = (p: AiProvider): string => `quire.ai.${p}.model`;
const STORAGE_SYSTEM = 'quire.ai.systemPrompt';

function safeGet(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    /* quota exceeded, private mode, etc. — non-fatal */
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === 'claude' || value === 'gemini';
}

export class AiKeyStore implements ReactiveController {
  provider: AiProvider = 'claude';
  apiKeys: Record<AiProvider, string> = { claude: '', gemini: '' };
  models: Record<AiProvider, string> = {
    claude: AI_DEFAULTS.claude.model,
    gemini: AI_DEFAULTS.gemini.model
  };
  systemPrompt: string = AI_DEFAULT_SYSTEM;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.loadFromStorage();
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    /* nothing to clean up; storage is persistent */
  }

  /**
   * Load all persisted values from localStorage.  Migrates the
   * pre-provider-split legacy key (`quire.ai.apiKey`) into the
   * current provider's slot, preserving DMs' existing keys across
   * the upgrade.
   */
  private loadFromStorage(): void {
    const provider = safeGet(STORAGE_PROVIDER);
    if (isAiProvider(provider)) {
      this.provider = provider;
    }
    const claudeKey = safeGet(STORAGE_API_KEY('claude'));
    const legacyKey = safeGet(STORAGE_LEGACY_KEY);
    const geminiKey = safeGet(STORAGE_API_KEY('gemini'));
    this.apiKeys = {
      // Legacy key migrates into the claude slot only when there's no
      // provider-scoped claude key already; protects DMs who upgraded,
      // chose gemini, and would otherwise see legacy migrate to claude
      // and silently leak.
      claude: claudeKey ?? legacyKey ?? '',
      gemini: geminiKey ?? ''
    };
    const claudeModel = safeGet(STORAGE_MODEL('claude'));
    const geminiModel = safeGet(STORAGE_MODEL('gemini'));
    this.models = {
      claude: claudeModel ?? AI_DEFAULTS.claude.model,
      gemini: geminiModel ?? AI_DEFAULTS.gemini.model
    };
    const sys = safeGet(STORAGE_SYSTEM);
    if (sys) this.systemPrompt = sys;
  }

  setProvider(provider: AiProvider): void {
    this.provider = provider;
    safeSet(STORAGE_PROVIDER, provider);
    this.host.requestUpdate();
  }

  setApiKey(key: string, provider: AiProvider = this.provider): void {
    this.apiKeys = { ...this.apiKeys, [provider]: key };
    if (key) {
      safeSet(STORAGE_API_KEY(provider), key);
    } else {
      safeRemove(STORAGE_API_KEY(provider));
    }
    // Clear the pre-split legacy key once a new provider-scoped key exists.
    safeRemove(STORAGE_LEGACY_KEY);
    this.host.requestUpdate();
  }

  setModel(model: string, provider: AiProvider = this.provider): void {
    this.models = { ...this.models, [provider]: model };
    safeSet(STORAGE_MODEL(provider), model);
    this.host.requestUpdate();
  }

  setSystemPrompt(text: string): void {
    this.systemPrompt = text;
    if (text && text !== AI_DEFAULT_SYSTEM) {
      safeSet(STORAGE_SYSTEM, text);
    } else {
      safeRemove(STORAGE_SYSTEM);
    }
    this.host.requestUpdate();
  }

  /**
   * Apply the campaign manifest's `defaultAiProvider` hint only if
   * the user has NOT explicitly chosen a provider in localStorage.
   * The manifest default is a "first-run suggestion," not a hard
   * override — once the user has picked a provider (either by
   * touching the radio or by having a prior provider stored), we
   * respect their choice.
   */
  applyCampaignDefault(
    manifestProvider: 'claude' | 'gemini' | 'none' | undefined
  ): void {
    if (!manifestProvider || manifestProvider === 'none') return;
    const explicit = safeGet(STORAGE_PROVIDER);
    if (isAiProvider(explicit)) return; // user has a stored choice
    if (this.provider !== manifestProvider) {
      this.provider = manifestProvider;
      this.host.requestUpdate();
    }
  }

  get apiKey(): string {
    return this.apiKeys[this.provider];
  }

  get model(): string {
    return this.models[this.provider];
  }
}
