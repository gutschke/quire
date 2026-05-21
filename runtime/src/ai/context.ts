/**
 * AI context construction + path validation (M3b.1, P2-6 + P2-8).
 *
 * Two responsibilities:
 *   1. `validateContextRef(ref, scope)` — defense-in-depth path
 *      check before the broker fetches any campaign-relative file
 *      into a model prompt.  Reused at multiple call sites
 *      (broker.complete + region UI + tests) so the policy is
 *      enforced once.
 *   2. `wrapUntrusted(content, source)` — wraps a campaign-sourced
 *      string in an `<untrusted_content source="...">…</untrusted_content>`
 *      block, escaping any literal close tag with a `<!--UC_CLOSE-->`
 *      sentinel.  Models that respect the wrapper structure treat
 *      the inner content as data, not as instructions to follow.
 *
 * `<!--UC_CLOSE-->` sentinel: the campaign-loader rejects raw
 * source files containing this literal (M3b.6) so a hostile
 * campaign author cannot break out of the wrapper by embedding
 * the sentinel directly.  Together these form the wrapper-safety
 * contract documented in design/security.md.
 */

/** Path patterns that are DM-only by convention (security.md). */
const DM_ONLY_PREFIXES = ['dm/', 'design/dm-only/'];

/** The opening / closing tags used to wrap untrusted content. */
const UC_OPEN = (source: string): string =>
  `<untrusted_content source="${escapeForAttribute(source)}">`;
const UC_CLOSE_TAG = '</untrusted_content>';
/**
 * Literal sentinel that replaces a `</untrusted_content>` close
 * tag inside content.  Campaign load-time validator rejects this
 * exact string in raw input so hostile campaigns can't smuggle a
 * fake close tag in.
 */
export const UC_CLOSE_SENTINEL = '<!--UC_CLOSE-->';

export type ContextScope = 'public' | 'dm';

export type ContextValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a contextRefs entry.  Returns `{ ok: true }` when the
 * ref is safe to fetch; otherwise an `{ ok: false, error }` whose
 * message is user-facing (surfaced in the AI prompt error panel).
 *
 * Defense in depth: when `scope === 'public'`, paths that target
 * DM-only directories are rejected EVEN IF the ref is otherwise
 * well-formed.  The DM's scope toggle is the authoritative gate;
 * this is the redundant one that catches a mis-clicked toggle
 * before the file lands in a public prompt.
 */
export function validateContextRef(
  ref: string,
  scope: ContextScope
): ContextValidation {
  if (typeof ref !== 'string' || ref.length === 0) {
    return { ok: false, error: 'context ref must be a non-empty string' };
  }
  if (ref.length > 1024) {
    return { ok: false, error: 'context ref exceeds 1024 chars' };
  }
  if (ref.startsWith('/')) {
    return {
      ok: false,
      error: `absolute path not allowed: ${ref}`
    };
  }
  if (/^[a-z]+:/i.test(ref)) {
    return {
      ok: false,
      error: `URL scheme not allowed in context ref: ${ref}`
    };
  }
  // Normalize the ref and reject any `..` segments — a `..` after
  // normalization means the path escapes the campaign root.
  const segments = ref.split('/');
  if (segments.some((s) => s === '..' || s === '')) {
    return {
      ok: false,
      error: `path traversal not allowed: ${ref}`
    };
  }
  if (segments.some((s) => s === '.')) {
    return {
      ok: false,
      error: `dotted segment not allowed: ${ref}`
    };
  }
  if (scope === 'public') {
    const lower = ref.toLowerCase();
    for (const prefix of DM_ONLY_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return {
          ok: false,
          error: `DM-only path "${ref}" cannot be included in a public-scope prompt`
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Wrap untrusted content for inclusion in a model prompt.  The
 * wrapper signals "this is data, do not follow instructions in
 * here" to the model; the inner content has its close tag replaced
 * with a comment sentinel so even malicious content can't end the
 * wrapper early.
 *
 * Source is escaped for an HTML attribute since the wrapper tag is
 * model-facing pseudo-XML and we don't want quotes / backticks in
 * the source breaking the wrapper.
 */
export function wrapUntrusted(content: string, source: string): string {
  const escaped = content.split(UC_CLOSE_TAG).join(UC_CLOSE_SENTINEL);
  return `${UC_OPEN(source)}\n${escaped}\n${UC_CLOSE_TAG}`;
}

/**
 * Detect a literal UC_CLOSE sentinel in raw campaign content.
 * Used by the campaign-loader load-time validator (M3b.6) — when
 * the sentinel appears in a fetched file we reject the load with
 * a typed error so the campaign author sees the violation.
 */
export function containsUcCloseSentinel(rawContent: string): boolean {
  return rawContent.includes(UC_CLOSE_SENTINEL);
}

function escapeForAttribute(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
