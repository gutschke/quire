// @vitest-environment happy-dom

/**
 * <dm-operational-view> — the DM-only "engineering reality"
 * surface (per `ux-strategy.md` locked principle 3 + DEC-029).
 *
 * # Why this exists as a discrete surface
 *
 * DEC-029 (run #8): instead of embedding `<backups-card>` as an
 * inline card inside the existing campaign render path, we
 * stand up the operational view as its own AppMode.  Three
 * reasons:
 *
 *   1. The ux-strategy.md locked principle 3 specified a
 *      separate hidden advanced surface for engineering reality
 *      — admitting the surface into the play cockpit would
 *      contradict the doc set the program has been writing
 *      toward.
 *   2. Future engineering-reality surfaces (local autosave
 *      health, eviction status, account-mismatch chip,
 *      browser-storage budget) want a single home.  Inlining
 *      each as a card on the play cockpit would multiply
 *      surfaces.
 *   3. Silent-player firewall is cleaner: one
 *      `appMode === 'dm-operational'` short-circuit + one
 *      `isCoordinator()` short-circuit covers the whole surface.
 *
 * # What this surface contains today
 *
 * - Backups (M6a-FS via `<backups-card>`; M6a-OAuth's parallel
 *   "My Drive" line lands inside the same card later).
 *
 * # What this surface will contain later
 *
 * - Local autosave health line (eviction status, last-flush
 *   time).
 * - Browser-storage budget chip (NEW-PRV-1 / persisted-storage
 *   visibility).
 * - Account-mismatch chip (NEW-SEC-4 — when M6a-OAuth ships).
 * - Manual-save download button (already exists in saveToFile;
 *   could migrate here for consistency).
 *
 * # Silent-player firewall
 *
 * Defense-in-depth: this element renders an empty `nothing`
 * when `renderForDm` is false.  The host gates the render at
 * `quire-app.ts`'s renderBody dispatch (appMode +
 * isCoordinator).  Both gates must pass for the surface to be
 * visible.  A player who somehow lands on this mode sees the
 * "DM is administering" placeholder (similar to the
 * `session-open` mode's player-side fallback).
 *
 * # Closing the surface
 *
 * Escape key returns to `'in-session'`.  The host listens for
 * the `dm-operational-close` custom event; this element fires
 * it on the Close button and on the Escape keydown.  The host
 * is the source of truth for the appMode transition.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './backups-card';
import type { FsApiCloudPush } from '../../auth/fs-api-cloud-push';
import type { RequestFsApiConsent } from './backups-card';

@customElement('dm-operational-view')
export class DmOperationalView extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Host-gated DM-only flag.  Player viewers MUST see nothing
   * (or a generic placeholder if they end up here via URL).
   */
  @property({ type: Boolean })
  renderForDm: boolean = false;

  /**
   * Campaign whose operational state we're surfacing.  Empty
   * string → render the "no active session" placeholder.
   */
  @property({ type: String })
  campaignId: string = '';

  /**
   * The host's wired FS-API cloud push.  Null while loading or
   * when the host hasn't built one yet.  Passed through to
   * `<backups-card>`.
   */
  @property({ attribute: false })
  fsApiCloudPush: FsApiCloudPush | null = null;

  /**
   * Host callback for the FS-API consent ceremony.  Passed
   * through to `<backups-card>`.
   */
  @property({ attribute: false })
  requestFsApiConsent: RequestFsApiConsent | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private readonly handleKeydown = (e: KeyboardEvent): void => {
    if (!this.renderForDm) return;
    if (e.key !== 'Escape') return;
    // Don't steal Escape from a child surface that's already
    // handling it (e.g. the consent dialog).  Check focus.
    const inside = document.activeElement?.closest(
      'cloud-push-consent-dialog'
    );
    if (inside) return;
    e.preventDefault();
    this.requestClose();
  };

  private requestClose(): void {
    this.dispatchEvent(
      new CustomEvent('dm-operational-close', {
        bubbles: true,
        composed: true
      })
    );
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.renderForDm) {
      // Player-side fallback per the session-open mode pattern.
      // We acknowledge that the DM is doing something so the
      // player isn't confused by an unexplained empty body —
      // but we leak no information about WHAT.
      return html`<section class="card dm-operational-player-fallback">
        <h2>The DM is checking the table's gear</h2>
        <p class="muted">One moment.  Play resumes shortly.</p>
      </section>`;
    }

    return html`<section
      class="card dm-operational-view"
      data-testid="dm-operational-view"
    >
      <header class="dm-operational-head">
        <h2>Operational view</h2>
        <button
          type="button"
          class="dm-operational-close"
          data-testid="dm-operational-close"
          title="Return to play (Esc)"
          @click=${() => this.requestClose()}
        >
          Close
        </button>
      </header>
      <p class="muted dm-operational-intro">
        The engineering reality behind your table.  Players don't
        see this.
      </p>
      ${this.renderBackupsSection()}
    </section>`;
  }

  private renderBackupsSection(): TemplateResult {
    if (!this.campaignId) {
      return html`<section class="dm-operational-section">
        <p class="muted">No active session — backups appear here once a campaign is loaded.</p>
      </section>`;
    }
    return html`<section
      class="dm-operational-section dm-operational-backups"
      data-testid="dm-operational-backups-section"
    >
      <backups-card
        .cloudPush=${this.fsApiCloudPush}
        .campaignId=${this.campaignId}
        ?renderForDm=${this.renderForDm}
        .requestConsent=${this.requestFsApiConsent}
      ></backups-card>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dm-operational-view': DmOperationalView;
  }
}
