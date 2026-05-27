/**
 * E-LARGE-1 step 1 (2026-05-27): chat-spoiler-lint state cluster
 * extracted from QuireApp.  Pre-extraction this lived as:
 *
 *   - 1 `@state` field (`chatSpoilerLint`) — current modal state
 *   - 1 private field (`chatSpoilerLintAbort`) — AbortController
 *   - 5 methods (`submitChat` gate-fragment, `runChatSpoilerLintAi`,
 *     `confirmChatSpoilerLintSend`, `routeChatSpoilerLintToAi`,
 *     `dismissChatSpoilerLint`) — all DM-only confirmation flow
 *
 * The cluster is COORDINATOR-ONLY.  Per
 * [[feedback_silent_player_firewall]], players never see anything;
 * the modal stays exclusively on the DM's screen.  Substring +
 * AI semantic checks gate the broadcast so DM-private knowledge
 * doesn't accidentally leak to player chat.
 *
 * The class is a Lit `ReactiveController`: it calls
 * `host.requestUpdate()` after every state mutation so the modal
 * + chat input re-render.  The QuireApp facade re-exposes
 * `chatSpoilerLint` as a getter so existing tests can read the
 * state without knowing about the controller field.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  lintChatDraftSync,
  lintChatDraftAi,
  type ChatLintAiStatus
} from '../ai/chat-spoiler-lint';
import { aiSemanticSpoilerCheck } from '../ai/spoiler-check';
import type { AiProvider as AiProviderImpl } from '../ai/broker';

type AiProvider = 'claude' | 'gemini';

/**
 * Snapshot of the DM-only chat-spoiler-lint modal.  Null when no
 * pending lint; non-null while the DM is choosing send / route-
 * to-AI / cancel.  AI status starts at 'unchecked' (no key) or
 * 'checking' (kicked off background semantic pass); the modal
 * updates as the AI resolves.
 */
export interface ChatSpoilerLintUiState {
  readonly draft: string;
  readonly substringHits: readonly string[];
  readonly aiStatus: ChatLintAiStatus;
  readonly aiLeaks: readonly string[];
  readonly aiReason: string;
}

/**
 * Host-environment slice the controller needs.  Each capability is
 * a getter callback so the controller always observes the latest
 * value at decision time (avoids stale-snapshot bugs from
 * QuireApp's re-renders).  The two action methods (`sendChat`,
 * `submitAiPrompt`) own the side-effect boundary — the controller
 * never calls `session.append` directly.
 */
export interface ChatSpoilerLintEnv {
  isCoordinator(): boolean;
  hasActiveSession(): boolean;
  getAiApiKey(): string;
  getAiProvider(): AiProvider;
  getAiProviders(): Record<AiProvider, AiProviderImpl>;
  getAiModel(): string;
  /** Max chat-event text length; the controller refuses send above this. */
  chatMaxLength(): number;
  /** Append a `chat` event to the session log. */
  sendChat(text: string): void;
  /** Route the held draft to the AI prompt path (chat/AI confusion fix). */
  submitAiPrompt(text: string): void;
  /** Restore the draft into the chat input for editing. */
  setChatDraft(draft: string): void;
  /** Clear any previous chatError so a fresh attempt starts clean. */
  clearChatError(): void;
}

export class ChatSpoilerLintController implements ReactiveController {
  /** Current modal state; null when no pending lint. */
  state: ChatSpoilerLintUiState | null = null;
  private abort: AbortController | null = null;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: ChatSpoilerLintEnv
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — modal is opened lazily by gateDraft. */
  }

  hostDisconnected(): void {
    // Abort any in-flight AI check + drop modal state on HMR /
    // unmount so a wedged spinner doesn't survive across re-mounts.
    this.abort?.abort();
    this.abort = null;
    this.state = null;
  }

  /**
   * Gate a chat draft against the spoiler lint.  Returns true when
   * the draft can proceed to broadcast immediately (not coord, or
   * no substring hits).  Returns false when the lint fired + the
   * modal is now open — caller MUST hold the broadcast and wait
   * for the DM's verdict (confirmSend / routeToAi / dismiss).
   *
   * Kicks off the async AI semantic pass when an API key is
   * configured; the modal renders the synchronous-substring
   * verdict immediately, then upgrades when the AI resolves.
   */
  gateDraft(draft: string): boolean {
    if (!this.env.isCoordinator()) return true;
    const sync = lintChatDraftSync(draft);
    if (!sync.flagged) return true;
    const hasKey = this.env.getAiApiKey().length > 0;
    this.state = {
      draft,
      substringHits: sync.substringHits,
      aiStatus: hasKey ? 'checking' : 'unchecked',
      // Conservative default until the AI says otherwise: treat
      // all substring hits as candidate leaks.  When no AI key is
      // configured this stays — the DM still decides.
      aiLeaks: sync.substringHits,
      aiReason: ''
    };
    this.host.requestUpdate();
    if (hasKey) void this.runAi();
    return false;
  }

  /**
   * "Send to chat anyway" — broadcasts the held draft as-is (no
   * marker, no warning to players — silent firewall) and clears
   * modal state.  Returns false when no modal is open, when there
   * is no active session, or when the draft exceeds the chat-
   * length cap.
   */
  confirmSend(): boolean {
    const state = this.state;
    if (!state) return false;
    this.abort?.abort();
    this.state = null;
    if (!this.env.hasActiveSession()) {
      this.host.requestUpdate();
      return false;
    }
    if (state.draft.length > this.env.chatMaxLength()) {
      this.host.requestUpdate();
      return false;
    }
    this.env.sendChat(state.draft);
    this.env.setChatDraft('');
    this.env.clearChatError();
    this.host.requestUpdate();
    return true;
  }

  /**
   * "Route to AI instead" — the canonical fix for the chat/AI-
   * confusion threat.  Submits the held draft as an AI prompt +
   * clears the chat input.
   */
  routeToAi(): boolean {
    const state = this.state;
    if (!state) return false;
    this.abort?.abort();
    const draft = state.draft;
    this.state = null;
    this.env.setChatDraft('');
    this.env.clearChatError();
    this.env.submitAiPrompt(draft);
    this.host.requestUpdate();
    return true;
  }

  /**
   * "Edit draft" — close the modal + restore the draft to the
   * chat input so the DM can edit + re-send.  Cancels any
   * in-flight AI check.
   */
  dismiss(): void {
    this.abort?.abort();
    const draft = this.state?.draft;
    this.state = null;
    if (draft !== undefined) this.env.setChatDraft(draft);
    this.host.requestUpdate();
  }

  /**
   * Background AI semantic pass.  Aborts any prior in-flight call
   * so an over-eager DM hitting Send twice doesn't leave a zombie
   * promise; ignores the result when the DM has dismissed or
   * started a new draft.
   */
  private async runAi(): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const provider = this.env.getAiProviders()[this.env.getAiProvider()];
    const apiKey = this.env.getAiApiKey();
    const model = this.env.getAiModel();
    const result = await lintChatDraftAi({
      draft: state.draft,
      substringHits: [...state.substringHits],
      aiCheck: (candidates, text) =>
        aiSemanticSpoilerCheck(provider, {
          apiKey,
          model,
          backstory: text,
          candidateWords: candidates,
          signal: ac.signal
        })
    });
    if (ac.signal.aborted) return;
    // Confirm the state still matches the draft we evaluated; if
    // the DM dismissed and started a new draft, drop the stale
    // result.
    if (this.state?.draft !== state.draft) return;
    this.state = {
      ...this.state,
      aiStatus: result.status,
      aiLeaks: result.aiLeaks,
      aiReason: result.reason
    };
    this.host.requestUpdate();
  }
}
