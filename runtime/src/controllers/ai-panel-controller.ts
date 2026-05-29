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

  constructor(host: ReactiveControllerHost) {
    // Registered so future increments can add lifecycle hooks; today
    // it holds no host ref — mutations flow through the host's
    // delegating setters, which call host.requestUpdate().
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — see constructor note. */
  }
}
