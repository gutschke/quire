/**
 * Cloud-push consent ledger (M6a ship-gate OP-027 / DEC-011 / DEC-020).
 *
 * # Why this exists
 *
 * The DM-coord cloud save contains EVERY player's authored
 * content (chat, character drafts, bond notes, intent statements).
 * When the DM clicks "Back up to Drive", those words leave the
 * table and land on the DM's Google Drive — a destination no
 * player explicitly consented to.
 *
 * Quire's firewall ethos is "never tell a player about a thing
 * they didn't consent to."  In spirit, that applies the other
 * direction too — the DM should know they're carrying their
 * players' words to a new destination before they do it.
 *
 * Per DEC-011 + DEC-020, the runtime surfaces a ONE-TIME
 * per-campaign acknowledgment dialog on first cloud push:
 *
 *   "You are uploading the full table's content (including your
 *    players' chat, character drafts, and bond notes) to YOUR
 *    Google Drive.  Players can read what they have written to
 *    this campaign; they cannot see this Drive folder.
 *    [Acknowledge]"
 *
 * Crucially, this is **DM-only** — the silent-player firewall
 * (`feedback_silent_player_firewall` memory) is preserved.
 * Players are NOT notified that the DM has clicked the
 * acknowledgment.  Telling a player "your DM just confirmed
 * they're backing up your chat to their Drive" would itself
 * be a disclosure the player didn't sign up for.
 *
 * # Module shape
 *
 * Pure functions over a pluggable `ConsentStorage` interface so
 * the controller integrates with Lit's reactive update cycle
 * later without coupling to it now.  Tests use an in-memory
 * stub; production passes `localStorage`-backed storage.
 *
 * # Re-prompt triggers (DEC-020)
 *
 * The acknowledgment is per `<campaignId, destination>` pair.
 * Re-prompt when:
 *
 *   - The campaign id changes (different campaign).
 *   - The destination changes (Drive vs GitHub vs a new
 *     self-host endpoint).
 *
 * Both axes matter: a DM who acknowledged Drive backup for
 * campaign X has NOT acknowledged GitHub backup for X (that's a
 * different custody transfer), nor Drive backup for campaign Y
 * (different table, different player content).
 *
 * # Schema versioning
 *
 * The ledger is versioned to allow future migrations.  A v1
 * record always carries `{v: 1, acknowledgedAt}`; future
 * versions can add fields.  Records with unknown version are
 * treated as MISSING (fail-closed: re-prompt).
 *
 * # Non-goal: per-player opt-in
 *
 * DEC-011 explicitly rejected a per-player opt-out UI for v1
 * (prime-directive: admin before play).  The acknowledgment is
 * the DM's promise that the table's content is going where they
 * said it was going.  Per-player consent is a v2 follow-up if a
 * real DM raises it.
 */

/**
 * Recognized cloud destinations.  Each destination is a separate
 * custody transfer and gets its own acknowledgment.
 */
export type ConsentDestination =
  | 'google-drive-appdata'
  | 'google-drive-file'
  | 'github-private'
  | 'github-public';

/**
 * The acknowledgment record persisted per (campaign, destination).
 * Versioned for future schema evolution.
 */
export interface CloudPushConsentRecord {
  readonly v: 1;
  /** ms-epoch when the DM clicked Acknowledge */
  readonly acknowledgedAt: number;
  /** Stable identifier of the campaign the DM acknowledged for. */
  readonly campaignId: string;
  /** Destination the DM acknowledged. */
  readonly destination: ConsentDestination;
}

/**
 * Pluggable storage so tests can substitute an in-memory map for
 * localStorage.  Both methods must be synchronous because the
 * "should I prompt?" check runs in the push-button click path
 * and must not block on async I/O.
 */
export interface ConsentStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Production storage backed by `window.localStorage`.  Returns a
 * no-op shim if localStorage is unavailable (e.g. SSR / private
 * browsing — fail-closed: re-prompt forever).
 */
export function browserLocalStorageConsentStorage(): ConsentStorage {
  return {
    read(key: string): string | null {
      try {
        return window.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key: string, value: string): void {
      try {
        window.localStorage?.setItem(key, value);
      } catch {
        // Quota / private-mode: re-prompt-forever is the safe
        // failure mode.  Don't throw — that would break the
        // click handler.
      }
    },
    remove(key: string): void {
      try {
        window.localStorage?.removeItem(key);
      } catch {
        // Same fail-closed reasoning.
      }
    }
  };
}

/**
 * In-memory storage for tests.  NOT for production use.
 */
export function inMemoryConsentStorage(): ConsentStorage {
  const map = new Map<string, string>();
  return {
    read(key: string): string | null {
      return map.has(key) ? map.get(key)! : null;
    },
    write(key: string, value: string): void {
      map.set(key, value);
    },
    remove(key: string): void {
      map.delete(key);
    }
  };
}

/**
 * Compute the storage key for a (campaign, destination) pair.
 * Uses a stable, readable prefix so a DM inspecting their
 * browser storage can recognize what the key represents.
 *
 * Encoding: campaignId is URL-encoded so a campaign id
 * containing `:` or other separators doesn't collide with the
 * destination segment.  This is a stable invariant — the
 * lookup path uses the same encoder.
 */
export function consentKey(
  campaignId: string,
  destination: ConsentDestination
): string {
  return `quire.cloud-consent.${destination}.${encodeURIComponent(campaignId)}`;
}

/**
 * Has the DM already acknowledged backup for this (campaign,
 * destination) pair?
 *
 * Returns `false` (re-prompt) for ANY of:
 *   - No record present.
 *   - Record present but unparseable JSON.
 *   - Record present but wrong shape / unknown version.
 *   - Record present but campaignId/destination don't match
 *     (defends against a storage-key collision or a key reused
 *     after a campaign id rename).
 *
 * The fail-closed semantics align with the firewall ethos: when
 * in doubt, ask.  False-positive re-prompt costs one click;
 * false-negative skip-prompt costs the DM's awareness.
 */
export function hasAcknowledged(
  storage: ConsentStorage,
  campaignId: string,
  destination: ConsentDestination
): boolean {
  const raw = storage.read(consentKey(campaignId, destination));
  if (raw === null) return false;
  let rec: unknown;
  try {
    rec = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!rec || typeof rec !== 'object') return false;
  const r = rec as Partial<CloudPushConsentRecord>;
  if (r.v !== 1) return false;
  if (typeof r.acknowledgedAt !== 'number') return false;
  if (!Number.isFinite(r.acknowledgedAt)) return false;
  if (r.campaignId !== campaignId) return false;
  if (r.destination !== destination) return false;
  return true;
}

/**
 * Record the DM's acknowledgment.  Idempotent — calling twice
 * just updates the timestamp.  Caller is expected to have
 * already shown the dialog and received the click.
 */
export function recordAcknowledgment(
  storage: ConsentStorage,
  campaignId: string,
  destination: ConsentDestination,
  now: number
): void {
  const record: CloudPushConsentRecord = {
    v: 1,
    acknowledgedAt: now,
    campaignId,
    destination
  };
  storage.write(consentKey(campaignId, destination), JSON.stringify(record));
}

/**
 * Withdraw an acknowledgment (e.g. DM clicks "Disconnect Drive"
 * in the operational view).  Re-prompts on next push.
 *
 * This is symmetrical to `recordAcknowledgment` and is the
 * surface that the OP-029 forensic-recovery story
 * ("Disconnect → Erase before revoking") hooks into.
 */
export function withdrawAcknowledgment(
  storage: ConsentStorage,
  campaignId: string,
  destination: ConsentDestination
): void {
  storage.remove(consentKey(campaignId, destination));
}

/**
 * The DM-only dialog copy spec.  Final string is M8-deferred per
 * `ux-strategy.md` (TTRPG-craft owns the in-fiction wording).
 *
 * This export captures the SEMANTIC requirements the dialog
 * must hit so a later UI implementation can pass a lint that
 * the rendered text covers each beat:
 *
 *   1. Names the destination explicitly ("YOUR Google Drive").
 *   2. Names the content categories ("chat, character drafts,
 *      bond notes").
 *   3. Reassures the DM about player visibility ("players can
 *      see what they have written").
 *   4. Reassures the DM about destination opacity ("they
 *      cannot see this Drive folder").
 *   5. Single acknowledge action — no nag / cancel / remember-
 *      me checkbox.  The acknowledgment IS the next click.
 *   6. Silent-player firewall: no player-visible side effect.
 */
export interface ConsentDialogCopySpec {
  /** Title text. */
  readonly title: string;
  /** Body paragraphs. */
  readonly body: ReadonlyArray<string>;
  /** Acknowledge button label. */
  readonly acknowledgeLabel: string;
  /** Cancel-without-uploading button label. */
  readonly cancelLabel: string;
}

/**
 * Default copy spec — engineering-language placeholder.  The
 * TTRPG-craft pass at M8 replaces with in-fiction-tuned copy.
 */
export const DEFAULT_CONSENT_COPY: ConsentDialogCopySpec = {
  title: 'Backing up your table to Google Drive',
  body: [
    'You are uploading the full table’s content — including your players’ chat, character drafts, and bond notes — to YOUR Google Drive.',
    'Players can read what they have written to this campaign; they cannot see this Drive folder.',
    'Quire shows this notice once per campaign per backup destination.'
  ],
  acknowledgeLabel: 'Back up to my Drive',
  cancelLabel: 'Not now'
};
