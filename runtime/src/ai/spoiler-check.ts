/**
 * CC-20 (M4 char-creation): forbidden-token post-check for AI
 * output bound for players.  Second layer of the spoiler firewall;
 * paired with CC-18's type-level scope override and CC-24's DM
 * approval gate.
 *
 * The check is a pure-string scan with word-boundary case-insensitive
 * matching.  Returns the matched tokens (deduped) so the auto-retry
 * logic in the broker can name what was caught:
 *
 *   const hits = containsSpoilerTokens(backstory);
 *   if (hits.length) {
 *     // Single auto-retry with "do not use the following words: …"
 *     // appended to the user prompt.  If the retry still hits,
 *     // surface as a DM-side warning rather than blocking the
 *     // player.  See prompt-engineering recommendations in
 *     // runtime/design/m4-character-creation.md §AI synthesis.
 *   }
 *
 * Forbidden-token list is Underleaf-specific policy.  Per the
 * engine-vs-campaign-boundary doc V-6 is a HYBRID: the engine ships
 * the detection mechanism; the campaign declares the token list via
 * `campaign.json` rules.spoilerTokens[].  Today there's only Underleaf
 * so the default list is hardcoded; the helper accepts an override
 * argument so a future campaign-schema-driven caller can pass the
 * campaign-declared list once V-6 lands.
 *
 * TODO(campaign-policy): replace `DEFAULT_SPOILER_TOKENS` with a
 * required argument once campaigns can declare their own list via
 * `campaign.json`'s `rules.spoilerTokens[]` field.
 */

/**
 * Underleaf's spoiler tokens.  Each one, if spoken in a backstory
 * before the discovery-arc beat, gives away the magic system to a
 * player whose character does not yet know magic exists.
 *
 * Per prompt-engineering recommendations: "Quiet, magic, premonition,
 * fate, chosen" — the five most obvious giveaways from the worldbook.
 * "Magical" is intentionally excluded as a separate token because it
 * collides with mundane English ("a magical sunset"); the post-check
 * is meant to catch deliberate disclosure, not idiomatic usage.
 *
 * Word-boundary matching means "the Quiet" is caught but "quietly"
 * is not.  Case-insensitive so "quiet" / "Quiet" / "QUIET" all hit.
 */
export const DEFAULT_SPOILER_TOKENS: readonly string[] = [
  'Quiet',
  'magic',
  'premonition',
  'fate',
  'chosen'
];

/**
 * Escape a string for use in a RegExp literal — copy of the
 * standard `re-escape` recipe.  Necessary because the caller-
 * supplied tokens may contain regex metacharacters (parens,
 * brackets, etc.) and we want them treated as literals.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan `text` for any of `tokens` (default: Underleaf's list).
 * Returns the matched tokens in the order they appear, deduplicated
 * and normalized to lowercase.  Empty array means "clean — no
 * spoilers caught."
 *
 * Matching rules:
 *   - Case-insensitive (uppercase Quiet hits the lowercase 'quiet').
 *   - Word-boundary anchored (`\b` on both sides) so 'magic' in
 *     'magical' or 'magician' does NOT hit.  Authors can use
 *     idiomatic English freely; only the deliberate disclosure
 *     "the magic system" / "your fate" trips the check.
 *   - Hostile-token list (empty array) returns [] — the helper
 *     refuses to allocate an empty regex.
 *   - Hostile tokens with regex metacharacters are escaped, so
 *     a campaign-declared token like "the Network" passes through
 *     as a literal even if it contained '('.
 *
 * Returned tokens are lowercased + deduped so the caller can build
 * a clean "do not use the following words" retry message without
 * leaking which case happened to trigger.
 */
export function containsSpoilerTokens(
  text: string,
  tokens: readonly string[] = DEFAULT_SPOILER_TOKENS
): string[] {
  if (text.length === 0) return [];
  if (tokens.length === 0) return [];
  const pattern = tokens.map(escapeRegex).join('|');
  // Lookarounds instead of `\b` so multi-word tokens with embedded
  // punctuation (e.g., a future campaign-declared "the Network
  // (closed)") match cleanly.  `\b` requires word/non-word
  // transitions at both edges; lookarounds only require that the
  // adjacent character not be a word character, which is the
  // semantic we actually want: don't match inside another word,
  // but do match next to punctuation or end-of-string.
  const re = new RegExp(`(?<!\\w)(${pattern})(?!\\w)`, 'gi');
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lower = match[1].toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
    }
    // Defensive against zero-width matches (escapeRegex's tokens
    // shouldn't produce these, but if a future caller passes "" as
    // a token the regex would loop forever).
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}
