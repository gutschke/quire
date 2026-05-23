/**
 * <track-bar> — 4-box harm or stress track for the quire-v0.1
 * ruleset (rules.md:73-94).  Boxes fill left-to-right; clicking a
 * box toggles up to that fill level (with single-step click-to-
 * fill / click-fill-to-clear semantics).
 *
 * Phase B P1d (2026-05-23): extracted from the prior inline
 * renderer (player-rail.ts had per-track inline render).  The
 * extraction lets every surface (chargen review, DM in-session,
 * player rail, end-of-session) use the same affordance with
 * consistent visuals.
 *
 * Rule-consequence hover: each box exposes the rule text for
 * "what happens when this box is filled" via the <rule-hover>
 * wrapper.  TTRPG R1 wish #1: the DM hovering the NEXT-empty box
 * sees the consequence of filling it.  Saves the DM from
 * memorizing 32 thresholds across 4 PCs × 2 tracks.
 *
 * Hover content table (rules.md:73-94):
 *   harm 1 — "1 box: -1 to physical rolls"
 *   harm 2 — "2 boxes: -1 to physical rolls (carried)"
 *   harm 3 — "3 boxes: -1 to all rolls; medical attention"
 *   harm 4 — "4 boxes: Out of action"
 *   stress 1 — "1 box: tense, no penalty yet"
 *   stress 2 — "2 boxes: -1 to WIS rolls"
 *   stress 3 — "3 boxes: -2 to WIS rolls; debt accumulates faster"
 *   stress 4 — "4 boxes: Broken — cannot cast; -1 to all rolls"
 *
 * Engine-vs-campaign note (V-10): harm/stress AS NAMED TRACKS
 * are Underleaf-specific.  This component takes the rule-text
 * table as a prop, so a future ruleset declaring different track
 * names + thresholds wires its own text in.  The component
 * itself is engine-shape (4 boxes, click-to-fill).
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './rule-hover';

export type TrackKind = 'harm' | 'stress';

/**
 * Per-box rule text.  Index 0 = "if you fill box 1, this happens."
 * Length-4 array (4-box tracks); missing entries render no hover.
 * Caller supplies the table — defaults below match quire-v0.1.
 */
export type TrackRuleText = readonly [string, string, string, string];

/**
 * quire-v0.1 default rule texts.  Used when `ruleText` prop is
 * unset.  Engine-vs-campaign note: this default is Underleaf-
 * specific; campaigns that override `rules.tracks` in the
 * manifest will eventually supply their own.
 */
export const DEFAULT_HARM_RULES: TrackRuleText = [
  'box 1: -1 to physical rolls',
  'box 2: -1 to physical rolls (carried)',
  'box 3: -1 to all rolls; medical attention',
  'box 4: Out of action'
] as const;
export const DEFAULT_STRESS_RULES: TrackRuleText = [
  'box 1: tense, no penalty yet',
  'box 2: -1 to WIS rolls',
  'box 3: -2 to WIS rolls; debt accumulates faster',
  'box 4: Broken — cannot cast; -1 to all rolls'
] as const;

const TRACK_MAX = 4;

@customElement('track-bar')
export class TrackBar extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Which track (`harm` or `stress`) — used for styling + default rule text. */
  @property() kind: TrackKind = 'harm';

  /** Current fill level (0..4).  Out-of-range values clamp visually. */
  @property({ type: Number }) value: number = 0;

  /**
   * Whether boxes are click-to-toggle.  When false, the bar is
   * read-only (no event handlers, no pointer cursor).  Player rail
   * uses true for own-PC tracks; DM uses true for any focused-PC
   * track; chargen-review uses true at creation time.
   */
  @property({ type: Boolean }) editable: boolean = false;

  /**
   * Per-box rule text.  Defaults to the quire-v0.1 harm/stress
   * tables above when unset.
   */
  @property({ attribute: false }) ruleText: TrackRuleText | null = null;

  /**
   * Fired when the user clicks a box.  Caller maps box-index to
   * the new fill level: clicking box `i` (1-based) when current
   * value is `v`:
   *   - if i > v: fill up to i (set value = i)
   *   - if i <= v AND i === v: clear box i (set value = i - 1)
   *   - if i < v: fill back to i (set value = i)
   * The component fires `(newValue: number)` so the caller's
   * fill/clear logic is the same regardless of pre-existing state.
   */
  @property({ attribute: false }) onSetValue:
    | ((newValue: number) => void)
    | null = null;

  /**
   * Optional aria-label for the whole bar.  When unset, derived
   * from `kind` ("harm track" / "stress track").
   */
  @property() override ariaLabel: string | null = null;

  private boxClick(boxIndex1Based: number): void {
    if (!this.editable || !this.onSetValue) return;
    const i = boxIndex1Based;
    const v = Math.max(0, Math.min(TRACK_MAX, Math.floor(this.value)));
    let next: number;
    if (i > v) {
      // Filling a new box past the current.
      next = i;
    } else if (i === v) {
      // Clicking the rightmost filled box clears it.
      next = i - 1;
    } else {
      // Clicking inside the filled stretch: shrink to that box.
      next = i;
    }
    this.onSetValue(Math.max(0, Math.min(TRACK_MAX, next)));
  }

  override render(): TemplateResult {
    const v = Math.max(0, Math.min(TRACK_MAX, Math.floor(this.value)));
    const ruleText =
      this.ruleText ??
      (this.kind === 'harm' ? DEFAULT_HARM_RULES : DEFAULT_STRESS_RULES);
    const ariaLabel = this.ariaLabel ?? `${this.kind} track`;
    return html`
      <ol
        class="track-bar track-bar-${this.kind} ${this.editable
          ? 'track-bar-editable'
          : ''}"
        aria-label=${ariaLabel}
      >
        ${[1, 2, 3, 4].map((i) => this.renderBox(i, v, ruleText[i - 1] ?? ''))}
      </ol>
    `;
  }

  private renderBox(
    i: number,
    fill: number,
    ruleText: string
  ): TemplateResult {
    const filled = i <= fill;
    const isNextEmpty = i === fill + 1;
    // Hover surfaces on filled boxes (current consequence) AND on
    // the next-empty box (TTRPG R1 #1: "what happens if I fill
    // this?").  Empty boxes past the next-empty don't show hover
    // (rules.md doesn't have a 7-box stress track to escalate to;
    // showing "box 4: Broken" on box 4 when only 1 is filled is
    // noise).
    const showHover = filled || isNextEmpty;
    const hoverText = showHover ? ruleText : '';
    const box = html`<button
      type="button"
      class="track-bar-box ${filled ? 'track-bar-box-filled' : ''} ${isNextEmpty
        ? 'track-bar-box-next'
        : ''}"
      aria-pressed=${filled ? 'true' : 'false'}
      aria-label="${this.kind} box ${i}, ${filled ? 'filled' : 'empty'}"
      ?disabled=${!this.editable}
      @click=${() => this.boxClick(i)}
    >
      ${filled ? '■' : '□'}
    </button>`;
    return html`<li class="track-bar-cell">
      ${hoverText
        ? html`<rule-hover text=${hoverText} placement="above">${box}</rule-hover>`
        : box}
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'track-bar': TrackBar;
  }
}
