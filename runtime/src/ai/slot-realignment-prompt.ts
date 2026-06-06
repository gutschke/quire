/**
 * 2026-06-06: AI-assisted slot↔PC realignment.
 *
 * After session 1, the DM commonly notices that some players have
 * been playing in a way that fits a DIFFERENT character than the
 * one they got bound to during chargen.  This module assembles the
 * prompt asking AI to propose swaps.
 *
 * Inputs the AI gets:
 *   - The current slot bindings (slot N → player Markus → PC "Marcus Vance")
 *   - Each PC's name + backstory + key tags
 *   - The most recent session digest (what happened at the table)
 *   - A few chat samples per player (their voice/decisions)
 *
 * Output: a JSON proposal — `noChangeNeeded` flag + per-slot
 * `{currentPcId, proposedPcId, rationale}` entries.  The DM reviews
 * each proposed swap and accepts or rejects individually.
 *
 * This module is PURE prompt assembly — no network, no Date.now, no
 * random.  The broker glue (host `generateSlotRealignment`) wraps
 * this with provider call.
 *
 * Engine-vs-campaign positioning: the system prompt is engine
 * default.  When a campaign declares
 * `aiSlotRealignment.systemPromptOverride`, the engine prefers it
 * (TODO: same V-7 hybrid pattern as backstory-synthesis-prompt).
 *
 * Threat-model alignment:
 *   - Player chat samples + PC backstories are public-facing-at-the-
 *     table — no DM-only data flows in.  No firewall risk.
 *   - The AI's proposal is treated as a suggestion the DM ratifies;
 *     no auto-apply.  The materializer is coord-gated anyway.
 */

import type { AiStructuredCallSchema } from './broker';
import { wrapUntrusted } from './context';

export interface SlotRealignmentBinding {
  /** Slot number (1..N). */
  slot: number;
  /** Display name of the player currently bound (e.g. "Markus"). */
  playerName: string;
  /** PC id currently in this slot. */
  pcId: string;
  /** PC's character name (e.g. "Marcus Vance"). */
  pcName: string;
}

export interface SlotRealignmentPcSheet {
  pcId: string;
  /** Character name. */
  name: string;
  /** Free-text backstory.  Truncated by the assembler to a budget. */
  backstory?: string;
  /** Optional tags / archetype hints (e.g. ["hacker", "ex-government"]). */
  tags?: ReadonlyArray<string>;
  /**
   * Optional alignment / pronouns / signature item — small fields
   * that quickly characterize the PC at a glance.
   */
  alignment?: string;
  pronouns?: string;
}

export interface SlotRealignmentPlayerSample {
  playerName: string;
  /** Up to ~10 short chat lines the player wrote during recent play. */
  chatLines: ReadonlyArray<string>;
}

export interface SlotRealignmentPromptInput {
  bindings: ReadonlyArray<SlotRealignmentBinding>;
  pcs: ReadonlyArray<SlotRealignmentPcSheet>;
  playerSamples: ReadonlyArray<SlotRealignmentPlayerSample>;
  /** Most recent session digest, if any. */
  recentDigestMarkdown?: string;
  /** Optional DM-typed nudge ("Markus seems frustrated; try a different PC"). */
  dmGuidance?: string;
}

export const SLOT_REALIGNMENT_SYSTEM_PROMPT = `You are a co-DM helping a TTRPG table figure out whether any players would be happier playing a different PC than the one chargen assigned them.

# What you're doing
After session 1 of a campaign, it sometimes turns out that a player's natural voice / instincts / decisions fit a different PC's backstory better than their original assignment.  The DM is asking you to look at how each player actually played and propose swaps if any would land better.

# What you have
- The current bindings: slot N → player → PC.
- Each PC's name, backstory excerpt, tags, alignment, pronouns.
- A few chat lines per player (their voice, the choices they leaned on).
- (Optional) the session digest of what happened in fiction.
- (Optional) DM guidance — a nudge from the DM about a specific friction.

# How to think
A good swap fits at least two of:
- The player's voice (formal vs jokey, hesitant vs decisive) matches the PC's register.
- The player kept making choices the PC's backstory would naturally make.
- The player misses chances to use the PC's hooks (skills, ties, history) — i.e., they ignore the PC's setup.
- A different PC's hooks line up with the player's recurring moves.

Propose ONLY swaps you're at least moderately confident about.  Default to no change if signals are ambiguous — a misaligned swap is worse than no swap.  The DM gates every proposal; they will reject ones that don't sit right.

# Output format (constrained)
Return JSON: {
  "noChangeNeeded": boolean,
  "reasoning": string,         // 1-3 sentences on what you're seeing overall
  "proposals": [
    {
      "slot": number,          // slot to rebind
      "currentPcId": string,   // the PC that's there now (must match input)
      "proposedPcId": string,  // the PC that should go there
      "rationale": string      // 1-2 sentences on why this player fits this PC
    }
  ]
}

The proposals array can be empty when noChangeNeeded is true.  When you propose multiple swaps, the union of (slot, proposedPcId) must form a valid permutation of the input pcIds — i.e. each pcId moves to exactly one slot, no duplicates, no inventions.  Use proposedPcId values from the input "pcs" list only.
`;

/** Cap backstory excerpt to keep prompt token budget tight. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildSlotRealignmentPrompt(
  input: SlotRealignmentPromptInput
): { system: string; user: string } {
  const parts: string[] = [];
  parts.push('# Current bindings');
  if (input.bindings.length === 0) {
    parts.push('(no bindings — nothing to realign)');
  } else {
    for (const b of input.bindings) {
      parts.push(
        `- Slot ${b.slot}: player "${b.playerName}" → PC "${b.pcName}" (id: ${b.pcId})`
      );
    }
  }

  parts.push('');
  parts.push('# PCs in play');
  for (const pc of input.pcs) {
    const meta: string[] = [];
    if (pc.pronouns) meta.push(pc.pronouns);
    if (pc.alignment) meta.push(pc.alignment);
    const metaStr = meta.length > 0 ? ` (${meta.join(', ')})` : '';
    parts.push(`## ${pc.name}${metaStr} — id: ${pc.pcId}`);
    if (pc.tags && pc.tags.length > 0) {
      parts.push(`tags: ${pc.tags.join(', ')}`);
    }
    if (pc.backstory) {
      parts.push('backstory:');
      parts.push(truncate(pc.backstory, 1200));
    }
    parts.push('');
  }

  if (input.playerSamples.length > 0) {
    parts.push('# Player voice samples (chat during recent play)');
    for (const s of input.playerSamples) {
      const lines = s.chatLines.slice(0, 10).map((l) => `- ${truncate(l, 220)}`);
      parts.push(`## ${s.playerName}`);
      if (lines.length === 0) {
        parts.push('(no chat samples)');
      } else {
        parts.push(lines.join('\n'));
      }
      parts.push('');
    }
  }

  if (
    input.recentDigestMarkdown &&
    input.recentDigestMarkdown.trim().length > 0
  ) {
    parts.push('# Recent session digest (what happened)');
    parts.push(truncate(input.recentDigestMarkdown.trim(), 4000));
    parts.push('');
  }

  if (input.dmGuidance && input.dmGuidance.trim().length > 0) {
    parts.push('# DM guidance');
    parts.push(
      wrapUntrusted(input.dmGuidance.trim(), 'dm-realignment-guidance')
    );
    parts.push('');
  }

  parts.push('# Your task');
  parts.push(
    'Propose slot↔PC realignment if any swap would fit better.  Be conservative — propose only when you can clearly justify the swap.  Return the JSON exactly as specified.'
  );

  return {
    system: SLOT_REALIGNMENT_SYSTEM_PROMPT,
    user: parts.join('\n')
  };
}

/** JSON schema for constrained-decoding response. */
export const SLOT_REALIGNMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    noChangeNeeded: { type: 'boolean' },
    reasoning: { type: 'string', minLength: 1, maxLength: 2000 },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot: { type: 'number' },
          currentPcId: { type: 'string', minLength: 1 },
          proposedPcId: { type: 'string', minLength: 1 },
          rationale: { type: 'string', minLength: 1, maxLength: 800 }
        },
        required: ['slot', 'currentPcId', 'proposedPcId', 'rationale'],
        additionalProperties: false
      }
    }
  },
  required: ['noChangeNeeded', 'reasoning', 'proposals'],
  additionalProperties: false
} as const;

export const SLOT_REALIGNMENT_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'propose_slot_realignment',
  schema: SLOT_REALIGNMENT_RESPONSE_SCHEMA as unknown as Record<string, unknown>
};

export interface SlotRealignmentProposal {
  slot: number;
  currentPcId: string;
  proposedPcId: string;
  rationale: string;
}

export interface SlotRealignmentResponse {
  noChangeNeeded: boolean;
  reasoning: string;
  proposals: SlotRealignmentProposal[];
}

/**
 * Validate that an AI response forms a valid permutation:
 *   - All currentPcIds appear in the input bindings.
 *   - All proposedPcIds appear in the input PCs list.
 *   - No two proposals target the same slot.
 *   - The set of (slot → proposedPcId) does NOT duplicate any pcId.
 *
 * Returns a list of human-readable issues (empty list = valid).
 * Lets the host surface "the AI's proposal is malformed" to the DM
 * rather than silently broadcasting events that would no-op.
 */
export function validateRealignmentResponse(
  resp: SlotRealignmentResponse,
  bindings: ReadonlyArray<SlotRealignmentBinding>,
  pcs: ReadonlyArray<SlotRealignmentPcSheet>
): string[] {
  const issues: string[] = [];
  const slotToCurrentPc = new Map<number, string>();
  for (const b of bindings) slotToCurrentPc.set(b.slot, b.pcId);
  const knownPcIds = new Set<string>(pcs.map((p) => p.pcId));

  const seenSlots = new Set<number>();
  const proposedPcIds = new Set<string>();
  for (const p of resp.proposals) {
    if (seenSlots.has(p.slot)) {
      issues.push(`slot ${p.slot} appears in multiple proposals`);
    }
    seenSlots.add(p.slot);
    const cur = slotToCurrentPc.get(p.slot);
    if (cur === undefined) {
      issues.push(`slot ${p.slot} is not a known binding`);
    } else if (cur !== p.currentPcId) {
      issues.push(
        `slot ${p.slot}: currentPcId mismatch (AI said ${p.currentPcId}, actual ${cur})`
      );
    }
    if (!knownPcIds.has(p.proposedPcId)) {
      issues.push(
        `slot ${p.slot}: proposedPcId ${p.proposedPcId} is not a known PC`
      );
    }
    if (proposedPcIds.has(p.proposedPcId)) {
      issues.push(
        `proposedPcId ${p.proposedPcId} appears in multiple proposals`
      );
    }
    proposedPcIds.add(p.proposedPcId);
  }
  return issues;
}
