// @vitest-environment happy-dom

/**
 * <dm-pc-detail> — Phase B P3 (Tier B, 2026-05-26) DM-only
 * companion to <player-rail>.  When the coord views a PC's
 * character page, this card renders below the player-visible
 * sheet showing the DM-only fields the viewer-scope projection
 * normally strips for players.
 *
 * Tier mapping per the planning-expert (run a4d73ff05b8fad993):
 *   - Tier A: glance (dm-roster-strip mini-pips, already shipped)
 *   - Tier B: disclosure-on-focus = THIS card (new)
 *   - Tier C: modal / dedicated (chargen-dm-review, already shipped)
 *
 * Read-only for v1 — inline editors for most DM-only fields
 * already exist on `<dm-aside>` (thread-debt selector, caster-
 * state badge, etc.).  This card is the "DM look at everything
 * about Mei right now" surface; editing flows through the
 * existing tools.
 *
 * Surface contract: the host passes a `DmDetailView` snapshot
 * (already filtered to a coord viewer); the component is a pure
 * read-only renderer.  No engine awareness; no callbacks today.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type {
  AccidentalGrant,
  AlignmentDrift,
  MagicPhase,
  TaxState,
  ThreadDebt
} from '../../character-loader';

export interface DmDetailView {
  pcName: string;
  magicPhase?: MagicPhase;
  knowsTheyCanCast?: boolean;
  tax?: TaxState;
  threadDebt?: ThreadDebt;
  accidentalGrants?: AccidentalGrant[];
  alignmentDrift?: AlignmentDrift;
  dmNotes?: string;
}

const MAGIC_PHASE_LABEL: Record<MagicPhase, string> = {
  accidental: 'Accidental — manifests in fiction, PC unaware',
  realization: 'Realization — about to surface (one-way gate)',
  tax: 'Tax — Trying-too-hard cost active',
  free: 'Free — magic mastered, no tax pressure'
};

const THREAD_DEBT_LABEL: Record<ThreadDebt['rung'], string> = {
  quiet: 'Quiet — antagonist unaware',
  noticed: 'Noticed — pattern attention',
  watched: 'Watched — agents in motion',
  'pushing-back': 'Pushing back — direct counter-moves',
  hunted: 'Hunted — full antagonist attention'
};

function hasAnyDmField(view: DmDetailView): boolean {
  return (
    view.magicPhase !== undefined ||
    view.knowsTheyCanCast !== undefined ||
    view.tax !== undefined ||
    view.threadDebt !== undefined ||
    (Array.isArray(view.accidentalGrants) &&
      view.accidentalGrants.length > 0) ||
    view.alignmentDrift !== undefined ||
    (typeof view.dmNotes === 'string' && view.dmNotes.length > 0)
  );
}

@customElement('dm-pc-detail')
export class DmPcDetail extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) view: DmDetailView | null = null;

  override render(): TemplateResult {
    const view = this.view;
    if (!view) return html``;
    // Empty-state: show the card header so the DM knows the
    // surface exists, but with a brief muted line — better than
    // hiding entirely (DM scanning expects the slot to be there).
    if (!hasAnyDmField(view)) {
      return html`<section class="card dm-pc-detail surface-private">
        <h2>
          DM details
          <span class="surface-private-tag">only you see this</span>
        </h2>
        <p class="muted">No DM-only state for ${view.pcName} yet.</p>
      </section>`;
    }
    return html`<section class="card dm-pc-detail surface-private">
      <h2>
        DM details — ${view.pcName}
        <span class="surface-private-tag">only you see this</span>
      </h2>
      ${this.renderMagicPhase(view)}
      ${this.renderTax(view.tax)}
      ${this.renderThreadDebt(view.threadDebt)}
      ${this.renderAlignmentDrift(view.alignmentDrift)}
      ${this.renderAccidentalGrants(view.accidentalGrants)}
      ${this.renderDmNotes(view.dmNotes)}
    </section>`;
  }

  private renderMagicPhase(view: DmDetailView): TemplateResult | typeof nothing {
    if (view.magicPhase === undefined && view.knowsTheyCanCast === undefined) {
      return nothing;
    }
    return html`<div class="dm-pc-detail-section">
      <h3>Magic arc</h3>
      ${view.magicPhase !== undefined
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Phase:</span>
            <span class="dm-pc-detail-value"
              >${MAGIC_PHASE_LABEL[view.magicPhase]}</span
            >
          </p>`
        : nothing}
      ${view.knowsTheyCanCast !== undefined
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Player knows:</span>
            <span class="dm-pc-detail-value"
              >${view.knowsTheyCanCast ? 'yes (post-Realization)' : 'no'}</span
            >
          </p>`
        : nothing}
    </div>`;
  }

  private renderTax(
    tax: TaxState | undefined
  ): TemplateResult | typeof nothing {
    if (!tax) return nothing;
    return html`<div class="dm-pc-detail-section">
      <h3>Trying-too-hard tax</h3>
      <p class="dm-pc-detail-row">
        <span class="dm-pc-detail-label">Status:</span>
        <span class="dm-pc-detail-value"
          >${tax.active ? 'active' : 'inactive'}</span
        >
      </p>
      ${typeof tax.sessionsRemaining === 'number'
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Sessions remaining:</span>
            <span class="dm-pc-detail-value">${tax.sessionsRemaining}</span>
          </p>`
        : nothing}
      ${tax.releaseMoment
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Release moment:</span>
            <span class="dm-pc-detail-value">${tax.releaseMoment}</span>
          </p>`
        : nothing}
    </div>`;
  }

  private renderThreadDebt(
    debt: ThreadDebt | undefined
  ): TemplateResult | typeof nothing {
    if (!debt) return nothing;
    return html`<div class="dm-pc-detail-section">
      <h3>Antagonist attention</h3>
      <p class="dm-pc-detail-row">
        <span class="dm-pc-detail-label">Rung:</span>
        <span class="dm-pc-detail-value"
          >${THREAD_DEBT_LABEL[debt.rung] ?? debt.rung}</span
        >
      </p>
      ${typeof debt.spamCount === 'number' && debt.spamCount > 0
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Spam count this scene:</span>
            <span class="dm-pc-detail-value">${debt.spamCount}</span>
          </p>`
        : nothing}
    </div>`;
  }

  private renderAlignmentDrift(
    drift: AlignmentDrift | undefined
  ): TemplateResult | typeof nothing {
    if (!drift) return nothing;
    const pips: TemplateResult[] = [];
    for (let i = 1; i <= 5; i++) {
      const filled = i <= drift.marks;
      pips.push(
        html`<span
          class="dm-pc-detail-drift-pip ${filled
            ? 'dm-pc-detail-drift-pip-filled'
            : ''}"
        ></span>`
      );
    }
    return html`<div class="dm-pc-detail-section">
      <h3>Alignment drift</h3>
      <p class="dm-pc-detail-row">
        <span class="dm-pc-detail-drift-pips">${pips}</span>
        <span class="dm-pc-detail-value muted">${drift.marks}/5</span>
      </p>
    </div>`;
  }

  private renderAccidentalGrants(
    grants: AccidentalGrant[] | undefined
  ): TemplateResult | typeof nothing {
    if (!grants || grants.length === 0) return nothing;
    return html`<div class="dm-pc-detail-section">
      <h3>Silent grants (Accidental phase)</h3>
      <ul class="dm-pc-detail-grants">
        ${grants.map(
          (g) => html`<li class="dm-pc-detail-grant">
            <span class="dm-pc-detail-grant-note">${g.note}</span>
            ${typeof g.ts === 'number'
              ? html`<span class="dm-pc-detail-grant-ts muted"
                  >· ${new Date(g.ts).toLocaleDateString()}</span
                >`
              : nothing}
          </li>`
        )}
      </ul>
    </div>`;
  }

  private renderDmNotes(
    notes: string | undefined
  ): TemplateResult | typeof nothing {
    if (!notes || notes.length === 0) return nothing;
    return html`<div class="dm-pc-detail-section">
      <h3>DM notes</h3>
      <p class="dm-pc-detail-notes">${notes}</p>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-pc-detail': DmPcDetail;
  }
}
