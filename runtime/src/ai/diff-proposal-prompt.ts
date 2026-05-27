/**
 * D1-B (2026-05-26): NPC living-doc diff-proposal prompt assembly.
 *
 * After session-wrap-marks + session-digest (D4), the DM enters
 * the diff-review Stage where the AI proposes structural updates
 * to NPC files (per ui.md L298-363).  This module assembles the
 * prompt + JSON schema for the AI broker call; the host wires
 * dispatch.
 *
 * **MVP scope (TTRPG-expert narrowed):** NPC memory of player
 * choices ONLY.  What does this NPC now know / remember / feel
 * about the PCs after this session?  Defer faction reveals,
 * retroactive consistency edits, and trait discovery to later
 * waves — those touch player-visible canon with higher stakes
 * and need the diff-review apparatus to prove out first.
 *
 * **Why this is NOT silent-grant anti-pattern**: the AI proposes
 * what the NPC NOW KNOWS (facts the NPC holds); the DM owns what
 * the NPC SAYS (voice).  No new dialogue, no speech tics, no
 * personality drift.  The DM is the final voice gate at accept
 * time.
 *
 * **Per-pointer cards** (Adversarial B-1): every proposal targets
 * ONE dotted-field path.  A change to `/disposition` is a separate
 * proposal from a change to `/dmNotes`.  The downstream apply
 * (`applyProposalToWorkingCopy`) handles each independently; the
 * structural firewall classifies each by the target field, not
 * by any AI claim.
 *
 * **AI sees DM material** (Adversarial B-2): unlike player-facing
 * AI calls (which hardcode `includeDmNotes:false`), this prompt
 * MUST include `dmNotes` so the AI can propose dmNotes updates.
 * The structural firewall is the BROADCAST PAYLOAD on accept
 * (D1-D event materializer), not the input bundle.
 *
 * Pure string assembly + schema construction — no provider call.
 */

import type { QuireEvent } from '../core/event-log';
import { isDmOnlyCharacterFieldPath } from '../character-loader';
import type { AiStructuredCallSchema } from './broker';

export interface NpcContext {
  /** NPC file basename (matches LoadedCharacter.id). */
  npcId: string;
  /** Campaign-relative path to the NPC JSON file. */
  path: string;
  /** Full file content as parsed JSON (including dmNotes). */
  record: Record<string, unknown>;
  /** Optional git SHA — flows into DiffProposal.baseSha for
   *  staleness detection at apply time. */
  baseSha?: string;
}

export interface DiffProposalPromptInput {
  /**
   * Player-visible events since the last diff-review.  Same
   * filter as `SESSION_DIGEST_INPUT_KINDS` PLUS pc-edit field-
   * level scrub for DM-only fields via `isDmOnlyCharacterFieldPath`
   * — applied by the caller before passing in (the host does this
   * via the same code path the digest uses).
   */
  events: ReadonlyArray<QuireEvent>;
  /**
   * The NPCs in scope for proposals.  Caller decides which NPCs
   * appeared in this session (or "all NPCs" for a thorough pass).
   * Full records — including dmNotes — so the AI can propose
   * dmNotes updates.  Per Adversarial B-2: visibility is enforced
   * at the broadcast firewall, not by hiding input from the AI.
   */
  npcs: ReadonlyArray<NpcContext>;
  /**
   * Optional: the just-saved session-digest markdown.  Gives the
   * AI the DM's-own framing for what happened, which produces
   * tighter proposals than events-alone.  (UX-expert: digest IS
   * input to diff-review.)
   */
  sessionDigestMarkdown?: string;
  /**
   * Brief campaign anchor.
   */
  campaignContext: {
    name?: string;
    currentEpisode?: string;
    currentScene?: string;
  };
  /**
   * Optional DM-typed steer.  Wrapped in `<untrusted_content>`
   * per the practice memo.
   */
  dmGuidance?: string;
}

export const DIFF_PROPOSAL_SYSTEM_PROMPT = `You are a co-DM helping a TTRPG group maintain their living-document of NPCs between sessions.  After a session, you review what happened and propose structural updates to NPC files — specifically, **what does each NPC now know, remember, or feel about the PCs**.

# MVP scope — NPC memory of player choices ONLY
Propose updates that capture what this NPC's inner state is NOW vs at session-start:
- A new memory (NPC remembers PC1 was kind / Reggie owes them a favor)
- A disposition shift (friendly-distant → owes-a-favor, after PC2 helped them)
- Updated current-stress / situational context (the kid was sick last session; now sleeping fine)
- A new factual entry in dmNotes about something the DM said in chat or showed in play

DO NOT propose:
- New dialogue, speech tics, or voice changes — the DM owns NPC voice
- New traits or personality changes the AI invents — only memory/disposition shifts the DM materially demonstrated
- Faction reveals, role changes, or retroactive consistency edits — those need DM scene-level review, not memory-level
- Updates to PCs (this surface is NPC-only)

# Inputs you receive
- Campaign anchor (name + current episode/scene)
- Optional session-digest (the DM's recap of what just happened — use as primary framing)
- Player-visible event timeline (chat, dice, scene reveals, lifecycle)
- Full NPC records, including DM-only fields like \`dmNotes\` and \`knownTo\`
- Optional DM guidance

You see DM-only NPC fields because you may propose updates TO them.  The structural firewall happens at acceptance time: when the DM accepts a \`dmNotes\` update, only the DM sees the new value broadcast; when the DM accepts a \`disposition\` update, all players see it.  YOU do not need to mark visibility; the apply step handles it.

# Per-proposal shape
Each proposal you return targets ONE NPC and ONE field path.  Dotted notation:
- \`disposition\`           — top-level string update
- \`dmNotes\`               — append/replace the DM-private notes
- \`background.currentStress\` — nested object field
- \`relationships.0.notes\` — array-indexed nested field
For lists like \`relationships\` or \`signature\`, prefer a TARGETED dotted update (e.g. \`relationships.0.notes\`) over replacing the whole array.  When the change is genuinely additive (a wholly new relationship), use the whole-array form (\`relationships\`) with the original entries preserved.

For each proposal include:
- \`id\`: stable id you generate (\`prop-001\`, \`prop-002\`, …)
- \`npcId\`: file basename
- \`field\`: dotted path
- \`before\`: current value at that path (from the NPC record you were given)
- \`after\`: the proposed new value
- \`rationale\`: short DM-only explanation (1-2 sentences); cite the event/digest paragraph that motivated it
- \`sourceEventIds\`: ids of events from the timeline that drove this proposal (may be empty if the source is purely the digest)

# Magic-discovery arc constraint
The campaign's magic system: some PCs cast but don't yet know magic exists; their successes resolve in-fiction as luck.  When proposing what an NPC remembers about a pre-Realization PC, narrate the events as the NPC perceived them (lucky breaks, near misses, strange timing).  Do NOT propose dmNotes entries that name the magical pattern across pre-Realization PCs unless the NPC themselves witnessed an unmistakable beat.

# Quality bar — proposals worth the DM's attention
Propose 0-8 updates total across all NPCs.  Quality > quantity.  Each proposal should be one the DM would otherwise have written into the file themselves over the next week — concretely grounded in something specific the players DID this session, not a generic "NPC remembers PC1."

# Output format
Return JSON: { "proposals": [ { id, npcId, field, before, after, rationale, sourceEventIds }, ... ] }
If nothing happened this session that warrants an NPC update, return \`{ "proposals": [] }\`.`;

/**
 * Render the event timeline using the same compact format the
 * session-digest prompt uses.  Per-kind summarizers shared
 * conceptually but inlined here to keep diff-proposal-prompt
 * decoupled from session-digest-prompt (different scope, both
 * may evolve independently).
 */
function renderEventTimeline(events: ReadonlyArray<QuireEvent>): string {
  if (events.length === 0) return '(no events recorded)';
  const lines: string[] = [];
  for (const e of events) {
    const t = new Date(e.ts).toISOString();
    lines.push(`- [${e.id}] [${t}] ${e.kind}: ${summarizePayload(e)}`);
  }
  return lines.join('\n');
}

function summarizePayload(e: QuireEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const text = (k: string): string => {
    const v = p[k];
    return typeof v === 'string' ? v : '';
  };
  const num = (k: string): number | string => {
    const v = p[k];
    return typeof v === 'number' ? v : '';
  };
  const trunc = (s: string, max: number): string =>
    s.length <= max ? s : s.slice(0, max - 1) + '…';
  switch (e.kind) {
    case 'chat':
      return `(${e.peerId}) ${trunc(text('text'), 200)}`;
    case 'dice-roll':
      return `${e.peerId} rolled ${text('purpose') || '?'} → ${text('outcome') || '?'}`;
    case 'scene-reveal':
      return `revealed scene ${text('scene')}`;
    case 'scene-reveal-paragraph':
      return `revealed paragraph in ${text('scene')}`;
    case 'pc-edit':
      return `pc-edit ${text('pcId')}.${text('field')} = ${trunc(JSON.stringify(p.value) ?? '', 200)}`;
    case 'pc-create':
      return `new PC ${text('name')} (${text('pcId')})`;
    case 'pc-retire':
      return `${text('pcId')} retired: ${trunc(text('inFictionReason'), 200)}`;
    case 'pc-archive':
      return `${text('pcId')} archived: ${trunc(text('inFictionReason'), 200)}`;
    case 'focus-grant': {
      const focus = (p.focus ?? {}) as Record<string, unknown>;
      const name = typeof focus.name === 'string' ? focus.name : '';
      const domain = typeof focus.domain === 'string' ? focus.domain : '';
      return `${text('pcId')} gained focus "${name}"${domain ? ` (domain: ${domain})` : ''}`;
    }
    case 'pc-mark-realization':
      return `${text('pcId')} realized their magic (one-way gate)`;
    case 'pc-slot-bind':
      return `slot ${num('slot')} → ${text('pcId')}`;
    default:
      return e.kind;
  }
}

/**
 * Wrap untrusted user-typed text in the standard sentinel.
 * Local copy to keep this leaf module dependency-free.
 */
function wrapUntrusted(body: string, source: string): string {
  const safe = body.replace(/<\/untrusted_content>/g, '<!--UC_CLOSE-->');
  return `<untrusted_content source="${source}">\n${safe}\n</untrusted_content>`;
}

export function buildDiffProposalPrompt(
  input: DiffProposalPromptInput
): { system: string; user: string } {
  const parts: string[] = [];
  parts.push('# Campaign anchor');
  const cc = input.campaignContext;
  const ccLines: string[] = [];
  if (cc.name) ccLines.push(`- name: ${cc.name}`);
  if (cc.currentEpisode) ccLines.push(`- episode: ${cc.currentEpisode}`);
  if (cc.currentScene) ccLines.push(`- scene: ${cc.currentScene}`);
  parts.push(ccLines.length > 0 ? ccLines.join('\n') : '(unknown)');

  if (
    input.sessionDigestMarkdown &&
    input.sessionDigestMarkdown.trim().length > 0
  ) {
    parts.push('');
    parts.push('# Session digest (DM-authored recap of what just happened)');
    parts.push(input.sessionDigestMarkdown.trim());
  }

  parts.push('');
  parts.push('# Event timeline (player-visible, chronological)');
  parts.push(renderEventTimeline(input.events));

  parts.push('');
  parts.push('# NPCs in scope');
  if (input.npcs.length === 0) {
    parts.push('(none — nothing to propose against)');
  } else {
    for (const npc of input.npcs) {
      parts.push('');
      parts.push(`## NPC: ${npc.npcId} (${npc.path})`);
      if (npc.baseSha) parts.push(`baseSha: ${npc.baseSha}`);
      // The NPC file is content from the campaign repo — DM-
      // authored, but not chat-injection authored.  Wrap anyway
      // per the practice memo: ANY non-trusted-system text that
      // reaches a prompt gets wrapped.  The dmNotes free-text
      // field in particular could contain backticks / sentinels.
      parts.push(
        wrapUntrusted(
          JSON.stringify(npc.record, null, 2),
          `npc:${npc.npcId}`
        )
      );
    }
  }

  if (input.dmGuidance && input.dmGuidance.trim().length > 0) {
    parts.push('');
    parts.push(
      `# DM guidance (focus the proposals):\n${wrapUntrusted(
        input.dmGuidance.trim(),
        'dm-diff-proposal-guidance'
      )}`
    );
  }

  parts.push('');
  parts.push(
    '# Your task\nPropose 0-8 NPC memory updates as the JSON object specified.  Quality > quantity.  Each proposal targets one NPC + one dotted-field path.  Cite source events in `sourceEventIds` when possible.  Nothing else in the output — just the JSON.'
  );

  return {
    system: DIFF_PROPOSAL_SYSTEM_PROMPT,
    user: parts.join('\n')
  };
}

/**
 * JSON schema for constrained decoding.  Mirrors the
 * `DiffProposal` shape from `src/living/diff-format.ts`.  Caps
 * mirror the validator caps so the AI can't return outputs the
 * validator will reject.
 */
export const DIFF_PROPOSAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          npcId: { type: 'string', minLength: 1, maxLength: 200 },
          field: { type: 'string', minLength: 1, maxLength: 200 },
          before: {},
          after: {},
          rationale: { type: 'string', minLength: 1, maxLength: 2000 },
          sourceEventIds: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', maxLength: 200 }
          }
        },
        required: ['id', 'npcId', 'field', 'before', 'after', 'rationale'],
        additionalProperties: false
      }
    }
  },
  required: ['proposals'],
  additionalProperties: false
} as const;

export const DIFF_PROPOSAL_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'emit_npc_diff_proposals',
  schema: DIFF_PROPOSAL_RESPONSE_SCHEMA as unknown as Record<string, unknown>
};

/**
 * Kind allowlist for diff-proposal input events.  Same kinds as
 * SESSION_DIGEST_INPUT_KINDS (the diff-proposal AI uses the same
 * player-visible event stream as the digest), MINUS `seat-memory-edit`
 * (DM-intimate, per D4-cleanup-2).
 *
 * pc-edit events still flow through; caller MUST apply the same
 * `isDmOnlyCharacterFieldPath` filter as `generateSessionDigest`
 * does, so DM-only PC field writes (dmNotes, magicPhase, tax.*,
 * etc.) don't reach this prompt either.  The host wires both
 * filters via the shared `isDmOnlyCharacterFieldPath` predicate
 * from D4-cleanup-3.
 */
export const DIFF_PROPOSAL_INPUT_KINDS: ReadonlySet<string> = new Set([
  'chat',
  'dice-roll',
  'scene-reveal',
  'scene-reveal-paragraph',
  'pc-edit',
  'pc-create',
  'pc-retire',
  'pc-archive',
  'focus-grant',
  'pc-mark-realization'
]);

/**
 * Convenience: combined player-visible + DM-only-field-stripped
 * filter for callers that don't want to wire the predicate
 * themselves.  Returns the events that should reach
 * `buildDiffProposalPrompt`.  Mirrors the exact filter
 * `generateSessionDigest` applies in `quire-app.ts`; D1-D wires
 * the host call through this helper so both AI surfaces share
 * the same source-of-truth filter.
 */
export function filterEventsForDiffProposal(
  events: ReadonlyArray<QuireEvent>
): QuireEvent[] {
  const out: QuireEvent[] = [];
  for (const e of events) {
    if (!DIFF_PROPOSAL_INPUT_KINDS.has(e.kind)) continue;
    if (e.kind === 'pc-edit') {
      const field = (e.payload as Record<string, unknown> | undefined)?.field;
      if (isDmOnlyCharacterFieldPath(field)) continue;
    }
    if (e.kind === 'pc-retire' || e.kind === 'pc-archive') {
      // Same A-1 structural scrub as the session-digest bundler.
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const { reason: _r, scene: _s, ...safe } = p;
      out.push({ ...e, payload: safe });
      continue;
    }
    out.push(e);
  }
  return out;
}
