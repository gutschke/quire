/**
 * <character-creation> — player-facing async chargen region (CC-5).
 *
 * Lands when the player visits an invite URL (CC-3 route).  The
 * region implements the 6-step player flow from the m4 design doc:
 *
 *   1. Landing      — "You're player N for X."
 *   2. Read-first   — expectation setting (same device, AI later,
 *                     save locally).
 *   3. Pick path    — Q&A / free-write / pre-gen.
 *   4. Work         — the chosen path's input UI.
 *   5. Done         — "Pack my character" + see-you-at-session-1.
 *   6. Resume       — re-entry on later visits.
 *
 * Today's scope (Phase 2 skeleton):
 *   - Step state machine + forward/back nav.
 *   - Steps 1 and 2 render real copy (the load-bearing
 *     expectation-setting moments per the UX expert).
 *   - Step 3 path picker renders the three options as buttons
 *     (selection is captured but doesn't yet route to a real form).
 *   - Steps 4-6 render placeholder copy explaining that the Q&A
 *     form (CC-6), free-write editor (CC-7), pre-gen browser
 *     (CC-8), and resume/done UX land in subsequent commits.
 *
 * Deferred from this commit:
 *   - Q&A form content (CC-6).
 *   - Free-write markdown editor (CC-7).
 *   - Pre-gen browser (CC-8).
 *   - Per-PC IndexedDB persistence (CC-4 + CC-11).
 *   - "Pack my character" export (CC-10).
 *   - Resume-on-revisit + wrong-device empty state (CC-11).
 *   - AI synthesis kickoff at session 1 (CC-14 / CC-17 / CC-19 /
 *     CC-20 / CC-22 / CC-23 / CC-24 — most primitives landed).
 *
 * Light-DOM rendering.  Player-facing — no coord gate.
 */

import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export type CreationPath = 'qa' | 'free-write' | 'pre-gen';
export type PickPathCallback = (path: CreationPath) => void;

const TOTAL_STEPS = 6;

@customElement('character-creation')
export class CharacterCreation extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Slot number from the validated invite token.  When 0 (default),
   * the host hasn't validated the token yet — render a loading
   * state.  When -1, the token was invalid — render an error state
   * (the host passes -1 via `tokenError` instead; -1 is reserved).
   */
  @property({ type: Number }) slotNumber: number = 0;

  /**
   * Campaign display name; sourced from the loaded campaign manifest
   * for the friendly landing copy.
   */
  @property() campaignName: string = '';

  /**
   * If the token failed validation, host passes the error code so
   * the region can render an apologetic banner.  Decoder error
   * codes are 'malformed' / 'expired' / 'campaign-mismatch' /
   * 'invalid-slot'.
   */
  @property() tokenError:
    | 'malformed'
    | 'expired'
    | 'campaign-mismatch'
    | 'invalid-slot'
    | '' = '';

  /**
   * The player's path selection.  Once set, transitions to step 4
   * (Work) where the appropriate input UI mounts.
   */
  @property() chosenPath: CreationPath | '' = '';

  /**
   * Callback fired when the player picks a path on step 3.  Host
   * (QuireApp) records the choice in IndexedDB so resume-on-revisit
   * (CC-11) returns the player to the right place.
   */
  @property({ attribute: false }) onPickPath: PickPathCallback | null = null;

  @state() private currentStep: number = 1;

  override render(): TemplateResult {
    if (this.tokenError) {
      return this.renderTokenError();
    }
    return html`
      <section class="card character-creation">
        ${this.renderProgressStrip()}
        <div class="character-creation-step">
          ${this.renderCurrentStep()}
        </div>
        ${this.renderStepNav()}
      </section>
    `;
  }

  private renderTokenError(): TemplateResult {
    const message = (() => {
      switch (this.tokenError) {
        case 'malformed':
          return 'This invite link is malformed.  Ask your DM for a fresh one.';
        case 'expired':
          return 'This invite link has expired.  Ask your DM for a fresh one.';
        case 'campaign-mismatch':
          return 'This invite link is for a different campaign than the one currently loaded.';
        case 'invalid-slot':
          return 'This invite link references a slot that is out of range.  Ask your DM for a fresh one.';
        default:
          return 'This invite link could not be validated.';
      }
    })();
    return html`
      <section class="card character-creation character-creation-error">
        <h2>Invite link invalid</h2>
        <p>${message}</p>
      </section>
    `;
  }

  private renderProgressStrip(): TemplateResult {
    const steps = [
      { n: 1, label: 'Welcome' },
      { n: 2, label: 'Read this' },
      { n: 3, label: 'Pick path' },
      { n: 4, label: 'Build' },
      { n: 5, label: 'Done' },
      { n: 6, label: 'Resume' }
    ];
    return html`
      <ol
        class="character-creation-progress"
        role="list"
        aria-label="Character creation steps"
      >
        ${steps.map(
          (s) => html`
            <li
              class="character-creation-progress-step ${s.n ===
              this.currentStep
                ? 'character-creation-progress-step-current'
                : ''} ${s.n < this.currentStep
                ? 'character-creation-progress-step-done'
                : ''}"
              aria-current=${s.n === this.currentStep ? 'step' : 'false'}
            >
              <span class="character-creation-progress-num">${s.n}</span>
              <span class="character-creation-progress-label">${s.label}</span>
            </li>
          `
        )}
      </ol>
    `;
  }

  private renderCurrentStep(): TemplateResult {
    switch (this.currentStep) {
      case 1:
        return this.renderLanding();
      case 2:
        return this.renderReadFirst();
      case 3:
        return this.renderPickPath();
      case 4:
        return this.renderWork();
      case 5:
        return this.renderDone();
      case 6:
        return this.renderResume();
      default:
        return html`<p>Unknown step.</p>`;
    }
  }

  private renderLanding(): TemplateResult {
    const slotLabel =
      this.slotNumber > 0 ? `PC${this.slotNumber}` : 'a player';
    const campaign = this.campaignName || 'this campaign';
    return html`
      <h2>Welcome to ${campaign}</h2>
      <p>
        You're <strong>${slotLabel}</strong> for this campaign.  Over
        the next few minutes you'll set up your character.  When
        you're done, save your work and see you at session 1.
      </p>
      <p class="muted">
        Tip: your DM may have suggested an archetype in the email
        they sent with this link.  Have a look — you can deviate,
        but the DM will want to know if you do.
      </p>
    `;
  }

  private renderReadFirst(): TemplateResult {
    return html`
      <h2>Before you start, three things</h2>
      <ol class="character-creation-readfirst">
        <li>
          <strong>Use the same browser on this computer for session
          1.</strong>  Your answers save here automatically.  If you
          clear your browser data or switch devices, you'll lose
          them — unless you also download a backup at the end (see
          step 5).
        </li>
        <li>
          <strong>The AI generates your backstory at session 1, not
          now.</strong>  Today you'll answer questions; at the
          table, your DM presses a button and the AI turns your
          answers into a backstory you can edit.
        </li>
        <li>
          <strong>Your answers stay on your device until session
          1.</strong>  Optionally, you can "pack" your character
          into a file or token and send it to your DM as backup —
          recommended in case anything happens to your browser.
        </li>
      </ol>
    `;
  }

  private renderPickPath(): TemplateResult {
    const choice = this.chosenPath;
    return html`
      <h2>How do you want to build your character?</h2>
      <p class="muted">
        Three ways to get there.  Pick what feels right; you can
        switch later.
      </p>
      <div class="character-creation-paths">
        ${this.renderPathButton(
          'qa',
          'Answer questions',
          'AI-assisted',
          'A short questionnaire — about 5 minutes.  At session 1, the AI weaves your answers into a backstory you can edit.',
          choice
        )}
        ${this.renderPathButton(
          'free-write',
          'Write it yourself',
          'No AI',
          'Open a Markdown editor and write your backstory from scratch.  Best when you have a clear character in mind.',
          choice
        )}
        ${this.renderPathButton(
          'pre-gen',
          'Pick a pre-made PC',
          'Quickest',
          'Choose from the DM-prepared characters.  You can tweak the details after picking.',
          choice
        )}
      </div>
    `;
  }

  private renderPathButton(
    path: CreationPath,
    title: string,
    badge: string,
    description: string,
    chosen: CreationPath | ''
  ): TemplateResult {
    const isChosen = chosen === path;
    return html`
      <button
        type="button"
        class="character-creation-path ${isChosen
          ? 'character-creation-path-chosen'
          : ''}"
        aria-pressed=${isChosen ? 'true' : 'false'}
        @click=${() => this.onPickPath?.(path)}
      >
        <div class="character-creation-path-header">
          <span class="character-creation-path-title">${title}</span>
          <span class="character-creation-path-badge">${badge}</span>
        </div>
        <div class="character-creation-path-description">
          ${description}
        </div>
      </button>
    `;
  }

  private renderWork(): TemplateResult {
    // Step 4 content depends on the chosen path; CC-6 / CC-7 / CC-8
    // ship the real content.  Today we surface a placeholder noting
    // which path the player picked.
    if (this.chosenPath === '') {
      return html`
        <h2>Build your character</h2>
        <p>Go back to step 3 and pick a path first.</p>
      `;
    }
    const label = (() => {
      switch (this.chosenPath) {
        case 'qa':
          return 'Q&A questionnaire';
        case 'free-write':
          return 'free-write editor';
        case 'pre-gen':
          return 'pre-gen browser';
      }
    })();
    return html`
      <h2>Build your character</h2>
      <p class="muted">
        Path selected: <strong>${label}</strong>.
      </p>
      <p>
        (The ${label} input UI lands in a later commit.  For now,
        you can move to step 5 to see the "Done" affordances.)
      </p>
    `;
  }

  private renderDone(): TemplateResult {
    return html`
      <h2>You're done — see you at session 1</h2>
      <p>
        Your answers are saved on this device.  When session 1
        starts, sit down with the DM and they'll run the synthesis.
      </p>
      <p class="muted">
        <strong>Recommended:</strong> click "Pack my character"
        below to download a backup file — send it to your DM via
        chat or email so they have a copy too.  (The "Pack my
        character" affordance lands in a later commit.)
      </p>
    `;
  }

  private renderResume(): TemplateResult {
    return html`
      <h2>Resume</h2>
      <p class="muted">
        This screen renders when you visit your invite URL again
        before session 1.  Your in-progress answers from this device
        are picked up automatically.  (The resume UX lands in a
        later commit — CC-11.)
      </p>
    `;
  }

  private renderStepNav(): TemplateResult {
    return html`
      <nav class="character-creation-stepnav">
        <button
          type="button"
          ?disabled=${this.currentStep <= 1}
          @click=${() => this.go(-1)}
        >
          ← Back
        </button>
        <span class="character-creation-stepnav-progress">
          Step ${this.currentStep} of ${TOTAL_STEPS}
        </span>
        <button
          type="button"
          ?disabled=${this.currentStep >= TOTAL_STEPS}
          @click=${() => this.go(1)}
        >
          Next →
        </button>
      </nav>
    `;
  }

  private go(delta: number): void {
    const next = this.currentStep + delta;
    if (next < 1 || next > TOTAL_STEPS) return;
    this.currentStep = next;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'character-creation': CharacterCreation;
  }
}
