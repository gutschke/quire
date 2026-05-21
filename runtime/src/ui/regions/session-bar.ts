/**
 * <session-bar> — top-region session controls (M3a.3 — P-M3a-session-bar-region).
 *
 * Extracted from `QuireApp.renderSessionBar` (216 LOC) during M3a.
 * Renders four distinct UI states based on sessionView.status +
 * sessionView.mode:
 *
 *   idle + solo  → role hint + name input + host/join controls
 *   connecting   → "Starting session…" / "Joining…" + Cancel
 *   error        → error message + Dismiss
 *   active       → status label + code/copy + member count + save/load + leave
 *
 * Light-DOM rendering (createRenderRoot = this) so the legacy CSS
 * cascade in src/ui/styles/quire-app.css.ts continues to style the
 * .session-bar, .session-solo, .session-name, .session-code,
 * .session-active, etc. selectors.
 *
 * Handlers stay on root per the facade-migration pattern.  The
 * component receives:
 * - sessionView (live state)
 * - draft strings (displayNameDraft, joinCodeDraft)
 * - inviteCopied flag
 * - save/load statuses
 * - brokerBadge as a pre-computed TemplateResult (the broker-config
 *   helper has a window dependency the region shouldn't touch)
 * - reclaimAffordance as a pre-computed TemplateResult (the
 *   reclaim button + confirmation flow stays on QuireApp until
 *   M3a.5 / M3a.9 can fold it into the proper region)
 * - displayNameForPeer callback (resolves peerId → display name
 *   via the host's filteredShared.peers map)
 * - 8 callbacks (onDisplayNameChange, onJoinCodeChange, onHost,
 *   onJoin, onLeave, onCopyInvite, onRegenerateCode, onSave,
 *   onLoad).
 *
 * Reclaim confirmation modal + resume prompt modal render OUTSIDE
 * the session-bar element (QuireApp's renderSessionBar wrapper
 * still calls them as siblings).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SessionView } from '../../session-controller';
import { extractJoinCode } from '../../controllers/session-bootstrap';

export interface SessionBarStatus {
  kind: 'idle' | 'saving' | 'saved' | 'error' | 'loading' | 'loaded';
  message?: string;
}

@customElement('session-bar')
export class SessionBar extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) sessionView: SessionView | null = null;
  @property() displayNameDraft: string = '';
  @property() joinCodeDraft: string = '';
  @property({ type: Boolean }) inviteCopied: boolean = false;
  @property({ attribute: false }) saveStatus: SessionBarStatus = { kind: 'idle' };
  @property({ attribute: false }) loadStatus: SessionBarStatus = { kind: 'idle' };
  /**
   * Pre-computed broker badge template (or `nothing`).  QuireApp
   * reads brokerConfigFromUrl() and passes it here so the region
   * stays data-only.
   */
  @property({ attribute: false }) brokerBadge: TemplateResult | typeof nothing = nothing;
  /** Pre-computed reclaim affordance template (DM-only). */
  @property({ attribute: false }) reclaimAffordance: TemplateResult | typeof nothing = nothing;

  @property({ attribute: false }) displayNameForPeer:
    | ((peerId: string) => string)
    | null = null;
  @property({ attribute: false }) onDisplayNameChange:
    | ((value: string) => void)
    | null = null;
  @property({ attribute: false }) onJoinCodeChange:
    | ((value: string) => void)
    | null = null;
  @property({ attribute: false }) onHost: (() => void) | null = null;
  @property({ attribute: false }) onJoin: (() => void) | null = null;
  @property({ attribute: false }) onLeave: (() => void) | null = null;
  @property({ attribute: false }) onCopyInvite: (() => void) | null = null;
  @property({ attribute: false }) onRegenerateCode: (() => void) | null = null;
  @property({ attribute: false }) onSave: (() => void) | null = null;
  @property({ attribute: false }) onLoad: ((file: File) => void) | null = null;

  override render(): TemplateResult {
    const v = this.sessionView;
    if (!v) return html``;

    if (v.status === 'idle' && v.mode === 'solo') {
      return this.renderSolo();
    }
    if (v.status === 'connecting') {
      return this.renderConnecting(v);
    }
    if (v.status === 'error') {
      return this.renderError(v);
    }
    return this.renderActive(v);
  }

  private renderSolo(): TemplateResult {
    const nameMissing = this.displayNameDraft.trim().length === 0;
    const codeMissing = this.joinCodeDraft.trim().length === 0;
    const nameHint = nameMissing ? 'Enter your name first' : '';
    return html`
      <div class="session-bar session-solo">
        <p class="session-role-hint">
          <strong>DM:</strong> click Host to start a session and
          share the code (or invite link) that appears.
          <strong>Player:</strong> wait for your DM to send a code
          or invite link, then paste it below.  A name is required
          so others know who you are — no GUIDs in chat.
        </p>
        <div class="session-bar-row">
          <input
            type="text"
            class="session-name"
            .value=${this.displayNameDraft}
            placeholder="Your name (required)"
            aria-label="Display name"
            required
            @input=${(e: Event) =>
              this.onDisplayNameChange?.((e.target as HTMLInputElement).value)}
          />
          <button
            ?disabled=${nameMissing}
            title=${nameHint || 'Start a new session as the DM'}
            @click=${() => this.onHost?.()}
          >
            Host session
          </button>
          <span class="session-sep">or</span>
          <input
            type="text"
            class="session-code"
            .value=${this.joinCodeDraft}
            placeholder="paste code or invite link from your DM"
            aria-label="Pairing code"
            maxlength="200"
            @input=${(e: Event) =>
              this.onJoinCodeChange?.(
                extractJoinCode((e.target as HTMLInputElement).value)
              )}
          />
          <button
            ?disabled=${nameMissing || codeMissing}
            title=${nameMissing
              ? nameHint
              : codeMissing
                ? 'Paste the code or invite link from your DM'
                : "Join your DM's session"}
            @click=${() => this.onJoin?.()}
          >
            Join
          </button>
          ${this.brokerBadge}
        </div>
      </div>
    `;
  }

  private renderConnecting(v: SessionView): TemplateResult {
    return html`
      <div class="session-bar session-connecting">
        <span class="session-label">
          ${v.mode === 'host' ? 'Starting session…' : 'Joining…'}
        </span>
        <button @click=${() => this.onLeave?.()}>Cancel</button>
      </div>
    `;
  }

  private renderError(v: SessionView): TemplateResult {
    return html`
      <div class="session-bar session-error">
        <span class="session-label">Session error</span>
        <span class="session-error-msg">${v.error}</span>
        <button @click=${() => this.onLeave?.()}>Dismiss</button>
      </div>
    `;
  }

  private renderActive(v: SessionView): TemplateResult {
    // F1 fix: report session membership (shared.peers, the
    // gossip-propagated count of who joined) instead of direct
    // WebRTC connections.  See QuireApp.renderSessionBar comment.
    const sessionMembers = Object.values(v.filteredShared.peers).filter(
      (p) => p.peerId !== v.peerId && p.leftAt === undefined
    );
    const coordPeerId = v.filteredShared.coordinator;
    const dmInOthers = sessionMembers.some((p) => p.peerId === coordPeerId);
    const playerCount = sessionMembers.filter(
      (p) => p.peerId !== coordPeerId
    ).length;
    const connected = v.connectedPeers.length;
    const labelParts: string[] = [];
    if (dmInOthers) labelParts.push('DM');
    if (playerCount === 1) labelParts.push('1 other player');
    else if (playerCount > 1) labelParts.push(`${playerCount} other players`);
    const memberCount = sessionMembers.length;
    const memberLabel =
      memberCount === 0
        ? 'no other players yet'
        : labelParts.length === 1
          ? labelParts[0] + ' connected'
          : labelParts.join(' + ');
    const reachabilityHint =
      memberCount > 0 && connected < memberCount
        ? html` <span
            class="session-peers-warn"
            title="Some peers are not directly reachable via WebRTC right now.  Events still flow if any peer can forward."
            >(${connected} direct)</span
          >`
        : nothing;
    return html`
      <div class="session-bar session-active">
        ${v.mode === 'host'
          ? html`
              <span class="session-label">Hosting</span>
              <span class="session-code-display">
                code: <code>${v.pairingCode}</code>
              </span>
              <button
                class="session-copy-invite"
                title="Copy a click-to-join link for players"
                @click=${() => this.onCopyInvite?.()}
              >
                ${this.inviteCopied ? 'Copied!' : 'Copy invite'}
              </button>
              <button
                class="session-regenerate-code"
                title="Issue a new code (defensive — use if a code leaks)"
                @click=${() => this.onRegenerateCode?.()}
              >
                New code
              </button>
            `
          : html`
              <span class="session-label">Joined</span>
              <span class="session-code-display">
                as
                <code title="Internal peer id: ${v.peerId}"
                  >${(v.peerId && this.displayNameForPeer?.(v.peerId)) ||
                  'unnamed'}</code
                >
              </span>
            `}
        <span
          class="session-peers"
          title=${sessionMembers
            .map((p) => p.name ?? p.peerId)
            .join(', ') || 'no other players in this session yet'}
        >
          ${memberLabel}${reachabilityHint}
        </span>
        ${this.brokerBadge}
        <button
          @click=${() => this.onSave?.()}
          title="Download a JSON save of this session"
        >
          Save
        </button>
        <label
          class="session-load-label"
          title="Load a JSON save file into this session"
        >
          Load
          <input
            type="file"
            accept="application/json,.json"
            @change=${(e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) this.onLoad?.(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </label>
        ${this.reclaimAffordance}
        <button @click=${() => this.onLeave?.()}>Leave</button>
        ${this.saveStatus.kind === 'saved'
          ? html`<span class="save-status">${this.saveStatus.message}</span>`
          : nothing}
        ${this.saveStatus.kind === 'error'
          ? html`<span class="save-status save-error"
              >${this.saveStatus.message}</span
            >`
          : nothing}
        ${this.loadStatus.kind === 'loaded'
          ? html`<span class="save-status">${this.loadStatus.message}</span>`
          : nothing}
        ${this.loadStatus.kind === 'error'
          ? html`<span class="save-status save-error"
              >${this.loadStatus.message}</span
            >`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'session-bar': SessionBar;
  }
}
