/**
 * <player-aside> — roster + (M2.7) chat region.
 *
 * Extracted from `QuireApp.renderRosterPanel` / `renderRosterRow` /
 * `renderRenameForm` during M2.5 (P1-3).  M2.7 will add the chat
 * panel as a collapsible section in the same component.
 *
 * Light-DOM rendering: createRenderRoot returns `this`.  Legacy
 * roster CSS (.roster-panel, .roster-head, .roster-list,
 * .roster-row, .roster-name, .roster-dm-tag, .roster-edit,
 * .roster-kick, .rename-form) continues to apply via the
 * QuireApp shadow root cascade.
 *
 * Handlers stay on root.  The component invokes callback props for
 * the four user-actionable verbs (begin-rename, submit-rename,
 * cancel-rename, kick-peer, toggle-roster) and emits draft updates
 * via onRenameDraftChange so QuireApp's @state stays the source of
 * truth.  This preserves the existing test surface (any tests that
 * poke at the @state fields continue to work).
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SessionView } from '../../session-controller';

export interface RenameDraft {
  name: string;
  character: string;
}

export type RenameDraftCallback = (draft: RenameDraft) => void;
export type KickPeerCallback = (peerId: string, name: string) => void;
export type VoidCallback = () => void;

@customElement('player-aside')
export class PlayerAside extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @property({ attribute: false }) sessionView: SessionView | null = null;
  @property({ type: Boolean }) localIsCoordinator: boolean = false;
  @property({ type: Boolean }) showRoster: boolean = true;
  @property({ type: Boolean }) renameEditing: boolean = false;
  @property({ attribute: false }) renameDraft: RenameDraft = {
    name: '',
    character: ''
  };
  @property({ attribute: false }) onToggleRoster: VoidCallback | null = null;
  @property({ attribute: false }) onBeginRename: VoidCallback | null = null;
  @property({ attribute: false }) onCancelRename: VoidCallback | null = null;
  @property({ attribute: false }) onSubmitRename: VoidCallback | null = null;
  @property({ attribute: false })
  onRenameDraftChange: RenameDraftCallback | null = null;
  @property({ attribute: false }) onKickPeer: KickPeerCallback | null = null;

  override render(): TemplateResult {
    const v = this.sessionView;
    if (!v || v.status !== 'active') return html``;
    const peers = Object.values(v.shared.peers).filter(
      (p) => p.leftAt === undefined
    );
    if (peers.length === 0) return html``;
    return html`
      <section class="card roster-panel">
        <div class="roster-head">
          <h2>
            Roster
            <span class="roster-count">(${peers.length})</span>
          </h2>
          <button
            type="button"
            class="roster-toggle"
            @click=${() => this.onToggleRoster?.()}
          >
            ${this.showRoster ? 'Hide' : 'Show'}
          </button>
        </div>
        ${this.showRoster
          ? html`
              <ul class="roster-list">
                ${peers.map((p) => this.renderRow(p))}
              </ul>
              ${this.renameEditing ? this.renderRenameForm() : nothing}
            `
          : nothing}
      </section>
    `;
  }

  private renderRow(peer: {
    peerId: string;
    name?: string;
    character?: string;
  }): TemplateResult {
    const v = this.sessionView!;
    const isSelf = peer.peerId === v.peerId;
    const isDm = v.shared.coordinator === peer.peerId;
    const canKick = this.localIsCoordinator && !isSelf && !isDm;
    const handRaised = v.shared.raisedHands.has(peer.peerId);
    const name = peer.name ?? '(unnamed)';
    return html`
      <li class="roster-row ${isSelf ? 'roster-row-self' : ''}">
        ${isDm ? html`<span class="roster-dm-tag">DM</span>` : nothing}
        <span class="roster-name">${name}</span>
        ${handRaised
          ? html`<span
              class="roster-hand"
              title="${name} has their hand raised"
              aria-label="Hand raised"
              >✋</span
            >`
          : nothing}
        ${peer.character
          ? html`<span class="roster-char">${peer.character}</span>`
          : nothing}
        ${isSelf
          ? html`<button
              type="button"
              class="roster-edit"
              @click=${() => this.onBeginRename?.()}
            >
              edit
            </button>`
          : nothing}
        ${canKick
          ? html`<button
              type="button"
              class="roster-kick"
              title="Remove this peer from the roster (use if they've left without disconnecting cleanly)"
              @click=${() => this.onKickPeer?.(peer.peerId, name)}
            >
              remove
            </button>`
          : nothing}
      </li>
    `;
  }

  private renderRenameForm(): TemplateResult {
    return html`
      <form
        class="rename-form"
        @submit=${(e: Event) => {
          e.preventDefault();
          this.onSubmitRename?.();
        }}
      >
        <label>
          <span>Your name</span>
          <input
            type="text"
            .value=${this.renameDraft.name}
            maxlength="80"
            @input=${(e: Event) =>
              this.onRenameDraftChange?.({
                ...this.renameDraft,
                name: (e.target as HTMLInputElement).value
              })}
          />
        </label>
        <label>
          <span>Character / status</span>
          <input
            type="text"
            .value=${this.renameDraft.character}
            maxlength="80"
            placeholder="e.g. Yui Tanaka, or Tim (afk)"
            @input=${(e: Event) =>
              this.onRenameDraftChange?.({
                ...this.renameDraft,
                character: (e.target as HTMLInputElement).value
              })}
          />
        </label>
        <div class="rename-actions">
          <button type="button" @click=${() => this.onCancelRename?.()}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'player-aside': PlayerAside;
  }
}
