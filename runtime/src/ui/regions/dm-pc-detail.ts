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
  Focus,
  MagicPhase,
  TaxState,
  ThreadDebt
} from '../../character-loader';
import type { CasterState, ThreadDebtLevel } from '../../core/state';
import './magic-arc-controls';
import type {
  LogAccidentalGrantCallback,
  MarkRealizationCallback,
  GrantFocusCallback,
  ReleaseTaxCallback,
  MagicArcControlsView
} from './magic-arc-controls';
// Wave C5 (2026-05-26) extraction: re-export the callback types
// from this module too, so any existing consumer that imported
// them from `dm-pc-detail` keeps compiling.  New consumers should
// import from `magic-arc-controls` directly.
export type {
  LogAccidentalGrantCallback,
  MarkRealizationCallback,
  GrantFocusCallback,
  ReleaseTaxCallback
} from './magic-arc-controls';

/**
 * Wave C4 (2026-05-26): thread-debt edit + spam-reset callbacks
 * moved here from `<dm-aside>` so the DM has ONE canonical home
 * for per-PC arc state (ui.md L170: "Thread-debt ladder lives
 * inside the Rail's active-PC card, not above Stage prose").
 * dm-aside is now PINNED-NPCS ONLY.
 *
 * Empty string in SetThreadDebtCallback clears the rung (no
 * antagonist attention).  Coord-only by enforcement at the host
 * layer; the component hides the affordances when the callback
 * is null (non-coord viewer).
 */
export type SetThreadDebtCallback = (
  pcId: string,
  level: ThreadDebtLevel | ''
) => void;
export type ResetSpamCounterCallback = (pcId: string) => void;

const THREAD_DEBT_OPTIONS: ReadonlyArray<{
  key: '' | ThreadDebtLevel;
  label: string;
}> = [
  { key: '', label: '— none —' },
  { key: 'quiet', label: 'quiet' },
  { key: 'noticed', label: 'noticed' },
  { key: 'watched', label: 'watched' },
  { key: 'pushing-back', label: 'pushing back' },
  { key: 'hunted', label: 'hunted' }
];

/**
 * Wave C5 verifier-N3 (2026-05-26): structurally extends
 * `MagicArcControlsView` so the parent → child view pass is a
 * direct assignment, not a hand-rolled mapper.  If a future field
 * gets added to `MagicArcControlsView` (e.g., bonds for D5), this
 * extension means TypeScript catches the missing field at the
 * parent boundary instead of silently under-forwarding it.
 */
export interface DmDetailView extends MagicArcControlsView {
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

// (Wave C5: callback types now live in `./magic-arc-controls.ts`
// and are re-exported above for back-compat with existing
// consumers that import them from `dm-pc-detail`.)

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

  /**
   * Wave C4 (2026-05-26): thread-debt edit + spam-reset
   * affordances consolidated here from dm-aside (UX expert: "Rail
   * wins as the canonical home; dm-aside sheds thread-debt +
   * caster-state entirely").  When the callback is null, the
   * surface remains read-only — same gate the inline arc-controls
   * pattern uses.
   *
   * `casterState[pcId]` carries the live in-session spamCount the
   * `caster-state-set` event tracks (separate from the
   * `threadDebt.spamCount` field on the character record — the
   * shared-state caster is the scene-boundary counter).
   */
  @property({ attribute: false })
  onSetThreadDebt: SetThreadDebtCallback | null = null;
  @property({ attribute: false })
  onResetSpamCounter: ResetSpamCounterCallback | null = null;
  /** Verifier N2 (2026-05-26): asymmetry vs. the `DmDetailView`
   *  arc-state fields (which use `undefined`) is intentional.
   *  `null` here means "host explicitly said no caster-state for
   *  this PC right now"; `undefined` would mean "host hasn't told
   *  me yet."  The host at quire-app.ts coalesces `?? null` to
   *  make the distinction explicit.  Do NOT normalize to
   *  `undefined`. */
  @property({ attribute: false })
  casterState: CasterState | null = null;

  // (Wave C5: inline-draft state + willUpdate guard moved into the
  // <magic-arc-controls> child component along with the arc-control
  // render methods.  This file stays a read-only renderer; arc
  // beat-affordances live in the child.)

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
      ${this.renderArcControlsChild(view)}
    </section>`;
  }

  /** True when ANY write callback is wired (host is coord).
   *  Used by the empty-state guard at the top of render() so the
   *  card stays visible for a coord even when there's nothing yet
   *  to display — the DM needs to see the surface exists. */
  private canEdit(): boolean {
    return (
      this.onLogAccidentalGrant !== null ||
      this.onMarkRealization !== null ||
      this.onGrantFocus !== null ||
      this.onReleaseTax !== null ||
      this.onSetThreadDebt !== null ||
      this.onResetSpamCounter !== null
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

  /**
   * Wave C4 (2026-05-26): thread-debt + spam-reset surface
   * consolidated from dm-aside.  Renders:
   *   - Rung readout / inline selector (selector when
   *     `onSetThreadDebt` is wired)
   *   - Reset-spam chip when shared-state casterState.spamCount > 0
   *     AND `onResetSpamCounter` is wired
   *
   * Section appears when EITHER the disk-loaded debt is present
   * OR the host wired the edit callback (so the DM can SET an
   * initial rung from this surface even on a PC with no prior
   * thread-debt).  Read-only `debt.spamCount` (the character-
   * record field) still displays in addition to the live
   * casterState chip — they're separate concepts the rules track
   * differently and the DM may want to see both.
   */
  private renderThreadDebt(
    debt: ThreadDebt | undefined
  ): TemplateResult | typeof nothing {
    const view = this.view;
    if (!view) return nothing;
    const liveSpam = this.casterState?.spamCount ?? 0;
    const editable = this.onSetThreadDebt !== null;
    const canResetSpam = liveSpam > 0 && this.onResetSpamCounter !== null;
    // If nothing to show AND nothing the DM can do here, skip.
    if (!debt && !editable && !canResetSpam) return nothing;
    const currentRung = debt?.rung ?? '';
    return html`<div class="dm-pc-detail-section">
      <h3>Antagonist attention</h3>
      <p class="dm-pc-detail-row">
        <span class="dm-pc-detail-label">Rung:</span>
        ${editable
          ? html`<select
              class="dm-pc-detail-thread-debt-select"
              aria-label="Thread debt rung for ${view.pcName}"
              @change=${(e: Event) =>
                this.onSetThreadDebt?.(
                  view.pcId,
                  (e.target as HTMLSelectElement).value as
                    | ThreadDebtLevel
                    | ''
                )}
            >
              ${THREAD_DEBT_OPTIONS.map(
                (o) => html`<option
                  value=${o.key}
                  ?selected=${o.key === currentRung}
                >
                  ${o.label}
                </option>`
              )}
            </select>`
          : html`<span class="dm-pc-detail-value"
              >${debt
                ? THREAD_DEBT_LABEL[debt.rung] ?? debt.rung
                : '—'}</span
            >`}
      </p>
      ${canResetSpam
        ? html`<p class="dm-pc-detail-row">
            <button
              type="button"
              class="dm-pc-detail-spam-reset"
              title="${view.pcName} has ${liveSpam} Free/Cheap casts this scene — reset on scene boundary"
              @click=${() => this.onResetSpamCounter?.(view.pcId)}
            >
              ${liveSpam} casts this scene · reset
            </button>
          </p>`
        : nothing}
      ${debt && typeof debt.spamCount === 'number' && debt.spamCount > 0
        ? html`<p class="dm-pc-detail-row">
            <span class="dm-pc-detail-label">Persistent spam count:</span>
            <span class="dm-pc-detail-value">${debt.spamCount}</span>
          </p>`
        : nothing}
    </div>`;
  }

  /**
   * Wave D-prep-2-C (T-LT2 2026-05-26): collapsed 5-pip widget to
   * a one-line counter.  TTRPG + UX both flagged the pip widget
   * as "ceremony where prose belongs" — rules.md:170 says
   * "DM privately notes... resolves via conversation."  A pip
   * widget is glance-bait for a mechanic the rules explicitly say
   * is conversational + DM-internal.  Counter format keeps the
   * number scannable + cues the "have the conversation at 5"
   * trigger without inviting cross-PC pip comparison the rules
   * don't intend.
   */
  private renderAlignmentDrift(
    drift: AlignmentDrift | undefined
  ): TemplateResult | typeof nothing {
    if (!drift) return nothing;
    const due = drift.marks >= 5;
    return html`<div class="dm-pc-detail-section">
      <h3>Alignment drift</h3>
      <p class="dm-pc-detail-row">
        <span class="dm-pc-detail-label">Marks:</span>
        <span class="dm-pc-detail-value">${drift.marks} / 5</span>
        ${due
          ? html`<span
              class="dm-pc-detail-drift-due"
              title="rules.md:170 — at 5 marks, schedule a realignment conversation with the player"
              >conversation due</span
            >`
          : nothing}
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
   * Wave C5 (2026-05-26): arc-controls render extracted to the
   * `<magic-arc-controls>` child component.  This method is now a
   * thin delegation that passes through the view subset + callbacks.
   * The child owns its own draft state + willUpdate guard +
   * re-entry guard.
   *
   * The child renders nothing when no callback is wired (non-coord
   * viewer) — same gate the inline version had.
   */
  private renderArcControlsChild(
    view: DmDetailView
  ): TemplateResult | typeof nothing {
    if (!this.canEdit()) return nothing;
    // Wave C5 verifier-N3: DmDetailView extends MagicArcControlsView,
    // so the view is directly assignable.  Lit ignores extra props
    // on the prop value (no run-time hazard); TS catches any future
    // MagicArcControlsView field that DmDetailView would otherwise
    // silently fail to forward.
    return html`<magic-arc-controls
      .view=${view}
      .onLogAccidentalGrant=${this.onLogAccidentalGrant}
      .onMarkRealization=${this.onMarkRealization}
      .onGrantFocus=${this.onGrantFocus}
      .onReleaseTax=${this.onReleaseTax}
    ></magic-arc-controls>`;
  }
  // (Wave C5: original renderArcControls + 4 form-renders + 4 commit
  // handlers + commit-and-draft state moved to <magic-arc-controls>.)
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-pc-detail': DmPcDetail;
  }
}
