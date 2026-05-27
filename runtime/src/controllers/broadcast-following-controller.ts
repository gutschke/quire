/**
 * E-LARGE-1 step 3 (2026-05-27): broadcast-follow cluster
 * extracted from QuireApp.  The DM's `broadcast-view` event
 * carries a route stagePath; non-coord viewers navigate to that
 * route when a NEWER ts than they've already followed arrives.
 * This controller owns the per-instance "last followed" cursor
 * + the follow logic that runs on every host update.
 *
 * What's NOT here:
 *   - `broadcastCurrentView()` (the DM-side append verb) stays
 *     on QuireApp.  Different concern (send vs. follow); putting
 *     both into one class would conflate roles.
 *   - The follow cursor is per-instance (not persisted to
 *     autosave).  A reload resets it so an old broadcast doesn't
 *     ambush the player on rejoin.
 *
 * Concurrency: the original inline `followBroadcast()` could fire
 * concurrent navigations when a new broadcast arrived while a
 * previous nav was pending.  The controller adds an `inFlight`
 * guard so only one navigation runs at a time; subsequent
 * broadcasts wait until the prior nav settles, then re-evaluate
 * the cursor at the next hostUpdated.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { SessionView } from '../session-controller';
import type { AppRoute } from '../routing';

export interface BroadcastFollowingEnv {
  getSessionView(): SessionView | null;
  isCoordinator(): boolean;
  /** Parse a broadcast `stagePath` (search-string) into a route. */
  parseStagePath(stagePath: string): AppRoute;
  /** Navigate to the broadcast target.  Promise resolves on settle. */
  navigateToRoute(route: AppRoute): Promise<void>;
}

export class BroadcastFollowingController implements ReactiveController {
  /**
   * The most recent broadcast ts the local viewer has already
   * followed.  Initialized to 0 so the first real broadcast
   * (positive ts) is always honored.
   */
  private lastFollowedBroadcastTs = 0;
  /**
   * Set while a follow-navigation is awaiting `navigateToRoute`.
   * Prevents concurrent navigations when a fresher broadcast
   * arrives mid-flight — the controller re-evaluates on the
   * next hostUpdated after the prior nav settles.
   */
  private inFlight = false;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: BroadcastFollowingEnv
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op */
  }

  hostDisconnected(): void {
    // Drop in-flight flag on unmount so re-mounts start clean.
    // The lastFollowedBroadcastTs cursor is intentionally reset
    // too — a re-mount that rehydrates from autosave should
    // re-evaluate the most recent broadcast (rejoin / refresh
    // shouldn't replay every historical broadcast, but the
    // newest one is fair game).  Without this reset, a re-mount
    // remembers the cursor across hostDisconnected/Connected
    // pairs (HMR keeps the class instance alive in some setups).
    this.inFlight = false;
    this.lastFollowedBroadcastTs = 0;
  }

  /**
   * Lit lifecycle: runs after every host update.  Reads
   * sessionView via the env getter (fresh snapshot each tick)
   * and follows the latest broadcast when:
   *   - a session is active,
   *   - a broadcastView with ts > cursor exists,
   *   - the local peer is NOT the DM (no self-bounce),
   *   - the stagePath parses to a real route (not home),
   *   - no prior navigation is already in flight.
   */
  hostUpdated(): void {
    const v = this.env.getSessionView();
    if (!v || v.status !== 'active') return;
    const bv = v.filteredShared.broadcastView;
    if (!bv) return;
    if (bv.ts <= this.lastFollowedBroadcastTs) return;
    if (this.env.isCoordinator()) {
      // DM is the broadcast author — no self-bounce.  Still
      // advance the cursor so future broadcasts dispatch
      // correctly when the DM changes coord state.
      this.lastFollowedBroadcastTs = bv.ts;
      return;
    }
    const route = this.env.parseStagePath(bv.stagePath);
    if (route.kind === 'home') {
      // Malformed stagePath — treat as followed so retry isn't
      // wedged on the same poisoned event.
      this.lastFollowedBroadcastTs = bv.ts;
      return;
    }
    if (this.inFlight) return;
    this.inFlight = true;
    // Advance the cursor AFTER navigation resolves so a DM retry
    // of the SAME ts still re-fires when the previous navigation
    // failed (the player lands on the error screen and the DM
    // can re-broadcast without bumping ts).  Call requestUpdate
    // on settle so a fresher broadcast queued during the await
    // (which the inFlight guard suppressed) gets re-evaluated on
    // the next hostUpdated — without this, we'd implicitly
    // depend on navigateToRoute mutating a @state field to
    // trigger the next reactive cycle.
    void this.env.navigateToRoute(route).then(
      () => {
        this.lastFollowedBroadcastTs = bv.ts;
        this.inFlight = false;
        this.host.requestUpdate();
      },
      () => {
        // Don't advance on rejection — re-broadcast of the same
        // ts will retry on the next hostUpdated.
        this.inFlight = false;
        this.host.requestUpdate();
      }
    );
  }

  /** Test-only: read the current cursor for assertions. */
  readonly _cursorForTest = (): number => this.lastFollowedBroadcastTs;
  /** Test-only: read the in-flight flag for assertions. */
  readonly _inFlightForTest = (): boolean => this.inFlight;
}
