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
 *   - Wraps the host's existing (and subsequently added) children
 *     in a native `<dialog>` (top-layer, focus-trap, ::backdrop).
 *     The parent's TemplateResult places children directly on the
 *     `<quire-modal>` host element; we re-parent them into a real
 *     `<dialog>` so `showModal()` displays them in the top layer.
 *     A MutationObserver picks up Lit-driven child updates so
 *     reactive content stays wrapped after the parent re-renders.
 *
 *     (Previous slot-based design did NOT work — `<slot>` requires
 *     shadow DOM, but the host uses light DOM so callers' CSS can
 *     target the inner `<dialog>`.  Run #17 P0 fix.)
 *   - Calls dialog.showModal() / dialog.close() in response to
 *     `open` property changes.  Defensive try/catch — happy-dom
 *     doesn't implement showModal(), tests verify only that the
 *     markup is inspectable.
 *   - Native @cancel event (Esc + browser-native close) invokes
 *     `onClose`.
 *   - Backdrop click invokes `onClose`, with the drag-select fix
 *     (only close when mousedown AND click both happened on
 *     DIALOG, never on inner content — solves the issue where
 *     drag-selecting text past the dialog frame fires a stray
 *     close).
 *   - The host element's own `class` attribute is mirrored to the
 *     inner `<dialog>` so existing per-modal CSS (chargen-dm-review-
 *     retire-modal etc.) targets the dialog directly.
 *
 * Run #17 background:
 *   The previous shadow-DOM-less `<slot>` implementation rendered
 *   `<dialog><slot></slot></dialog>` into the host's light DOM, but
 *   without a shadow root the `<slot>` never distributed the host's
 *   children.  In production: `dialog.showModal()` displayed an
 *   empty dialog (the "white frame" the user reported); the form
 *   content rendered as a sibling and was hidden behind the
 *   backdrop.  Mock campaign 11 Scenario A covers this regression.
 */

import { LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('quire-modal')
export class QuireModal extends LitElement {
  /**
   * Light-DOM render so callers' CSS reaches the inner `<dialog>`.
   * We do NOT use Lit's template — instead we wrap the host's
   * existing children in a real `<dialog>` on first connect, and a
   * MutationObserver catches dynamically-added children.
   */
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
   * The `<dialog>` element we mount around the host's children.
   * Created lazily; reused across re-renders.
   */
  private dialog: HTMLDialogElement | null = null;

  /**
   * Catch dynamically-added children (e.g. Lit re-rendering the
   * parent template) and re-parent them into the dialog.  Disabled
   * while we ourselves move nodes to avoid feedback loops.
   */
  private childObserver: MutationObserver | null = null;
  private suppressObserver = false;

  /** Suppress Lit's render — we manage the DOM directly. */
  override render(): null {
    return null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.ensureDialog();
    this.absorbStrayChildren();
    this.observeChildren();
    this.syncOpen();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.childObserver?.disconnect();
    this.childObserver = null;
  }

  /**
   * Create the `<dialog>` wrapper if it doesn't exist yet.  Class
   * mirror: any class on the host (e.g.
   * `chargen-dm-review-retire-modal`) is copied to the dialog so
   * existing CSS targeting that class actually styles the dialog
   * frame (which is what enters the top layer on showModal).
   */
  private ensureDialog(): void {
    if (this.dialog && this.dialog.isConnected && this.dialog.parentNode === this) {
      return;
    }
    const existing = this.querySelector<HTMLDialogElement>(
      ':scope > dialog.quire-modal-dialog'
    );
    if (existing) {
      this.dialog = existing;
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.classList.add('quire-modal-dialog');
    for (const cls of Array.from(this.classList)) {
      dialog.classList.add(cls);
    }
    dialog.addEventListener('cancel', () => this.handleClose());
    dialog.addEventListener('click', (e) => this.handleClick(e));
    dialog.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.suppressObserver = true;
    try {
      this.appendChild(dialog);
    } finally {
      this.suppressObserver = false;
    }
    this.dialog = dialog;
  }

  /**
   * Move all stray top-level children (anything that is NOT the
   * dialog) into the dialog.  Handles both first-connect children
   * (placed by the parent's initial template) and subsequent
   * Lit-driven mutations.
   */
  private absorbStrayChildren(): void {
    if (!this.dialog) return;
    this.suppressObserver = true;
    try {
      const dialog = this.dialog;
      // Walk a snapshot so live mutations during the loop don't
      // confuse the iteration.
      for (const node of Array.from(this.childNodes)) {
        if (node === dialog) continue;
        dialog.appendChild(node);
      }
    } finally {
      this.suppressObserver = false;
    }
  }

  /**
   * Watch for Lit-driven children appearing as direct children of
   * the host (typical of parent template re-renders).  Whenever
   * any non-dialog node arrives at the host, re-parent it into the
   * dialog.
   */
  private observeChildren(): void {
    if (this.childObserver) return;
    if (typeof MutationObserver === 'undefined') return;
    this.childObserver = new MutationObserver(() => {
      if (this.suppressObserver) return;
      // If the dialog was somehow removed, recreate it first.
      this.ensureDialog();
      this.absorbStrayChildren();
    });
    this.childObserver.observe(this, { childList: true });
  }

  /**
   * Sync the native dialog's open state.  showModal MUST be called
   * on a DOM node; we already have one cached.  The try/catch keeps
   * happy-dom (and other test envs without dialog support) from
   * blowing up; the DOM stays inspectable.
   */
  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    this.syncOpen();
  }

  private syncOpen(): void {
    const dialog = this.dialog;
    if (!dialog) return;
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
