/**
 * CC-19 (M4 char-creation): assemble the AI synthesis prompt for
 * backstory generation.  Pure string-building — no network, no
 * Date.now, no random.  The broker glue (lands later) wraps this
 * with `cache_control` for the 1h prompt cache (CC-22) before
 * making the actual provider call.
 *
 * Output of `buildBackstorySynthesisPrompt` is `{system, user}` —
 * two strings the caller passes to whatever provider (Anthropic or
 * Gemini) is configured.  Both providers accept a system+user pair
 * already; existing broker code reuses the same shape.
 *
 * Engine-vs-campaign positioning (V-7 alias of CC-19):
 * - The system prompt template is CAMPAIGN POLICY today; hardcoded
 *   for Underleaf with `// TODO(campaign-policy)` comments.  When
 *   V-7 lands as a hybrid, the campaign manifest will declare
 *   `aiBackstory.systemPromptOverride` and `aiBackstory.toneAnchors`;
 *   the engine reads them.
 * - The user-prompt assembler (`assembleUserPrompt`) is ENGINE —
 *   it's a mechanical template: campaign context + DM constraints
 *   + player answers + task line.  The CONTENT in each section is
 *   campaign / DM / player data.
 *
 * Threat-model alignment:
 * - The campaign-context block passed to `assembleUserPrompt` MUST
 *   come from `buildPlayerFacingContext` (CC-18), NOT
 *   `buildCampaignContext`.  Type signature can't enforce this; the
 *   broker glue caller is responsible.
 * - Player answers are wrapped in `untrusted_content` sentinels via
 *   the existing `wrapUntrusted` helper (passed in as the wrapper).
 */

import type { CampaignCharCreationQuestion } from '../campaign-loader';
import type { ContextFile } from './campaign-context';
import { wrapCampaignContext } from './campaign-context';
import { wrapUntrusted } from './context';

/**
 * The Underleaf-tuned system prompt.  Pinned at this layer until
 * V-7 hybrid lands (campaign-declared override).  Captures the
 * prompt-engineering expert's recommendation:
 *   - Negative-tone list (the 'Avoid:' line).
 *   - Hard constraints (intent-against-pressure, Bay Area, no
 *     magic/Quiet/fate/etc., name uniqueness).
 *   - Output format (JSON shape matching PcBackstorySynthesisResponse).
 *   - "Do not invent a dark secret" line per the prompt-engineer's
 *     §6 failure-modes list.
 *
 * TODO(campaign-policy): move to `campaign.json` under
 * `aiBackstory.systemPromptOverride` once V-7 hybrid is wired.
 * Engine default falls back to this constant when the campaign
 * doesn't declare its own.
 */
export const UNDERLEAF_BACKSTORY_SYSTEM_PROMPT = `You are a co-author helping a player draft an opening backstory for a character in Underleaf, a contemporary-feeling tabletop story game.

# Tone (load-bearing)
Underleaf is about ordinary people in the present-day Bay Area who will, over many sessions, slowly notice that the world is stranger than it seems. At character creation the PC does NOT know this. Write their backstory as if you, too, do not know it. No prophecy, no chosen-one framing, no foreshadowing of magic, no "they always felt different." The reader should close the backstory thinking "this is a real person living a real life" — not "this is a hero in waiting."

Avoid: high-fantasy register, grimdark, melodrama, trauma-as-origin, mystical hints, second-person address, present-tense vignette prose, "main character" framing, early-life foreshadowing, self-conscious narration of the PC's specialness, synonyms for magic (the Hush, the Stillness, the Veil, thaumaturgy, sorcery, prophecy, destiny, foreseen).
Prefer: specific nouns, concrete places, named small objects, the texture of an ordinary week. Sentences of varied length. One vivid sensory detail per paragraph at most.

# Content constraints
- The backstory MUST answer, even obliquely, "what in their life taught them to hold an intention against pressure?" This is the mandatory question from the rules.
- The backstory MUST be set in or anchored to a real Bay Area place.
- The backstory MUST NOT reference magic, The Quiet, retrocausality, premonition, fate, "being chosen," or any cosmological hint. The player will discover those in play.
- The PC's name MUST differ from the player's name.
- Do not invent a "dark secret" the player did not ask for. Leave at least one relationship vague (e.g. "a sibling you don't talk to anymore") rather than fully specifying every named relation.
- The "tags" field is for open free-text expertise (e.g. "ICU nurse", "competition climber", "fluent in Mandarin"). The "skillMastery" field is the closed-list mechanical mapping. Do not conflate them.
- For stats, distribute the fixed starting array: one stat at +2, three stats at +1, two stats at 0. Respect the player's "where the +2 lives" answer if they gave one; otherwise pick the +2 to match the archetype + temperament.
- For skillMastery, respect the player's "top skill category" answer if they gave one; then add 1-2 more that fit the archetype.
- Target 250-400 words for the backstory, in 3-4 short paragraphs.

# Languages (Phase B P2 — additive)
- The default is ["English"].  Add at most ONE inherited language when the player's answers explicitly name a heritage country, a family language, or a place where another language is the obvious one (e.g. an answer mentioning "growing up speaking Mandarin at home").
- DO NOT assume a heritage implies fluency — mom-from-Taiwan does not automatically mean the PC speaks Mandarin.  When the player gave no explicit signal, omit the field (the engine defaults to ["English"]).
- Use plain English language names ("Mandarin", "Spanish", "Tagalog"), not dialect labels or constructed-language names.

# Money band (Phase B P2 — additive)
- Pick one of: broke / tight / comfortable / well-off / wealthy.
- Default expectation is "tight" (fresh Underleaf PCs are usually ordinary-precarious).  Use "comfortable" only when the player's answers paint stable employment AND ownership / savings.  Use "well-off" or "wealthy" ONLY when the player's text explicitly signals affluence — never as inference from "good job" alone.  Use "broke" when the player's text describes precarity, debt, or housing instability.
- Money band is fictional texture, NOT a numeric ledger.  Do not write "Maya has $32,000".
`;

/**
 * One question + answer pair, formatted for inclusion in the user
 * prompt.  `aiRole` modulates how the answer is presented to the AI:
 *   - 'voice-sample' → answer quoted in triple-quoted block so the
 *     AI knows to paraphrase tightly rather than reinterpret.
 *   - 'grounder' → answer presented as "use this exact detail".
 *   - 'skeleton' (default) → answer presented as a fact.
 */
export interface AnsweredQuestion {
  question: CampaignCharCreationQuestion;
  answer: string;
}

export interface SynthesisPromptInput {
  /**
   * Player-facing context (CC-18 `buildPlayerFacingContext` output).
   * The campaign-policy MUST be `'public'`; the caller is
   * responsible (no type-system enforcement at this layer).
   */
  campaignContext: ContextFile[];
  /**
   * DM-authored per-player constraints (free text).  E.g.,
   * "must have a connection to Taipei", "play an Engineer or
   * Hacker", etc.  Empty string when the DM has no special
   * direction for this slot.
   */
  dmConstraints: string;
  /** The player's display name — passed to the AI as a NEGATIVE constraint (don't reuse). */
  playerDisplayName: string;
  /**
   * The player's answers to the campaign questionnaire, paired
   * with the question that produced them.  Order matters — the
   * AI reads top-to-bottom; the campaign-declared order (per
   * `CampaignCharCreationQuestion[]`) is the canonical sequence.
   */
  answers: AnsweredQuestion[];
  /**
   * Wave 3b (2026-05-25): optional re-sync context.  When present,
   * the synthesizer is being asked to regenerate the backstory
   * after the DM has edited the originally-synthesized PC fields.
   * The AI must use the locked-in field values verbatim + honor
   * the previous draft's voice + still respect the player's answers.
   */
  resync?: ResyncContext;
}

/**
 * Wave 3b (2026-05-25): re-sync request body.  The DM has edited
 * one or more synth-result fields and wants the AI to regenerate
 * the backstory consistent with the edits + previous draft.
 */
export interface ResyncContext {
  /** Edited field values — these MUST land in the output verbatim. */
  lockedFields: {
    name: string;
    pronouns: string;
    tags: readonly string[];
    skillMastery: readonly string[];
    stats: {
      STR: number;
      DEX: number;
      CON: number;
      INT: number;
      WIS: number;
      CHA: number;
    };
    /**
     * Phase B P2 (2026-05-26): languages + moneyBand are now part of
     * the locked-fields contract.  If the DM edits the moneyBand or
     * tweaks the languages list pre-accept, a subsequent re-sync MUST
     * keep those values verbatim — otherwise the AI would silently
     * drop the DM's edits at re-sync time (TTRPG-craft P2 review
     * BLOCKER).
     */
    languages?: readonly string[];
    moneyBand?: 'broke' | 'tight' | 'comfortable' | 'well-off' | 'wealthy';
  };
  /** AI's previous backstory text — voice + structural anchor. */
  previousBackstory: string;
  /** Which fields the DM edited (drives prompt callouts so AI knows what to change). */
  editedFields: ReadonlyArray<
    | 'name'
    | 'pronouns'
    | 'tags'
    | 'skillMastery'
    | 'stats'
    | 'languages'
    | 'moneyBand'
  >;
}

/**
 * Build the user-side prompt for a backstory synthesis call.  Pure
 * string assembly; the broker glue wraps in API-specific envelopes.
 *
 * Sections (in order):
 *   1. Campaign canon — wrapped untrusted context.
 *   2. Player display name (as a negative constraint anchor).
 *   3. DM constraints (when non-empty).
 *   4. Player answers — MC answers as facts, short-answer answers
 *      quoted verbatim per the aiRole.
 *   5. Task line.
 */
export function assembleUserPrompt(input: SynthesisPromptInput): string {
  const parts: string[] = [];

  // 1. Campaign canon.
  if (input.campaignContext.length > 0) {
    parts.push('# Campaign canon (do not contradict)');
    parts.push(wrapCampaignContext(input.campaignContext));
  }

  // 2. Player display name as a hard NEGATIVE constraint.  The
  //    system prompt already says "name MUST differ from player";
  //    this is the binding for that rule.
  parts.push('# Player\'s display name (DO NOT REUSE for the PC name)');
  parts.push(
    wrapUntrusted(input.playerDisplayName || '(none provided)', 'player-name')
  );

  // 3. DM constraints (optional).
  if (input.dmConstraints && input.dmConstraints.trim().length > 0) {
    parts.push('# DM constraints for this player');
    parts.push(wrapUntrusted(input.dmConstraints, 'dm-constraints'));
  }

  // 4. Player answers, presented in declared order.
  parts.push("# Player's answers");
  for (const { question, answer } of input.answers) {
    parts.push(formatAnsweredQuestion(question, answer));
  }

  // 4b. Wave 3b re-sync block.  When the caller is re-syncing the
  //     backstory after DM edits, the AI gets the previous draft
  //     as anchor + the locked-in fields it MUST honor verbatim.
  if (input.resync) {
    parts.push(formatResyncBlock(input.resync));
  }

  // 5. Task line.  The "honor every answer" instruction is the
  //    backstop for the AI tendency to "reinterpret" inputs into
  //    a "better" story.
  parts.push('# Your task');
  if (input.resync) {
    parts.push(formatResyncTaskLine(input.resync));
  } else {
    parts.push(
      'Synthesize a backstory that honors EVERY player answer above.  ' +
        "Do not contradict any of them.  Where the player gave free text, " +
        'treat their exact words as canonical — quote or paraphrase, but ' +
        'never override.  Where the player gave a multiple-choice answer, ' +
        'you have latitude to interpret it but not to invert it.\n\n' +
        'Return the JSON object specified in the system prompt and nothing else.'
    );
  }

  return parts.join('\n\n');
}

/**
 * Wave 3b: render the re-sync block carrying the previous backstory
 * + locked-in fields.  Sits between the player answers and the
 * task line so the AI reads in order: who the PC was (answers),
 * what they ARE now (locked fields), what was already written
 * (previous draft), then what to do (task line).
 */
function formatResyncBlock(ctx: ResyncContext): string {
  const parts: string[] = [];
  parts.push('# Re-sync request');
  parts.push(
    'The DM has refined the PC since the original synth.  The fields ' +
      'below are LOCKED — your output MUST use them verbatim.  The ' +
      'previous backstory below is the voice + structural anchor; ' +
      'preserve its tone, register, and any factual detail that ' +
      'remains consistent with the locked-in fields.  Where the ' +
      'previous draft contradicts a locked-in field, rewrite that ' +
      'sentence (or paragraph) so it matches the new value.'
  );
  parts.push('## Locked-in fields (echo verbatim in JSON)');
  parts.push(`- **name**: ${ctx.lockedFields.name}`);
  parts.push(`- **pronouns**: ${ctx.lockedFields.pronouns}`);
  parts.push(`- **tags**: ${JSON.stringify(ctx.lockedFields.tags)}`);
  parts.push(`- **skillMastery**: ${JSON.stringify(ctx.lockedFields.skillMastery)}`);
  parts.push(`- **stats**: ${JSON.stringify(ctx.lockedFields.stats)}`);
  if (ctx.lockedFields.languages !== undefined) {
    parts.push(
      `- **languages**: ${JSON.stringify(ctx.lockedFields.languages)}`
    );
  }
  if (ctx.lockedFields.moneyBand !== undefined) {
    parts.push(`- **moneyBand**: ${ctx.lockedFields.moneyBand}`);
    // Phase B P2 verification fix (S5): the system prompt's
    // "Default expectation is 'tight'" guidance applies to FRESH
    // synthesis, not re-sync.  An explicit DM-locked value beats
    // the default-bias.  Spell that out so the AI doesn't
    // soft-override 'comfortable' or 'wealthy' back to 'tight'
    // citing precarity texture.
    parts.push(
      '  (The "Default expectation is tight" guidance from the system prompt is overridden by the locked-in moneyBand above — emit it verbatim regardless of the answers.)'
    );
  }
  if (ctx.editedFields.length > 0) {
    parts.push(
      '## DM edited:  ' +
        ctx.editedFields.join(', ') +
        '.  Pay special attention to making the backstory consistent with these.'
    );
  }
  parts.push('## Previous backstory (voice + anchor — rewrite, do not copy verbatim)');
  parts.push(wrapUntrusted(ctx.previousBackstory, 'previous-backstory'));
  return parts.join('\n\n');
}

/**
 * Wave 3b: re-sync task line — different emphasis from a fresh
 * synthesis.  The AI is told it's iterating on existing content,
 * not generating from scratch.
 */
function formatResyncTaskLine(ctx: ResyncContext): string {
  return (
    'Re-synthesize the backstory.  Use the locked-in fields above ' +
    'EXACTLY (no substitutions, no creative renaming).  Honor the ' +
    'player answers as canonical.  Preserve voice + register from ' +
    'the previous draft, but rewrite any sentence that contradicts ' +
    'the locked-in fields' +
    (ctx.editedFields.length > 0
      ? ` (especially around the edited ${ctx.editedFields.join(' / ')})`
      : '') +
    '.\n\n' +
    'Return the JSON object specified in the system prompt and ' +
    'nothing else.  The JSON\'s name/pronouns/tags/skillMastery/stats' +
    '/languages/moneyBand fields MUST match any locked-in values ' +
    'verbatim (fields omitted from the locked-in block above are ' +
    'free for you to refine).'
  );
}

/**
 * Format a single Q+A pair for the user prompt.  MC answers are
 * presented as facts; short-answer answers are wrapped in the
 * canonical `<untrusted_content>` sentinel via `wrapUntrusted` so
 * a player who types `"""` (or any other markdown / quote token)
 * inside their answer can't break out and inject author-level
 * instructions to the model.
 *
 * **Security history (F-PI1 — Phase 2 adversarial review,
 * 2026-05-22):** an earlier version of this function wrapped
 * short-answer text in triple-quotes (`"""\n...\n"""`).  A player
 * who included `"""` literally in their answer could close the
 * fence, inject "# Author override" instructions, and re-open the
 * fence — directly defeating CC-20's spoiler firewall because the
 * AI's compliance with the player's instructions trumps the
 * "do not use these tokens" guard.  `wrapUntrusted` (defined in
 * `context.ts`) carries the load-bearing wrapper-safety contract:
 * any `</untrusted_content>` substring in the wrapped body is
 * escaped to `<!--UC_CLOSE-->`.  See memory
 * `project-quire-ai-player-facing-scope`.
 */
function formatAnsweredQuestion(
  question: CampaignCharCreationQuestion,
  answer: string
): string {
  // Lookup the MC option's label for friendlier prompt text.
  let displayAnswer = answer;
  if (question.kind === 'mc') {
    const option = (question.options ?? []).find((o) => o.value === answer);
    if (option) {
      displayAnswer = option.label;
    }
  }

  const labelLine = `**${question.prompt}**`;

  // P3T-5: honor aiRole per-question.  The hint guides the AI's
  // weight on the answer:
  //   - voice-sample (player's prose): preserve their wording.
  //   - grounder (a small concrete detail): incorporate verbatim.
  //   - skeleton (categorical closed-form): treat as a hard fact
  //     to build the backstory around.
  // Default is skeleton when the campaign doesn't declare aiRole.
  const role = question.aiRole ?? 'skeleton';
  const roleHint = aiRoleHint(role);

  if (question.kind === 'short-answer') {
    // Wrap the player's verbatim text in the wrapper-safety sentinel
    // so close-tag injection is escaped.  Source label includes the
    // question id so the model has provenance even if multiple
    // short-answers land back-to-back.
    return `${labelLine}\n${roleHint}\n\n${wrapUntrusted(
      answer,
      `player-answer-${question.id}`
    )}`;
  }

  // MC: present as a fact.
  return `${labelLine}\n${roleHint}\n\nAnswer: ${displayAnswer}`;
}

/**
 * P3T-5: human-friendly one-liner that tells the AI how to use the
 * answer below.  Kept short so the prompt doesn't bloat per
 * question — the prompt-engineering recommendation is "one line
 * per answer is enough; more bloats the prompt without helping."
 */
function aiRoleHint(
  role: 'skeleton' | 'voice-sample' | 'grounder'
): string {
  switch (role) {
    case 'voice-sample':
      return '_(Use as a VOICE SAMPLE — preserve the player\'s wording; paraphrase tightly, do not reinterpret.)_';
    case 'grounder':
      return '_(Use as a GROUNDER — work this exact concrete detail into the backstory verbatim.)_';
    case 'skeleton':
    default:
      return '_(Use as a SKELETON — closed-form fact; build the backstory consistent with it.)_';
  }
}

/**
 * Build both halves of the synthesis prompt — system + user.  The
 * system prompt is the Underleaf-tuned constant today; once V-7
 * lands, the campaign manifest's `aiBackstory.systemPromptOverride`
 * (or similar) flows through here.
 */
export function buildBackstorySynthesisPrompt(
  input: SynthesisPromptInput
): { system: string; user: string } {
  return {
    system: UNDERLEAF_BACKSTORY_SYSTEM_PROMPT,
    user: assembleUserPrompt(input)
  };
}
