// @vitest-environment happy-dom

/**
 * <cloud-push-consent-dialog> — the first-push consent ceremony
 * surface (DEC-011 / DEC-020) rendered as a Lit modal.
 *
 * # Why this lives here
 *
 * `cloud-push-consent.ts` exports a `ConsentDialogCopySpec` and
 * the ledger primitives.  This element is the host-owned dialog
 * that renders the spec, blocks on the DM's click, and resolves
 * a promise — the same shape `<backups-card>` expects from its
 * `requestConsent` callback.
 *
 * Shared by:
 *   - M6a-FS path (DEFAULT_CONSENT_COPY_FS_API)
 *   - M6a-OAuth path (DEFAULT_CONSENT_COPY) — lands later
 *   - M6c-A / M6c-B GitHub paths — eventual
 *
 * Each destination has its own `ConsentDialogCopySpec`; the
 * dialog is destination-agnostic so the host picks copy based
 * on which backups card invoked it.
 *
 * # Silent-player firewall
 *
 * This is a DM-only surface.  The host renders it only on the
 * DM's render path (gated by `isCoordinator()` AND the
 * `dm-operational` appMode, OR by the future session-digest
 * chip's DM-only conditional).  As defense-in-depth the dialog
 * itself emits no chrome until `open()` is called — a player who
 * accidentally mounts this element sees nothing.
 *
 * # State machine
 *
 *   closed → open(spec) → user clicks acknowledge → resolves
 *                                                   true
 *                       → user clicks cancel       → resolves
 *                                                   false
 *                       → user presses Escape      → resolves
 *                                                   false
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ConsentDialogCopySpec } from '../../auth/cloud-push-consent';

@customElement('cloud-push-consent-dialog')
export class CloudPushConsentDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private spec: ConsentDialogCopySpec | null = null;
  @state() private isOpen: boolean = false;
  private resolver: ((value: boolean) => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
    // Resolve any pending promise as cancel so callers don't hang.
    if (this.resolver) {
      this.resolver(false);
      this.resolver = null;
    }
  }

  private readonly handleKeydown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.resolve(false);
    }
  };

  /**
   * Open the dialog with the given copy.  Returns a promise that
   * resolves to true (acknowledged) or false (cancelled / Escape).
   *
   * If the dialog is already open with a prior promise, that
   * promise is resolved with false BEFORE the new prompt opens
   * — prevents stuck promises if the host accidentally double-
   * invokes.
   */
  open(spec: ConsentDialogCopySpec): Promise<boolean> {
    if (this.resolver) {
      this.resolver(false);
      this.resolver = null;
    }
    this.spec = spec;
    this.isOpen = true;
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  private resolve(value: boolean): void {
    const r = this.resolver;
    this.resolver = null;
    this.isOpen = false;
    this.spec = null;
    if (r) r(value);
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.isOpen || !this.spec) return nothing;
    const spec = this.spec;
    return html`<div
      class="cloud-consent-backdrop"
      data-testid="cloud-consent-backdrop"
      @click=${(e: MouseEvent) => {
        // Click on backdrop = cancel.  Click inside dialog
        // shouldn't propagate (the dialog stops propagation).
        if (e.target === e.currentTarget) {
          this.resolve(false);
        }
      }}
    >
      <section
        class="cloud-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-consent-title"
        data-testid="cloud-consent-dialog"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <h2 id="cloud-consent-title" class="cloud-consent-title">
          ${spec.title}
        </h2>
        <div class="cloud-consent-body">
          ${spec.body.map((para) => html`<p>${para}</p>`)}
        </div>
        <div class="cloud-consent-actions">
          <button
            type="button"
            class="cloud-consent-cancel"
            data-testid="cloud-consent-cancel"
            @click=${() => this.resolve(false)}
          >
            ${spec.cancelLabel}
          </button>
          <button
            type="button"
            class="cloud-consent-acknowledge"
            data-testid="cloud-consent-acknowledge"
            @click=${() => this.resolve(true)}
          >
            ${spec.acknowledgeLabel}
          </button>
        </div>
      </section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'cloud-push-consent-dialog': CloudPushConsentDialog;
  }
}
