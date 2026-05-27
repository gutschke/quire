/**
 * Markdown facade.
 *
 * E-LH6 (2026-05-26): the heavy implementation (marked + DOMPurify
 * + js-yaml, ~30 KB gzipped) lives in `./markdown-pipeline` and
 * loads on demand via `ensureMarkdownPipeline()`.  This file
 * stays light: types, brand, pure string helpers, block-hashing
 * (Web Crypto), and thin facades that delegate to the pipeline
 * after it's loaded.
 *
 * Public surface unchanged for sync callers — they get an empty
 * `SanitizedHtml` placeholder on the very first render before the
 * pipeline loads.  QuireApp's connectedCallback kicks off
 * `ensureMarkdownPipeline()` and triggers `requestUpdate()` once
 * the chunk resolves, so the second render shows real content.
 *
 * Trust boundary: this is still the *only* path by which campaign-
 * authored Markdown becomes HTML in the runtime.  The brand type
 * `SanitizedHtml` is the contract; raw strings cannot satisfy it.
 *
 * NOT pluggable.  Forks that swap the pipeline out forfeit the
 * security guarantees documented in design/security.md.
 */

/**
 * Brand type: a string that has been through `renderMarkdown` and
 * is safe to pass to Lit's `unsafeHTML` directive.  Raw strings
 * will not satisfy this type — the compiler enforces the
 * sanitize-before-inject invariant.
 */
export type SanitizedHtml = string & { readonly __brand: 'SanitizedHtml' };

export interface MarkdownDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface RenderedDocument extends MarkdownDocument {
  html: SanitizedHtml;
}

/**
 * One addressable block in a scene file.  Each block corresponds
 * to a top-level markdown construct: a paragraph, heading, list,
 * blockquote, fenced code block, or table.  The `blockHash` is
 * the first 16 hex chars of sha256(normalizeBlock(raw)).
 */
export interface MarkdownBlock {
  /** Stable 16-hex-char content hash; identifier in reveal events. */
  blockHash: string;
  /** Sanitized HTML for this block alone. */
  html: SanitizedHtml;
  /** Original markdown source for this block, verbatim. */
  raw: string;
  /** Zero-based index in scene order.  UI hint only — not authoritative. */
  index: number;
}

export interface ParagraphsDocument {
  frontmatter: Record<string, unknown>;
  blocks: MarkdownBlock[];
}

// -----------------------------------------------------------------
// Light-weight pure helpers (no heavy deps)
// -----------------------------------------------------------------

/**
 * Normalize a block's raw markdown for hashing: trim edges and
 * collapse internal whitespace runs (incl. line breaks, tabs) to a
 * single space.  Two blocks with the same text content but
 * different whitespace formatting hash identically — important so
 * trivial editorial reflow doesn't lapse reveals.
 */
export function normalizeBlock(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * BLOCK_HASH_LENGTH from redesign-plan.md: 16 hex chars (64 bits).
 */
const BLOCK_HASH_HEX_LENGTH = 16;

/**
 * Specialized error thrown when `crypto.subtle` is unavailable —
 * usually because Quire is being served from an insecure context
 * (HTTP, file://) where browsers gate Web Crypto.
 */
export class CryptoUnavailableError extends Error {
  override readonly name = 'CryptoUnavailableError';
  constructor() {
    super(
      'Per-paragraph reveal requires Web Crypto (crypto.subtle), which the browser disables in insecure contexts.  Serve Quire over HTTPS or open it on localhost.'
    );
  }
}

/**
 * Async sha256 (Web Crypto), first 16 hex chars.  Used for block
 * identity in scene-reveal-paragraph events.
 */
export async function blockHash(raw: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new CryptoUnavailableError();
  }
  const normalized = normalizeBlock(raw);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < BLOCK_HASH_HEX_LENGTH / 2; i++) {
    hex += view[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * PC-slot bindings: maps a slot number (1-9+) to the character
 * name that fills it.
 */
export type PcSlotBindings = Readonly<Record<number, string>>;

const PC_SLOT_RE = /\{\{pc:([1-9]\d*)\}\}/g;

/**
 * Substitute `{{pc:N}}` placeholders in sanitized HTML.  Pure
 * string-replace — no heavy deps.
 */
export function substitutePcSlots(
  html: string,
  bindings?: PcSlotBindings
): string {
  return html.replace(PC_SLOT_RE, (_match, digit: string) => {
    const slot = Number(digit);
    const bound = bindings?.[slot];
    return bound !== undefined && bound !== '' ? bound : `PC${slot}`;
  });
}

/**
 * Adapter from the new Seat-shaped slot map to the legacy
 * PcSlotBindings consumed by `substitutePcSlots`.
 */
export function pcSlotsToBindings(
  slotMap: Record<number, { pcId?: string }>,
  getDisplayName: (pcId: string) => string | null
): PcSlotBindings {
  const out: Record<number, string> = {};
  for (const [slotStr, seat] of Object.entries(slotMap)) {
    if (!seat.pcId) continue;
    const name = getDisplayName(seat.pcId);
    if (name && name.length > 0) out[Number(slotStr)] = name;
  }
  return out;
}

// -----------------------------------------------------------------
// Pipeline lazy-load (E-LH6)
// -----------------------------------------------------------------

type PipelineModule = typeof import('./markdown-pipeline');

let _pipeline: PipelineModule | null = null;
let _pipelinePromise: Promise<PipelineModule> | null = null;
const _onReadyCallbacks: Array<() => void> = [];

/**
 * Eagerly load the heavy markdown pipeline (marked + DOMPurify +
 * js-yaml).  Idempotent — repeat calls return the same Promise.
 * QuireApp's connectedCallback calls this once at boot and
 * requests a re-render when it resolves so the first paint can
 * fall back to placeholders while the chunk loads.
 *
 * Returns the pipeline module so async callers (e.g. tests) can
 * also use it directly: `const p = await ensureMarkdownPipeline()`.
 */
export function ensureMarkdownPipeline(): Promise<PipelineModule> {
  if (_pipeline) return Promise.resolve(_pipeline);
  if (!_pipelinePromise) {
    _pipelinePromise = import('./markdown-pipeline').then(
      (mod) => {
        _pipeline = mod;
        // Fire registered onReady callbacks; lets Lit components
        // request a re-render once the pipeline is available.
        for (const cb of _onReadyCallbacks) {
          try {
            cb();
          } catch {
            // Don't let one bad listener block others.
          }
        }
        _onReadyCallbacks.length = 0;
        return mod;
      },
      (err) => {
        // Reset so a subsequent call retries cleanly.  Vitest's
        // env-teardown can race a `void ensureMarkdownPipeline()`
        // call near a test boundary and surface as an unhandled
        // rejection; that's not a production failure.  Real
        // load errors re-throw.
        _pipelinePromise = null;
        const isTeardown =
          err &&
          typeof err === 'object' &&
          (err as { name?: string }).name === 'EnvironmentTeardownError';
        if (!isTeardown) throw err;
        return null as unknown as PipelineModule;
      }
    );
  }
  return _pipelinePromise;
}

/**
 * Register a one-shot callback to fire when the pipeline becomes
 * available.  If already loaded, fires synchronously.  Used by
 * QuireApp to schedule `requestUpdate()` after the chunk resolves.
 */
export function onMarkdownPipelineReady(cb: () => void): void {
  if (_pipeline) {
    cb();
    return;
  }
  _onReadyCallbacks.push(cb);
}

/** Test-only reset for the pipeline state.  Production code should
 *  never call this. */
export function resetMarkdownPipelineForTests(): void {
  _pipeline = null;
  _pipelinePromise = null;
  _onReadyCallbacks.length = 0;
}

/** Whether the heavy pipeline has finished loading. */
export function isMarkdownPipelineLoaded(): boolean {
  return _pipeline !== null;
}

const EMPTY_HTML = '' as SanitizedHtml;

/**
 * Render a Markdown string to sanitized HTML.  Returns the empty
 * brand if the pipeline hasn't loaded yet — caller should pair
 * with `ensureMarkdownPipeline()` + `onMarkdownPipelineReady()` so
 * the next render shows real content.
 */
export function renderMarkdown(text: string): SanitizedHtml {
  if (!_pipeline) {
    void ensureMarkdownPipeline();
    return EMPTY_HTML;
  }
  return _pipeline.renderMarkdownImpl(text);
}

/**
 * Split a Markdown document into its YAML frontmatter block (if
 * present) and the body.  Returns empty frontmatter + the full
 * input text when the pipeline hasn't loaded yet.
 */
export function parseFrontmatter(text: string): MarkdownDocument {
  if (!_pipeline) {
    void ensureMarkdownPipeline();
    return { frontmatter: {}, body: text };
  }
  return _pipeline.parseFrontmatterImpl(text);
}

/**
 * Combined: split frontmatter, render body to sanitized HTML.
 */
export function renderMarkdownDocument(text: string): RenderedDocument {
  const doc = parseFrontmatter(text);
  return { ...doc, html: renderMarkdown(doc.body) };
}

/**
 * P2-1: split a scene markdown source into addressable blocks.
 * Async — awaits the pipeline before lexing/rendering.  The block
 * hashes go through Web Crypto.
 */
export async function renderMarkdownParagraphs(
  text: string
): Promise<ParagraphsDocument> {
  const pipeline = await ensureMarkdownPipeline();
  const doc = pipeline.parseFrontmatterImpl(text);
  const tokens = pipeline.lexBlocks(doc.body);
  const blockKinds = new Set([
    'heading',
    'paragraph',
    'list',
    'blockquote',
    'code',
    'table'
  ]);
  const contentTokens = tokens.filter((t) => blockKinds.has(t.type));
  const blocks = await Promise.all(
    contentTokens.map(async (t, index) => {
      const hash = await blockHash(t.raw);
      return {
        blockHash: hash,
        html: pipeline.renderMarkdownImpl(t.raw),
        raw: t.raw,
        index
      };
    })
  );
  return { frontmatter: doc.frontmatter, blocks };
}
