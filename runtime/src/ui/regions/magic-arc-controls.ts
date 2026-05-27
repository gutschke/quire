// @vitest-environment happy-dom

/**
 * <magic-arc-controls> — Wave C5 (2026-05-26) extraction from
 * `dm-pc-detail.ts`.  The four magic-arc beat-affordances live as
 * an isolated child component so:
 *
 *   - dm-pc-detail keeps its read-only render small (~440 LOC
 *     after this extraction, was ~620);
 *   - the same render pattern can serve future arc-beat surfaces
 *     (D5 bonds with name+intent+commit, eventually retire-flow
 *     for non-magic PCs) without copy-paste;
 *   - per the engineering audit on 2026-05-26 + the practice memo
 *     `feedback_engineering_practices_from_reviews.md`, the
 *     willUpdate draft-leak protection lives WITH the drafts, not
 *     in the parent — moving the drafts means moving the guard.
 *
 * **TTRPG firewall (preserved from Wave B):**
 *   - Log silent grant: always available when `onLogAccidentalGrant`
 *     is wired (DM-only callback null for non-coord viewers).
 *   - Mark Realization: only when `knowsTheyCanCast !== true`;
 *     confirm dialog + re-entry guard prevents the half-applied
 *     batch the Wave D-prep-2 atomic event replaced.
 *   - Grant focus: only when magicPhase >= 'realization'.  Engine
 *     does NOT enforce this gate (engine-vs-campaign-policy
 *     boundary); the UI is the firewall.
 *   - Release tax: only when tax.active === true.
 *
 * **DM-typed-only invariant:** none of these forms accept AI-
 * suggested defaults.  Per the TTRPG-expert anti-pattern recorded
 * in `holistic-review-2026-05-26.md`, the DM authors silent-grant
 * text and release-moment text from scratch — the silent-player-
 * firewall principle requires it.  Do NOT add AI scaffolding to
 * the placeholders.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { MagicPhase, TaxState } from '../../character-loader';

/**
 * Minimal subset of `DmDetailView` the controls actually read.
 * Keeping this narrow makes the component reusable for future
 * arc-beat surfaces that don't carry the full DM-detail shape.
 */
export interface MagicArcControlsView {
  pcId: string;
  pcName: string;
  magicPhase?: MagicPhase;
  knowsTheyCanCast?: boolean;
  tax?: TaxState;
}

/**
 * Callback shapes — moved here from dm-pc-detail.ts as part of the
 * extraction so the component owns its contract.  Re-exported from
 * dm-pc-detail.ts for back-compat with existing consumers.
 */
export type LogAccidentalGrantCallback = (
  pcId: string,
  note: string
) => boolean;
export type MarkRealizationCallback = (pcId: string) => boolean;
export type GrantFocusCallback = (
  pcId: string,
  focus: {
    name: string;
    domain?: string;
    /**
     * Wave D-prep-2-B (T-LT4 2026-05-26): in-fiction trigger that
     * lets AI write API + session-digest reason about WHEN the
     * focus applies (rules.md:139 "have a domain... and only
     * apply within it" — condition IS the in-fiction trigger).
     * DM-typed.  Player-visible at Realization per the same rule
     * as `domain` — both describe the focus to its owner.
     */
    condition?: string;
    notes?: string;
  }
) => boolean;
export type ReleaseTaxCallback = (
  pcId: string,
  releaseMoment: string
) => boolean;

@customElement('magic-arc-controls')
export class MagicArcControls extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) view: MagicArcControlsView | null = null;

  @property({ attribute: false })
  onLogAccidentalGrant: LogAccidentalGrantCallback | null = null;
  @property({ attribute: false })
  onMarkRealization: MarkRealizationCallback | null = null;
  @property({ attribute: false })
  onGrantFocus: GrantFocusCallback | null = null;
  @property({ attribute: false })
  onReleaseTax: ReleaseTaxCallback | null = null;

  /** Inline editor state — drafts kept locally so the host doesn't
   *  need to round-trip them through callbacks until commit. */
  @state() private grantDraft: string = '';
  @state() private focusNameDraft: string = '';
  @state() private focusDomainDraft: string = '';
  /** Wave D-prep-2-B (T-LT4): in-fiction trigger phrasing.
   *  Optional; when present, threaded through onGrantFocus.payload. */
  @state() private focusConditionDraft: string = '';
  @state() private releaseDraft: string = '';
  @state() private confirmingRealization: boolean = false;

  /** Re-entry guard on the Realization commit.  Even with the
   *  Wave D-prep-2 atomic event, network blips or rapid double-
   *  clicks shouldn't fire the event twice — re-emitting a
   *  realization event harmlessly re-applies the same state, but
   *  the `tax.sessionsRemaining=3` reset would clobber any
   *  progress the DM had clicked down in between.
   *
   *  Verifier N6 (2026-05-26): the guard is synchronous because
   *  `onMarkRealization` is synchronous (returns boolean).  If the
   *  callback ever becomes async, this guard becomes load-bearing
   *  — wrap the body in await + extend the guard window across
   *  the awaited call. */
  private realizationInFlight: boolean = false;

  /** Last-seen pcId so we can wipe drafts when the view switches.
   *
   *  **Why this matters** (practice memo
   *  `feedback_engineering_practices_from_reviews.md` #2): inline
   *  `@state` drafts persist across renders.  If the parent
   *  re-uses the same `<magic-arc-controls>` instance for different
   *  PCs (which Lit does when only `.view` changes), a draft typed
   *  on Mei would commit against Iris's pcId on submit.  Mirrors
   *  the dm-pc-detail willUpdate guard that originally caught this
   *  in Wave B verifier S1. */
  private lastPcId: string | null = null;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('view')) {
      const nextId = this.view?.pcId ?? null;
      if (nextId !== this.lastPcId) {
        this.grantDraft = '';
        this.focusNameDraft = '';
        this.focusDomainDraft = '';
        this.focusConditionDraft = '';
        this.releaseDraft = '';
        this.confirmingRealization = false;
        this.lastPcId = nextId;
      }
    }
  }

  override render(): TemplateResult | typeof nothing {
    const view = this.view;
    if (!view) return nothing;
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

  /** True when ANY write callback is wired (host is coord).
   *
   *  Verifier N2 (2026-05-26): also gated by the parent (`dm-pc-detail`
   *  early-returns this whole render when `canEdit()` fails at its
   *  layer).  This child-side gate is defense-in-depth — kept for
   *  direct-mount scenarios (the component is independently testable
   *  per `magic-arc-controls.test.ts`, and a future host might mount
   *  it outside dm-pc-detail). */
  private canEdit(): boolean {
    return (
      this.onLogAccidentalGrant !== null ||
      this.onMarkRealization !== null ||
      this.onGrantFocus !== null ||
      this.onReleaseTax !== null
    );
  }

  private renderLogGrantForm(view: MagicArcControlsView): TemplateResult {
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

  private renderRealizationButton(
    view: MagicArcControlsView
  ): TemplateResult {
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

  private renderGrantFocusForm(view: MagicArcControlsView): TemplateResult {
    // Wave D-prep-2-B (T-LT4 2026-05-26): added `condition` row.
    // Rules.md:139 treats condition as the in-fiction trigger
    // that lets AI write API + session-digest reason about WHEN
    // the focus applies — without it, downstream automation
    // can't compose with focus state intelligently.  `notes` /
    // `status` / `boundFor` deferred (still outside the v1 form
    // surface area).  Adversarial Finding A (D-prep-2-A) closed
    // the matching save-stream leak so condition can land safely.
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
        <input
          type="text"
          maxlength="200"
          placeholder="Condition (optional, e.g., when held in moonlight)"
          aria-label="Focus condition — the in-fiction trigger"
          title="Player-visible.  When the focus 'fires' — the in-fiction trigger phrase the AI write API + session-digest use to reason about WHEN the focus applies (rules.md:139)."
          .value=${this.focusConditionDraft}
          @input=${(e: Event) => {
            this.focusConditionDraft = (e.target as HTMLInputElement).value;
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

  private renderReleaseTaxForm(view: MagicArcControlsView): TemplateResult {
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

  private commitLogGrant(view: MagicArcControlsView): void {
    if (!this.onLogAccidentalGrant) return;
    const note = this.grantDraft.trim();
    if (note.length === 0) return;
    const ok = this.onLogAccidentalGrant(view.pcId, note);
    if (ok) this.grantDraft = '';
  }

  private commitMarkRealization(view: MagicArcControlsView): void {
    if (!this.onMarkRealization) return;
    if (this.realizationInFlight) return;
    this.realizationInFlight = true;
    try {
      const ok = this.onMarkRealization(view.pcId);
      if (ok) this.confirmingRealization = false;
    } finally {
      this.realizationInFlight = false;
    }
  }

  private commitGrantFocus(view: MagicArcControlsView): void {
    if (!this.onGrantFocus) return;
    const name = this.focusNameDraft.trim();
    if (name.length === 0) return;
    const domain = this.focusDomainDraft.trim();
    const condition = this.focusConditionDraft.trim();
    // Build payload conditionally so undefined optional fields
    // don't land in the event log.  D-prep-2-A scrub treats
    // condition as player-visible — DM intends it as the in-
    // fiction trigger phrase, which IS player-safe (the player
    // sees their own focus's trigger).  Different from
    // boundFor/notes which D-prep-2-A scrubs from player saves.
    const payload: {
      name: string;
      domain?: string;
      condition?: string;
    } = { name };
    if (domain.length > 0) payload.domain = domain;
    if (condition.length > 0) payload.condition = condition;
    const ok = this.onGrantFocus(view.pcId, payload);
    if (ok) {
      this.focusNameDraft = '';
      this.focusDomainDraft = '';
      this.focusConditionDraft = '';
    }
  }

  private commitReleaseTax(view: MagicArcControlsView): void {
    if (!this.onReleaseTax) return;
    const moment = this.releaseDraft.trim();
    if (moment.length === 0) return;
    const ok = this.onReleaseTax(view.pcId, moment);
    if (ok) this.releaseDraft = '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'magic-arc-controls': MagicArcControls;
  }
}
