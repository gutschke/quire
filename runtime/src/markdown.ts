/**
 * Markdown rendering pipeline.
 *
 * Trust boundary: this module is the *only* path by which campaign-authored
 * Markdown becomes HTML in the runtime.  It returns a branded `SanitizedHtml`
 * string that the caller hands to Lit's `unsafeHTML` directive — the type
 * system prevents accidentally passing raw strings.
 *
 * NOT pluggable.  Forks that swap this out forfeit the security guarantees
 * documented in design/security.md.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { load as parseYaml } from 'js-yaml';

// Allow an optional leading BOM (UTF-8 byte-order mark) which some editors
// emit on Windows.  Without this, a BOM-prefixed file silently loses its
// frontmatter.
const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Tell marked we want GitHub-flavored Markdown (tables, strikethrough, task
// lists).  `breaks: false` is the CommonMark default — single line breaks do
// not become <br>; explicit blank lines start new paragraphs.
marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false
});

// Forked DOMPurify instance bound to the page window.  Hooks installed on
// this instance do not pollute the global DOMPurify singleton, so HMR module
// re-loads cannot accumulate duplicate hooks and unrelated future modules
// cannot interfere with our sanitization pipeline.
const purify = DOMPurify(window);

// Block dangerous URL schemes explicitly on href/src.  DOMPurify's defaults
// already cover javascript: and vbscript: in most contexts; this hook makes
// the policy explicit and resilient to library updates.  By the time this
// hook runs, HTML entities have been decoded — `&#106;avascript:alert(1)`
// arrives as `javascript:alert(1)`.
const BAD_URL_SCHEMES = [
  'javascript:',
  'vbscript:',
  'data:',
  'blob:',
  'filesystem:',
  'about:'
];
purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if ((data.attrName === 'href' || data.attrName === 'src') && data.attrValue) {
    const v = data.attrValue.trim().toLowerCase();
    if (BAD_URL_SCHEMES.some((s) => v.startsWith(s))) {
      data.keepAttr = false;
    }
  }
});

// External http(s) links get target=_blank + rel=noopener noreferrer so they
// open in a new tab without leaking the runtime origin via the Referer header
// or window.opener.  Protocol-relative `//host/path` URLs are deliberately
// NOT promoted — they resolve to the runtime origin's protocol and the
// new-tab affordance would mislead users about destination.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

/**
 * Brand type: a string that has been through `renderMarkdown` and is safe to
 * pass to Lit's `unsafeHTML` directive.  Raw strings will not satisfy this
 * type — the compiler enforces the sanitize-before-inject invariant.
 */
export type SanitizedHtml = string & { readonly __brand: 'SanitizedHtml' };

export interface MarkdownDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Split a Markdown document into its YAML frontmatter block (if present) and
 * the body.  A malformed frontmatter block is treated as if absent — the
 * whole text is returned as the body — so authors notice via the body
 * containing a stray `---` rather than via a hard parse error.
 */
export function parseFrontmatter(text: string): MarkdownDocument {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    return { frontmatter: {}, body: text };
  }
  return { frontmatter, body: text.slice(match[0].length) };
}

/**
 * Render a Markdown string to a sanitized HTML string.  The return value is
 * a branded `SanitizedHtml` and may be handed to Lit's `unsafeHTML`.
 *
 * Sanitize config rationale:
 *   - `USE_PROFILES: { html: true }` enables the HTML tag set and excludes
 *     SVG and MathML — both can carry script via nested handlers.
 *   - `ADD_ATTR` extends the profile's default attribute allowlist with the
 *     attributes added by our afterSanitizeAttributes hook.  We deliberately
 *     do NOT pass `ALLOWED_ATTR`, which would replace the profile's defaults
 *     and drop table/img attributes like colspan, rowspan, srcset, alt.
 *   - Dangerous URI schemes (javascript:, data:, vbscript:, blob:,
 *     filesystem:, about:) are blocked by the `uponSanitizeAttribute` hook
 *     above.  DOMPurify's default URI regex is permissive enough to allow
 *     relative campaign links like `npcs/alice.md`; tighter scheme control
 *     happens in the hook so the policy is explicit and testable.
 *
 * `style` attributes are not in ADD_ATTR and not in the default HTML profile
 * for sanitized output, so the page's CSP can tighten `style-src` to `'self'`
 * (no `unsafe-inline`) without breaking rendered campaign content.
 */
export function renderMarkdown(text: string): SanitizedHtml {
  const html = marked.parse(text, { async: false }) as string;
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  }) as SanitizedHtml;
}

export interface RenderedDocument extends MarkdownDocument {
  html: SanitizedHtml;
}

/**
 * Combined: split frontmatter, render body to sanitized HTML.
 */
export function renderMarkdownDocument(text: string): RenderedDocument {
  const doc = parseFrontmatter(text);
  return { ...doc, html: renderMarkdown(doc.body) };
}
