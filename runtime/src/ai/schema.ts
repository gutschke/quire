/**
 * AI response schema (M3b.1, P2-6).
 *
 * The AiBroker contract: both Anthropic and Gemini provider impls
 * return the same `AiResponse` shape — `{safe, dmOnly, sources, …}`
 * — regardless of underlying tool/schema mechanism.  The dual-card
 * renderer in `<dm-aside>` (M3b.5, P2-12) consumes this directly:
 * `safe` is read aloud to the table, `dmOnly` stays private.
 *
 * Parse failures degrade gracefully (the broker synthesizes a
 * `{safe: '', dmOnly: '(AI response was not in the expected format…)' }`
 * rather than throwing) — see `parseFailureResponse` below.
 */

export interface SourceRef {
  /** Display label — usually the file's slug or document title. */
  label: string;
  /** Campaign-relative path; passes the same validator as contextRefs. */
  path?: string;
}

/**
 * M3c.2: discriminated union of state-write proposals the AI may
 * include alongside its prose response.  The DM accepts (apply-all
 * or per-entry) before any event lands in the log; hard-gated
 * entries (harm 3-4, stress 4, ladder→Hunted, tax activation/release,
 * double-1, cross-PC pc-edit) require explicit individual click.
 *
 * Subset rationale:
 * - `pc-edit` is intentionally narrower than the manual one (harm
 *   / stress only).  Other field types (arbitrary stat / skill
 *   changes) belong to the DM-direct path; the AI doesn't propose
 *   them via stateUpdates.
 * - `dice-roll` carries `purpose` (what the roll resolves) +
 *   `expression` + `modifierBreakdown` (the math, shown to the DM
 *   in the one-liner) so the DM can verify before applying.
 * - `caster-state-set` mirrors the materializer payload at
 *   `core/state.ts`'s CasterStateSetPayload — see that file for
 *   the field validators.
 */
export type StateUpdate =
  | {
      kind: 'pc-edit';
      pcId: string;
      field: 'harm' | 'stress';
      delta: number;
      reason?: string;
    }
  | {
      kind: 'dice-roll';
      purpose: string;
      expression: string;
      modifierBreakdown?: string;
    }
  | {
      kind: 'caster-state-set';
      pcId: string;
      ladderState:
        | 'clear'
        | 'quiet'
        | 'noticed'
        | 'watched'
        | 'pushing-back'
        | 'hunted';
      reason?: string;
      taxActive?: boolean;
      spamCount?: number;
    };

export interface AiResponse {
  /**
   * The portion of the response the DM may freely read aloud.
   * NEVER contains DM-only material — both providers' tool/schema
   * shape encodes the separation, and parse failures default safe
   * to the empty string rather than guessing.
   */
  safe: string;
  /**
   * DM-only narrative / mechanics / spoilers.  Rendered in the
   * amber-rail card with the "copy (do not read aloud)" affordance.
   * MUST NOT leak into the player Stage / Aside under any code
   * path (see e2e/ai-content-safety.spec.ts at M3b.7 gate).
   */
  dmOnly: string;
  /** Citations into the campaign repo — null when none are returned. */
  sources: SourceRef[];
  /**
   * M3c: structured state writes the AI proposes.  Defaults to []
   * for backward compat — old providers / parse failures don't
   * inject any writes.  See StateUpdate above.
   */
  stateUpdates: StateUpdate[];
  /** Raw provider text (or JSON) for the audit chain. */
  raw: string;
  /** Tokens consumed by the prompt half of this exchange. */
  tokensIn: number;
  /** Tokens consumed by the completion half of this exchange. */
  tokensOut: number;
  /** Stable provider-side id, used for `ai-accept` / `ai-reject` events. */
  responseId: string;
}

/**
 * Type guard: does `value` shape-match the AiResponse interface
 * tightly enough that the dual-card renderer can consume it
 * without further defensive coding?  Used by the broker to decide
 * between "structured success" and "parse failure → fallback."
 */
export function isAiResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.safe !== 'string') return false;
  if (typeof r.dmOnly !== 'string') return false;
  if (!Array.isArray(r.sources)) return false;
  if (!r.sources.every(isSourceRef)) return false;
  // M3c.2: stateUpdates is optional (back-compat); when present
  // must be an array of valid entries.  The broker fills `[]`
  // before validation when the provider omitted it.
  if (r.stateUpdates !== undefined) {
    if (!Array.isArray(r.stateUpdates)) return false;
    if (!r.stateUpdates.every(isStateUpdate)) return false;
  }
  // raw / tokens / id are broker-filled; tolerate absence here so a
  // pre-normalization provider parse can still satisfy the shape.
  return true;
}

/**
 * Type guard for a single StateUpdate entry.  Rejects unknown
 * `kind`, missing required fields, wrong-type fields, and the
 * known footguns (empty-string ladderState, non-finite delta).
 */
export function isStateUpdate(value: unknown): value is StateUpdate {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  switch (u.kind) {
    case 'pc-edit':
      if (typeof u.pcId !== 'string' || u.pcId.length === 0) return false;
      if (u.field !== 'harm' && u.field !== 'stress') return false;
      if (typeof u.delta !== 'number' || !Number.isFinite(u.delta)) return false;
      if (!Number.isInteger(u.delta)) return false;
      if (u.reason !== undefined && typeof u.reason !== 'string') return false;
      return true;
    case 'dice-roll':
      if (typeof u.purpose !== 'string' || u.purpose.length === 0) return false;
      if (typeof u.expression !== 'string' || u.expression.length === 0)
        return false;
      if (
        u.modifierBreakdown !== undefined &&
        typeof u.modifierBreakdown !== 'string'
      ) {
        return false;
      }
      return true;
    case 'caster-state-set':
      if (typeof u.pcId !== 'string' || u.pcId.length === 0) return false;
      if (
        u.ladderState !== 'clear' &&
        u.ladderState !== 'quiet' &&
        u.ladderState !== 'noticed' &&
        u.ladderState !== 'watched' &&
        u.ladderState !== 'pushing-back' &&
        u.ladderState !== 'hunted'
      ) {
        return false;
      }
      if (u.reason !== undefined && typeof u.reason !== 'string') return false;
      if (u.taxActive !== undefined && typeof u.taxActive !== 'boolean')
        return false;
      if (u.spamCount !== undefined) {
        if (typeof u.spamCount !== 'number') return false;
        if (!Number.isFinite(u.spamCount)) return false;
        if (!Number.isInteger(u.spamCount)) return false;
        if (u.spamCount < 0) return false;
      }
      return true;
    default:
      return false;
  }
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (typeof s.label !== 'string') return false;
  if (s.path !== undefined && typeof s.path !== 'string') return false;
  return true;
}

/**
 * The fallback response synthesized when a provider's reply cannot
 * be parsed into the AiResponse shape.  Documented in the design
 * (`redesign-plan.md` L137, L154) and load-bearing: by surfacing
 * the parse failure in the DM-only card we don't accidentally
 * stage hallucinated content in the safe card.
 *
 * `responseId` defaults to an empty string; the broker fills it
 * with a generated id so accept/reject events can still reference
 * the degraded response.
 */
/**
 * CC-17 (M4 char-creation): structured response shape for the AI
 * backstory-synthesis call.  Distinct from `AiResponse` because the
 * synthesis output is *the player's PC*, not a safe/dmOnly dual-card
 * play exchange — there is no DM-private half.  Synthesized once at
 * session 1 from the player's MC + short-answer questionnaire
 * responses (see runtime/design/m4-character-creation.md §AI synthesis).
 *
 * Field rationale (per prompt-engineering expert recommendation):
 * - `name` MUST differ from the player's display name; the broker
 *   validator at CC-21 cross-checks against the inviting peer's
 *   display name.
 * - `tags` array bounded at 3-5 entries.  Below 3 makes the PC
 *   feel undefined; above 5 is over-determination.
 * - `backstory` bounded at 250-400 words (approx).  Below 250 is
 *   too thin to anchor coincidence-seeding; above 400 the AI
 *   tends to invent campaign-canon-contradicting detail.  Exact
 *   range enforcement lives in CC-21 (structural validator), not
 *   in the type guard — the guard only checks non-empty.
 * - `pronouns` is a free-form short string; no allowlist (would
 *   exclude players who use non-canonical pronouns).
 * - `stats` carries the quire-v0.1 fixed starting array (one +2,
 *   three +1s, two 0s; see `underleaf/world/rules.md` §Stats).
 *   Added P3T-2 — without this, synthesized PCs aren't sheet-ready
 *   and the DM does the distribution by hand at the table.
 * - `skillMastery` carries the player's chosen quire-v0.1 skill
 *   categories (subset of the 8-category list).  Added P3T-2 — same
 *   sheet-ready rationale.  Open free-text "tags" remain separate.
 *
 * Forbidden-token enforcement (Quiet / magic / premonition / fate /
 * chosen — see [[project-quire-ai-player-facing-scope]]) runs on
 * `backstory` AFTER parsing; it's not encoded in the type.
 */
export interface PcBackstorySynthesisResponse {
  /**
   * Plausible character name.  MUST NOT match the player's display
   * name (post-parse check; not enforced by the type guard).
   */
  name: string;
  /** Pronoun set — free-form short string. */
  pronouns: string;
  /**
   * 3-5 concrete, fiction-relevant tags.  Bounded by the type guard
   * to a non-empty array of strings; the [3..5] range is enforced
   * by the structural validator at CC-21.
   */
  tags: string[];
  /**
   * P3T-2: quire-v0.1 starting stat array.  Six keys exactly:
   * STR/DEX/CON/INT/WIS/CHA.  Distribution per rules.md §Stats —
   * one +2, three +1s, two 0s.  Validator enforces the shape so an
   * AI that ignores the constraint is auto-retried.
   */
  stats: PcStats;
  /**
   * P3T-2: quire-v0.1 starting skill mastery.  Subset of the 8-category
   * list.  Today's archetype-based picks land 2-3 categories at +1.
   * Validator enforces the subset constraint + the count range.
   */
  skillMastery: string[];
  /**
   * Markdown body, ~250-400 words, 3-4 paragraphs.  Tone-anchored
   * to "ordinary people in the present-day Bay Area" (Underleaf
   * default; campaign opt-out via the rules-schema tone field in
   * a future hybrid landing).  Forbidden tokens scrubbed post-
   * parse per [[project-quire-ai-player-facing-scope]].
   */
  backstory: string;
  /**
   * Phase B P2 (2026-05-26): languages the PC speaks fluently.
   * AI generates at chargen by inferring from the player's
   * heritage / family / where-they-grew-up answers.  Default
   * `['English']`; the AI may add ONE inherited language when the
   * player's text explicitly names it or names a place where it
   * would be obvious (TTRPG-craft guardrail per the P2 review:
   * don't assume mom-from-Taiwan means the PC speaks Mandarin —
   * the PC might be third-gen English-only).
   *
   * Optional in the schema so existing parse paths keep working;
   * `applyPcCreateEvent` validates the shape if present and falls
   * back to defaults if omitted.
   */
  languages?: string[];
  /**
   * Phase B P2 (2026-05-26): fictional wealth tier (broke / tight /
   * comfortable / well-off / wealthy — see rules.md).  AI infers
   * from job / housing / life-circumstance answers; default
   * `tight` per the TTRPG-craft conservative-bias guardrail
   * (under-shoot wealth rather than overshoot — the Underleaf
   * frame prizes precarity texture).  `well-off` / `wealthy` MUST
   * NOT be inferred from a "good job" answer alone; require
   * explicit player signal.
   *
   * Optional in the schema; `applyPcCreateEvent` validates the
   * enum if present.  Foci / conditions / DM-only fields stay
   * out of this schema entirely — see P2 review verdicts.
   */
  moneyBand?:
    | 'broke'
    | 'tight'
    | 'comfortable'
    | 'well-off'
    | 'wealthy';
  /** Raw provider text/JSON for the audit chain. */
  raw: string;
  /** Tokens consumed by the prompt half of this exchange. */
  tokensIn: number;
  /** Tokens consumed by the completion half of this exchange. */
  tokensOut: number;
  /**
   * Stable provider-side id for the DM approval gate (CC-24).
   * When the broker can't parse a structured response, a synthesized
   * fingerprint id keeps the gate buttons working — same shape as
   * the existing parseFailureResponse pattern.
   */
  responseId: string;
}

/**
 * P3T-2: quire-v0.1 stat array shape.  Keys + range hardcoded
 * because they're the engine ruleset (locked decision V-4 — campaign-
 * declared stat keys wait until a second campaign exists with a
 * different stat list).  Range -2..+3 per rules.md §Stats.
 */
export interface PcStats {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

/**
 * P3T-2: the 8 quire-v0.1 skill categories.  See rules.md §Skills.
 * Engine-default canonical list; campaigns inherit unless they
 * declare an override (V-2 — same locked-deferred posture as V-4).
 */
export const QUIRE_SKILL_CATEGORIES = [
  'Action',
  'Subterfuge',
  'Knowledge',
  'Insight',
  'Influence',
  'Tech',
  'Craft',
  'Medic'
] as const;
export type QuireSkillCategory = (typeof QUIRE_SKILL_CATEGORIES)[number];

/**
 * Type guard for the stat shape.  Exported for the validator + tests.
 */
export function isPcStats(value: unknown): value is PcStats {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
    const v = s[k];
    if (typeof v !== 'number') return false;
    if (!Number.isFinite(v) || !Number.isInteger(v)) return false;
  }
  return true;
}

/**
 * Type guard for a backstory-synthesis response.  Tight enough that
 * downstream rendering code can consume the result without further
 * defensive coding, loose enough that out-of-band field additions
 * by a future provider don't break the parse.
 */
export function isPcBackstorySynthesisResponse(
  value: unknown
): value is PcBackstorySynthesisResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return false;
  if (typeof r.pronouns !== 'string') return false;
  if (typeof r.backstory !== 'string' || r.backstory.length === 0) return false;
  if (!Array.isArray(r.tags)) return false;
  if (r.tags.length === 0) return false;
  if (!r.tags.every((t) => typeof t === 'string' && t.length > 0)) return false;
  // P3T-2: stats + skillMastery are required for sheet-ready PCs.
  if (!isPcStats(r.stats)) return false;
  if (!Array.isArray(r.skillMastery)) return false;
  if (!r.skillMastery.every((s) => typeof s === 'string' && s.length > 0))
    return false;
  // Phase B P2 (2026-05-26): languages + moneyBand are optional —
  // older AI providers / pre-extension callers may omit them.  When
  // present, validate the shape so downstream renderers can rely on
  // the type assertion.  When absent, the materializer fills
  // defaults (`['English']` / `'tight'`).
  if (r.languages !== undefined) {
    if (!Array.isArray(r.languages)) return false;
    if (!r.languages.every((l) => typeof l === 'string' && l.length > 0)) {
      return false;
    }
  }
  if (r.moneyBand !== undefined) {
    if (typeof r.moneyBand !== 'string') return false;
    if (
      r.moneyBand !== 'broke' &&
      r.moneyBand !== 'tight' &&
      r.moneyBand !== 'comfortable' &&
      r.moneyBand !== 'well-off' &&
      r.moneyBand !== 'wealthy'
    ) {
      return false;
    }
  }
  // raw / tokens / responseId are broker-filled; tolerate absence here
  // so a pre-normalization provider parse can still satisfy the shape.
  return true;
}

export function parseFailureResponse(rawText: string): AiResponse {
  // responseId synthesized from a content-hash-ish fingerprint so the
  // DM can still hit Accept / Reject on a degraded response (the UI
  // verdict buttons gate on responseId being truthy).  Not
  // cryptographically meaningful — just unique enough that two
  // parse failures in the same session land as distinct rows.
  const fingerprint = `parse-fail-${rawText.length}-${rawText.slice(0, 8).replace(/[^A-Za-z0-9]/g, '')}`;
  return {
    safe: '',
    dmOnly:
      '(AI response was not in the expected format; raw text saved to audit log.)',
    sources: [],
    stateUpdates: [],
    raw: rawText,
    tokensIn: 0,
    tokensOut: 0,
    responseId: fingerprint
  };
}
