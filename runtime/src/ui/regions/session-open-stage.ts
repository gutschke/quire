// @vitest-environment happy-dom

/**
 * <session-open-stage> — D2 (2026-05-26) session-open ritual.
 *
 * Twin of <session-wrap-marks>.  When the DM resumes a session
 * (new event log loaded with prior `session-digest`s + no fresh
 * `session-open` since the last digest), this region renders the
 * "table picks up the thread" surface:
 *
 *   - Top: last session's digest re-read (markdown-rendered)
 *   - Middle: per-bound-active PC carryover cards
 *   - Footer: soft-nudge counts + "Begin session" terminal button
 *
 * **DM-coord-only** (Adversarial D2-1).  The carryover cards
 * surface DM-only fields (tax, threadDebt rung, alignmentDrift).
 * Rendering this region for a non-coord viewer would either leak
 * DM data or require a parallel scrubbed render (the
 * D-prep-2-A bug class).  Easier and safer: render NOTHING for
 * non-coord viewers.  The host renderBody dispatch checks
 * `isCoordinator()` before mounting this component; even so the
 * component itself bails out if callbacks aren't wired.
 *
 * **drift-conversation-due is DM-only** (Adversarial D2-2).
 * The badge has no player render path under any condition.  This
 * file enforces it structurally — the badge only renders when
 * the host passes a non-zero `driftDueMarks` (which the host
 * only supplies for coord viewers).
 *
 * **No "spend marks" / "log downtime" affordances** (TTRPG +
 * D2-9).  Marks-ready is a passive badge; downtime mechanics
 * don't exist in rules.md v0.1.
 *
 * **Realignment-acknowledge** (TTRPG): clicking the "Realignment
 * due" button records local-only acknowledgment for THIS open-
 * ritual session.  Does NOT clear `alignmentDrift.marks` (only
 * the in-fiction conversation does that — rules.md:170).  The
 * receipt is ephemeral; reload re-fires the badge.  Acceptable
 * since reload mid-open is rare.
 *
 * **Begin button** invokes `onBegin()` which the host wires to:
 *   1. Emit `pc-edit` events decrementing `tax.sessionsRemaining`
 *      for each PC with `tax.active && sessionsRemaining > 0`
 *   2. Emit a `session-open` event recording WHO opened
 *   3. Transition appMode to in-session
 *
 * No AI surface (TTRPG D2-8).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { renderMarkdown } from '../../markdown';

/**
 * Per-PC carryover card data.  Adapted by the host from
 * `state.shared.synthesizedPcs[pcId]` + `pcEdits[pcId]` overlay.
 * All DM-only fields (tax, threadDebt rung, drift marks) are
 * passed ONLY by coord viewers — the host gates this.
 */
export interface CarryoverPcCard {
  pcId: string;
  /** Display name for the card header. */
  name: string;
  /** Slot integer (sticky-N display). */
  slot: number;
  /** Persistent harm boxes ≥ 2 (recovery rule rules.md:74-81). */
  harm: number;
  /** Persistent stress boxes ≥ 2 (recovery rule rules.md:85-94). */
  stress: number;
  /** Mark count toward next advancement (rules.md:157). */
  marks: number;
  /** True if marks ≥ 5 — advancement-due (rules.md:157). */
  advancementReady: boolean;
  /**
   * Optional DM-only: tax.sessionsRemaining (rules.md:180-184).
   * Passed only by coord viewers; omitted otherwise so the badge
   * never renders for a non-coord.
   */
  taxSessionsRemaining?: number;
  /**
   * Optional DM-only: thread-debt rung label (rules.md:125-137).
   * Passed only by coord viewers.
   */
  threadDebtRung?: string;
  /**
   * Optional DM-only: alignmentDrift.marks count.  When ≥ 5,
   * surfaces the "Realignment due" badge (rules.md:170-172).
   * Passed only by coord viewers; the firewall is structural.
   */
  driftMarks?: number;
}

export type BeginSessionCallback = () => Promise<
  | { ok: true }
  | { ok: false; code: string; message: string }
>;
export type AcknowledgeDriftCallback = (pcId: string) => void;

@customElement('session-open-stage')
export class SessionOpenStage extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Markdown body of the most-recent session digest (D4). */
  @property({ attribute: false }) lastDigestMarkdown: string = '';

  /** Per-PC carryover cards.  Coord viewer only — players get
   *  nothing (host doesn't mount this region for non-coord). */
  @property({ attribute: false }) carryover: CarryoverPcCard[] = [];

  /** Wired only on the coord viewer. */
  @property({ attribute: false }) onBegin: BeginSessionCallback | null = null;

  /**
   * Local-only acknowledgment receipts for drift-conversation
   * prompts.  Ephemeral — not persisted to the event log.  TTRPG-
   * expert: "flag-with-receipt" — the badge clears for THIS
   * open-ritual session; reloads re-fire it.  Keyed by pcId.
   */
  @state() private driftAcknowledged: Record<string, boolean> = {};

  /** "Begin" call state surfacing. */
  @state() private beginning: boolean = false;
  @state() private errorMessage: string | null = null;

  override render(): TemplateResult {
    const canCoord = this.onBegin !== null;
    return html`<section class="session-open-stage">
      <header class="session-open-stage-head">
        <h2>Open session — pick up the thread</h2>
        <p class="muted">
          A quick re-orientation before the table resumes play.
        </p>
      </header>
      ${this.lastDigestMarkdown
        ? html`<section class="session-open-stage-recap">
            <h3>Last time</h3>
            <div class="session-open-stage-digest">
              ${unsafeHTML(renderMarkdown(this.lastDigestMarkdown))}
            </div>
          </section>`
        : nothing}
      ${this.carryover.length > 0
        ? html`<section class="session-open-stage-carryover">
            <h3>Carryover</h3>
            <ol class="session-open-stage-cards">
              ${this.carryover.map((c) => this.renderCard(c))}
            </ol>
          </section>`
        : html`<p class="muted">No bound PCs yet.</p>`}
      ${canCoord
        ? html`<footer class="session-open-stage-footer">
            ${this.renderFooterSummary()}
            ${this.errorMessage
              ? html`<p class="session-open-stage-error" role="alert">
                  ${this.errorMessage}
                </p>`
              : nothing}
            <button
              type="button"
              class="session-open-stage-begin"
              ?disabled=${this.beginning}
              @click=${() => void this.handleBegin()}
            >
              ${this.beginning
                ? 'Beginning…'
                : this.hasUnresolved()
                  ? 'Begin session anyway'
                  : 'Begin session'}
            </button>
          </footer>`
        : nothing}
    </section>`;
  }

  private renderCard(c: CarryoverPcCard): TemplateResult {
    const driftAck = this.driftAcknowledged[c.pcId] === true;
    const showDrift =
      typeof c.driftMarks === 'number' && c.driftMarks >= 5 && !driftAck;
    return html`<li class="session-open-stage-card">
      <header class="session-open-stage-card-head">
        <strong>${c.name}</strong>
        <span class="muted">slot ${c.slot}</span>
      </header>
      <ul class="session-open-stage-card-stats">
        ${c.harm >= 2
          ? html`<li class="session-open-stage-card-stat">
              harm ${c.harm}/4
            </li>`
          : nothing}
        ${c.stress >= 2
          ? html`<li class="session-open-stage-card-stat">
              stress ${c.stress}/4
            </li>`
          : nothing}
        <li class="session-open-stage-card-stat">
          marks ${c.marks}/5
          ${c.advancementReady
            ? html`<span class="session-open-stage-badge session-open-stage-badge-adv"
                >Advancement ready</span
              >`
            : nothing}
        </li>
        ${typeof c.taxSessionsRemaining === 'number' &&
        c.taxSessionsRemaining > 0
          ? html`<li class="session-open-stage-card-stat session-open-stage-dm-only">
              tax: ${c.taxSessionsRemaining} session${c.taxSessionsRemaining === 1 ? '' : 's'} remaining
            </li>`
          : nothing}
        ${c.threadDebtRung
          ? html`<li class="session-open-stage-card-stat session-open-stage-dm-only">
              thread-debt: ${c.threadDebtRung}
            </li>`
          : nothing}
      </ul>
      ${showDrift
        ? html`<div class="session-open-stage-drift-banner">
            <span class="session-open-stage-badge session-open-stage-badge-drift"
              >Realignment due</span
            >
            <button
              type="button"
              class="session-open-stage-drift-ack"
              @click=${() => this.acknowledgeDrift(c.pcId)}
            >
              Bring it up when the moment fits
            </button>
          </div>`
        : nothing}
    </li>`;
  }

  private renderFooterSummary(): TemplateResult | typeof nothing {
    let advCount = 0;
    let driftCount = 0;
    for (const c of this.carryover) {
      if (c.advancementReady) advCount++;
      if (
        typeof c.driftMarks === 'number' &&
        c.driftMarks >= 5 &&
        this.driftAcknowledged[c.pcId] !== true
      ) {
        driftCount++;
      }
    }
    if (advCount === 0 && driftCount === 0) return nothing;
    const parts: string[] = [];
    if (advCount > 0)
      parts.push(`${advCount} advancement-due`);
    if (driftCount > 0)
      parts.push(`${driftCount} drift-due`);
    return html`<p class="session-open-stage-summary muted">
      ${parts.join(' · ')}
    </p>`;
  }

  private hasUnresolved(): boolean {
    for (const c of this.carryover) {
      if (c.advancementReady) return true;
      if (
        typeof c.driftMarks === 'number' &&
        c.driftMarks >= 5 &&
        this.driftAcknowledged[c.pcId] !== true
      ) {
        return true;
      }
    }
    return false;
  }

  private acknowledgeDrift(pcId: string): void {
    this.driftAcknowledged = { ...this.driftAcknowledged, [pcId]: true };
  }

  private async handleBegin(): Promise<void> {
    if (!this.onBegin) return;
    this.beginning = true;
    this.errorMessage = null;
    try {
      const result = await this.onBegin();
      if (!result.ok) {
        this.errorMessage = result.message;
      }
    } finally {
      this.beginning = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'session-open-stage': SessionOpenStage;
  }
}
