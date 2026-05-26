/**
 * #254 (2026-05-26): AI complementarity hints for the DM
 * quick-generate workflow.  When the DM is about to quick-gen a
 * fresh PC, this helper asks the AI "given the existing roster,
 * what archetype / hook would round out the table?" and returns
 * 2-3 short one-line concepts the DM can click to pre-fill the
 * quick-gen hook field.
 *
 * Pure data layer.  No DOM, no controller state — caller manages
 * loading + result state.  Same `callStructured` pattern as
 * `aiSemanticSpoilerCheck` so the AI broker handles
 * provider-specific JSON-mode quirks centrally.
 *
 * Threat model: the suggestions are DM-facing (used to seed
 * quick-gen).  They don't reach players directly, but the AI is
 * consulted with the existing roster — if the AI surfaces a hook
 * that mentions hidden lore, the DM is the one reading it.  The
 * system prompt explicitly tells the AI to stay in PLAYER-FACING
 * tropes (no hidden-magic-system framing) so the suggestions are
 * safe for the DM to type into a player-visible PC.
 */

import type { AiProvider, AiStructuredCallSchema } from './broker';
import { wrapUntrusted } from './context';

const HINTS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          archetype: { type: 'string' },
          hook: { type: 'string' }
        },
        required: ['archetype', 'hook'],
        additionalProperties: false
      }
    }
  },
  required: ['suggestions'],
  additionalProperties: false
} as const;

const HINTS_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'complementarity_hints',
  schema: HINTS_SCHEMA as unknown as Record<string, unknown>
};

const HINTS_SYSTEM_PROMPT = `You are advising a tabletop RPG DM on how to round out the player roster for the next PC.  The DM will quick-generate a new PC by typing a NAME and a ONE-LINE CONCEPT (hook).  Your job: suggest 2-4 archetype + hook pairs that complement the existing PCs without duplicating them.

Rules:
- Look at the existing roster's stats, tags, skills, and roles.  Pick archetypes that FILL GAPS.  Example: roster is all high-INT thinkers → suggest a high-STR or high-DEX physical archetype.
- Hooks must be ONE LINE (max ~80 chars).  Conversational present-tense, like "ex-paramedic from Chicago looking for her sister."
- Hooks should be PLAYER-FACING — no hidden-magic, prophecy, chosen-one, or "secretly" framing.  The DM may type these directly into a player-visible quick-gen, so anything that mentions hidden lore is a spoiler vector.  Stick to mundane Earth-2026 hooks.
- Variety: don't make every suggestion the same archetype.  Cover 2-3 different stat profiles + 2-3 different motivations (revenge, love, debt, ideology, survival, etc.).
- Avoid copying existing PCs' tags or names verbatim.

Reply with the suggestions array.  Each entry has an archetype (1-3 words, e.g. "ex-paramedic" or "rebel cell veteran") and a hook (one-line concept).`;

/**
 * Minimal roster summary the helper passes to the AI.  The host
 * builds this from the currently-bound PCs.  Stats are summarized
 * as a single dominant axis ("STR-led", "INT-led", "balanced") to
 * keep the prompt compact and prevent the AI from gaming individual
 * numbers.
 */
export interface RosterSnapshot {
  pcs: Array<{
    name: string;
    archetype: string; // 1-3 word summary, e.g. "junior engineer"
    dominantStat: string; // e.g. "INT", "DEX", or "balanced"
    tags: string[]; // up to 5 distinguishing tags
  }>;
}

export interface ComplementaritySuggestion {
  archetype: string;
  hook: string;
}

export interface ComplementarityHintsInput {
  apiKey: string;
  model: string;
  roster: RosterSnapshot;
  /**
   * Optional DM-side guidance.  Free-form, e.g. "make sure one is
   * combat-leaning" or "the table needs comic relief."
   */
  dmGuidance?: string;
  signal?: AbortSignal;
}

export interface ComplementarityHintsResult {
  /** True when at least one suggestion came back. */
  ok: boolean;
  suggestions: ComplementaritySuggestion[];
  /** Populated on failure (provider error, refusal, empty list). */
  reason?: string;
}

/**
 * Ask the AI to suggest complementary PC archetypes + hooks for
 * the quick-gen flow.  Returns at most 4 entries; the caller's UI
 * decides how many to render.
 *
 * Defensive: when the AI returns oversized strings (rare), the
 * helper truncates to the reasonable ceiling (~80 chars for hook,
 * ~30 for archetype) before handing back to the UI.
 */
export async function requestComplementarityHints(
  provider: AiProvider,
  input: ComplementarityHintsInput
): Promise<ComplementarityHintsResult> {
  const userPrompt = buildUserPrompt(input.roster, input.dmGuidance);
  let result;
  try {
    result = await provider.callStructured<{
      suggestions: ComplementaritySuggestion[];
    }>(
      {
        apiKey: input.apiKey,
        model: input.model,
        systemPrompt: HINTS_SYSTEM_PROMPT,
        prompt: userPrompt,
        signal: input.signal
      },
      HINTS_CALL_SCHEMA
    );
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return {
      ok: false,
      suggestions: [],
      reason: `AI complementarity-hints call failed: ${(e as Error).message}.`
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      suggestions: [],
      reason: `AI refused: ${result.refusal.kind}: ${result.refusal.message}`
    };
  }
  const raw = Array.isArray(result.value.suggestions)
    ? result.value.suggestions
    : [];
  const cleaned: ComplementaritySuggestion[] = [];
  for (const s of raw) {
    if (typeof s?.archetype !== 'string' || typeof s?.hook !== 'string') {
      continue;
    }
    const archetype = s.archetype.trim().slice(0, 40);
    const hook = s.hook.trim().slice(0, 120);
    if (archetype.length === 0 || hook.length === 0) continue;
    cleaned.push({ archetype, hook });
  }
  if (cleaned.length === 0) {
    return {
      ok: false,
      suggestions: [],
      reason: 'AI returned no usable suggestions.'
    };
  }
  return { ok: true, suggestions: cleaned };
}

function buildUserPrompt(
  roster: RosterSnapshot,
  dmGuidance?: string
): string {
  const lines: string[] = [];
  if (roster.pcs.length === 0) {
    lines.push(
      'Existing roster: (none yet).  Suggest 3-4 archetypes that would form a balanced starting party.'
    );
  } else {
    lines.push('Existing roster:');
    for (const pc of roster.pcs) {
      const tags =
        pc.tags.length > 0 ? ` — tags: ${pc.tags.slice(0, 5).join(', ')}` : '';
      lines.push(
        `  - ${pc.name}: ${pc.archetype}, ${pc.dominantStat}-led${tags}`
      );
    }
  }
  if (dmGuidance && dmGuidance.trim().length > 0) {
    // Wave A4 (2026-05-26) firewall hardening: dmGuidance is DM-
    // typed but the DM may paste in player chat / scratch text
    // containing prompt-injection.  Wrap in `<untrusted_content>`
    // sentinel — same convention P2 established for player
    // answers.  Any `</untrusted_content>` substring in the wrapped
    // body is escaped to `<!--UC_CLOSE-->` by wrapUntrusted itself.
    lines.push('');
    lines.push(
      `DM guidance:\n${wrapUntrusted(dmGuidance.trim(), 'dm-guidance')}`
    );
  }
  lines.push('');
  lines.push(
    'Suggest 2-4 complementary archetype + hook pairs in the structured response.'
  );
  return lines.join('\n');
}
