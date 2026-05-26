// @vitest-environment happy-dom

/**
 * <foci-card> — Phase B P1d (2026-05-26) renderer for the PC's
 * foci list.  A focus is the PC's relationship-with-a-power
 * (rules.md §Foci): name + optional domain (what it's tied to in
 * the world) + optional condition (the cost or contract) +
 * boundFor (the PC's intent that anchors it) + status enum.
 *
 * Status enum (P1a, rules.md:139): active / broken / faded /
 * corrupted / transformed.  Each has a distinct visual treatment
 * — `active` is the default green; the four altered states get
 * amber-rail framing because they're DM-narrative-meaningful
 * (broken foci hint at a cost the PC paid, corrupted/transformed
 * foreshadow magic-arc beats).
 *
 * Read-only by default.  Editable mode adds a status-cycle button
 * (active → broken → faded → corrupted → transformed → active),
 * which the host wires to the existing pc-edit path.  Add/remove
 * focus entries is deferred — array-write semantics need a richer
 * edit model per character-edits.ts header note.
 *
 * Per the planning-expert P1d verdict: second BLOCKING component
 * (after stat-grid).  Foci have the most new structure of any
 * Phase B field; getting them right unblocks P2 chargen review.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Focus } from '../../character-loader';

export type FocusStatus = NonNullable<Focus['status']>;

/**
 * Status cycle for the editable-mode status-chip click.  Wraps
 * around — clicking `transformed` cycles back to `active`.  The
 * order mirrors a "from-good-to-altered" progression so a click
 * always advances by one named state.
 */
const STATUS_CYCLE: readonly FocusStatus[] = [
  'active',
  'broken',
  'faded',
  'corrupted',
  'transformed'
] as const;

function nextStatus(current: FocusStatus | undefined): FocusStatus {
  const idx = current ? STATUS_CYCLE.indexOf(current) : 0;
  if (idx < 0) return 'active';
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

/**
 * Per-focus status-change callback.  The host translates this into
 * a pc-edit event (or queues an AI-write proposal).  Identifies
 * the target focus by INDEX in the foci array; array writes still
 * await a richer edit model so the host may NO-OP this for now.
 */
export type SetFocusStatusCallback = (
  pcId: string,
  focusIndex: number,
  newStatus: FocusStatus
) => void;

@customElement('foci-card')
export class FociCard extends LitElement {
  /** Light-DOM rendering so the legacy CSS cascade applies. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Array of foci from the bound character record. */
  @property({ attribute: false }) foci: Focus[] = [];

  /**
   * When non-null, the status chip becomes a click-to-cycle button
   * and `onSetFocusStatus` fires on each click.  Null = read-only.
   */
  @property() editablePcId: string | null = null;

  @property({ attribute: false }) onSetFocusStatus:
    | SetFocusStatusCallback
    | null = null;

  override render(): TemplateResult {
    if (this.foci.length === 0) {
      return html`<section class="foci-card foci-card-empty">
        <h3>Foci</h3>
        <p class="muted">No foci yet.</p>
      </section>`;
    }
    return html`
      <section class="foci-card">
        <h3>Foci</h3>
        <ul class="foci-card-list">
          ${this.foci.map((focus, i) => this.renderFocus(focus, i))}
        </ul>
      </section>
    `;
  }

  private renderFocus(focus: Focus, index: number): TemplateResult {
    const status = focus.status ?? 'active';
    const editable = this.editablePcId !== null && this.onSetFocusStatus !== null;
    return html`<li class="foci-card-item foci-card-status-${status}">
      <header class="foci-card-head">
        <strong class="foci-card-name">${focus.name}</strong>
        ${editable
          ? html`<button
              type="button"
              class="foci-card-status-chip foci-card-status-chip-${status}"
              title="Cycle focus status (active → broken → faded → corrupted → transformed)"
              @click=${() =>
                this.onSetFocusStatus?.(
                  this.editablePcId!,
                  index,
                  nextStatus(focus.status)
                )}
            >
              ${status}
            </button>`
          : html`<span
              class="foci-card-status-chip foci-card-status-chip-${status}"
              >${status}</span
            >`}
      </header>
      ${focus.domain
        ? html`<p class="foci-card-domain muted">
            <span class="foci-card-field-label">domain:</span> ${focus.domain}
          </p>`
        : nothing}
      ${focus.boundFor
        ? html`<p class="foci-card-boundfor">
            <span class="foci-card-field-label">intent:</span>
            ${focus.boundFor}
          </p>`
        : nothing}
      ${focus.condition
        ? html`<p class="foci-card-condition">
            <span class="foci-card-field-label">condition:</span>
            ${focus.condition}
          </p>`
        : nothing}
      ${focus.notes
        ? html`<p class="foci-card-notes muted">${focus.notes}</p>`
        : nothing}
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foci-card': FociCard;
  }
}
