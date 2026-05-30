// @vitest-environment happy-dom

/**
 * <backups-card> — M6a-FS "Cloud backup" section for the DM-only
 * operational view (per ux-strategy.md §A10 placement B).
 *
 * # What this renders
 *
 * A single card surface that the DM-only operational view
 * embeds.  States it renders:
 *
 *   - **Not available (browser unsupported).**  A "Cloud backup
 *     isn't available in this browser yet" placeholder with
 *     reason-specific copy (Safari / Firefox / mobile / no-api).
 *     Notes that OAuth Drive support is coming.
 *   - **Available, not connected.**  A "Back up to a folder"
 *     primary action.  Click → consent dialog → folder picker →
 *     connect.
 *   - **Connected, current.**  Shows the folder name, last-push
 *     time, and Push/Pull/Disconnect actions.
 *   - **Connected, permission revoked.**  Shows a "Reconnect
 *     folder" affordance.  Click → request permission gesture.
 *   - **Error after an action.**  Shows a small status line with
 *     the error code; non-modal.
 *
 * # Silent-player firewall
 *
 * The host MUST gate-render this element with `?renderForDm`
 * — players never see it.  The component itself does not
 * compute the firewall classification; it trusts the host.
 *
 * The render is also defensive: if `cloudPush` is null OR
 * `campaignId` is empty, nothing renders.  That way an
 * accidental embed in a player-side render path produces
 * empty DOM rather than leaking the "your DM has cloud sync"
 * fact to the player.
 *
 * # Why this lives in src/ui/regions rather than quire-app.ts
 *
 * Following the existing pattern (session-digest, dm-aside, …):
 * regions are extracted Lit elements with their own tests and a
 * narrow props surface.  The host (`quire-app.ts`) composes
 * them inside its render path.  Integration into the
 * yet-to-be-named "operational view" surface is a follow-up;
 * for M6a-FS we ship the region + a placeholder embed point so
 * the engine layer has a user-visible consumer.
 *
 * # Tests
 *
 * Drives every documented state via happy-dom + injected
 * dependencies.  Picker-click flow is mocked at the
 * `FsApiCloudPush` boundary so we never need a real
 * `showDirectoryPicker`.  The picker call itself is
 * Playwright-untestable (requires a real user gesture + native
 * dialog) — out of scope.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  ConnectFolderResult,
  DisconnectResult,
  FsApiCloudPush,
  PushResult
} from '../../auth/fs-api-cloud-push';
import type { FileSystemAccessVerdict } from '../../auth/fs-api-availability';

/**
 * Public callback the host provides for the consent dialog.
 * Returns true if the DM acknowledged, false if they cancelled.
 *
 * Why a host callback rather than an in-component modal: the
 * consent dialog is a campaign-level surface (single instance,
 * blocking, copy may be campaign-tunable at M8 per
 * `ux-strategy.md`).  Keeping it host-owned lets the same
 * dialog serve OAuth + FS-API + GitHub paths.
 */
export type RequestFsApiConsent = (campaignId: string) => Promise<boolean>;

type ChipState =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  // M6a-FS-2 (run #9): permission-revoked is a recoverable error
  // class that needs a [Reconnect] button distinct from the
  // generic error chip.  Drives renderChip() to add the
  // affordance.
  | { kind: 'permission-revoked'; message: string };

@customElement('backups-card')
export class BackupsCard extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * The host's wired `FsApiCloudPush` instance.  Null when the
   * host hasn't built one (e.g. test scaffolding) — renders
   * nothing.
   */
  @property({ attribute: false })
  cloudPush: FsApiCloudPush | null = null;

  /**
   * The campaign whose backup state we're surfacing.  Empty
   * string → renders nothing.
   */
  @property({ type: String })
  campaignId: string = '';

  /**
   * Host-gated DM-only flag.  If false, render nothing — silent-
   * player firewall defense-in-depth.
   */
  @property({ type: Boolean })
  renderForDm: boolean = false;

  /**
   * Host-provided consent gate.  Called before the picker so the
   * DM acknowledges what they're agreeing to.
   */
  @property({ attribute: false })
  requestConsent: RequestFsApiConsent | null = null;

  // --- internal state ---

  @state() private chipState: ChipState = { kind: 'idle' };
  @state() private connected: {
    folderName: string;
    lastPushedAt: number | null;
  } | null = null;
  /**
   * Loaded asynchronously on first render.  Null while loading.
   */
  @state() private loaded: boolean = false;
  @state() private verdict: FileSystemAccessVerdict | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('cloudPush') || changed.has('campaignId')) {
      void this.refresh();
    }
  }

  /**
   * Re-read availability + connection state from the cloud push.
   * Public so tests + host-level events can trigger a redraw
   * after a state change (e.g. after a connect / disconnect).
   */
  async refresh(): Promise<void> {
    if (!this.cloudPush || !this.campaignId) {
      this.loaded = true;
      this.verdict = null;
      this.connected = null;
      return;
    }
    this.verdict = this.cloudPush.getAvailabilityVerdict();
    const state = await this.cloudPush.getConnectedFolderState({
      campaignId: this.campaignId
    });
    this.connected = state.connected
      ? { folderName: state.folderName, lastPushedAt: state.lastPushedAt }
      : null;
    this.loaded = true;
  }

  override render(): TemplateResult | typeof nothing {
    // Silent-player firewall: the host gates us, but defense-in-
    // depth — if not DM, render nothing.
    if (!this.renderForDm) return nothing;
    if (!this.cloudPush || !this.campaignId) return nothing;
    if (!this.loaded) return nothing;

    return html`<section class="backups-card" data-testid="backups-card">
      <header class="backups-card-head">
        <h3>Cloud backup</h3>
      </header>
      ${this.verdict?.available
        ? this.renderAvailable()
        : this.renderUnavailable()}
    </section>`;
  }

  private renderUnavailable(): TemplateResult {
    const reason = this.verdict?.available === false ? this.verdict.reason : 'no-api';
    const message = this.unavailableMessage(reason);
    return html`<div class="backups-card-unavailable" data-testid="backups-unavailable" data-reason=${reason}>
      <p>${message}</p>
      <p class="backups-card-muted">
        OAuth Drive sync is in development; it will support Safari,
        Firefox, and mobile devices when it ships.
      </p>
    </div>`;
  }

  /**
   * Reason-specific copy — engineering placeholder per the
   * project's standard "TTRPG-craft owns final wording at M8"
   * pattern.  Each reason is mapped to a distinct sentence so
   * the DM understands their alternatives.
   */
  private unavailableMessage(
    reason: 'no-api' | 'mobile' | 'safari' | 'firefox'
  ): string {
    switch (reason) {
      case 'safari':
        return "Cloud backup to a folder isn't available in Safari yet.  Try Chrome or Edge on your desktop.";
      case 'firefox':
        return "Cloud backup to a folder isn't available in Firefox yet.  Try Chrome or Edge on your desktop.";
      case 'mobile':
        return "Cloud backup to a folder isn't available on mobile devices.  Use a desktop browser to set up backups.";
      case 'no-api':
      default:
        return "Cloud backup isn't available in this browser yet.";
    }
  }

  private renderAvailable(): TemplateResult {
    return html`
      ${this.connected
        ? this.renderConnected(this.connected)
        : this.renderNotConnected()}
      ${this.renderChip()}
    `;
  }

  private renderNotConnected(): TemplateResult {
    return html`<div class="backups-card-disconnected" data-testid="backups-disconnected">
      <p>
        Save the table's full event log into a folder on your
        device.  If that folder is watched by Google Drive Desktop,
        Dropbox, OneDrive, or iCloud Drive, your sync tool will
        upload it.
      </p>
      <button
        type="button"
        class="backups-card-connect"
        data-testid="backups-connect"
        ?disabled=${this.chipState.kind === 'busy'}
        @click=${() => void this.handleConnect()}
      >
        Connect a folder
      </button>
    </div>`;
  }

  private renderConnected(state: {
    folderName: string;
    lastPushedAt: number | null;
  }): TemplateResult {
    return html`<div class="backups-card-connected" data-testid="backups-connected">
      <dl class="backups-card-detail">
        <dt>Folder</dt>
        <dd>${state.folderName}</dd>
        <dt>Last push</dt>
        <dd>${state.lastPushedAt ? formatRelativeTime(state.lastPushedAt) : 'never'}</dd>
      </dl>
      <div class="backups-card-actions">
        <button
          type="button"
          class="backups-card-push"
          data-testid="backups-push"
          ?disabled=${this.chipState.kind === 'busy'}
          @click=${() => void this.handlePushClick()}
        >
          Push now
        </button>
        <button
          type="button"
          class="backups-card-pull"
          data-testid="backups-pull"
          ?disabled=${this.chipState.kind === 'busy'}
          @click=${() => void this.handlePullClick()}
        >
          Pull
        </button>
        <button
          type="button"
          class="backups-card-disconnect"
          data-testid="backups-disconnect"
          ?disabled=${this.chipState.kind === 'busy'}
          @click=${() => void this.handleDisconnectClick()}
        >
          Disconnect
        </button>
      </div>
    </div>`;
  }

  private renderChip(): TemplateResult | typeof nothing {
    if (this.chipState.kind === 'idle') return nothing;
    const cls =
      this.chipState.kind === 'error' ||
      this.chipState.kind === 'permission-revoked'
        ? 'backups-card-chip-error'
        : this.chipState.kind === 'success'
          ? 'backups-card-chip-success'
          : 'backups-card-chip-busy';
    return html`<div
      class="backups-card-chip ${cls}"
      data-testid="backups-chip"
      data-state=${this.chipState.kind}
      role="status"
    >
      <p>${this.chipState.message}</p>
      ${this.chipState.kind === 'permission-revoked'
        ? html`<button
            type="button"
            class="backups-card-reconnect"
            data-testid="backups-reconnect"
            @click=${() => void this.handleReconnectClick()}
          >
            Reconnect
          </button>`
        : nothing}
    </div>`;
  }

  /**
   * M6a-FS-2 (run #9, OP-037 sibling): reconnect-on-permission-
   * revoked.  Production browsers expire write permission between
   * sessions (Chrome's "transient" permission lifetime).  Pre-fix,
   * the DM saw "Click Reconnect" copy but had no actual reconnect
   * affordance — they had to disconnect + re-connect a folder,
   * losing handle continuity.
   *
   * `requestPermissionForCampaign` calls `requestWritePermission`
   * on the existing stored handle.  Per the FS API spec it MUST be
   * called from within a user-gesture handler.  This click is the
   * gesture.
   *
   * Success → push retry is left to the DM (they re-click Push).
   * The simpler one-action-per-state pattern from `ux-strategy.md
   * §A12 principle 2` argues against auto-retrying push as part of
   * reconnect; a "Reconnect → success → Push now appears" rhythm
   * is more legible.
   */
  private async handleReconnectClick(): Promise<void> {
    if (!this.cloudPush || !this.campaignId) return;
    this.chipState = { kind: 'busy', message: 'Asking for permission…' };
    const result = await this.cloudPush.requestPermissionForCampaign({
      campaignId: this.campaignId
    });
    if (result.ok) {
      this.chipState = {
        kind: 'success',
        message: 'Folder reconnected.  Click Push to back up.'
      };
      await this.refresh();
    } else if (result.reason === 'not-connected') {
      this.chipState = {
        kind: 'error',
        message:
          'No folder to reconnect.  Pick a folder via Connect.'
      };
      await this.refresh();
    } else {
      // 'denied' — browser blocked the gesture, OR the DM clicked
      // Cancel.  Keep the permission-revoked state so the chip
      // surfaces the Reconnect button again.
      this.chipState = {
        kind: 'permission-revoked',
        message:
          "Your browser still hasn't confirmed folder access.  Click Reconnect to try again."
      };
    }
  }

  // -----------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------

  /**
   * Drive the consent → picker → connect flow.  Each step has
   * a single primary action — if the DM cancels at any point,
   * we leave the card in its prior state.
   */
  private async handleConnect(): Promise<void> {
    if (!this.cloudPush || !this.requestConsent || !this.campaignId) return;
    this.chipState = { kind: 'busy', message: 'Asking for consent…' };
    let acknowledged = false;
    try {
      acknowledged = await this.requestConsent(this.campaignId);
    } catch {
      // Treat as cancel.
    }
    if (!acknowledged) {
      this.chipState = { kind: 'idle' };
      return;
    }
    this.chipState = { kind: 'busy', message: 'Choose a folder…' };
    const result: ConnectFolderResult = await this.cloudPush.connectFolder({
      campaignId: this.campaignId,
      consentAlreadyAcknowledged: true
    });
    if (result.ok) {
      this.chipState = {
        kind: 'success',
        message: `Connected to ${result.folderName}`
      };
      await this.refresh();
    } else {
      this.chipState = {
        kind: 'error',
        message: this.connectErrorMessage(result.reason)
      };
    }
  }

  private connectErrorMessage(reason: string): string {
    switch (reason) {
      case 'cancelled':
        return 'No folder picked.';
      case 'permission-denied':
        return 'Your browser blocked write access to that folder.';
      case 'no-consent':
        return 'Backup acknowledgment is required before connecting.';
      case 'storage-failure':
        return "Couldn't save the folder selection.  Try again.";
      case 'feature-unavailable':
        return "Cloud backup isn't available in this browser.";
      default:
        return 'Could not connect to that folder.';
    }
  }

  private async handlePushClick(): Promise<void> {
    this.chipState = { kind: 'busy', message: 'Pushing…' };
    this.dispatchEvent(
      new CustomEvent('backups-push-request', {
        bubbles: true,
        composed: true,
        detail: { campaignId: this.campaignId }
      })
    );
  }

  /**
   * Tests + host can call this directly with the host-driven
   * push result so the chip reflects the outcome.  Production
   * host listens for the `backups-push-request` event, runs
   * `pushCampaignToFolder` with a freshly-serialized save, and
   * calls `applyPushResult` to update the chip.
   */
  applyPushResult(result: PushResult): void {
    if (result.ok) {
      this.chipState = {
        kind: 'success',
        message: `Pushed ${result.bytesWritten} bytes to ${result.fileName}`
      };
      void this.refresh();
    } else if (result.reason === 'permission-revoked') {
      // M6a-FS-2 (run #9): hoist permission-revoked into its own
      // chip state so renderChip() can surface a [Reconnect]
      // button.  The reason itself isn't recoverable by retrying
      // push — the browser dropped write permission and we need a
      // fresh user gesture to re-grant it.
      this.chipState = {
        kind: 'permission-revoked',
        message: this.pushErrorMessage(result.reason)
      };
    } else {
      this.chipState = {
        kind: 'error',
        message: this.pushErrorMessage(result.reason)
      };
    }
  }

  private pushErrorMessage(reason: string): string {
    switch (reason) {
      case 'permission-revoked':
        return "Your browser asked to confirm folder access.  Click Reconnect.";
      case 'conflict':
        return "Another device updated this campaign's backup.  Pull first, then push.";
      case 'write-failure':
        return "Couldn't write to the folder.  Check it still exists.";
      case 'not-connected':
        return 'Connect a folder first.';
      case 'feature-unavailable':
        return "Cloud backup isn't available in this browser.";
      default:
        return 'Push failed.';
    }
  }

  private async handlePullClick(): Promise<void> {
    this.chipState = { kind: 'busy', message: 'Pulling…' };
    this.dispatchEvent(
      new CustomEvent('backups-pull-request', {
        bubbles: true,
        composed: true,
        detail: { campaignId: this.campaignId }
      })
    );
  }

  private async handleDisconnectClick(): Promise<void> {
    if (!this.cloudPush || !this.campaignId) return;
    this.chipState = { kind: 'busy', message: 'Disconnecting…' };
    const result: DisconnectResult = await this.cloudPush.disconnectFolder({
      campaignId: this.campaignId
    });
    if (result.ok) {
      this.chipState = { kind: 'success', message: 'Folder disconnected.' };
      await this.refresh();
    }
  }
}

/**
 * Cheap relative-time formatter.  Avoids pulling in a date
 * library; the precision is "feels recent" / "a while ago" only.
 */
function formatRelativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 0) return 'just now';
  const secs = Math.floor(delta / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

declare global {
  interface HTMLElementTagNameMap {
    'backups-card': BackupsCard;
  }
}
