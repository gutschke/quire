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

/**
 * Debounce window for storage writes triggered by per-keystroke
 * input handlers (setApiKey + setSystemPrompt).  In-memory state
 * updates synchronously (preserves input responsiveness); the
 * localStorage write coalesces to one flush ~300 ms after the
 * user stops typing.  Trade-off: a tab killed mid-typing loses up
 * to 300 ms of unsaved characters, which is acceptable for a
 * configuration field but unsafe for, say, session events
 * (those route through the synchronous session-controller path).
 */
const STORAGE_FLUSH_DEBOUNCE_MS = 300;

export class AiKeyStore implements ReactiveController {
  provider: AiProvider = 'claude';
  apiKeys: Record<AiProvider, string> = { claude: '', gemini: '' };
  models: Record<AiProvider, string> = {
    claude: AI_DEFAULTS.claude.model,
    gemini: AI_DEFAULTS.gemini.model
  };
  systemPrompt: string = AI_DEFAULT_SYSTEM;

  // Per-key debounce timers for storage flushes; see flushPending().
  private pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.loadFromStorage();
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    // Flush any pending storage writes synchronously on unmount so a
    // user typing then closing the tab doesn't lose their key.
    this.flushPending();
  }

  /**
   * Force any debounced storage writes to commit immediately.
   * Public so callers can ensure persistence at known checkpoints
   * (e.g. before initiating an AI prompt that depends on the key)
   * and so tests can assert post-write state without sleeping.
   */
  flushPending(): void {
    for (const [, timer] of this.pendingFlushes) clearTimeout(timer);
    for (const [key, value] of this.pendingValues) {
      if (value === null) safeRemove(key);
      else safeSet(key, value);
    }
    this.pendingFlushes.clear();
    this.pendingValues.clear();
  }

  /**
   * Per-key map of the most recent pending value to flush.  Kept
   * separately from pendingFlushes (timers) so a Map.set on the
   * value side is cheap.
   */
  private pendingValues = new Map<string, string | null>();

  /**
   * Schedule a debounced localStorage write for the given key.
   * If a flush is already pending for this key, reset the timer
   * and replace the pending value.
   */
  private scheduleFlush(key: string, value: string | null): void {
    this.pendingValues.set(key, value);
    const existing = this.pendingFlushes.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingFlushes.delete(key);
      const pending = this.pendingValues.get(key);
      this.pendingValues.delete(key);
      if (pending === undefined) return;
      if (pending === null) safeRemove(key);
      else safeSet(key, pending);
    }, STORAGE_FLUSH_DEBOUNCE_MS);
    this.pendingFlushes.set(key, timer);
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
    // Debounce the localStorage write — per-keystroke flushing
    // serialized fine but the surrounding Lit re-render cost adds
    // up.  In-memory state is already updated above, so the input
    // binding stays responsive.
    this.scheduleFlush(STORAGE_API_KEY(provider), key || null);
    // Legacy-key removal is one-shot; do it immediately rather
    // than scheduling.  (Calling safeRemove on an already-absent
    // key is free.)
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
    // Debounced storage write — see setApiKey.  Textarea is the
    // worst case (multi-line typing produces many keystrokes).
    const persistValue =
      text && text !== AI_DEFAULT_SYSTEM ? text : null;
    this.scheduleFlush(STORAGE_SYSTEM, persistValue);
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
