/**
 * Run #19 (2026-05-30) — UX-MH-3 backstory-refresher.
 *
 * Surgical AI-driven adjustment to a PC's existing backstory after
 * a player- or DM-triggered field change (name, pronouns, tag
 * add/remove/rename).  NOT a full regenerate — the AI thread the
 * delta through the existing prose while preserving voice / rhythm
 * / idiosyncratic phrasing the player chose.
 *
 * Locked invariants (per R-F + R-G + ai-player-facing-scope):
 *
 *  - ALWAYS calls `buildPlayerFacingContext` (NEVER
 *    `buildCampaignContext` with scope:'dm').  Backstory is always
 *    player-visible regardless of who triggered the refresh.  The
 *    module has no `scope` parameter on its public API.
 *
 *  - `includeDmNotes: false` is implicit — `buildPlayerFacingContext`
 *    excludes `dm/*.md` files at the file-loader level (CC-18, see
 *    `campaign-context.ts:262`).  This is the FIRST line of defense.
 *
 *  - Forbidden-token post-check runs BEFORE the caller emits the
 *    `backstory-refresh-proposal` event.  If a leak persists after
 *    one auto-retry, the proposal is REFUSED — never reaches the
 *    player.  This is the SECOND line of defense.  Per
 *    silent-player-firewall + Adversarial P1 #2: the DM sees a soft
 *    warning ("AI named hidden lore; try again"), the player sees
 *    nothing.
 *
 *  - DM-initiated prompts MUST NOT include DM's reason / dmNotes /
 *    why-this-tag-changed narrative.  The structured `fieldDelta`
 *    arg is the ONLY DM-side input that lands in the prompt; it is
 *    a delta over PLAYER-VISIBLE fields (old → new).  Per
 *    Adversarial P1 #4 — defense in depth alongside the post-check.
 *
 *  - Returns the proposal payload READY to materialize.  The caller
 *    is responsible for emitting the `backstory-refresh-proposal`
 *    event (DM-initiated) OR a direct `pc-edit field:backstory`
 *    (player-initiated, per R-F's "no proposal event needed on the
 *    player's own path" decision).
 *
 *  - The `baselineHash` field on a returned proposal is the SHA-256
 *    hex of the baseline backstory the AI ran against.  The player
 *    UI compares this against the PC's current backstory before
 *    accepting; a mismatch surfaces the staleness warning.  See
 *    `R-F` baseline-hash staleness guard.
 *
 * Engine vs campaign positioning: the refresher mechanism is
 * ENGINE.  Spoiler tokens + the prompt-builder are CAMPAIGN POLICY
 * supplied via `req`.
 */

import type { AiProvider } from './broker';
import type { ContextFile } from './campaign-context';
import {
  aiSemanticSpoilerCheck,
  containsSpoilerTokens,
  DEFAULT_SPOILER_TOKENS
} from './spoiler-check';

/**
 * Structured representation of WHAT changed on the PC.  Only fields
 * the player is allowed to see end up in the prompt; the DM's
 * authorial reason for the change does NOT.  Per Adversarial P1 #4.
 *
 * The fields are deliberately a small allowlist mirrored from the
 * R-D allowed-fields decision (name / pronouns / tags / backstory).
 * Backstory itself is the OUTPUT field — never input to the delta.
 *
 * Example: DM removes the `outsider` tag → fieldDelta carries
 * `{ tagsRemoved: ['outsider'] }` and nothing else.  The DM's
 * reasoning ("Quiet rejected Sora") never reaches the AI.
 */
export interface BackstoryFieldDelta {
  /** Old name → new name (omit field when unchanged). */
  nameChanged?: { from: string; to: string };
  /** Old pronouns → new pronouns. */
  pronounsChanged?: { from: string; to: string };
  /** Tags added since the baseline backstory was written. */
  tagsAdded?: readonly string[];
  /** Tags removed since the baseline backstory was written. */
  tagsRemoved?: readonly string[];
  /**
   * Tags whose text changed (atomic pc-tag-rename events).  Each
   * entry is `{ from, to }` so the AI knows what to renaming the
   * mention to.
   */
  tagsRenamed?: ReadonlyArray<{ from: string; to: string }>;
  /**
   * Optional player-supplied hint ("keep the bookstore reference").
   * Surfaced verbatim when the player clicked "Try again with…".
   * NEVER carries DM-side reasoning even on DM-initiated refreshes.
   */
  playerHint?: string;
}

export interface RefreshBackstoryRequest {
  /** AI provider. */
  provider: AiProvider;
  /** Provider API key (host-supplied; never persisted with the save). */
  apiKey: string;
  /** Provider model id (e.g. 'claude-sonnet-4-6'). */
  model: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;

  /**
   * Player-facing campaign context (CC-18 output of
   * `buildPlayerFacingContext`).  The CALLER is responsible for
   * computing this with `buildPlayerFacingContext` (NOT
   * `buildCampaignContext` with `scope:'dm'`).  The refresher's
   * type signature does not accept arbitrary contexts — the
   * type-level discipline lives at the call site.
   *
   * Pass an empty array when no campaign context is needed (rare
   * for the refresher — the AI usually needs world setting).
   */
  campaignContext: ContextFile[];

  /** The PC's current name (post-edit). */
  pcName: string;
  /** The PC's current pronouns (post-edit). */
  pcPronouns: string;
  /** The PC's current tags (post-edit, deterministic order). */
  pcTags: readonly string[];
  /** The PC's CURRENT backstory text — the baseline to surgically edit. */
  baselineBackstory: string;
  /** Structured delta of WHAT changed (see BackstoryFieldDelta doc). */
  fieldDelta: BackstoryFieldDelta;
  /** Who initiated the refresh.  Player-visible (informational). */
  initiator: 'player' | 'dm';

  /**
   * Spoiler tokens to scan in the AI's output.  Defaults to
   * `DEFAULT_SPOILER_TOKENS` (Underleaf-tuned).  Caller passes a
   * campaign-declared list when V-6 hybrid lands.
   */
  spoilerTokens?: readonly string[];
}

/**
 * Discriminated-union result.  Same shape pattern as
 * `SynthesizeBackstoryResult` for consistency.
 */
export type RefreshBackstoryResult =
  | {
      ok: true;
      /** The proposed new backstory text. */
      proposedBackstory: string;
      /** SHA-256 hex of the baseline backstory the AI ran against. */
      baselineHash: string;
      /** True if the auto-retry path ran (diagnostic for DM logs). */
      retried: boolean;
    }
  | {
      ok: false;
      code:
        | 'parse-failed'
        | 'spoiler-leak-persistent'
        | 'provider-error'
        | 'aborted'
        | 'provider-refused';
      message: string;
      /** Present on spoiler-leak-persistent — which tokens kept hitting. */
      persistentTokens?: string[];
      /** Present on provider-refused — the refusal sub-kind. */
      refusalKind?: 'safety' | 'model-unsupported' | 'truncated';
    };

/**
 * Compute the SHA-256 hex of a string.  Used to fingerprint the
 * baseline backstory so the player UI can detect staleness on
 * accept.  Uses Web Crypto (available in the browser + Node 18+).
 */
export async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compose the system + user prompts for the surgical refresh.
 * Co-located here (rather than its own file) because the prompt is
 * <100 lines and we don't anticipate divergent caller shapes.
 *
 * Per R-G: NO DM-side reasoning enters the prompt.  Only the
 * player-visible delta + the baseline backstory + the campaign
 * context that came from buildPlayerFacingContext.
 */
function buildRefreshPrompt(req: RefreshBackstoryRequest): {
  system: string;
  user: string;
} {
  const system = [
    'You are helping a tabletop-RPG player keep their character backstory',
    'consistent after a small edit to the character sheet.',
    '',
    '## Goal',
    'Thread the listed changes through the existing prose with the lightest',
    'possible touch.  Preserve the player\'s voice, sentence rhythm, and any',
    'idiosyncratic phrasing they chose.  This is a SURGICAL edit, not a',
    'rewrite.',
    '',
    '## Rules',
    '- Do not invent new plot events, NPCs, locations, or motivations.',
    '- Do not regenerate from scratch — anchor on the baseline text.',
    '- Make ONLY the changes needed to honor the field delta.',
    '- If a change ripples (e.g. removed tag was central), keep the ripple',
    '  narrowly scoped to the affected paragraph(s); do not cascade.',
    '- Output ONLY the refreshed backstory text.  No preamble, no commentary,',
    '  no markdown headers or fences.  Just the prose.',
    '',
    '## Output format',
    'Plain prose, same approximate length as the baseline, same overall',
    'structure (paragraph breaks where the baseline had them).'
  ].join('\n');

  const deltaLines: string[] = [];
  if (req.fieldDelta.nameChanged) {
    deltaLines.push(
      `- Name: "${req.fieldDelta.nameChanged.from}" → "${req.fieldDelta.nameChanged.to}"`
    );
  }
  if (req.fieldDelta.pronounsChanged) {
    deltaLines.push(
      `- Pronouns: "${req.fieldDelta.pronounsChanged.from}" → "${req.fieldDelta.pronounsChanged.to}"`
    );
  }
  if (req.fieldDelta.tagsAdded && req.fieldDelta.tagsAdded.length > 0) {
    deltaLines.push(`- Tags added: ${req.fieldDelta.tagsAdded.join(', ')}`);
  }
  if (req.fieldDelta.tagsRemoved && req.fieldDelta.tagsRemoved.length > 0) {
    deltaLines.push(
      `- Tags removed: ${req.fieldDelta.tagsRemoved.join(', ')}`
    );
  }
  if (req.fieldDelta.tagsRenamed && req.fieldDelta.tagsRenamed.length > 0) {
    for (const r of req.fieldDelta.tagsRenamed) {
      deltaLines.push(`- Tag renamed: "${r.from}" → "${r.to}"`);
    }
  }
  if (deltaLines.length === 0) {
    deltaLines.push('- (no structured delta; surface a light touch-up)');
  }

  const userParts: string[] = [];
  // Campaign context (player-facing only — type-level enforced
  // upstream).  Empty array → empty string, prompt still well-formed.
  if (req.campaignContext.length > 0) {
    userParts.push('## Campaign context (player-visible)');
    for (const f of req.campaignContext) {
      userParts.push(`### ${f.path}`);
      userParts.push(f.content);
    }
    userParts.push('');
  }
  userParts.push('## Current character sheet (post-edit)');
  userParts.push(`Name: ${req.pcName}`);
  userParts.push(`Pronouns: ${req.pcPronouns}`);
  userParts.push(`Tags: ${req.pcTags.join(', ') || '(none)'}`);
  userParts.push('');
  userParts.push('## Field delta to thread through the backstory');
  userParts.push(...deltaLines);
  userParts.push('');
  userParts.push('## Baseline backstory (anchor on this — surgical edit only)');
  userParts.push(req.baselineBackstory);
  if (req.fieldDelta.playerHint) {
    userParts.push('');
    userParts.push('## Player hint');
    userParts.push(req.fieldDelta.playerHint);
  }

  return { system, user: userParts.join('\n') };
}

/** JSON Schema for the structured AI call. */
const REFRESH_BACKSTORY_SCHEMA = {
  type: 'object',
  properties: {
    backstory: { type: 'string' }
  },
  required: ['backstory'],
  additionalProperties: false
} as const;

const REFRESH_BACKSTORY_CALL_SCHEMA = {
  name: 'backstory_refresh',
  schema: REFRESH_BACKSTORY_SCHEMA as unknown as Record<string, unknown>
};

interface RefreshSchemaResponse {
  backstory: string;
}

function isRefreshSchemaResponse(x: unknown): x is RefreshSchemaResponse {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as { backstory?: unknown }).backstory === 'string' &&
    (x as { backstory: string }).backstory.length > 0
  );
}

/**
 * Run the surgical refresh end-to-end.  Deterministic given identical
 * provider responses; pure orchestration (no DOM, no Date.now).
 *
 * Sequence:
 *   1. Build prompts (player-visible delta only).
 *   2. Call provider via callStructured.
 *   3. Forbidden-token substring scan on the result.
 *   4. If hit, AI semantic check to narrow to genuine leaks.
 *   5. If genuine leaks → single auto-retry with do-not-use list.
 *   6. If retry still leaks → REFUSE.  Caller surfaces the
 *      `spoiler-leak-persistent` DM-only soft-warn.  Player sees
 *      nothing.  (R-G + Adversarial P1 #2.)
 *   7. Compute baseline hash + return proposal.
 *
 * The proposal does NOT carry the DM's reason — even when initiator
 * is 'dm', the player-facing copy comes from the UI layer (per the
 * 10 copy strings in TTRPG/UX memo §3).
 */
export async function refreshBackstory(
  req: RefreshBackstoryRequest
): Promise<RefreshBackstoryResult> {
  const { system, user } = buildRefreshPrompt(req);

  // ----- First attempt -----
  const first = await callAndParse(req, system, user);
  if (!first.ok) return first;

  const tokens = req.spoilerTokens ?? DEFAULT_SPOILER_TOKENS;
  let active = first.backstory;
  let retried = false;

  // ----- Spoiler check (substring → semantic) -----
  let firstHits = containsSpoilerTokens(active, tokens);
  if (firstHits.length > 0) {
    const semantic = await aiSemanticSpoilerCheck(req.provider, {
      apiKey: req.apiKey,
      model: req.model,
      backstory: active,
      candidateWords: firstHits,
      signal: req.signal
    });
    firstHits = semantic.leakingWords;
  }

  if (firstHits.length > 0) {
    // Single auto-retry with a do-not-use list.  The retry instruction
    // names ONLY genuine leaks, not false-positive ordinary-usage words.
    retried = true;
    const retryUser =
      user +
      '\n\n# Retry instruction\n' +
      `The previous attempt revealed campaign secrets via these words: ${firstHits.join(', ')}.  ` +
      'Re-write the backstory WITHOUT using any of those words in their ' +
      'spoiler-revealing sense.  Preserve voice and structure; surgical edit only.';
    const second = await callAndParse(req, system, retryUser);
    if (!second.ok) return second;
    active = second.backstory;
    let secondHits = containsSpoilerTokens(active, tokens);
    if (secondHits.length > 0) {
      const semantic2 = await aiSemanticSpoilerCheck(req.provider, {
        apiKey: req.apiKey,
        model: req.model,
        backstory: active,
        candidateWords: secondHits,
        signal: req.signal
      });
      secondHits = semantic2.leakingWords;
    }
    if (secondHits.length > 0) {
      // PERSISTENT LEAK: refuse.  Per silent-player-firewall the
      // caller surfaces a DM-only soft-warn; the player never sees
      // any indication a refresh was attempted.
      return {
        ok: false,
        code: 'spoiler-leak-persistent',
        message:
          'AI named campaign lore after one retry. Refreshed backstory is suppressed; try again or edit by hand.',
        persistentTokens: secondHits
      };
    }
  }

  const baselineHash = await sha256Hex(req.baselineBackstory);
  return {
    ok: true,
    proposedBackstory: active,
    baselineHash,
    retried
  };
}

type CallParseResult =
  | { ok: true; backstory: string }
  | {
      ok: false;
      code: 'parse-failed' | 'provider-error' | 'aborted' | 'provider-refused';
      message: string;
      refusalKind?: 'safety' | 'model-unsupported' | 'truncated';
    };

async function callAndParse(
  req: RefreshBackstoryRequest,
  system: string,
  user: string
): Promise<CallParseResult> {
  let result;
  try {
    result = await req.provider.callStructured<RefreshSchemaResponse>(
      {
        apiKey: req.apiKey,
        model: req.model,
        systemPrompt: system,
        prompt: user,
        signal: req.signal
      },
      REFRESH_BACKSTORY_CALL_SCHEMA
    );
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, code: 'aborted', message: 'Refresh was cancelled.' };
    }
    return {
      ok: false,
      code: 'provider-error',
      message: `Provider call failed: ${(e as Error).message}`
    };
  }
  if (!result.ok) {
    if (result.refusal.kind === 'provider-error') {
      return {
        ok: false,
        code: 'provider-error',
        message: result.refusal.message
      };
    }
    return {
      ok: false,
      code: 'provider-refused',
      message: result.refusal.message,
      refusalKind: result.refusal.kind
    };
  }
  if (!isRefreshSchemaResponse(result.value)) {
    return {
      ok: false,
      code: 'parse-failed',
      message:
        'Provider returned schema-valid JSON that fails the runtime type guard.'
    };
  }
  return { ok: true, backstory: result.value.backstory };
}

/**
 * Test-only export of the prompt builder so unit tests can introspect
 * the assembled prompt for absence of DM-side reasoning (Adversarial
 * P1 #4 — defense-in-depth assertion the prompt is clean).
 *
 * NOT for production callers — they should use `refreshBackstory`.
 */
export const _testHooks = {
  buildRefreshPrompt
};
