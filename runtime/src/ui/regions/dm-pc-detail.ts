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
import type { CasterState, ThreadDebtLevel } from '../../core/state';
import './magic-arc-controls';
import '../field-renderers/bonds-card';
import {
  DM_ASIDE_BOND_NAV_EVENT,
  type DmAsideBondNavDetail
} from './dm-aside';
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
  /**
   * D5 (2026-05-27): ratified bonds for this PC.  Host builds
   * these from `state.pcBonds[pcId]` + target-label lookups.
   * Empty array when none; per-entry `dmNotes` is visible here
   * (DM view); rendered via `<bonds-card>` with editablePcId set.
   */
  bonds?: import('../field-renderers/bonds-card').BondsCardEntry[];
  /**
   * D5 (2026-05-27): pending bond proposals for this PC awaiting
   * DM ratification.  Empty array when none.  Each entry has
   * `id`, `targetPcId`, `targetLabel`, `text`, `proposedByPeerId`.
   */
  bondProposals?: Array<{
    id: string;
    targetPcId: string;
    targetLabel: string;
    text: string;
    proposedByPeerId: string;
    /**
     * D5.5-B: true when this is a chargen PLACEHOLDER bond — the
     * target is a free-text string (`targetLabel`) the player
     * typed, with no real `targetPcId` yet.  The DM MUST resolve
     * it to a real PC (via the ratify-form picker) before the
     * bond can be ratified.
     */
    unresolved?: boolean;
    /**
     * D5.5-B (2026-05-28): campaign spoiler tokens found in the
     * player-authored bond text / placeholder.  Non-empty → the
     * DM sees an amber "possible spoiler" warning before ratify.
     * DM-only (silent-player-firewall).
     */
    spoilerHits?: string[];
  }>;
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
    (typeof view.dmNotes === 'string' && view.dmNotes.length > 0) ||
    (Array.isArray(view.bonds) && view.bonds.length > 0) ||
    (Array.isArray(view.bondProposals) && view.bondProposals.length > 0)
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

  /**
   * D5 (2026-05-27): bond callbacks — coord-only.  Host wires
   * to `QuireApp.ratifyBond` / `QuireApp.removeBond`.  Null when
   * the host wants read-only.
   */
  @property({ attribute: false })
  onRatifyBond:
    | ((
        pcId: string,
        id: string,
        opts?: { dmNotes?: string; targetPcId?: string }
      ) => void)
    | null = null;
  @property({ attribute: false })
  onRemoveBond: ((pcId: string, id: string) => void) | null = null;
  /**
   * D5.5-B: candidate PCs the DM can resolve a placeholder bond's
   * target to (other bound-active PCs in the campaign).  Host
   * builds via `bondTargetCandidates`.  Empty/absent → the resolve
   * picker shows a "no other PCs yet" notice.
   */
  @property({ attribute: false })
  bondTargetCandidates: Array<{ pcId: string; name: string }> = [];

  /**
   * D5-C-fix (2026-05-27 scenario-playthrough TTRPG-B / UX-3):
   * which proposal id (if any) has its dmNotes-inline-form open.
   * Local-only @state; cleared on ratify / cancel.  Allows the
   * DM to add a spoiler-anchor dmNotes string before clicking
   * the final "Ratify" — the engine already accepted dmNotes;
   * D5-C shipped without exposing it.
   */
  @state() private bondRatifyOpenId: string | null = null;
  @state() private bondRatifyDmNotes: string = '';
  /**
   * D5.5-B: the real targetPcId the DM picked to resolve a
   * placeholder bond.  Empty until the DM selects from the picker.
   * Only meaningful when the open proposal is `unresolved`.
   */
  @state() private bondRatifyTargetPcId: string = '';
  /**
   * UX-polish (2026-05-27 post-D5 sweep): two-step reject confirm.
   * Reject was one-click destructive; only recovery was
   * interpersonal ("hey Bob, propose that again").  Now: first
   * click stages the rejection; second click commits; Cancel
   * dismisses.  Per UX-expert scenario S5.
   */
  @state() private bondRejectConfirmId: string | null = null;

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
      ${this.renderBonds(view)}
      ${this.renderBondProposals(view)}
    </section>`;
  }

  /**
   * D5 (2026-05-27): render the ratified bonds list for the DM
   * view.  Per-entry `dmNotes` visible here.  Delete callback
   * removes the bond (coord-only).  Hidden when no bonds.
   */
  private renderBonds(view: DmDetailView): TemplateResult | typeof nothing {
    const bonds = view.bonds ?? [];
    if (bonds.length === 0) return nothing;
    return html`<div class="dm-pc-detail-section">
      <bonds-card
        .bonds=${bonds}
        .editablePcId=${view.pcId}
        .onRemove=${this.onRemoveBond
          ? (pcId: string, id: string) => this.onRemoveBond?.(pcId, id)
          : null}
      ></bonds-card>
    </div>`;
  }

  /**
   * UX-polish (2026-05-27 post-D5 sweep): listen for the dm-aside
   * "Review on PC sheet →" navigation event + scroll the bond-
   * proposals section into view when the DM lands here from the
   * queue.  No-op when no matching pcId; tolerant of missing DOM.
   */
  private readonly bondNavHandler = (e: Event): void => {
    const detail = (e as CustomEvent<DmAsideBondNavDetail>).detail;
    if (!this.view || !detail || detail.pcId !== this.view.pcId) return;
    // Defer to next frame so the navigation has completed +
    // dm-pc-detail has had a chance to (re)render.
    requestAnimationFrame(() => {
      const target = this.querySelector('.dm-pc-detail-bond-proposals');
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(DM_ASIDE_BOND_NAV_EVENT, this.bondNavHandler);
  }

  override disconnectedCallback(): void {
    window.removeEventListener(DM_ASIDE_BOND_NAV_EVENT, this.bondNavHandler);
    super.disconnectedCallback();
  }

  /**
   * D5 (2026-05-27): pending bond proposals awaiting DM
   * ratification.  Each row shows the proposed bond text + target
   * + the player who proposed it.  Two flows:
   *
   *   1. "Ratify…" expands an inline form with an optional
   *      `dmNotes` textarea (D5-C-fix #1, per scenario-playthrough
   *      TTRPG-B + UX-3): the engine has always accepted dmNotes;
   *      D5-C shipped without exposing the input, silently
   *      breaking the "DM owns fit" half of the locked design.
   *      Final "Ratify" button inside the form commits with the
   *      optional dmNotes payload + a "broadcasts to all players"
   *      hint.
   *   2. "Reject" removes the proposal silently (no warning;
   *      player doesn't see proposals so they can't be confused
   *      by silent removal — see Adv-Scenario-3).
   */
  private renderBondProposals(
    view: DmDetailView
  ): TemplateResult | typeof nothing {
    const proposals = view.bondProposals ?? [];
    if (proposals.length === 0) return nothing;
    return html`<div class="dm-pc-detail-section dm-pc-detail-bond-proposals">
      <h3>Pending bond proposals (${proposals.length})</h3>
      <ul class="dm-pc-detail-bond-proposal-list">
        ${proposals.map((p) => this.renderBondProposalRow(view, p))}
      </ul>
    </div>`;
  }

  private renderBondProposalRow(
    view: DmDetailView,
    p: NonNullable<DmDetailView['bondProposals']>[number]
  ): TemplateResult {
    const isOpen = this.bondRatifyOpenId === p.id;
    return html`<li class="dm-pc-detail-bond-proposal">
      <p>
        <strong>${p.targetLabel}</strong>
        ${p.unresolved
          ? html`<span
              class="dm-pc-detail-bond-unresolved"
              title="Player-typed target — pick a real PC below to ratify"
              >· unresolved</span
            >`
          : nothing}
        <span class="muted"> · ${p.proposedByPeerId}</span>
      </p>
      <p class="dm-pc-detail-bond-proposal-text">${p.text}</p>
      ${p.spoilerHits && p.spoilerHits.length > 0
        ? html`<p
            class="dm-pc-detail-bond-spoiler"
            role="note"
            title="The player's text mentions campaign secrets.  Ratifying broadcasts it to all players.  Edit or reject if it would spoil."
          >
            ⚠ possible spoiler: ${p.spoilerHits.join(', ')}
          </p>`
        : nothing}
      ${isOpen
        ? this.renderBondRatifyForm(view.pcId, p)
        : this.bondRejectConfirmId === p.id
          ? html`<div class="dm-pc-detail-bond-proposal-actions">
              <span class="dm-pc-detail-bond-reject-prompt"
                >Reject this proposal?  No undo.</span
              >
              <button
                type="button"
                class="dm-pc-detail-bond-reject-confirm"
                @click=${() => this.confirmBondReject(view.pcId, p.id)}
              >
                Confirm reject
              </button>
              <button
                type="button"
                class="dm-pc-detail-bond-reject-cancel"
                @click=${() => this.cancelBondReject()}
              >
                Cancel
              </button>
            </div>`
          : html`<div class="dm-pc-detail-bond-proposal-actions">
              ${this.onRatifyBond
                ? html`<button
                    type="button"
                    class="dm-pc-detail-bond-ratify"
                    @click=${() => this.openBondRatifyForm(p.id)}
                  >
                    Ratify…
                  </button>`
                : nothing}
              ${this.onRemoveBond
                ? html`<button
                    type="button"
                    class="dm-pc-detail-bond-reject"
                    @click=${() => this.stageBondReject(p.id)}
                  >
                    Reject
                  </button>`
                : nothing}
            </div>`}
    </li>`;
  }

  private stageBondReject(id: string): void {
    this.bondRejectConfirmId = id;
  }

  private cancelBondReject(): void {
    this.bondRejectConfirmId = null;
  }

  private confirmBondReject(pcId: string, id: string): void {
    if (this.onRemoveBond) this.onRemoveBond(pcId, id);
    this.bondRejectConfirmId = null;
  }

  private renderBondRatifyForm(
    pcId: string,
    p: NonNullable<DmDetailView['bondProposals']>[number]
  ): TemplateResult {
    // D5.5-B: a placeholder bond can't be ratified until the DM
    // resolves its free-text target to a real PC.  Candidates
    // exclude this PC itself (host-filtered).  Ratify stays
    // disabled until a target is picked.
    const candidates = this.bondTargetCandidates.filter(
      (c) => c.pcId !== pcId
    );
    const needsResolve = p.unresolved === true;
    const resolveReady = !needsResolve || this.bondRatifyTargetPcId !== '';
    return html`<div class="dm-pc-detail-bond-ratify-form">
      ${needsResolve
        ? html`<label class="dm-pc-detail-bond-ratify-label">
            Resolve target — the player wrote
            <em>"${p.targetLabel}"</em>; pick the real PC:
            ${candidates.length === 0
              ? html`<span class="muted dm-pc-detail-bond-resolve-empty"
                  >No other PCs to bond to yet.  The target PC must be
                  created first.</span
                >`
              : html`<select
                  class="dm-pc-detail-bond-resolve-target"
                  .value=${this.bondRatifyTargetPcId}
                  @change=${(e: Event) => {
                    this.bondRatifyTargetPcId = (
                      e.target as HTMLSelectElement
                    ).value;
                  }}
                >
                  <option value="">— pick a PC —</option>
                  ${candidates.map(
                    (c) =>
                      html`<option value=${c.pcId}>${c.name}</option>`
                  )}
                </select>`}
          </label>`
        : nothing}
      <label class="dm-pc-detail-bond-ratify-label">
        DM-only spoiler anchor (optional)
        <textarea
          class="dm-pc-detail-bond-ratify-notes"
          rows="3"
          maxlength="2000"
          placeholder="e.g., Iris saw Mei cast accidentally in their first year."
          .value=${this.bondRatifyDmNotes}
          @input=${(e: Event) => {
            this.bondRatifyDmNotes = (
              e.target as HTMLTextAreaElement
            ).value;
          }}
        ></textarea>
      </label>
      <p class="muted dm-pc-detail-bond-ratify-hint">
        Ratifying broadcasts the bond text to all players.  Spoiler
        anchor stays DM-only.
      </p>
      <div class="dm-pc-detail-bond-proposal-actions">
        <button
          type="button"
          class="dm-pc-detail-bond-ratify"
          ?disabled=${!resolveReady}
          title=${needsResolve && !resolveReady
            ? 'Pick a target PC first'
            : 'Ratify this bond'}
          @click=${() => this.submitBondRatify(pcId, p.id)}
        >
          Ratify bond
        </button>
        <button
          type="button"
          class="dm-pc-detail-bond-reject"
          @click=${() => this.cancelBondRatifyForm()}
        >
          Cancel
        </button>
      </div>
    </div>`;
  }

  private openBondRatifyForm(id: string): void {
    this.bondRatifyOpenId = id;
    this.bondRatifyDmNotes = '';
    this.bondRatifyTargetPcId = '';
  }

  private cancelBondRatifyForm(): void {
    this.bondRatifyOpenId = null;
    this.bondRatifyDmNotes = '';
    this.bondRatifyTargetPcId = '';
  }

  private submitBondRatify(pcId: string, id: string): void {
    if (!this.onRatifyBond) return;
    const notes = this.bondRatifyDmNotes.trim();
    const target = this.bondRatifyTargetPcId.trim();
    const opts: { dmNotes?: string; targetPcId?: string } = {};
    if (notes.length > 0) opts.dmNotes = notes;
    if (target.length > 0) opts.targetPcId = target;
    this.onRatifyBond(
      pcId,
      id,
      Object.keys(opts).length > 0 ? opts : undefined
    );
    this.cancelBondRatifyForm();
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
