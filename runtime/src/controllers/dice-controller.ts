/**
 * DiceController (#414, E-LARGE-1) — owns the dice-roll surface that
 * lived as 3 `@state` fields + `submitRoll` on `QuireApp`.  Unlike the
 * AI panel (#413, whose submit orchestrates many collaborators and
 * stayed on the host), the dice surface is self-contained, so this
 * extraction moves STATE *and* BEHAVIOR: the parse → roll → history →
 * draft-clear logic lives here.  The single cross-boundary concern —
 * publishing the roll to peers when in an active session — is handed
 * back to the host via the `publishRoll` env callback (the host owns
 * the session + the in-session gate).
 *
 * `rng` is late-bound (a callback) because tests stub the host's
 * `rngForRoll` field; reading it through the callback at roll time sees
 * the stubbed value.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  parseDiceCommand,
  rollDice,
  type DiceRoll
} from '../dice';

/** How many recent local rolls the dock keeps in history. */
export const ROLL_HISTORY_MAX = 5;

export interface DiceHostEnv {
  /** Late-bound RNG (host's `rngForRoll`, which tests stub). */
  rng: () => number;
  /** Publish the roll to peers IFF in an active session (host gates). */
  publishRoll: (roll: DiceRoll) => void;
}

export class DiceController implements ReactiveController {
  /** Local roll history (most-recent-first, capped at ROLL_HISTORY_MAX). */
  rolls: DiceRoll[] = [];
  /** The in-progress roll expression the player is typing. */
  rollDraft = '';
  /** Parse-error message for the current draft, or null. */
  rollError: string | null = null;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: DiceHostEnv
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op */
  }

  setRollDraft(value: string): void {
    if (this.rollDraft === value) return;
    this.rollDraft = value;
    this.host.requestUpdate();
  }

  /**
   * Parse + roll `input`.  On parse failure sets `rollError` and returns
   * null; on success records the roll, clears the draft, and asks the
   * host to publish it (when in session).
   */
  submitRoll(input: string): DiceRoll | null {
    const cmd = parseDiceCommand(input);
    if (!cmd) {
      this.rollError = `Couldn't parse "${input}".  Try 2d6, 2d6+1, 1d20, etc.`;
      this.host.requestUpdate();
      return null;
    }
    this.rollError = null;
    const roll = rollDice(cmd, this.env.rng);
    this.rolls = [roll, ...this.rolls].slice(0, ROLL_HISTORY_MAX);
    this.rollDraft = '';
    this.host.requestUpdate();
    this.env.publishRoll(roll);
    return roll;
  }
}
