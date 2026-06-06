/**
 * 2026-06-06 (v2 rewrite, per TTRPG-expert correction):
 * AI-assisted slot renumbering for Quire/Underleaf.
 *
 * **What this actually does** (the previous v1 was wrong):
 *
 *   The campaign's narrative addresses each PC by slot index — the
 *   scenes (and DM docs) say `{{pc:1}}`, `{{pc:3}}`, etc.  When the
 *   campaign author wrote those references, they didn't know which
 *   real characters would fill which slot.  After chargen + session
 *   1 the DM can see which (player+PC) pair fits which `{{pc:N}}`
 *   role best.
 *
 *   The DM realigns by **renumbering which slot each (player+PC)
 *   pair answers to** — NOT by moving characters between players.
 *   Each pair is atomic: Markus keeps playing Marcus Vance.  What
 *   moves is the slot LABEL that addresses them.
 *
 * Input to the AI:
 *   - Current bindings — each existing slot's (slot, pcId, peerId,
 *     pcName, playerName).  Pairs are atomic and shown to the AI
 *     that way.
 *   - PC sheets — character name, backstory, tags, alignment,
 *     pronouns.
 *   - Slot fingerprints — for each `{{pc:N}}` referenced in the
 *     campaign, the role/prop/skill signals the author wrote.  This
 *     is THE load-bearing input.
 *   - (optional) recent chat samples per player — secondary signal.
 *   - (optional) most recent session digest.
 *   - (optional) DM-typed nudge.
 *
 * Output (constrained JSON, see schema below):
 *   {
 *     noChangeNeeded: boolean,
 *     reasoning: string,
 *     permutation: [
 *       { newSlot, pairKey: {pcId, peerId}, currentSlot,
 *         slotFingerprintMatched, rationale }
 *     ]
 *   }
 *
 * Validation:
 *   - Each currentSlot appears exactly once across `permutation`.
 *   - Each newSlot appears exactly once.
 *   - Each (pcId, peerId) pair appears exactly once, and ONLY pairs
 *     that currently co-occupy a seat in the input may appear.
 *   - Pair ↔ slot count preserved.  No inventions.
 *   - When `noChangeNeeded` is true, `permutation` must be empty.
 *
 * The DM accepts the WHOLE permutation atomically (no per-row
 * accept) — partially applying a permutation breaks the bijection.
 * The UI presents the proposed renumbering as a single accept/reject
 * choice.
 */

import type { AiStructuredCallSchema } from './broker';
import type { SlotFingerprint } from './slot-fingerprints';
import { wrapUntrusted } from './context';

export interface RealignmentBinding {
  slot: number;
  /** Display name of the player currently bound. */
  playerName: string;
  /** PC id currently in this slot. */
  pcId: string;
  /** PC character name. */
  pcName: string;
  /** Peer id controlling this slot (the load-bearing identifier). */
  peerId: string;
}

export interface RealignmentPcSheet {
  pcId: string;
  name: string;
  backstory?: string;
  tags?: ReadonlyArray<string>;
  alignment?: string;
  pronouns?: string;
}

export interface RealignmentPlayerSample {
  playerName: string;
  chatLines: ReadonlyArray<string>;
}

export interface RealignmentPromptInput {
  bindings: ReadonlyArray<RealignmentBinding>;
  pcs: ReadonlyArray<RealignmentPcSheet>;
  /** Extracted via `slot-fingerprints.ts` from campaign markdown. */
  slotFingerprints: ReadonlyArray<SlotFingerprint>;
  playerSamples: ReadonlyArray<RealignmentPlayerSample>;
  recentDigestMarkdown?: string;
  dmGuidance?: string;
}

export const SLOT_REALIGNMENT_SYSTEM_PROMPT = `You are a co-DM helping a TTRPG table after chargen + session 1.

# What you are doing
The campaign's scenes address players by SLOT INDEX — \`{{pc:1}}\`, \`{{pc:3}}\`, etc.  The script-author wrote those references BEFORE knowing which real (player + PC) pair would fill which slot.

Your job: propose a RENUMBERING that maps each current (player + PC) pair to a (possibly different) slot index, so that each slot's narrative fingerprint — what the script-author intended that slot to be doing — best matches the PC's backstory in that pair.

**Pairs are ATOMIC.**  A pair = (player, PC).  Never separate a player from the PC they made.  Markus keeps playing Marcus Vance — what moves is the slot LABEL (1, 2, 3…) that addresses them.

# Inputs you will receive
- Current bindings (slot → player → PC), one per occupied seat.  Pairs.
- PC sheets — name, backstory, tags, alignment, pronouns.
- **Slot fingerprints** — for each \`{{pc:N}}\` referenced in the campaign, the role / prop / skill cues the author wrote.  This is the load-bearing signal.  A slot with fingerprint "carries an SDR, notices avionics" wants a hacker / radio-curious PC.
- (Optional) chat samples per player — tiebreaker only.
- (Optional) the most recent session digest.
- (Optional) DM guidance.

# How to think
- For each occupied slot, ask: "of all the pairs in play, whose PC backstory most matches the script-author's fingerprint for this slot label?"
- A good renumbering is when MULTIPLE slot↔pair matches improve.  A single weak match is not enough.
- If the alignment is already roughly right — or if the misalignment is concentrated in scenes the table already played out — output \`noChangeNeeded: true\` and explain.  Sometimes the right answer is "rewrite the script", not "renumber the table".  Say that aloud when you see it.
- Be conservative: ambiguity defaults to no-change.

# Hard constraints
- Pairs are atomic.  A pair currently bound to slot 3 may move to slot 1, but its (peerId, pcId) tuple stays together.
- You may not invent pairs, drop pairs, or duplicate pairs.
- The proposed permutation must be a bijection over the input pairs.  Each pair appears once; each currentSlot appears once; each newSlot appears once.
- newSlot values must come from the slots present in the input bindings (no new slot indices invented).
- When noChangeNeeded is true, the permutation array MUST be empty.

# Output format (return exactly this JSON shape)
{
  "noChangeNeeded": boolean,
  "reasoning": string,         // 1-3 sentences on what you see overall
  "permutation": [
    {
      "newSlot": number,
      "pairKey": { "pcId": string, "peerId": string },
      "currentSlot": number,
      "slotFingerprintMatched": string,  // brief tag the AI considers load-bearing
      "rationale": string                // 1-2 sentences justifying THIS pair → THIS new slot
    }
  ]
}

Nothing else in the output — just the JSON.
`;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildSlotRealignmentPrompt(
  input: RealignmentPromptInput
): { system: string; user: string } {
  const parts: string[] = [];

  parts.push('# Current bindings (pairs are atomic)');
  if (input.bindings.length === 0) {
    parts.push('(no bindings)');
  } else {
    for (const b of input.bindings) {
      parts.push(
        `- slot ${b.slot}: player "${b.playerName}" + PC "${b.pcName}" (pcId: ${b.pcId}, peerId: ${b.peerId})`
      );
    }
  }
  parts.push('');

  parts.push('# Slot fingerprints (from the campaign script)');
  if (input.slotFingerprints.length === 0) {
    parts.push(
      '(no `{{pc:N}}` references found in the campaign — the AI has no script-author signal to optimize against.  Default to noChangeNeeded=true.)'
    );
  } else {
    for (const fp of input.slotFingerprints) {
      parts.push(`## slot ${fp.slot} (${fp.mentions} mentions)`);
      for (const ex of fp.excerpts) {
        parts.push(`- (${ex.path}) ${truncate(ex.excerpt, 280)}`);
      }
      parts.push('');
    }
  }

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
    parts.push('# Player voice samples (tiebreaker; secondary signal)');
    for (const s of input.playerSamples) {
      const lines = s.chatLines.slice(0, 8).map((l) => `- ${truncate(l, 220)}`);
      parts.push(`## ${s.playerName}`);
      parts.push(lines.length === 0 ? '(no samples)' : lines.join('\n'));
      parts.push('');
    }
  }

  if (
    input.recentDigestMarkdown &&
    input.recentDigestMarkdown.trim().length > 0
  ) {
    parts.push('# Recent session digest (what happened so far)');
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
    'Propose a slot renumbering if any permutation of the pairs over the existing slot indices yields stronger script-fingerprint matches overall.  Be conservative.  Return the exact JSON shape, nothing else.'
  );

  return {
    system: SLOT_REALIGNMENT_SYSTEM_PROMPT,
    user: parts.join('\n')
  };
}

export const SLOT_REALIGNMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    noChangeNeeded: { type: 'boolean' },
    reasoning: { type: 'string', minLength: 1, maxLength: 2000 },
    permutation: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          newSlot: { type: 'number' },
          pairKey: {
            type: 'object',
            properties: {
              pcId: { type: 'string', minLength: 1 },
              peerId: { type: 'string', minLength: 1 }
            },
            required: ['pcId', 'peerId'],
            additionalProperties: false
          },
          currentSlot: { type: 'number' },
          slotFingerprintMatched: {
            type: 'string',
            minLength: 1,
            maxLength: 300
          },
          rationale: { type: 'string', minLength: 1, maxLength: 800 }
        },
        required: [
          'newSlot',
          'pairKey',
          'currentSlot',
          'slotFingerprintMatched',
          'rationale'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['noChangeNeeded', 'reasoning', 'permutation'],
  additionalProperties: false
} as const;

export const SLOT_REALIGNMENT_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'propose_slot_renumbering',
  schema: SLOT_REALIGNMENT_RESPONSE_SCHEMA as unknown as Record<string, unknown>
};

export interface RealignmentPermutationEntry {
  newSlot: number;
  pairKey: { pcId: string; peerId: string };
  currentSlot: number;
  slotFingerprintMatched: string;
  rationale: string;
}

export interface RealignmentResponse {
  noChangeNeeded: boolean;
  reasoning: string;
  permutation: RealignmentPermutationEntry[];
}

/**
 * Validate the AI's response forms a valid pair-atomic permutation.
 * Returns a list of human-readable issues; empty list means valid.
 *
 * Invariants checked:
 *   - When noChangeNeeded is true, permutation must be empty.
 *   - Each currentSlot in `permutation` appears in input bindings
 *     with the same (pcId, peerId) pair (no separating pairs).
 *   - Each newSlot in `permutation` corresponds to a slot that
 *     exists in the input bindings.
 *   - currentSlots are unique across permutation entries.
 *   - newSlots are unique across permutation entries.
 *   - Pair keys are unique across permutation entries.
 *   - Identity permutation entries (newSlot === currentSlot) are
 *     permitted but unnecessary — included for completeness in case
 *     the AI returns a full N-tuple.
 */
export function validateRealignmentResponse(
  resp: RealignmentResponse,
  bindings: ReadonlyArray<RealignmentBinding>
): string[] {
  const issues: string[] = [];
  if (resp.noChangeNeeded && resp.permutation.length > 0) {
    issues.push(
      'noChangeNeeded=true but permutation is non-empty; pick one'
    );
  }
  const knownSlots = new Set(bindings.map((b) => b.slot));
  const slotToPair = new Map<number, { pcId: string; peerId: string }>();
  for (const b of bindings) {
    slotToPair.set(b.slot, { pcId: b.pcId, peerId: b.peerId });
  }

  const seenCurrent = new Set<number>();
  const seenNew = new Set<number>();
  const seenPair = new Set<string>();
  for (const e of resp.permutation) {
    if (seenCurrent.has(e.currentSlot)) {
      issues.push(`currentSlot ${e.currentSlot} appears more than once`);
    }
    seenCurrent.add(e.currentSlot);
    if (seenNew.has(e.newSlot)) {
      issues.push(`newSlot ${e.newSlot} appears more than once`);
    }
    seenNew.add(e.newSlot);
    const pairKeyStr = `${e.pairKey.pcId}|${e.pairKey.peerId}`;
    if (seenPair.has(pairKeyStr)) {
      issues.push(
        `pair (${e.pairKey.pcId}, ${e.pairKey.peerId}) appears more than once`
      );
    }
    seenPair.add(pairKeyStr);

    if (!knownSlots.has(e.currentSlot)) {
      issues.push(`currentSlot ${e.currentSlot} is not a known binding`);
    }
    if (!knownSlots.has(e.newSlot)) {
      issues.push(`newSlot ${e.newSlot} is not a known slot`);
    }

    const actualPair = slotToPair.get(e.currentSlot);
    if (actualPair) {
      if (
        actualPair.pcId !== e.pairKey.pcId ||
        actualPair.peerId !== e.pairKey.peerId
      ) {
        issues.push(
          `currentSlot ${e.currentSlot}: pair mismatch (AI claims ${e.pairKey.pcId}/${e.pairKey.peerId}, actual ${actualPair.pcId}/${actualPair.peerId})`
        );
      }
    }
  }

  return issues;
}
