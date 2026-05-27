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
import { customElement, property, state } from 'lit/decorators.js';
import type {
  AccidentalGrant,
  AlignmentDrift,
  Focus,
  MagicPhase,
  TaxState,
  ThreadDebt
} from '../../character-loader';

export interface DmDetailView {
  pcId: string;
  pcName: string;
  magicPhase?: MagicPhase;
  knowsTheyCanCast?: boolean;
  tax?: TaxState;
  threadDebt?: ThreadDebt;
  accidentalGrants?: AccidentalGrant[];
  /**
   * Wave B (2026-05-26): foci granted to this PC.  Merge of
   * `record.foci` and `state.pcFoci[pcId]` (host responsibility);
   * the surface renders the union.
   */
  foci?: Focus[];
  alignmentDrift?: AlignmentDrift;
  dmNotes?: string;
}

/**
 * Wave B (2026-05-26): magic-arc runtime control callbacks.  Host
 * (quire-app) wires each to an `append*` method that fires the
 * corresponding coord-only event.  All four are no-op when the
 * host isn't the coord; the component hides the controls when the
 * callback is null.
 */
export type LogAccidentalGrantCallback = (
  pcId: string,
  note: string
) => boolean;
export type MarkRealizationCallback = (pcId: string) => boolean;
export type GrantFocusCallback = (
  pcId: string,
  focus: { name: string; domain?: string; notes?: string }
) => boolean;
export type ReleaseTaxCallback = (
  pcId: string,
  releaseMoment: string
) => boolean;

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
    (Array.isArray(view.foci) && view.foci.length > 0) ||
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

  /**
   * Wave B (2026-05-26): magic-arc DM runtime controls.  Each
   * callback is optional — when null, the corresponding affordance
   * doesn't render (host hides them for non-coord viewers / when
   * the surface isn't relevant).  Per TTRPG-expert anti-pattern
   * warning: these MUST be DM-typed, never AI-suggested at the
   * source; the silent-player-firewall principle requires the DM
   * to author silent grants in their own words.
   */
  @property({ attribute: false })
  onLogAccidentalGrant: LogAccidentalGrantCallback | null = null;
  @property({ attribute: false })
  onMarkRealization: MarkRealizationCallback | null = null;
  @property({ attribute: false })
  onGrantFocus: GrantFocusCallback | null = null;
  @property({ attribute: false })
  onReleaseTax: ReleaseTaxCallback | null = null;

  /** Inline editor state — drafts kept here so the host doesn't
   *  need to round-trip them through callbacks until commit. */
  @state() private grantDraft: string = '';
  @state() private focusNameDraft: string = '';
  @state() private focusDomainDraft: string = '';
  @state() private releaseDraft: string = '';
  @state() private confirmingRealization: boolean = false;
  /** Verifier S2: re-entry guard on the Realization commit (the
   *  multi-event batch is not atomic on the wire; double-click
   *  could send 8 pc-edits instead of 4 and reset
   *  tax.sessionsRemaining=3 mid-progression). */
  private realizationInFlight: boolean = false;
  /** Last-seen pcId so we can wipe drafts when the view switches.
   *  Verifier S1 fix: drafts persisted across PC navigation,
   *  causing a Mei-typed silent grant to commit against Iris's
   *  pcId if the DM navigated mid-compose. */
  private lastPcId: string | null = null;

  protected override willUpdate(
    changed: Map<string, unknown>
  ): void {
    // Verifier S1 fix: wipe inline drafts whenever the view's
    // pcId changes (DM navigates to a different PC).  Without
    // this, a draft typed on Mei could commit against Iris's
    // pcId on submit.  Confirm-dialog flag also resets so the
    // new PC doesn't render the Realization confirm UI.
    if (changed.has('view')) {
      const nextId = this.view?.pcId ?? null;
      if (nextId !== this.lastPcId) {
        this.grantDraft = '';
        this.focusNameDraft = '';
        this.focusDomainDraft = '';
        this.releaseDraft = '';
        this.confirmingRealization = false;
        this.lastPcId = nextId;
      }
    }
  }

  override render(): TemplateResult {
    const view = this.view;
    if (!view) return html``;
    // Empty-state: show the card header so the DM knows the
    // surface exists, but with a brief muted line — better than
    // hiding entirely (DM scanning expects the slot to be there).
    if (!hasAnyDmField(view) && !this.canEdit()) {
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
      ${this.renderFoci(view.foci)}
      ${this.renderDmNotes(view.dmNotes)}
      ${this.renderArcControls(view)}
    </section>`;
  }

  /** True when ANY write callback is wired (host is coord). */
  private canEdit(): boolean {
    return (
      this.onLogAccidentalGrant !== null ||
      this.onMarkRealization !== null ||
      this.onGrantFocus !== null ||
      this.onReleaseTax !== null
    );
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

  /**
   * Wave B (2026-05-26): foci list rendered with status pill.
   * Read-only here; status transitions land in a future wave.
   * Empty/undefined foci skip the section entirely.
   */
  private renderFoci(
    foci: Focus[] | undefined
  ): TemplateResult | typeof nothing {
    if (!foci || foci.length === 0) return nothing;
    return html`<div class="dm-pc-detail-section">
      <h3>Foci</h3>
      <ul class="dm-pc-detail-foci">
        ${foci.map(
          (f) => html`<li class="dm-pc-detail-focus">
            <span class="dm-pc-detail-focus-name">${f.name}</span>
            ${f.domain
              ? html`<span class="dm-pc-detail-focus-domain muted"
                  >· ${f.domain}</span
                >`
              : nothing}
            ${f.status
              ? html`<span
                  class="dm-pc-detail-focus-status"
                  data-status=${f.status}
                  >${f.status}</span
                >`
              : nothing}
            ${f.notes
              ? html`<div class="dm-pc-detail-focus-notes muted">
                  ${f.notes}
                </div>`
              : nothing}
          </li>`
        )}
      </ul>
    </div>`;
  }

  /**
   * Wave B (2026-05-26): magic-arc DM runtime controls.  Renders
   * the four beat-affordances gated by phase:
   *   - Log silent grant (always available pre-Realization)
   *   - Mark Realization (only when phase is undefined or
   *     accidental, AND knowsTheyCanCast is not yet true)
   *   - Grant focus (only when phase >= realization)
   *   - Release tax (only when tax.active is true)
   *
   * All affordances disabled when the host hasn't wired the
   * callback (non-coord viewer).
   */
  private renderArcControls(
    view: DmDetailView
  ): TemplateResult | typeof nothing {
    if (!this.canEdit()) return nothing;
    const phase = view.magicPhase ?? 'accidental';
    const realized = view.knowsTheyCanCast === true;
    const taxActive = view.tax?.active === true;
    const canLogGrant = this.onLogAccidentalGrant !== null;
    const canMarkRealization =
      this.onMarkRealization !== null && !realized;
    const canGrantFocus =
      this.onGrantFocus !== null &&
      (phase === 'realization' || phase === 'tax' || phase === 'free');
    const canReleaseTax = this.onReleaseTax !== null && taxActive;
    return html`<div
      class="dm-pc-detail-section dm-pc-detail-arc-controls"
    >
      <h3>Arc controls</h3>
      ${canLogGrant ? this.renderLogGrantForm(view) : nothing}
      ${canMarkRealization
        ? this.renderRealizationButton(view)
        : nothing}
      ${canGrantFocus ? this.renderGrantFocusForm(view) : nothing}
      ${canReleaseTax ? this.renderReleaseTaxForm(view) : nothing}
    </div>`;
  }

  private renderLogGrantForm(view: DmDetailView): TemplateResult {
    const canSubmit = this.grantDraft.trim().length > 0;
    return html`<div class="dm-pc-detail-arc-row">
      <label class="dm-pc-detail-arc-label">
        Log silent grant
        <span class="dm-pc-detail-arc-hint">
          A coincidence, a near-miss, a small aid the PC doesn't
          recognize as magical yet (rules.md:178).  DM-private; never
          shown to ${view.pcName}.
        </span>
      </label>
      <textarea
        rows="2"
        maxlength="200"
        class="dm-pc-detail-arc-text"
        placeholder="e.g., the keys were already in her hand"
        aria-label="Silent grant note for ${view.pcName}"
        .value=${this.grantDraft}
        @input=${(e: Event) => {
          this.grantDraft = (e.target as HTMLTextAreaElement).value;
        }}
      ></textarea>
      <button
        type="button"
        class="dm-pc-detail-arc-commit"
        ?disabled=${!canSubmit}
        @click=${() => this.commitLogGrant(view)}
      >
        Log grant
      </button>
    </div>`;
  }

  private renderRealizationButton(view: DmDetailView): TemplateResult {
    if (!this.confirmingRealization) {
      return html`<div class="dm-pc-detail-arc-row">
        <button
          type="button"
          class="dm-pc-detail-arc-realize"
          title="One-way story gate.  Activates the trying-too-hard tax (rules.md:180-184) and flips knowsTheyCanCast=true so the player can be told."
          @click=${() => {
            this.confirmingRealization = true;
          }}
        >
          Mark Realization…
        </button>
      </div>`;
    }
    return html`<div class="dm-pc-detail-arc-row dm-pc-detail-arc-confirm">
      <strong>Confirm Realization beat for ${view.pcName}?</strong>
      <p class="dm-pc-detail-arc-hint">
        One-way: sets phase=realization, knowsTheyCanCast=true, and
        activates the trying-too-hard tax for 3 sessions.  Narrate
        the beat in fiction first; this is the bookkeeping after.
      </p>
      <div class="dm-pc-detail-arc-confirm-actions">
        <button
          type="button"
          class="dm-pc-detail-arc-commit"
          @click=${() => this.commitMarkRealization(view)}
        >
          Confirm Realization
        </button>
        <button
          type="button"
          class="dm-pc-detail-arc-cancel"
          @click=${() => {
            this.confirmingRealization = false;
          }}
        >
          Cancel
        </button>
      </div>
    </div>`;
  }

  private renderGrantFocusForm(view: DmDetailView): TemplateResult {
    // Verifier S3: v1 UI captures name + domain only.  Engine
    // accepts condition / notes / status / boundFor on the same
    // event — expose those when the status-transition wave lands
    // (Wave C+).  Engine validation is the authoritative cap.
    // TODO Wave C: expose condition / notes / status / boundFor.
    const canSubmit = this.focusNameDraft.trim().length > 0;
    return html`<div class="dm-pc-detail-arc-row">
      <label class="dm-pc-detail-arc-label">
        Grant a focus
        <span class="dm-pc-detail-arc-hint">
          Player-visible.  Anchor of the recurring intent (rules.md:139).
          Once granted, ${view.pcName}'s rail surfaces it.
        </span>
      </label>
      <div class="dm-pc-detail-arc-focus-form">
        <input
          type="text"
          maxlength="80"
          placeholder="Focus name (e.g., pattern-sense)"
          aria-label="Focus name"
          .value=${this.focusNameDraft}
          @input=${(e: Event) => {
            this.focusNameDraft = (e.target as HTMLInputElement).value;
          }}
        />
        <input
          type="text"
          maxlength="200"
          placeholder="Domain (optional, e.g., perception)"
          aria-label="Focus domain"
          .value=${this.focusDomainDraft}
          @input=${(e: Event) => {
            this.focusDomainDraft = (e.target as HTMLInputElement).value;
          }}
        />
        <button
          type="button"
          class="dm-pc-detail-arc-commit"
          ?disabled=${!canSubmit}
          @click=${() => this.commitGrantFocus(view)}
        >
          Grant focus
        </button>
      </div>
    </div>`;
  }

  private renderReleaseTaxForm(view: DmDetailView): TemplateResult {
    const canSubmit = this.releaseDraft.trim().length > 0;
    return html`<div class="dm-pc-detail-arc-row">
      <label class="dm-pc-detail-arc-label">
        Release the tax
        <span class="dm-pc-detail-arc-hint">
          The release is a fiction beat (rules.md:182).  Type the
          moment in your own words; commit drops tax.active to false
          and records the moment.
        </span>
      </label>
      <textarea
        rows="2"
        maxlength="200"
        class="dm-pc-detail-arc-text"
        placeholder="e.g., she let her sister see the trick"
        aria-label="Release moment for ${view.pcName}"
        .value=${this.releaseDraft}
        @input=${(e: Event) => {
          this.releaseDraft = (e.target as HTMLTextAreaElement).value;
        }}
      ></textarea>
      <button
        type="button"
        class="dm-pc-detail-arc-commit"
        ?disabled=${!canSubmit}
        @click=${() => this.commitReleaseTax(view)}
      >
        Release tax
      </button>
    </div>`;
  }

  private commitLogGrant(view: DmDetailView): void {
    if (!this.onLogAccidentalGrant) return;
    const note = this.grantDraft.trim();
    if (note.length === 0) return;
    const ok = this.onLogAccidentalGrant(view.pcId, note);
    if (ok) this.grantDraft = '';
  }

  private commitMarkRealization(view: DmDetailView): void {
    if (!this.onMarkRealization) return;
    if (this.realizationInFlight) return; // Verifier S2: re-entry guard
    this.realizationInFlight = true;
    try {
      const ok = this.onMarkRealization(view.pcId);
      if (ok) this.confirmingRealization = false;
    } finally {
      this.realizationInFlight = false;
    }
  }

  private commitGrantFocus(view: DmDetailView): void {
    if (!this.onGrantFocus) return;
    const name = this.focusNameDraft.trim();
    if (name.length === 0) return;
    const domain = this.focusDomainDraft.trim();
    const ok = this.onGrantFocus(
      view.pcId,
      domain.length > 0 ? { name, domain } : { name }
    );
    if (ok) {
      this.focusNameDraft = '';
      this.focusDomainDraft = '';
    }
  }

  private commitReleaseTax(view: DmDetailView): void {
    if (!this.onReleaseTax) return;
    const moment = this.releaseDraft.trim();
    if (moment.length === 0) return;
    const ok = this.onReleaseTax(view.pcId, moment);
    if (ok) this.releaseDraft = '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-pc-detail': DmPcDetail;
  }
}
