/**
 * Chat-input spoiler lint — DM-only, never player-visible.
 *
 * Task #293 (2026-05-25).  Companion to the existing post-AI-output
 * spoiler firewall in `spoiler-check.ts` (which guards AI-authored
 * backstory prose from leaking campaign secrets to players).  This
 * helper guards the opposite direction: a DM about to broadcast a
 * chat message to all players, when their draft contains language
 * the players don't know yet.
 *
 * Threat model context (per [[project_quire_chat_ai_confusion_threat]]):
 * the play-time aside has two adjacent text inputs — Chat (broadcasts
 * to all players) and DM aide (private AI query).  A DM in actual
 * testing typed "can you create the pcs for me" intending it for the
 * AI but addressed Chat.  In that incident the question was harmless;
 * the next time it could be "what does the antagonist actually want?"
 * — a campaign spoiler the players would now see.
 *
 * Per [[feedback_silent_player_firewall]]: telling the player they
 * hit a spoiler IS itself a spoiler.  The lint is COORDINATOR-ONLY
 * and the warning surfaces only on the DM's screen, before the
 * broadcast.  Players never see anything, ever.  When the DM elects
 * to send a flagged message anyway (chosen as a false alarm), the
 * message broadcasts with no marker — the player's chat view is
 * indistinguishable from any other.
 *
 * Layered design — both layers reuse the proven chargen path:
 *   1. Substring scan (`containsSpoilerTokens`) — instant, no AI cost.
 *      Same default token list as chargen (Quiet, magic, fate, …).
 *   2. Optional AI semantic pass (`aiSemanticSpoilerCheck`) — same
 *      function the chargen post-synthesis check uses; given the
 *      substring candidates + the full draft, it filters false
 *      positives ("I chose this seat" — ordinary; "the chosen one"
 *      — leak).  When no AI key is configured, the substring hits
 *      are returned as-is (conservative — over-warn rather than
 *      under-warn; the DM has the final call).
 *
 * The caller (quire-app.submitChat) opens a confirmation modal on
 * substring hit and lets the AI pass enrich the modal copy when it
 * resolves.  The lint helper itself is pure data-in / data-out so
 * tests inject a mock `aiCheck` and the chargen + chat paths can
 * share the same AI prompt without coupling either to the other.
 */

import {
  containsSpoilerTokens,
  type AiSpoilerCheckResult
} from './spoiler-check';

export type ChatLintAiStatus =
  | 'unchecked' // no AI check requested (no key configured)
  | 'checking' // AI call in flight
  | 'clean' // AI says ordinary English (modal can auto-dismiss)
  | 'leak' // AI confirms one or more genuine leaks
  | 'failed'; // AI errored — fall back to substring hits as genuine

/**
 * Synchronous first-pass result from `lintChatDraftSync`.  The
 * caller (quire-app) holds this in @state, opens the modal, and
 * optionally enriches it with the AI semantic pass via
 * `lintChatDraftAi` running in the background.
 */
export interface ChatLintSyncResult {
  /** The full draft text the DM was about to broadcast. */
  draft: string;
  /** Substring scanner hits, deduped + lowercased. */
  substringHits: string[];
  /** True when the substring scan caught at least one token. */
  flagged: boolean;
}

/**
 * Synchronous substring-only pre-check.  Returns immediately so the
 * caller can open the warning modal without latency — the AI pass
 * is layered on top via `lintChatDraftAi` once the modal is up.
 *
 * When `flagged === false` the caller broadcasts the chat as normal.
 */
export function lintChatDraftSync(
  draft: string,
  spoilerTokens?: readonly string[]
): ChatLintSyncResult {
  const hits = containsSpoilerTokens(draft, spoilerTokens);
  return {
    draft,
    substringHits: hits,
    flagged: hits.length > 0
  };
}

/**
 * AI semantic check input — caller supplies the substring hits +
 * the draft + an AI-check thunk.  The thunk wraps
 * `aiSemanticSpoilerCheck` (or, in tests, a stub) so this helper
 * stays free of broker / provider dependencies.
 */
export interface ChatLintAiInput {
  /** The draft text (passed verbatim to the AI). */
  draft: string;
  /** Substring hits from `lintChatDraftSync`. */
  substringHits: string[];
  /**
   * Caller-supplied semantic-check.  Receives the candidates +
   * draft; returns the proven-leak subset.  Wrap
   * `aiSemanticSpoilerCheck(provider, {...})` here.
   */
  aiCheck: (
    candidates: string[],
    draft: string
  ) => Promise<AiSpoilerCheckResult>;
}

export interface ChatLintAiResult {
  status: ChatLintAiStatus;
  /** Subset of `substringHits` the AI confirmed as genuine leaks. */
  aiLeaks: string[];
  /** One-sentence reason from the AI (or the failure message). */
  reason: string;
}

/**
 * Async AI semantic pass.  Call AFTER `lintChatDraftSync` returns
 * `flagged: true`, with the same draft + hits.  Maps the
 * `AiSpoilerCheckResult` shape to the chat-lint vocabulary:
 *
 *   ok=true (no leaks)         → status='clean', aiLeaks=[]
 *   ok=false + checkFailed     → status='failed', aiLeaks=<hits>
 *   ok=false + !checkFailed    → status='leak',   aiLeaks=<subset>
 *
 * The 'failed' status surfaces to the modal so the DM knows the AI
 * pass was inconclusive and the substring hits stand (conservative).
 */
export async function lintChatDraftAi(
  input: ChatLintAiInput
): Promise<ChatLintAiResult> {
  if (input.substringHits.length === 0) {
    return {
      status: 'clean',
      aiLeaks: [],
      reason: 'No flagged words.'
    };
  }
  const result = await input.aiCheck(input.substringHits, input.draft);
  if (result.checkFailed) {
    return {
      status: 'failed',
      aiLeaks: result.leakingWords,
      reason: result.reason
    };
  }
  if (result.ok) {
    return {
      status: 'clean',
      aiLeaks: [],
      reason: result.reason
    };
  }
  return {
    status: 'leak',
    aiLeaks: result.leakingWords,
    reason: result.reason
  };
}
