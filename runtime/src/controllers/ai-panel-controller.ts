/**
 * AiPanelController (#413, E-LARGE-1) — owns the DM-side AI-panel
 * interaction state that previously lived as ~10 `@state` fields on the
 * 7400-LOC `QuireApp` god-object.  Extracting it is the next step toward
 * the quire-app render-orchestrator target (see
 * `design/quire-app-target-architecture.md`): the metric that matters is
 * domain `@state` on the host, and this moves 10 of them off.
 *
 * SCOPE: this controller owns the panel's *display/interaction* state.
 * It deliberately does NOT own the cross-controller orchestration in
 * `QuireApp.submitAiPrompt` (which coordinates AiKeyStore + the broker +
 * the budget + AiWriteController) nor `shareAiResponseToChat` (which
 * coordinates the chat + spoiler-lint controller) — those legitimately
 * live on the host as the orchestrator and mutate this state through the
 * controller.  (transientError stays on QuireApp: it's a SHARED error
 * field also written by import / NPC-load paths, not AI-panel-specific.)
 *
 * FIREWALL NOTE: `aiResponseStructured` carries the broker's `dmOnly`
 * slice.  This controller merely HOLDS it.  The firewall is the render
 * gate — `QuireApp.showAiPanel()` checks live `isCoordinator()`, so the
 * panel (and the dmOnly slice) never renders for a player even across a
 * coord→player flip.  That gate is pinned by
 * `quire-app.coord-flip-firewall.test.ts`; moving the state here does
 * NOT move the firewall, and must not.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { AiResponse } from '../ai/schema';
import type { ContextScope } from '../ai/context';
import { DEFAULT_BUDGET_CEILING } from '../ai/budget';

export class AiPanelController implements ReactiveController {
  /** Whether the API-key / model / budget settings drawer is open. */
  aiShowSettings = false;
  /** Adversarial A8: route every AI-proposed update through explicit accept. */
  aiReviewEveryUpdate = false;
  /** The DM's in-progress prompt text. */
  aiPromptDraft = '';
  /** Legacy single-string response (the `safe` half) — used by "Share to chat". */
  aiResponse: string | null = null;
  /**
   * M3b.5: dual-card response from the broker (safe + DM-only halves +
   * sources + responseId).  When set, the panel renders both cards.
   */
  aiResponseStructured: AiResponse | null = null;
  /** M3b.5: scope for the NEXT prompt.  Resets to 'public' on submit. */
  aiScope: ContextScope = 'public';
  /**
   * M3b gate fix: the most-recent verdict the DM cast, so the panel can
   * render "✓ Accepted" / "✗ Rejected" instead of leaving the buttons hot.
   */
  aiVerdictResponseId = '';
  aiVerdictKind: '' | 'accept' | 'reject' = '';
  /** A request is in flight. */
  aiLoading = false;
  /** M3b.4: per-DM session-wide token budget ceiling. */
  aiBudgetCeiling: number = DEFAULT_BUDGET_CEILING;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — state seeds inline. */
  }

  // ---- mutation methods (#415: behavior, not just state, lives here) ----
  // The host's cross-controller ORCHESTRATION (submitAiPrompt, which
  // coordinates the broker / budget / AiKeyStore / AiWriteController, and
  // the verdict handlers) stays on QuireApp and calls these to mutate the
  // panel's own state.  Each requests a host re-render.  (The delegating
  // get/set accessors on QuireApp remain for test/compat writes.)

  toggleSettings(): void {
    this.aiShowSettings = !this.aiShowSettings;
    this.host.requestUpdate();
  }

  setPromptDraft(text: string): void {
    if (this.aiPromptDraft === text) return;
    this.aiPromptDraft = text;
    this.host.requestUpdate();
  }

  setScope(scope: ContextScope): void {
    if (this.aiScope === scope) return;
    this.aiScope = scope;
    this.host.requestUpdate();
  }

  setReviewEveryUpdate(value: boolean): void {
    if (this.aiReviewEveryUpdate === value) return;
    this.aiReviewEveryUpdate = value;
    this.host.requestUpdate();
  }

  /** Start a request: show loading + clear the prior response. */
  beginRequest(): void {
    this.aiLoading = true;
    this.aiResponse = null;
    this.aiResponseStructured = null;
    this.host.requestUpdate();
  }

  /**
   * Return the scope for THIS request and reset the toggle to 'public'
   * (the toggle should snap back the moment the DM hits Ask).
   */
  consumeScope(): ContextScope {
    const scope = this.aiScope;
    this.aiScope = 'public';
    this.host.requestUpdate();
    return scope;
  }

  /** Record the structured dual-card result + reset the verdict buttons. */
  setResult(structured: AiResponse): void {
    this.aiResponseStructured = structured;
    this.aiVerdictResponseId = '';
    this.aiVerdictKind = '';
    this.host.requestUpdate();
  }

  /** Record the safe single-string response + clear the prompt draft. */
  setSafeResponse(safe: string): void {
    this.aiResponse = safe;
    this.aiPromptDraft = '';
    this.host.requestUpdate();
  }

  /** Record the DM's accept/reject verdict for visible feedback. */
  setVerdict(responseId: string, kind: 'accept' | 'reject'): void {
    this.aiVerdictResponseId = responseId;
    this.aiVerdictKind = kind;
    this.host.requestUpdate();
  }

  /** Request finished (success or error) — clear loading. */
  endRequest(): void {
    this.aiLoading = false;
    this.host.requestUpdate();
  }
}
