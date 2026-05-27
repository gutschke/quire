/**
 * D4 (2026-05-26): session-digest prompt assembly.
 *
 * Bundles the player-visible events since the last digest (or
 * session start) + structured state deltas (PCs hit Realization,
 * gained foci, took harm, etc.) into an AI prompt asking for a
 * one-page DM-facing recap.  The DM edits before saving.
 *
 * **Why this is NOT the silent-player-firewall anti-pattern**
 * (practice memo): the silent-grant text / release-moment text /
 * seat-memory rule says "DM-typed, never AI-suggested" because
 * those are intimate DM-narrative beats with one-shot stakes.
 * The session-digest is different — it's a long-form recap the
 * DM will edit anyway; AI scaffolding accelerates the DM without
 * substituting for them.  Same model as backstory synthesis
 * (CC-19+): AI drafts, DM gates.
 *
 * **Spoiler-safety:** the prompt bundle is built from PLAYER-
 * VISIBLE events only (chat, dice rolls, scene reveals,
 * player-visible pc-edits, focus-grants).  Scratch-notes +
 * accidental-grants + ai-prompt history are DM-only and stay
 * out of the input.  This means the DRAFT cannot accidentally
 * surface DM-only content even if the AI hallucinates.  Same
 * filterForViewer / serializeSessionForViewer firewall that
 * protects player autosaves applies to the digest input bundle.
 *
 * Pure string assembly + JSON schema construction — no
 * provider call; the host owns broker dispatch.
 */

import type { QuireEvent } from '../core/event-log';
import type { AiStructuredCallSchema } from './broker';

export interface SessionDigestPromptInput {
  /**
   * Player-visible events since the last session-digest (or
   * session start).  Caller is responsible for filtering — the
   * canonical filter is `filterForViewer(state, '<non-coord>')`
   * + a kind-allowlist for the recap-relevant kinds.
   */
  events: ReadonlyArray<QuireEvent>;
  /**
   * Brief campaign anchor — name + the loaded episode/scene if
   * any.  Helps the AI frame the recap in the right register.
   * Pure metadata; no DM-only content.
   */
  campaignContext: {
    name?: string;
    currentEpisode?: string;
    currentScene?: string;
  };
  /**
   * Optional DM-typed nudge — "focus on Mei's realization" or
   * "lean into the tense Hadrian moment."  DM-typed so the
   * `<untrusted_content>` wrapper applies (practice: ANY DM-
   * typed text reaching a prompt gets wrapped).
   */
  dmGuidance?: string;
  /**
   * D4-cleanup-2 (TTRPG-expert): the most-recent prior digest, if
   * any.  Anchors the new recap as a continuation rather than a
   * cold restart ("previously, on..." framing).  Same player-
   * visibility as the new digest will have.
   */
  priorDigestMarkdown?: string;
}

export const SESSION_DIGEST_SYSTEM_PROMPT = `You are a co-DM helping a TTRPG group remember last session by producing a campfire recap.

# Register
The setting is contemporary, mundane-surface — people have phones and jobs.  The recap should sound like a friend recounting the week over a beer, not a fantasy chronicler.  Prefer concrete specific nouns ("the bus stop", "her sister's kitchen") over evocative ones ("the threshold", "the hearth").  Past tense, three to five short paragraphs, 200-400 words.  Player-facing — this is what the table reads at the start of the next session.

# Inputs
You will receive:
- Campaign anchor (name + current episode/scene)
- (Optional) the most recent prior recap, as a "previously" anchor
- A timeline of player-visible events: chat lines, dice rolls (with stat + outcome), scene reveals, PC state changes (harm/stress/marks the players know about), focus grants, retirements
- Optional DM guidance

# Hard constraints
- Past tense.  No second-person address to a specific player.  No "you all walked into..." — narrate as the campfire recap.
- Honor every event you're given.  Don't invent new beats.
- If a dice roll changed an outcome, mention the change (not the number).
- If a PC took harm or stress, mention the moment in fiction, not the box number.
- If a focus was granted, describe it as a discovery, not a stat assignment.
- Do NOT explain mechanics ("they advanced", "they took 2 harm") — translate to fiction ("she came home limping").
- Do NOT reveal DM-only material (you are not given any; the bundle is pre-filtered).  If your draft contains anything spoiler-shaped, the DM will edit it out before saving.

# Magic-discovery arc (CRITICAL)
The campaign's magic system has a "discovery" arc: some PCs cast spells but do not yet know magic exists, and their successes resolve in-fiction as luck, coincidence, or good timing.  Until a PC has explicitly "realized" their magic (a one-way gate event you will see as \`pc-mark-realization\`), DO NOT:
- name the magical pattern across their actions
- imply a hidden cause when events resolved as luck/coincidence
- pattern-match across multiple pre-Realization PCs to suggest something supernatural is at work
Narrate pre-Realization events as the table experienced them: lucky breaks, near misses, strange timing.  After a PC's \`pc-mark-realization\`, you may name their magic plainly when describing their actions.

# Thread-debt
"Thread-debt" appears as a DM-narrated ladder of escalating cost, not a numbered state.  When the timeline shows thread-debt context, mirror DM phrasing about consequences ("the world's eye drifted toward her", "the room went quiet without anyone noticing why") rather than labels or rung numbers.

# Output format
Return JSON: { "markdown": "<the recap>" }`;

/**
 * Render the event timeline into compact prose lines the AI can
 * narrate over.  Each line names the kind + a short payload
 * summary; the AI translates to fiction.
 */
function renderEventTimeline(events: ReadonlyArray<QuireEvent>): string {
  if (events.length === 0) return '(no events recorded)';
  const lines: string[] = [];
  for (const e of events) {
    const t = new Date(e.ts).toISOString();
    lines.push(`- [${t}] ${e.kind}: ${summarizePayload(e)}`);
  }
  return lines.join('\n');
}

/**
 * Per-kind one-line payload summary.  Best-effort — falls back to
 * the kind name when the payload doesn't match a known shape.
 * Conservative on length to keep the prompt token budget tight.
 */
function summarizePayload(e: QuireEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'chat':
      return `(${e.peerId}) ${truncate(stringField(p, 'text'), 200)}`;
    case 'dice-roll':
      return `${e.peerId} rolled ${stringField(p, 'purpose') || '?'} → ${stringField(p, 'outcome') || '?'}`;
    case 'scene-reveal':
      return `revealed scene ${stringField(p, 'scene')}`;
    case 'scene-reveal-paragraph':
      return `revealed paragraph in ${stringField(p, 'scene')}`;
    case 'pc-edit':
      return `pc-edit ${stringField(p, 'pcId')}.${stringField(p, 'field')} = ${JSON.stringify(p.value)}`;
    case 'pc-create':
      return `new PC ${stringField(p, 'name')} (${stringField(p, 'pcId')})`;
    case 'pc-slot-bind':
      return `slot ${numField(p, 'slot')} → ${stringField(p, 'pcId')}`;
    case 'pc-retire':
      return `${stringField(p, 'pcId')} retired: ${truncate(stringField(p, 'inFictionReason'), 200)}`;
    case 'pc-archive':
      return `${stringField(p, 'pcId')} archived: ${truncate(stringField(p, 'inFictionReason'), 200)}`;
    case 'focus-grant': {
      const focus = (p.focus ?? {}) as Record<string, unknown>;
      const name = stringField(focus, 'name');
      const domain = stringField(focus, 'domain');
      return `${stringField(p, 'pcId')} gained focus "${name}"${domain ? ` (domain: ${domain})` : ''}`;
    }
    case 'bond-ratify': {
      // D5-C-fix #4: text is the player-visible bond text.  The
      // `dmNotes` sub-field is already stripped from this event
      // payload by `scrubEventForPlayer` before it reaches a
      // player save, but this code path reads the LOCAL log
      // which carries the full payload for the coord.  Per the
      // SESSION_DIGEST input contract (player-visible content
      // only), summarize only the player-facing fields.
      return `bond ratified for ${stringField(p, 'pcId')} → "${truncate(stringField(p, 'text'), 200)}"`;
    }
    case 'bond-remove':
      return `bond removed for ${stringField(p, 'pcId')} (id ${stringField(p, 'id')})`;
    case 'pc-mark-realization':
      return `${stringField(p, 'pcId')} realized their magic (one-way gate)`;
    default:
      return e.kind;
  }
}

function stringField(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : '';
}

function numField(p: Record<string, unknown>, key: string): number | string {
  const v = p[key];
  return typeof v === 'number' ? v : '';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Wrap untrusted user-typed text in the standard sentinel.
 * Mirrors `src/ai/context.ts:wrapUntrusted` to avoid a circular
 * import (this file is a leaf in the ai/ tree).
 */
function wrapUntrusted(body: string, source: string): string {
  const safe = body.replace(/<\/untrusted_content>/g, '<!--UC_CLOSE-->');
  return `<untrusted_content source="${source}">\n${safe}\n</untrusted_content>`;
}

export function buildSessionDigestPrompt(
  input: SessionDigestPromptInput
): { system: string; user: string } {
  const parts: string[] = [];
  parts.push('# Campaign anchor');
  const cc = input.campaignContext;
  const ccLines: string[] = [];
  if (cc.name) ccLines.push(`- name: ${cc.name}`);
  if (cc.currentEpisode) ccLines.push(`- episode: ${cc.currentEpisode}`);
  if (cc.currentScene) ccLines.push(`- scene: ${cc.currentScene}`);
  parts.push(ccLines.length > 0 ? ccLines.join('\n') : '(unknown)');
  parts.push('');
  if (input.priorDigestMarkdown && input.priorDigestMarkdown.trim().length > 0) {
    parts.push('');
    parts.push('# Previously (most-recent prior recap)');
    parts.push(input.priorDigestMarkdown.trim());
  }
  parts.push('');
  parts.push('# Event timeline (player-visible, chronological)');
  parts.push(renderEventTimeline(input.events));
  if (input.dmGuidance && input.dmGuidance.trim().length > 0) {
    parts.push('');
    parts.push(
      `# DM guidance (focus the recap):\n${wrapUntrusted(
        input.dmGuidance.trim(),
        'dm-digest-guidance'
      )}`
    );
  }
  parts.push('');
  parts.push(
    '# Your task\nWrite the campfire recap as the JSON object specified.  Past tense, 200-400 words, 3-5 short paragraphs.  Translate mechanics to fiction.  Honor every event.  Nothing else in the output — just the JSON.'
  );
  return {
    system: SESSION_DIGEST_SYSTEM_PROMPT,
    user: parts.join('\n')
  };
}

/**
 * JSON schema for constrained decoding.  Single-field object so
 * the AI can return markdown directly without prose-extraction.
 * Mirrors the pattern PC backstory synthesis uses.
 */
export const SESSION_DIGEST_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    markdown: {
      type: 'string',
      minLength: 50,
      maxLength: 8000,
      description:
        'The campfire recap.  Past tense, 200-400 words, 3-5 short paragraphs.  Player-facing.'
    }
  },
  required: ['markdown'],
  additionalProperties: false
} as const;

export const SESSION_DIGEST_CALL_SCHEMA: AiStructuredCallSchema = {
  name: 'emit_session_digest',
  schema: SESSION_DIGEST_RESPONSE_SCHEMA as unknown as Record<string, unknown>
};

/**
 * Kind allowlist for the digest input bundle.  Caller filters
 * the event log down to ONLY these kinds before passing to
 * `buildSessionDigestPrompt`.  Anything not on this list is
 * either too noisy (peer-join/leave) or DM-only (scratch-note,
 * ai-prompt, accidental-grant-log) and stays out.
 *
 * Pre-filter intent: even though the player-visible-events list
 * is large, the digest only narrates the things a player remembers
 * across sessions.  Chat moments, dice swings, reveals, lifecycle.
 * Not slot binds or coord transitions.
 */
export const SESSION_DIGEST_INPUT_KINDS: ReadonlySet<string> = new Set([
  'chat',
  'dice-roll',
  'scene-reveal',
  'scene-reveal-paragraph',
  'pc-edit',
  'pc-create',
  'pc-retire',
  'pc-archive',
  'focus-grant',
  'pc-mark-realization',
  // D5-C-fix #4 (2026-05-27 D5-13 lock-fulfillment): bond-ratify
  // is the moment a relationship becomes table-canon.  Feeding
  // it to the digest lets the recap narrate ("Mei and Iris,
  // classmates, fell out over X this session").  dmNotes is
  // already stripped by PER_KIND_SCRUBBERS in persistence.ts +
  // by filterForViewer's per-entry strip — the digest input is
  // doubly-safe.
  'bond-ratify',
  // D5-cleanup-2 (2026-05-27 scenario TTRPG-D.4): dissolution is
  // also table-canon.  The recap should narrate when a bond was
  // ended, not just when it formed.  bond-remove payload is
  // `{v, id, pcId}` — no DM-only sub-fields — so feeding it is
  // safe by construction.
  'bond-remove'
  // D4-cleanup-2 (TTRPG): `seat-memory-edit` removed — seat-memory
  // is the DM's intimate per-seat note layer (silent-player-firewall
  // domain).  Feeding it into a player-facing recap risks both
  // spoiler leakage and stepping on DM voice.  Lives in the same
  // "DM-typed, never AI-fed" cluster as silent-grant / release-
  // moment text.
]);
