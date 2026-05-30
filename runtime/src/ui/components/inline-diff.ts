/**
 * <inline-diff> — unified-diff rendering for the UX-MH-3 backstory
 * refresh proposal.
 *
 * Per Run #19 R-F + TTRPG/UX expert advisory: NOT side-by-side, NOT
 * pulse-then-settle animation.  Markdown-style `+`/`-` lines with
 * light/dark themed inline coloring so the player can SEE what
 * changed and decide.
 *
 * Contract:
 *
 *   <inline-diff
 *     .baseline=${baselineText}
 *     .proposed=${proposedText}
 *   ></inline-diff>
 *
 * The component computes a line-level diff (LCS-based) and emits:
 *   - unchanged lines: default body color
 *   - removed lines: red strikethrough + light-red background
 *   - added lines: green underline + light-green background
 *
 * Render is light-DOM so the host's CSS reaches without ::slotted
 * gymnastics (matches chip-editor pattern).
 *
 * Engine vs campaign: this is a generic UI primitive with no
 * Quire-specific logic.  Could move to a /primitives/ subdir if a
 * second consumer appears.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Compute a line-level diff using a minimal LCS algorithm.  Exposed
 * for unit testing (the visual component just renders the result).
 *
 * Returns an array of diff hunks: each is either
 *   { kind: 'same', text }
 * or
 *   { kind: 'add', text }  | { kind: 'del', text }
 *
 * Lines are split on `\n` and never re-collapsed (trailing newlines
 * preserved as empty entries so the visual matches the original
 * structure).
 *
 * LCS via dynamic programming — O(n*m) time, O(n*m) memory.  For
 * backstories ≤ 8 KB / ~100 lines this is fine; the proposal cap
 * is `BACKSTORY_REFRESH_MAX_PROPOSED = 8000` chars.
 */
export type DiffHunk =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string };

export function computeLineDiff(
  baseline: string,
  proposed: string
): DiffHunk[] {
  const a = baseline.split('\n');
  const b = proposed.split('\n');
  // LCS DP table.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  // Backtrack to build the hunks.
  const out: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i++] });
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j++] });
  }
  return out;
}

@customElement('inline-diff')
export class InlineDiff extends LitElement {
  /** Light-DOM so host CSS reaches. */
  createRenderRoot(): this {
    return this;
  }

  /** The original baseline text. */
  @property({ attribute: false }) baseline = '';
  /** The proposed new text. */
  @property({ attribute: false }) proposed = '';

  render(): TemplateResult {
    const hunks = computeLineDiff(this.baseline, this.proposed);
    return html`
      <div class="inline-diff" role="region" aria-label="Backstory diff">
        ${hunks.map((h) => this.renderHunk(h))}
      </div>
    `;
  }

  private renderHunk(h: DiffHunk): TemplateResult {
    // Display each line with a clear sigil + colored background so the
    // diff is skimmable.  Empty lines still render as a sigil-only row
    // so paragraph breaks are visible.
    const sigil = h.kind === 'add' ? '+ ' : h.kind === 'del' ? '- ' : '  ';
    const cls = `inline-diff-line inline-diff-line-${h.kind}`;
    return html`<div class=${cls}>
      <span class="inline-diff-sigil" aria-hidden="true">${sigil}</span
      ><span class="inline-diff-text">${h.text}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'inline-diff': InlineDiff;
  }
}
