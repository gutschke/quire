// @vitest-environment happy-dom

/**
 * <wrap-stepper> — D1-C (2026-05-26) end-of-session workflow shell.
 *
 * UX-expert finding: wrap mode used to be a single scrolling
 * surface (marks list + digest editor co-located).  That was
 * cockpit-overload territory once D1's diff-review was added.
 * Now wrap mode is a STEPPER: three discrete panes the DM walks
 * through in order.
 *
 *   1. Marks      — advancement-mark bullets per PC (D-prep-2)
 *   2. Digest     — campfire-recap editor (D4)
 *   3. Diff-review — NPC living-doc proposal review (D1-D)
 *
 * Final action is an explicit "Finish wrap" button on the
 * diff-review pane that returns the DM to in-session mode.
 *
 * **Why a stepper, not a tabbed dashboard:** wrap is a WORKFLOW
 * (each step's output composes into the next; digest is input to
 * diff-review per UX-expert).  Tabs imply independent views;
 * stepper implies sequence + completion.  Matches the
 * `renderWrapSessionLauncher` framing ("Step away from play…") —
 * wrap is explicitly NOT a cockpit-at-a-glance surface.
 *
 * **Why NO per-step URL state:** the destination (the saved
 * digest + ratified proposals) is what matters; the path through
 * is ephemeral.  Reload during wrap returns to the marks pane
 * with the saved state intact (digest in priorDigests, proposals
 * still in state.diffProposals).
 *
 * Composes for D2 (session-open ritual) by reversing the
 * sub-step list.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type WrapStep = 'marks' | 'digest' | 'diff-review';

export const WRAP_STEPS: ReadonlyArray<WrapStep> = [
  'marks',
  'digest',
  'diff-review'
];

const STEP_LABEL: Record<WrapStep, string> = {
  marks: 'Marks',
  digest: 'Digest',
  'diff-review': 'Diff-review'
};

const STEP_BLURB: Record<WrapStep, string> = {
  marks: 'Tick the bullets each PC earned this session.',
  digest: 'Draft the campfire recap players will read next time.',
  'diff-review': 'Review AI-proposed updates to the NPCs they met.'
};

export type StepChangeCallback = (next: WrapStep) => void;
export type FinishWrapCallback = () => void;

@customElement('wrap-stepper')
export class WrapStepper extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Which sub-step is currently shown. */
  @property({ attribute: false }) step: WrapStep = 'marks';

  /** Host callback to move to a different sub-step. */
  @property({ attribute: false }) onStepChange: StepChangeCallback | null = null;

  /**
   * Host callback to leave wrap mode entirely.  Rendered as the
   * "Finish wrap" terminal button on the diff-review pane.
   */
  @property({ attribute: false }) onFinish: FinishWrapCallback | null = null;

  override render(): TemplateResult {
    return html`<section class="wrap-stepper">
      ${this.renderBreadcrumb()}
      <p class="muted wrap-stepper-blurb">${STEP_BLURB[this.step]}</p>
      <slot></slot>
      ${this.renderFooter()}
    </section>`;
  }

  private renderBreadcrumb(): TemplateResult {
    const currentIdx = WRAP_STEPS.indexOf(this.step);
    return html`<nav
      class="wrap-stepper-breadcrumb"
      aria-label="Wrap workflow steps"
    >
      <ol>
        ${WRAP_STEPS.map((s, idx) => {
          const isCurrent = s === this.step;
          const isPast = idx < currentIdx;
          const classes = [
            'wrap-stepper-crumb',
            isCurrent ? 'wrap-stepper-crumb-current' : '',
            isPast ? 'wrap-stepper-crumb-past' : ''
          ]
            .filter(Boolean)
            .join(' ');
          return html`<li class=${classes}>
            <button
              type="button"
              class="wrap-stepper-crumb-button"
              ?disabled=${isCurrent || this.onStepChange === null}
              aria-current=${isCurrent ? 'step' : 'false'}
              @click=${() => this.onStepChange?.(s)}
            >
              <span class="wrap-stepper-crumb-index">${idx + 1}.</span>
              ${STEP_LABEL[s]}
            </button>
          </li>`;
        })}
      </ol>
    </nav>`;
  }

  private renderFooter(): TemplateResult {
    const currentIdx = WRAP_STEPS.indexOf(this.step);
    const prev = currentIdx > 0 ? WRAP_STEPS[currentIdx - 1] : null;
    const next =
      currentIdx < WRAP_STEPS.length - 1 ? WRAP_STEPS[currentIdx + 1] : null;
    const isLast = currentIdx === WRAP_STEPS.length - 1;
    return html`<div class="wrap-stepper-footer">
      <div class="wrap-stepper-nav">
        <button
          type="button"
          class="wrap-stepper-back"
          ?disabled=${prev === null || this.onStepChange === null}
          @click=${() => prev && this.onStepChange?.(prev)}
        >
          ${prev ? `← ${STEP_LABEL[prev]}` : '←'}
        </button>
        ${isLast
          ? html`<button
              type="button"
              class="wrap-stepper-finish"
              ?disabled=${this.onFinish === null}
              @click=${() => this.onFinish?.()}
            >
              Finish wrap — back to session
            </button>`
          : html`<button
              type="button"
              class="wrap-stepper-next"
              ?disabled=${next === null || this.onStepChange === null}
              @click=${() => next && this.onStepChange?.(next)}
            >
              ${next ? `${STEP_LABEL[next]} →` : '→'}
            </button>`}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wrap-stepper': WrapStepper;
  }
}
