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
 * **Adversarial review 2026-05-22 (F-S2):** the original 5-token
 * list ("Quiet, magic, premonition, fate, chosen") was trivially
 * defeated by an AI's natural synonym vocabulary — "the Hush", "the
 * Stillness", "thaumaturgy", "destiny", "the elect", etc.  This list
 * is broader after the review; the system prompt also explicitly
 * tells the AI not to use synonyms (CC-19 follow-up), so the regex
 * is the second-line catch, not the first.
 *
 * "Magical" / "magician" / "magically" are intentionally NOT in the
 * list — they collide with mundane English ("a magical sunset", "a
 * stage magician") and the word-boundary lookaround makes "magic"
 * NOT match those substrings.  The post-check is meant to catch
 * deliberate disclosure, not idiomatic usage.
 *
 * Word-boundary matching means "the Quiet" is caught but "quietly"
 * is not.  Case-insensitive so "quiet" / "Quiet" / "QUIET" all hit.
 *
 * **This list is CAMPAIGN POLICY (V-6 alias of CC-20).**  The default
 * is Underleaf-tuned; future campaigns declare their own via
 * `campaign.json` rules.spoilerTokens[] (`TODO(campaign-policy)`).
 * The synthesizer accepts `spoilerTokens?` per-call so the campaign
 * manifest can override.
 */
export const DEFAULT_SPOILER_TOKENS: readonly string[] = [
  // Core 5 (original v1).
  'Quiet',
  'magic',
  'premonition',
  'fate',
  'chosen',
  // F-S2 extensions — synonyms an AI naturally reaches for.
  'prophecy',
  'prophesied',
  'destiny',
  'destined',
  'foreseen',
  'foresight',
  'supernatural',
  'paranormal',
  'psychic',
  'thaumaturgy',
  'sorcery',
  'awakening',
  'awakened'
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
 * F-S6: format-control + zero-width character class used by
 * `sanitizeForSpoilerScan`.  Built via `new RegExp` from string
 * `\u` escapes because the included U+2028/U+2029 line separators
 * are NOT permitted in a source-file regex literal (they terminate
 * the regex token).  Same character set documented inline at the
 * sanitize call site.
 */
const FORMAT_CONTROL_RE = new RegExp(
  '[' +
    '\\u00AD' + // soft hyphen
    '\\u034F' + // combining grapheme joiner
    '\\u061C' + // Arabic letter mark
    '\\u17B4\\u17B5' + // Khmer inherent vowels
    '\\u180E' + // Mongolian vowel separator
    '\\u200B-\\u200F' + // ZWSP / ZWNJ / ZWJ / LRM / RLM
    '\\u2028-\\u202F' + // line / para / various bidi
    '\\u2060-\\u206F' + // word joiner + invisible separators
    '\\uFEFF' + // BOM / zero-width no-break space
    ']',
  'g'
);

/**
 * Sanitize input before spoiler-token regex matching.  Defends
 * against bypass variants discovered in the Phase 2/3 adversarial
 * reviews:
 *
 *   - **F-S3 (Phase 2)**: Unicode compatibility variants (full-width
 *     "ｍａｇｉｃ", bold-mathematical "𝐦𝐚𝐠𝐢𝐜", etc.) would slip past a
 *     literal regex.  NFKC normalization collapses compatibility
 *     variants to ASCII.
 *   - **F-S5 (Phase 2)**: Markdown emphasis interior to a word
 *     ("ma*g*ic", "ma_g_ic", "*magic*") would split the token across
 *     the regex word-boundary lookarounds.
 *   - **F-S5b (Phase 3a sanity)**: REGRESSION from F-S5's earlier fix —
 *     stripping `*` / `_` / zero-widths *without* a placeholder
 *     collapsed adjacent words.  `the_Quiet` → `theQuiet` defeated
 *     BOTH the "the Quiet" multi-word token AND the bare "Quiet"
 *     token (the `e` in `the` is a word-char, so the lookbehind
 *     fails).  Same shape for `the*Quiet`, `the​Quiet`, etc.
 *     Fix: replace strip chars with a single space, then collapse
 *     whitespace runs so multi-word tokens still match cleanly.
 *   - **F-S6 (Phase 3a sanity)**: zero-width format chars beyond
 *     the originally-stripped ZWSP/ZWNJ/ZWJ/BOM also defeat the
 *     scan — notably U+00AD (soft hyphen), U+2060 (word joiner),
 *     and the broader Cf-category formatters that an over-helpful
 *     AI may emit.  Strip the documented Unicode format-control
 *     ranges.
 *
 * All transforms are applied to the SCAN text only — the spoiler
 * tokens themselves are passed verbatim.  This is correct because a
 * campaign-declared token like "the Network (closed)" is meant to be
 * matched literally; we're only canonicalizing the AI's output.
 *
 * Known gap (F-S7 deferred): homoglyphs (Cyrillic / Greek / Cherokee
 * lookalikes — "mаgic" with Cyrillic а U+0430) are NOT canonicalized
 * because NFKC doesn't fold them.  Defense for this class is the
 * system prompt's "no synonyms" line + the auto-retry path; a
 * confusables table is a follow-up.
 */
/**
 * F-S5b reconciliation: the strip-with-space discipline (so an
 * external-glue attack like `the_Quiet` reads as `the Quiet`)
 * conflicts with the F-S5 internal-split discipline (so an internal-
 * split attack like `ma*g*ic` reads as `magic`).  Same characters
 * serve as glue in one attack and splitter in the other; there is no
 * single transformation that catches both.  Solution: produce TWO
 * sanitized variants and scan each; the caller unions the hit sets.
 *
 * - `collapsed`: strip glue/format chars WITHOUT a placeholder.
 *   Catches internal-split (`ma*g*ic` → `magic`, `Qu­iet` →
 *   `Quiet`).
 * - `spaced`: replace glue/format chars WITH a single space, then
 *   collapse whitespace runs.  Catches external-glue
 *   (`the_Quiet` → `the Quiet`, multi-word match succeeds; bare
 *   "Quiet" also matches since `the ` ends in a non-word char).
 *
 * Both variants are applied to the SCAN text only — the spoiler
 * tokens themselves are passed verbatim.  Campaign-declared
 * multi-word tokens with embedded punctuation (e.g. "the Network
 * (closed)") still match cleanly in either variant.
 */
function sanitizeForSpoilerScan(text: string): {
  collapsed: string;
  spaced: string;
} {
  const normalized = text.normalize('NFKC');
  const collapsed = normalized
    .replace(FORMAT_CONTROL_RE, '')
    .replace(/[*_]/g, '');
  const spaced = normalized
    .replace(FORMAT_CONTROL_RE, ' ')
    .replace(/[*_]/g, ' ')
    .replace(/\s+/g, ' ');
  return { collapsed, spaced };
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
  const { collapsed, spaced } = sanitizeForSpoilerScan(text);
  if (collapsed.length === 0 && spaced.length === 0) return [];
  const pattern = tokens.map(escapeRegex).join('|');
  // Lookarounds instead of `\b` so multi-word tokens with embedded
  // punctuation (e.g., a future campaign-declared "the Network
  // (closed)") match cleanly.  `\b` requires word/non-word
  // transitions at both edges; lookarounds only require that the
  // adjacent character not be a word character, which is the
  // semantic we actually want: don't match inside another word,
  // but do match next to punctuation or end-of-string.
  const seen = new Set<string>();
  const out: string[] = [];
  // Two scans — each canonicalization catches a complementary attack
  // shape (internal split vs external glue).  Union the hits in
  // first-seen order across both scans so the caller's "do not use"
  // retry message lists them deterministically.
  for (const scan of [collapsed, spaced]) {
    if (scan.length === 0) continue;
    const re = new RegExp(`(?<!\\w)(${pattern})(?!\\w)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(scan)) !== null) {
      const lower = match[1].toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        out.push(lower);
      }
      // Defensive against zero-width matches.
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}
