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

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CampaignCharCreationQuestion } from '../../campaign-loader';
import {
  type BondDraft,
  MAX_BOND_DRAFTS,
  MAX_BOND_TARGET_LEN
} from '../../chargen-pack';

/**
 * D5.5-B: soft cap on chargen bond text in the authoring UI.  The
 * engine + pack accept up to 500 chars (MAX_BOND_TEXT_LEN), but per
 * the TTRPG-craft review an Underleaf bond is one evocative
 * sentence, not a paragraph — a ~140-char nudge keeps it from
 * competing with the backstory.  Not a hard gate: the textarea
 * shows an over-soft-cap hint but still lets the player submit
 * (the pack validator enforces the real 500 ceiling).
 */
export const BOND_TEXT_SOFT_CAP = 140;

export type BondDraftsChangeCallback = (drafts: BondDraft[]) => void;

export type CreationPath = 'qa' | 'free-write' | 'pre-gen';
export type PickPathCallback = (path: CreationPath) => void;

/**
 * CC-6: map of question id → captured answer (the player's input).
 * MC answers are option values; short-answer answers are the raw
 * string the player typed.  Caller (QuireApp) holds the
 * authoritative copy via `onAnswerChange`.
 */
export type CharCreationAnswers = Record<string, string>;
export type AnswerChangeCallback = (id: string, value: string) => void;

// P3-sanity UX B1 / backlog P3U-1: dropped step 6 "Resume" — it
// was a placeholder card that landed players in a dead state right
// after the Required-pack moment.  Resume-on-revisit (CC-11) will
// surface as a banner on step 1 when it lands, not as its own
// step in the strip.
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

  /**
   * CC-6: campaign-declared questionnaire.  When empty, the Q&A
   * path renders an "ask your DM to declare questions" notice
   * instead of an empty form — same engine-vs-campaign drift
   * principle (engine renders whatever the campaign declares).
   */
  @property({ attribute: false })
  questions: CampaignCharCreationQuestion[] = [];

  /**
   * CC-6: captured answers keyed by question id.  Controlled
   * value — the caller passes the current snapshot and is notified
   * on every change via `onAnswerChange`.
   */
  @property({ attribute: false }) answers: CharCreationAnswers = {};

  @property({ attribute: false }) onAnswerChange: AnswerChangeCallback | null =
    null;

  /**
   * D5.5-B: player-authored bond drafts (the "Connections" step).
   * Controlled value — the host holds the authoritative copy + is
   * notified on every edit via `onBondDraftsChange`.  Always
   * 0-3 entries (the step enforces the cap by hiding "add" at 3).
   */
  @property({ attribute: false }) bondDrafts: BondDraft[] = [];
  @property({ attribute: false })
  onBondDraftsChange: BondDraftsChangeCallback | null = null;

  /**
   * CC-10: callback fired when the player clicks the "Pack my
   * character" button on step 5.  Host (QuireApp) serializes the
   * chargen state via `packChargen` + triggers a download.
   *
   * When null, the button is hidden — the host hasn't wired the
   * export path yet.
   */
  @property({ attribute: false }) onPack: (() => void) | null = null;
  /**
   * #253 (2026-05-26): live "Send to DM" callback.  When non-null,
   * the player sees a primary "Send to DM" button alongside the
   * "Pack my character" download.  Host wires this only when the
   * player is in an active session (chargen + WebRTC together).
   * When null, only the download is offered (legacy file-shuffle
   * workflow).
   */
  @property({ attribute: false }) onSendToDm: (() => void) | null = null;
  @property() sendToDmFeedback:
    | ''
    | 'sent'
    | 'send-failed'
    | 'send-too-large' = '';

  /**
   * CC-10 feedback: when the host wants to surface "packed!" or
   * "couldn't pack — try again" state on step 5.  Empty string =
   * no feedback shown.
   */
  @property() packFeedback: '' | 'packed' | 'pack-failed' = '';

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
      { n: 5, label: 'Connections' },
      { n: 6, label: 'Done' }
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
        return this.renderConnections();
      case 6:
        return this.renderDone();
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
        the next 10–15 minutes you'll set up your character.  When
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
          1.</strong>  At step 5 you'll "pack" your character into
          a file to email or chat to your DM <em>before</em>
          session 1 — this is currently the only way for the DM to
          receive your work.  (Live pull-from-player isn't wired
          yet.)
        </li>
      </ol>
    `;
  }

  private renderPickPath(): TemplateResult {
    const choice = this.chosenPath;
    // Reasons each path may be unavailable.  When set, the button
    // renders disabled with the reason as hover-text so the player
    // sees WHY a path is offered-but-blocked instead of clicking a
    // dead button.  Empty string = path is live.
    const qaDisabled =
      this.questions.length === 0
        ? "Your DM hasn't set up the character questions yet."
        : '';
    // CC-7: free-write editor isn't implemented — the path renders
    // a placeholder.  Disable to set expectations honestly.
    const freeWriteDisabled =
      'The free-write editor isn’t built yet — coming in a later release.';
    // Pre-gen pool isn't declared in the campaign manifest yet;
    // when it is, the host should pass an availability flag and
    // this reason will go away.  Today the path is universally
    // unavailable + the browser UI is a placeholder.
    const preGenDisabled =
      "Your DM hasn’t prepared any pre-made characters.";
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
          choice,
          qaDisabled
        )}
        ${this.renderPathButton(
          'free-write',
          'Write it yourself',
          'No AI',
          'Open a Markdown editor and write your backstory from scratch.  Best when you have a clear character in mind.',
          choice,
          freeWriteDisabled
        )}
        ${this.renderPathButton(
          'pre-gen',
          'Pick a pre-made PC',
          'Quickest',
          'Choose from the DM-prepared characters.  You can tweak the details after picking.',
          choice,
          preGenDisabled
        )}
      </div>
    `;
  }

  private renderPathButton(
    path: CreationPath,
    title: string,
    badge: string,
    description: string,
    chosen: CreationPath | '',
    disabledReason: string
  ): TemplateResult {
    const isChosen = chosen === path;
    const isDisabled = disabledReason !== '';
    // Auto-advance: picking a path commits the choice AND moves to
    // step 4.  If the player regrets, the step-nav's "← Back"
    // button takes them right back to this picker — no need to
    // require a separate "Next" click.
    const onClick = () => {
      if (isDisabled) return;
      this.onPickPath?.(path);
      this.currentStep = Math.min(this.currentStep + 1, TOTAL_STEPS);
    };
    return html`
      <button
        type="button"
        class="character-creation-path ${isChosen
          ? 'character-creation-path-chosen'
          : ''}"
        aria-pressed=${isChosen ? 'true' : 'false'}
        ?disabled=${isDisabled}
        title=${isDisabled ? disabledReason : ''}
        @click=${onClick}
      >
        <div class="character-creation-path-header">
          <span class="character-creation-path-title">${title}</span>
          <span class="character-creation-path-badge">${badge}</span>
        </div>
        <div class="character-creation-path-description">
          ${description}
        </div>
        ${isDisabled
          ? html`<div class="character-creation-path-unavailable">
              ${disabledReason}
            </div>`
          : nothing}
      </button>
    `;
  }

  private renderWork(): TemplateResult {
    if (this.chosenPath === '') {
      return html`
        <h2>Build your character</h2>
        <p>Go back to step 3 and pick a path first.</p>
      `;
    }
    if (this.chosenPath === 'qa') {
      return this.renderQaForm();
    }
    // CC-7 / CC-8 placeholder text — these paths land in later commits.
    const label =
      this.chosenPath === 'free-write'
        ? 'free-write editor'
        : 'pre-gen browser';
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

  /**
   * CC-6: render the Q&A form from the campaign's declared question
   * list.  Each question is one of two shapes:
   *
   *   - MC: rendered as a radio group with one button per option.
   *   - short-answer: rendered as a textarea with min/max length
   *     bounds enforced via the standard attributes plus a remaining-
   *     chars hint.
   *
   * When the campaign declares zero questions, the form falls back
   * to a friendly "ask your DM" notice — same defensive shape as
   * the M3D-7 dm-rail when episode.dmDocs is undeclared.
   */
  private renderQaForm(): TemplateResult {
    const qs = this.questions ?? [];
    if (qs.length === 0) {
      return html`
        <h2>Answer questions</h2>
        <p class="muted">
          This campaign hasn't declared a question list yet.  Ask
          your DM to add a <code>characterCreation.questions[]</code>
          block to <code>campaign.json</code>, or switch to the
          free-write path on step 3.
        </p>
      `;
    }
    return html`
      <h2>Answer questions</h2>
      <p class="muted">
        Take your time — about 10–15 minutes for the full set.
        Required questions are marked; optional ones can be left blank.
      </p>
      <ol class="character-creation-qa">
        ${qs.map((q, i) => this.renderQuestion(q, i + 1))}
      </ol>
    `;
  }

  private renderQuestion(
    q: CampaignCharCreationQuestion,
    n: number
  ): TemplateResult {
    const required = q.required !== false;
    const answer = this.answers?.[q.id] ?? '';
    return html`
      <li class="character-creation-qa-item">
        <label class="character-creation-qa-label">
          <span class="character-creation-qa-num">${n}.</span>
          <span class="character-creation-qa-prompt">${q.prompt}</span>
          ${required
            ? html`<span class="character-creation-qa-required" aria-label="required"
                >*</span
              >`
            : nothing}
        </label>
        ${q.kind === 'mc'
          ? this.renderMc(q, answer)
          : this.renderShortAnswer(q, answer)}
      </li>
    `;
  }

  private renderMc(
    q: CampaignCharCreationQuestion,
    answer: string
  ): TemplateResult {
    const options = q.options ?? [];
    return html`
      <fieldset class="character-creation-qa-mc">
        <legend class="character-creation-qa-sr-only">${q.prompt}</legend>
        ${options.map(
          (opt) => html`
            <label
              class="character-creation-qa-mc-option ${answer === opt.value
                ? 'character-creation-qa-mc-option-chosen'
                : ''}"
            >
              <input
                type="radio"
                name=${q.id}
                .value=${opt.value}
                .checked=${answer === opt.value}
                @change=${(e: Event) => {
                  const input = e.currentTarget as HTMLInputElement;
                  if (input.checked) {
                    this.onAnswerChange?.(q.id, opt.value);
                  }
                }}
              />
              <span>${opt.label}</span>
            </label>
          `
        )}
      </fieldset>
    `;
  }

  private renderShortAnswer(
    q: CampaignCharCreationQuestion,
    answer: string
  ): TemplateResult {
    const minLen = q.minLength ?? 10;
    const maxLen = q.maxLength ?? 400;
    const remaining = maxLen - answer.length;
    const tooShort = answer.length > 0 && answer.length < minLen;
    return html`
      <textarea
        class="character-creation-qa-textarea"
        name=${q.id}
        rows="3"
        minlength=${minLen}
        maxlength=${maxLen}
        .value=${answer}
        @input=${(e: Event) => {
          const ta = e.currentTarget as HTMLTextAreaElement;
          this.onAnswerChange?.(q.id, ta.value);
        }}
      ></textarea>
      <div class="character-creation-qa-meta">
        ${tooShort
          ? html`<span class="character-creation-qa-hint-warn"
              >Aim for at least ${minLen} characters.</span
            >`
          : html`<span class="character-creation-qa-hint"
              >${remaining} characters left</span
            >`}
      </div>
    `;
  }

  /**
   * D5.5-B: the "Connections" step.  Optional, skippable bond
   * authoring — the player names up to 3 people who matter to
   * their character.  The target is FREE TEXT (a name, a role,
   * "the medic on our team") because at chargen time the other
   * PCs may not exist yet; the DM resolves each to a real PC at
   * ratify.  Never a gate — the player can leave it empty + click
   * Next.  Bonds emerge fine in fiction; this is just a head start.
   */
  private renderConnections(): TemplateResult {
    const drafts = this.bondDrafts ?? [];
    const canAdd = drafts.length < MAX_BOND_DRAFTS;
    return html`
      <h2>Connections <span class="muted">(optional)</span></h2>
      <p class="muted">
        Who matters to your character?  Name up to ${MAX_BOND_DRAFTS}
        people — a fellow player's character, someone from your past,
        anyone.  One sentence each.  You can skip this and let the
        ties show up in play.
      </p>
      <p class="muted character-creation-connections-note">
        Don't worry if you don't know the other characters' names yet
        — describe them ("the quiet one", "my sister") and your DM
        sorts it out at the table.
      </p>
      ${drafts.length === 0
        ? html`<p class="character-creation-connections-empty muted">
            No connections yet.
          </p>`
        : html`<ol class="character-creation-connections-list">
            ${drafts.map((d, i) => this.renderBondDraftRow(d, i))}
          </ol>`}
      ${canAdd
        ? html`<button
            type="button"
            class="character-creation-connections-add"
            @click=${() => this.addBondDraft()}
          >
            + Add a connection
          </button>`
        : html`<p class="muted">That's the max (${MAX_BOND_DRAFTS}).</p>`}
    `;
  }

  private renderBondDraftRow(d: BondDraft, index: number): TemplateResult {
    const overSoft = d.text.length > BOND_TEXT_SOFT_CAP;
    return html`
      <li class="character-creation-connections-row">
        <label class="character-creation-connections-target-label">
          Who
          <input
            type="text"
            class="character-creation-connections-target"
            maxlength=${MAX_BOND_TARGET_LEN}
            placeholder="e.g., the medic on our team"
            .value=${d.targetPlaceholder}
            @input=${(e: Event) =>
              this.updateBondDraft(index, {
                targetPlaceholder: (e.target as HTMLInputElement).value
              })}
          />
        </label>
        <label class="character-creation-connections-text-label">
          What's between you
          <textarea
            class="character-creation-connections-text"
            rows="2"
            placeholder="e.g., She pulled me out of the fire. I owe her."
            .value=${d.text}
            @input=${(e: Event) =>
              this.updateBondDraft(index, {
                text: (e.target as HTMLTextAreaElement).value
              })}
          ></textarea>
        </label>
        <div class="character-creation-connections-meta">
          ${overSoft
            ? html`<span class="character-creation-qa-hint-warn"
                >A connection reads best as one line — consider
                trimming.</span
              >`
            : nothing}
          <button
            type="button"
            class="character-creation-connections-remove"
            aria-label="Remove this connection"
            @click=${() => this.removeBondDraft(index)}
          >
            Remove
          </button>
        </div>
      </li>
    `;
  }

  private addBondDraft(): void {
    const next = [
      ...(this.bondDrafts ?? []),
      { targetPlaceholder: '', text: '' }
    ].slice(0, MAX_BOND_DRAFTS);
    this.onBondDraftsChange?.(next);
  }

  private updateBondDraft(index: number, patch: Partial<BondDraft>): void {
    const next = (this.bondDrafts ?? []).map((d, i) =>
      i === index ? { ...d, ...patch } : d
    );
    this.onBondDraftsChange?.(next);
  }

  private removeBondDraft(index: number): void {
    const next = (this.bondDrafts ?? []).filter((_, i) => i !== index);
    this.onBondDraftsChange?.(next);
  }

  private renderDone(): TemplateResult {
    const packFeedback = (() => {
      switch (this.packFeedback) {
        case 'packed':
          return html`<span class="character-creation-pack-feedback character-creation-pack-feedback-ok"
            >✓ Pack downloaded — send it to your DM as a backup.</span
          >`;
        case 'pack-failed':
          return html`<span class="character-creation-pack-feedback character-creation-pack-feedback-err"
            >Could not pack — try again?</span
          >`;
        default:
          return nothing;
      }
    })();
    // #253: live "Send to DM" feedback.
    const sendFeedback = (() => {
      switch (this.sendToDmFeedback) {
        case 'sent':
          return html`<span class="character-creation-pack-feedback character-creation-pack-feedback-ok"
            >✓ Sent to the DM — they should see it instantly.</span
          >`;
        case 'send-failed':
          return html`<span class="character-creation-pack-feedback character-creation-pack-feedback-err"
            >Couldn't send live — use "Pack my character" to download
            the file as a backup, then email/chat it to your DM.</span
          >`;
        case 'send-too-large':
          return html`<span class="character-creation-pack-feedback character-creation-pack-feedback-err"
            >Your pack is too large to send live (over 32 KB).  Use
            "Pack my character" to download a file and send that
            instead.</span
          >`;
        default:
          return nothing;
      }
    })();
    return html`
      <h2>You're done — see you at session 1</h2>
      <p>
        Your answers are saved on this device.  When session 1
        starts, sit down with the DM and they'll run the synthesis.
      </p>
      <p class="character-creation-required-pack">
        ${this.onSendToDm
          ? html`<strong>Send your pack to the DM</strong> using the
              live button below — it travels via the session connection,
              no file shuffling required.  The download is still
              available as a backup.`
          : html`<strong>Required:</strong> click "Pack my character"
              below to download your character file, then email or
              chat it to your DM <em>before</em> session 1.  Your DM
              cannot synthesize without this file — your answers live
              only on this device.`}
      </p>
      ${this.onSendToDm || this.onPack
        ? html`
            <div class="character-creation-pack-actions">
              ${this.onSendToDm
                ? html`<button
                    type="button"
                    class="character-creation-send-button"
                    @click=${() => this.onSendToDm?.()}
                  >
                    Send to DM
                  </button>`
                : nothing}
              ${this.onPack
                ? html`<button
                    type="button"
                    class="character-creation-pack-button"
                    @click=${() => this.onPack?.()}
                  >
                    Pack my character
                  </button>`
                : nothing}
              ${sendFeedback}${packFeedback}
            </div>
          `
        : nothing}
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
