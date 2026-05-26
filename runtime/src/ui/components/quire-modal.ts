// @vitest-environment happy-dom

/**
 * <quire-modal> — reusable modal-dialog primitive.
 *
 * Phase 3a extraction (2026-05-25) per Engineering-R5 review.  Four
 * dialogs in chargen-dm-review (review / edit / retire / revise)
 * duplicated the same showModal-sync + Esc + drag-select-safe
 * backdrop-click dance.  P-R5 (Stage roster) and P-R8 (co-DM
 * handoff) will want more modals; this primitive avoids a fifth /
 * sixth copy.
 *
 * Contract:
 *
 *   <quire-modal
 *     class="my-modal-class"
 *     ?open=${someState}
 *     .onClose=${() => this.closeMyModal()}
 *   >
 *     <div>...content...</div>
 *   </quire-modal>
 *
 * The wrapper:
 *   - Renders a native `<dialog>` (top-layer, focus-trap, ::backdrop)
 *   - Calls dialog.showModal() / dialog.close() in response to
 *     `open` property changes, in `updated()` so the DOM node
 *     exists.  Defensive try/catch — happy-dom doesn't implement
 *     showModal(), tests verify only that markup is inspectable.
 *   - Native @cancel event (Esc + browser-native close) invokes
 *     `onClose`.
 *   - Backdrop click invokes `onClose`, with the drag-select fix
 *     (only close when mousedown AND click both happened on
 *     DIALOG, never on inner content — solves the issue where
 *     drag-selecting text past the dialog frame fires a stray
 *     close).
 *   - The host element's own `class` attribute passes through so
 *     existing per-modal CSS (chargen-dm-review-retire-modal etc.)
 *     keeps working.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('quire-modal')
export class QuireModal extends LitElement {
  /** Render slotted content into the light DOM so callers' CSS reaches. */
  createRenderRoot(): this {
    return this;
  }

  @property({ type: Boolean }) open = false;

  @property({ attribute: false }) onClose: (() => void) | null = null;

  /**
   * Drag-select fix flag.  Tracked privately because state changes
   * within a single click sequence shouldn't trigger re-renders.
   */
  private backdropMouseDownOnDialog = false;

  /**
   * Cache the rendered <dialog> so updated() can sync showModal/close
   * without an extra querySelector on every property change.
   */
  private renderedDialog: HTMLDialogElement | null = null;

  /**
   * Render the dialog.  Slotted content goes inside.  Esc + backdrop
   * close both route through `handleClose()` so derived behaviors
   * (analytics, cleanup) can be added in one place.
   */
  override render(): TemplateResult {
    return html`
      <dialog
        class="quire-modal-dialog"
        @cancel=${() => this.handleClose()}
        @click=${(e: MouseEvent) => this.handleClick(e)}
        @mousedown=${(e: MouseEvent) => this.handleMouseDown(e)}
      >
        <slot></slot>
      </dialog>
    `;
  }

  /**
   * Sync the native dialog's open state after each render.  showModal
   * MUST be called on a DOM node (not a Lit template), so we wait
   * for updateComplete and the <dialog> element to exist.  The
   * try/catch keeps happy-dom from blowing up on the missing API.
   */
  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    const dialog =
      this.renderedDialog ??
      this.querySelector<HTMLDialogElement>('dialog.quire-modal-dialog');
    if (!dialog) return;
    this.renderedDialog = dialog;
    try {
      if (this.open && !dialog.open) dialog.showModal?.();
      if (!this.open && dialog.open) dialog.close?.();
    } catch {
      /* test env without dialog support — DOM stays inspectable */
    }
  }

  private handleClose(): void {
    this.onClose?.();
  }

  /**
   * Backdrop-click handler with the drag-select fix from chargen-dm-
   * review.  Only fires close when BOTH mousedown AND click landed
   * on the dialog element itself (the backdrop / overlay area) —
   * dragging text that ends outside the frame doesn't accidentally
   * close the modal.
   */
  private handleClick(e: MouseEvent): void {
    const onBackdrop =
      (e.target as HTMLElement).tagName === 'DIALOG' &&
      this.backdropMouseDownOnDialog;
    this.backdropMouseDownOnDialog = false;
    if (onBackdrop) this.handleClose();
  }

  private handleMouseDown(e: MouseEvent): void {
    this.backdropMouseDownOnDialog =
      (e.target as HTMLElement).tagName === 'DIALOG';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-modal': QuireModal;
  }
}
