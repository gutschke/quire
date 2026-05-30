// @vitest-environment happy-dom

/**
 * <start-fresh-confirm-dialog> — two-step confirm gate for the
 * "Start fresh" affordance (run #17 P0 fix).
 *
 * # Why this lives here
 *
 * The product owner hit a real bug during a playtest dry-run: the
 * resume-prompt "Start fresh" button fires a destructive
 * (silently-broken) clear with NO confirmation, so a single
 * misclick discards months of progress.  Per the run #17 mandate,
 * EVERY "Start fresh" affordance gets the same dialog in front of
 * it — even the cross-device probe "Start fresh," which is
 * locally safe (it doesn't touch the cloud copy) but visually
 * identical to the destructive resume-prompt button.  Defense-in-
 * depth: the user can't tell them apart by reading the button
 * label, so confirm both.
 *
 * # Shape
 *
 * Same Lit-region shape as `<cloud-push-consent-dialog>`:
 *   - Host calls `open(spec)`; returns a promise resolving true
 *     (Discard) or false (Cancel).
 *   - Escape / backdrop click both resolve false.
 *   - `disconnectedCallback` resolves any pending promise false
 *     so callers never hang.
 *
 * The CALLER (host) decides what "Start fresh" actually clears —
 * this element only renders the gate.
 *
 * # Silent-player firewall
 *
 * DM-only by gating in the host (only DMs see the resume-prompt
 * and cross-device probe surfaces).  As defense-in-depth this
 * element emits no chrome until `open()` is called.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

export interface StartFreshConfirmSpec {
  /** Human campaign name (manifest.name).  Renders in the title. */
  readonly campaignName: string;
  /** Short slug (`owner/repo`) — renders as a subtitle. */
  readonly campaignSlug: string;
  /**
   * Optional event count to surface in the body so the DM can
   * gauge "how much is at risk."  Omit when no live session is
   * counting (the autosave's event count is still load-bearing
   * if available — host can pass it).
   */
  readonly eventCount?: number;
  /**
   * The variant determines body copy.  'destructive' is the
   * resume-prompt case (clears the local autosave + chargen
   * drafts on this machine).  'safe' is the cross-device probe
   * case (just dismisses the prompt; cloud backup is untouched).
   */
  readonly variant: 'destructive' | 'safe';
}

@customElement('start-fresh-confirm-dialog')
export class StartFreshConfirmDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private spec: StartFreshConfirmSpec | null = null;
  @state() private isOpen: boolean = false;
  private resolver: ((value: boolean) => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeydown);
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
   * Open the dialog with the given spec.  Returns a promise that
   * resolves to true (Discard / Confirm) or false (Cancel /
   * Escape / backdrop).  Double-open: prior promise resolves
   * false first to avoid leaks.
   */
  open(spec: StartFreshConfirmSpec): Promise<boolean> {
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
    const isDestructive = spec.variant === 'destructive';
    const title = isDestructive
      ? `Discard the saved session for ${spec.campaignName}?`
      : `Dismiss the cross-device backup prompt?`;
    const eventLine =
      isDestructive && typeof spec.eventCount === 'number'
        ? `${spec.eventCount} event${spec.eventCount === 1 ? '' : 's'} from your saved session will be deleted from this device.`
        : null;
    const body: string[] = isDestructive
      ? [
          eventLine ??
            `Your saved session for ${spec.campaignSlug} will be deleted from this device.`,
          'Any in-progress character drafts on this device for this campaign will also be cleared.',
          'Players who reconnect will see an empty session until you start a new one.',
          'Cloud backups in connected folders are NOT touched — you can re-pull from the cloud later.'
        ]
      : [
          `This dismisses the cross-device backup prompt for ${spec.campaignSlug}.`,
          'The backup file in your connected folder is NOT touched. You can load it later from the operational view.',
          'Your local session stays empty.'
        ];
    const confirmLabel = isDestructive
      ? 'Discard saved session'
      : 'Dismiss prompt';
    return html`<div
      class="start-fresh-backdrop"
      data-testid="start-fresh-backdrop"
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) {
          this.resolve(false);
        }
      }}
    >
      <section
        class="start-fresh-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-fresh-title"
        data-testid="start-fresh-dialog"
        data-variant=${spec.variant}
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <h2 id="start-fresh-title" class="start-fresh-title">${title}</h2>
        <p class="start-fresh-slug" data-testid="start-fresh-slug">
          ${spec.campaignSlug}
        </p>
        <div class="start-fresh-body">
          ${body.map((para) => html`<p>${para}</p>`)}
        </div>
        <div class="start-fresh-actions">
          <button
            type="button"
            class="start-fresh-cancel"
            data-testid="start-fresh-cancel"
            autofocus
            @click=${() => this.resolve(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="start-fresh-confirm"
            data-testid="start-fresh-confirm"
            data-destructive=${isDestructive ? 'true' : 'false'}
            @click=${() => this.resolve(true)}
          >
            ${confirmLabel}
          </button>
        </div>
      </section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'start-fresh-confirm-dialog': StartFreshConfirmDialog;
  }
}
