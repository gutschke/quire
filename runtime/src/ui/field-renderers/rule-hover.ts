/**
 * <rule-hover> — generic anchored popover that surfaces a one-line
 * rule consequence when the user hovers (or focuses) a child element.
 *
 * Phase B P1d (2026-05-23): designed in the 3-round expert
 * convergence; both TTRPG and UX experts asked for this.  Live use
 * case: a DM hovering the next-empty stress box sees "-1 to WIS
 * rolls" without having to remember 32 thresholds across 4 PCs ×
 * 2 tracks (TTRPG R1 20-second playthrough wish #1).
 *
 * Usage:
 *   <rule-hover text="-1 to WIS rolls" placement="above">
 *     <div class="track-box">...</div>
 *   </rule-hover>
 *
 * Implementation choices:
 *   - Light DOM (createRenderRoot returns `this`) so the slotted
 *     child sits in the inherited CSS cascade — no shadow boundary
 *     to coordinate styling across.
 *   - Pointer + focus hover (matches ui.md:142 "skill-chip
 *     popover" pattern: opens on hover/focus, anchored).  200 ms
 *     enter delay so accidental hovers don't surface noise; 100 ms
 *     exit delay so a quick re-enter doesn't flicker.
 *   - Native `title` attribute on the host as a fallback for
 *     keyboard users who don't have focus on a child + accessibility
 *     tools that read the tooltip text.
 *   - Honors `prefers-reduced-motion`: no enter/exit transitions
 *     when set.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export type RuleHoverPlacement = 'above' | 'below';

@customElement('rule-hover')
export class RuleHover extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * The rule text shown in the popover.  Empty string = no
   * popover (renders the slotted child verbatim).  Bounded to a
   * one-liner by convention; longer text wraps but starts to feel
   * like documentation rather than a glance-cue.
   */
  @property() text: string = '';

  /**
   * Where the popover sits relative to the host.  `above` is the
   * default — for tracks the popover floats above the next-empty
   * box so it doesn't visually collide with the box itself.
   * `below` is for the few cases where above would clip outside
   * the viewport.
   */
  @property() placement: RuleHoverPlacement = 'above';

  /**
   * Override the auto-derived `aria-label` for the popover.  When
   * unset, the popover uses the `text` prop as its label.
   */
  @property() ariaLabel: string | null = null;

  /**
   * Hover delays (ms).  200/100 in production; tests can override
   * via the static fields below to make assertions fast without
   * fake-timer machinery (happy-dom + vi.useFakeTimers hangs).
   */
  static enterDelayMs = 200;
  static exitDelayMs = 100;

  @state() private open = false;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Native `title` attribute as accessibility fallback.  Screen
    // readers + browser tooltips consume this.  Updated reactively
    // via updated() below.
    this.setAttribute('title', this.text);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.enterTimer) clearTimeout(this.enterTimer);
    if (this.exitTimer) clearTimeout(this.exitTimer);
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('text')) {
      this.setAttribute('title', this.text);
    }
  }

  private scheduleOpen(): void {
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
    if (this.open) return;
    this.enterTimer = setTimeout(() => {
      this.enterTimer = null;
      this.open = true;
    }, RuleHover.enterDelayMs);
  }

  private scheduleClose(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
    if (!this.open) return;
    this.exitTimer = setTimeout(() => {
      this.exitTimer = null;
      this.open = false;
    }, RuleHover.exitDelayMs);
  }

  override render(): TemplateResult {
    const showPopover = this.open && this.text.length > 0;
    return html`
      <span
        class="rule-hover-host"
        @pointerenter=${() => this.scheduleOpen()}
        @pointerleave=${() => this.scheduleClose()}
        @focusin=${() => this.scheduleOpen()}
        @focusout=${() => this.scheduleClose()}
      >
        <slot></slot>
        ${showPopover
          ? html`<span
              class="rule-hover-popover rule-hover-popover-${this.placement}"
              role="tooltip"
              aria-label=${this.ariaLabel ?? this.text}
            >
              ${this.text}
            </span>`
          : nothing}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rule-hover': RuleHover;
  }
}
