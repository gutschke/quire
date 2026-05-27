// @vitest-environment happy-dom

/**
 * <quire-help-overlay> — Wave C1 (2026-05-26) keyboard-shortcut
 * cheatsheet.  Closes the discoverability gap flagged in the
 * 2026-05-26 holistic review (UX-1 + `project_quire_hotkey_discoverability_todo`
 * memory) — new DMs had no in-app way to find J/K/Cmd-Enter/B/'.
 *
 * Contract:
 *   <quire-help-overlay></quire-help-overlay>
 *
 * The component is self-contained:
 *   - Listens for `?` on `window`; opens the modal unless focus is
 *     in an editable target (matching the convention QuireApp's
 *     `hotkeyTargetIsEditable` uses).
 *   - Reads its own hotkey inventory from the in-file SHIPPED_HOTKEYS
 *     constant — the source of truth for "what's actually
 *     keyboard-accessible right now."  Adding a new hotkey to the
 *     app means adding a row here too.
 *   - Esc dismisses (via `<quire-modal>` cancel) + backdrop click +
 *     explicit Close button.
 *   - Topbar `?` chip dispatches a `quire-help-open` CustomEvent
 *     which this component listens for (so the chip lives in the
 *     QuireApp's topbar slot without needing a callback prop).
 *
 * Why a single-source-of-truth list inside the component (vs.
 * reading `ui.md`):
 *   - `ui.md` § Keyboard map is aspirational — lists hotkeys the
 *     spec wants AND hotkeys that ship.  This component renders
 *     only what ACTUALLY works today, so a DM hitting `?` never
 *     reads about a key that does nothing.
 *   - When a real hotkey lands, the engineer touches one file
 *     (this one) instead of going to the spec doc.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './quire-modal';

/**
 * Each row is a hotkey the local DM (coord) can actually fire.
 * `scope: 'dm'` items are gated on `isCoordinator()` at the
 * runtime layer — non-coord viewers never see them work even if
 * they read about them in the overlay.  Today every shipped
 * hotkey is DM-only; player hotkeys land in a future wave.
 *
 * **When adding a hotkey to QuireApp.hotkeyHandler, add a row
 * here in the same commit.**
 */
interface HelpRow {
  keys: string;
  action: string;
  scope: 'dm' | 'player' | 'shared';
}

const SHIPPED_HOTKEYS: ReadonlyArray<HelpRow> = [
  // DM-only hotkeys — all shipped via QuireApp.hotkeyHandler.
  {
    keys: '?',
    action: 'Open / close this cheatsheet',
    scope: 'shared'
  },
  {
    keys: 'Esc',
    action: 'Close any open modal / overlay',
    scope: 'shared'
  },
  { keys: 'J / K', action: 'Walk paragraphs in the Stage', scope: 'dm' },
  {
    keys: '⌘-Enter',
    action: 'Reveal the next paragraph (Stage)',
    scope: 'dm'
  },
  {
    keys: 'Enter',
    action: 'Apply all pending AI state-updates (when an AI batch is waiting)',
    scope: 'dm'
  },
  { keys: 'B', action: 'Broadcast your current view to all players', scope: 'dm' },
  { keys: "'", action: 'Focus the DM scratch input', scope: 'dm' },
  {
    keys: 'F1',
    action: 'Add a new player seat (allocates the next slot)',
    scope: 'dm'
  }
];

/**
 * Public event name for the topbar `?` chip → overlay open
 * dispatch.  Exported so the host can `dispatchEvent(new
 * CustomEvent(HELP_OPEN_EVENT))` without string-matching.
 */
export const HELP_OPEN_EVENT = 'quire-help-open';

@customElement('quire-help-overlay')
export class QuireHelpOverlay extends LitElement {
  /** Light-DOM so the app's existing CSS variables / typography
   *  reach without ::slotted gymnastics. */
  createRenderRoot(): this {
    return this;
  }

  @state() private open = false;

  private readonly keydownHandler = (e: KeyboardEvent): void => {
    if (e.key !== '?') return;
    // Same editable-target gate QuireApp uses (open `?` should not
    // hijack the question-mark a DM is typing into chat or AI
    // prompt).  We can't import `hotkeyTargetIsEditable` from
    // QuireApp without a circular dep, so re-derive it locally —
    // small enough that drift won't bite.
    const t = (e.composedPath()[0] ?? e.target) as Element | null;
    if (isEditableTarget(t)) return;
    e.preventDefault();
    this.open = true;
  };

  private readonly openEventHandler = (): void => {
    this.open = true;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener(HELP_OPEN_EVENT, this.openEventHandler);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener(HELP_OPEN_EVENT, this.openEventHandler);
  }

  private close(): void {
    this.open = false;
  }

  override render(): TemplateResult {
    const dmRows = SHIPPED_HOTKEYS.filter((r) => r.scope === 'dm');
    const sharedRows = SHIPPED_HOTKEYS.filter((r) => r.scope === 'shared');
    return html`<quire-modal
      class="quire-help-overlay"
      ?open=${this.open}
      .onClose=${() => this.close()}
    >
      <header class="quire-help-overlay-head">
        <h3>Keyboard shortcuts</h3>
        <button
          type="button"
          class="quire-help-overlay-close"
          aria-label="Close cheatsheet"
          @click=${() => this.close()}
        >
          ×
        </button>
      </header>
      <div class="quire-help-overlay-body">
        ${renderGroup('Shared', sharedRows)}
        ${renderGroup('DM hotkeys', dmRows)}
        <p class="quire-help-overlay-foot muted">
          DM hotkeys only fire when you're the coordinator + your
          focus isn't in a text field.  Player hotkeys land in a
          later wave.
        </p>
      </div>
    </quire-modal>`;
  }
}

function renderGroup(
  label: string,
  rows: ReadonlyArray<HelpRow>
): TemplateResult {
  return html`<section class="quire-help-overlay-group">
    <h4>${label}</h4>
    <dl class="quire-help-overlay-list">
      ${rows.map(
        (row) => html`<div class="quire-help-overlay-row">
          <dt class="quire-help-overlay-keys">
            ${row.keys.split(' / ').map(
              (k, i, arr) =>
                html`<kbd>${k}</kbd>${i < arr.length - 1
                  ? html`<span class="quire-help-overlay-sep"> or </span>`
                  : ''}`
            )}
          </dt>
          <dd class="quire-help-overlay-action">${row.action}</dd>
        </div>`
      )}
    </dl>
  </section>`;
}

/**
 * Match QuireApp.hotkeyTargetIsEditable behavior.  Returns true
 * when the keydown landed inside a text-input element — the `?`
 * key in chat / AI / textareas is content, not a help-overlay
 * trigger.
 */
function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }
  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  // contentEditable boundary
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

declare global {
  interface HTMLElementTagNameMap {
    'quire-help-overlay': QuireHelpOverlay;
  }
}
