/**
 * File System Access API cloud-push orchestrator (M6a-FS).
 *
 * # What this module does
 *
 * Wires the M6a-FS engine layer together:
 *
 *   - Feature detection (`fs-api-availability`).
 *   - Persistent folder-handle storage (`fs-api-handle-store`).
 *   - Permission lifecycle (probe → request).
 *   - Consent ledger (`cloud-push-consent`, destination = `'fs-api'`).
 *   - File-naming convention (`<campaign-slug>.quire-save.json`).
 *   - Read-before-write conflict detection.
 *
 * Callers (the operational view's "Backups" section, the
 * session-digest chip) hold a single `FsApiCloudPush` instance and
 * call its five user-facing methods:
 *
 *   - `connectFolder({campaignId})` — picks a folder, records
 *     consent, writes a handle record.
 *   - `pushCampaignToFolder({campaignId, ...})` — writes the save.
 *   - `pullCampaignFromFolder({campaignId})` — reads the save.
 *   - `listSavesInFolder({campaignId})` — enumerates the folder.
 *   - `disconnectFolder({campaignId})` — drops the handle +
 *     withdraws consent.
 *
 * Each method returns a typed result rather than throwing past
 * the orchestrator boundary.  Failure reasons map to the §A12
 * error matrix' FS-API row equivalents (see auth-strategy.md
 * §FS).
 *
 * # File-naming convention
 *
 * `<campaign-slug>.quire-save.json` at the top level of the
 * chosen folder.  Examples:
 *
 *   - `underleaf.quire-save.json`
 *   - `quire-test.quire-save.json`
 *
 * Multi-campaign layout (per mandate): ONE folder, file-per-
 * campaign.  The DM picks (say) `Google Drive/Quire/`; Quire
 * writes `underleaf.quire-save.json`, `other.quire-save.json`,
 * etc.  Each campaign records its own handle (the handle is the
 * same DirectoryHandle structurally — IndexedDB stores it
 * per-campaign so each campaign has its own accounting and
 * disconnect behavior).
 *
 * The slug is sanitized to be filesystem-safe: only
 * `[a-z0-9._-]`, lowercased, with anything else replaced by `-`.
 * Maximum length 64 chars.  A campaign id of `owner/repo@main`
 * becomes `owner-repo-main.quire-save.json`.  Sanitization is
 * documented in `maintainer-ops.md` so users searching for the
 * file by hand know what to look for.
 *
 * # Conflict handling (read-before-write)
 *
 * Before each push, we read the file's current `lastModified`.
 * If that's newer than the `lastObservedModifiedMs` we cached
 * on the previous push or pull, the file was modified externally
 * — desktop sync pulled a newer copy from cloud (another device
 * wrote first).  We surface a `'conflict'` result so the caller
 * can show a "Pull, merge, then push" prompt analogous to
 * auth-strategy §A7's pull-rebase-push.  The runtime's existing
 * CRDT merge handles the actual reconciliation; this module's
 * job is to detect the conflict and bail before clobbering.
 *
 * # What this module DOESN'T do
 *
 * - The actual dialog rendering for the consent ceremony.  The
 *   caller (Piece 2 UI) calls `hasAcknowledged`, shows the dialog
 *   if false, calls `recordAcknowledgment` on click, and then
 *   calls `connectFolder` / `pushCampaignToFolder`.  Inverting
 *   that into the orchestrator would couple this module to Lit.
 *
 * - File-content merging.  The runtime owns CRDT merge in
 *   `persistence.ts` (LWW, sum-of-clock ordering).  This module
 *   only round-trips the JSON.
 *
 * - The OAuth flow.  M6a-FS deliberately bypasses OAuth entirely;
 *   the consent ledger is the only ceremony shared with the
 *   OAuth path.
 */

import {
  hasAcknowledged,
  recordAcknowledgment,
  withdrawAcknowledgment,
  type ConsentStorage
} from './cloud-push-consent';
import {
  getAvailabilityVerdict,
  isFileSystemAccessAvailable,
  type FsApiEnv
} from './fs-api-availability';
import {
  probeWritePermission,
  requestWritePermission,
  type FsApiDirectoryHandleLike,
  type FsApiHandleRecord,
  type FsApiHandleStorage
} from './fs-api-handle-store';

// ---------------------------------------------------------------
// File-name sanitization
// ---------------------------------------------------------------

const FILE_SUFFIX = '.quire-save.json';
const MAX_SLUG_LEN = 64;

/**
 * Convert a campaign id into a filesystem-safe slug for the save
 * file name.  Idempotent (running twice produces the same string)
 * and stable across runs (no clock / random state).
 *
 * Examples:
 *   `owner/repo@main` → `owner-repo-main`
 *   `Owner/Repo@v1.0` → `owner-repo-v1.0`
 *
 * Documented in `maintainer-ops.md` so users hunting for the
 * file by hand know the naming convention.
 */
export function sanitizeCampaignSlug(campaignId: string): string {
  const lowered = campaignId.toLowerCase();
  // Replace anything that's NOT a safe filename char with `-`.
  // Allowed: letters, digits, dot, underscore, hyphen.
  const cleaned = lowered.replace(/[^a-z0-9._-]+/g, '-');
  // Collapse runs of dashes (cosmetic).
  const collapsed = cleaned.replace(/-+/g, '-');
  // Trim leading/trailing dashes.
  const trimmed = collapsed.replace(/^-+|-+$/g, '');
  // Truncate to MAX_SLUG_LEN.  We don't need a hash suffix here —
  // two campaigns with the same prefix on the same folder is a
  // structural collision the DM should resolve out-of-band; we
  // surface that as a documented limitation rather than silently
  // adding entropy that would also break user search.
  const truncated = trimmed.slice(0, MAX_SLUG_LEN);
  // Final fallback if everything stripped to empty (e.g. all
  // forbidden chars): use a stable placeholder so we still write
  // SOMETHING the DM can find.
  return truncated.length > 0 ? truncated : 'campaign';
}

/**
 * Compose the full save-file name from a campaign id.
 */
export function saveFileNameFor(campaignId: string): string {
  return `${sanitizeCampaignSlug(campaignId)}${FILE_SUFFIX}`;
}

// ---------------------------------------------------------------
// File-system handle abstraction (minimal subset we need)
// ---------------------------------------------------------------

/**
 * The minimum we need from a FileSystemFileHandle.  Modeled as
 * an interface so the mock implementation in tests doesn't have
 * to depend on the DOM lib types.
 */
export interface FsApiFileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<FsApiFileLike>;
  createWritable(): Promise<FsApiWritableStreamLike>;
}

export interface FsApiFileLike {
  readonly lastModified: number;
  readonly size: number;
  text(): Promise<string>;
}

export interface FsApiWritableStreamLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The minimum we need from the parent DirectoryHandle for I/O.
 * `FsApiDirectoryHandleLike` (from the handle store) only models
 * permission methods; this extends it with the file-access
 * methods we need at I/O time.
 *
 * We model it as a separate interface so the handle store can
 * persist the simpler shape; the cloud-push layer narrows to
 * this superset for the read/write paths.
 */
export interface FsApiDirectoryHandleIo extends FsApiDirectoryHandleLike {
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FsApiFileHandleLike>;
  removeEntry?(name: string): Promise<void>;
  /**
   * Async-iterable over directory entries.  Real
   * FileSystemDirectoryHandle exposes `values()` returning an
   * async iterator of file/directory handles.
   */
  values(): AsyncIterable<FsApiFileHandleLike | FsApiDirectoryHandleLike>;
}

// ---------------------------------------------------------------
// Picker abstraction
// ---------------------------------------------------------------

/**
 * The folder picker.  Production wires `window.showDirectoryPicker`;
 * tests inject a stub.  Both throw on user dismissal — the
 * production browser throws `AbortError`; tests can throw any
 * Error and we'll map it to `'cancelled'`.
 */
export type FsApiDirectoryPicker = (
  options?: { mode?: 'read' | 'readwrite' }
) => Promise<FsApiDirectoryHandleIo>;

// ---------------------------------------------------------------
// Result types
// ---------------------------------------------------------------

export type ConnectFolderResult =
  | {
      readonly ok: true;
      readonly folderName: string;
      /**
       * Whether the DM was prompted for the consent dialog as
       * part of this connect, or whether they had previously
       * acknowledged.  The UI surface uses this to skip the
       * dialog flow when it's a no-op.
       */
      readonly consentJustRecorded: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'feature-unavailable' // browser doesn't support the API
        | 'cancelled' // user dismissed the picker
        | 'permission-denied' // user picked but denied readwrite
        | 'no-consent' // caller didn't pre-acknowledge consent
        | 'storage-failure'; // IndexedDB write failed
    };

export type PushResult =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly bytesWritten: number;
      readonly lastModifiedMs: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'not-connected' // no folder handle for this campaign
        | 'permission-revoked' // probe returned prompt / denied
        | 'conflict' // file modified externally since last push
        | 'write-failure' // I/O error during write
        | 'feature-unavailable';
    };

export type PullResult =
  | {
      readonly ok: true;
      readonly body: string;
      readonly lastModifiedMs: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'not-connected'
        | 'permission-revoked'
        | 'not-found' // no save file in folder
        | 'read-failure'
        | 'feature-unavailable';
    };

export type ListResult =
  | {
      readonly ok: true;
      readonly files: ReadonlyArray<{
        readonly name: string;
        readonly lastModifiedMs: number;
        readonly size: number;
      }>;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'not-connected'
        | 'permission-revoked'
        | 'list-failure'
        | 'feature-unavailable';
    };

export type DisconnectResult = { readonly ok: true };

// ---------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------

export interface FsApiCloudPushDeps {
  /** Feature-detection env.  Defaults to `window` / `navigator`. */
  readonly env?: FsApiEnv;
  /** The folder picker — production passes `window.showDirectoryPicker`. */
  readonly picker: FsApiDirectoryPicker;
  /** IndexedDB-backed handle storage. */
  readonly handleStorage: FsApiHandleStorage;
  /** localStorage-backed consent ledger. */
  readonly consentStorage: ConsentStorage;
  /** Clock; injected for deterministic tests. */
  readonly now: () => number;
}

export class FsApiCloudPush {
  constructor(private readonly deps: FsApiCloudPushDeps) {}

  /**
   * Surface the verdict from `fs-api-availability` so callers can
   * branch on "should we render the Backups section at all?"
   * without importing the availability module separately.
   */
  isAvailable(): boolean {
    return isFileSystemAccessAvailable(this.deps.env);
  }

  getAvailabilityVerdict() {
    return getAvailabilityVerdict(this.deps.env);
  }

  /**
   * Show the folder picker, request write permission, persist the
   * handle, and record consent in the ledger.
   *
   * MUST be called from a user-gesture handler (the browser
   * blocks `showDirectoryPicker` outside of one).  The caller is
   * also expected to have already gotten the DM's
   * acknowledgment via the consent dialog before invoking this.
   *
   * The `consentAlreadyAcknowledged` parameter lets the caller
   * skip the in-method acknowledgment write if they handled the
   * dialog themselves (typical path).  If they pass `false`,
   * this method writes the acknowledgment after a successful
   * connect, which is the simple path for callers that just want
   * "the DM clicked Connect, do the thing."
   */
  async connectFolder({
    campaignId,
    consentAlreadyAcknowledged
  }: {
    campaignId: string;
    consentAlreadyAcknowledged: boolean;
  }): Promise<ConnectFolderResult> {
    if (!this.isAvailable()) {
      return { ok: false, reason: 'feature-unavailable' };
    }

    // If the caller hasn't recorded consent yet AND there's no
    // existing acknowledgment on record, refuse — the consent
    // ceremony is load-bearing per DEC-020.
    const alreadyAcknowledged = hasAcknowledged(
      this.deps.consentStorage,
      campaignId,
      'fs-api'
    );
    if (!alreadyAcknowledged && !consentAlreadyAcknowledged) {
      return { ok: false, reason: 'no-consent' };
    }

    let handle: FsApiDirectoryHandleIo;
    try {
      handle = await this.deps.picker({ mode: 'readwrite' });
    } catch {
      // Picker throws on user dismiss / any failure.  Map
      // generically; the typical user-dismiss case is the
      // dominant one.
      return { ok: false, reason: 'cancelled' };
    }

    // The picker grants permission for THIS gesture; verify.
    const perm = await probeWritePermission(handle);
    if (!perm.ok) {
      // Rare — but if the user picked a folder and the OS denied
      // write access, surface that distinctly from a dismiss.
      return { ok: false, reason: 'permission-denied' };
    }

    // Record consent if the caller asked us to.
    let consentJustRecorded = false;
    if (!alreadyAcknowledged) {
      recordAcknowledgment(
        this.deps.consentStorage,
        campaignId,
        'fs-api',
        this.deps.now()
      );
      consentJustRecorded = true;
    }

    const record: FsApiHandleRecord = {
      v: 1,
      campaignId,
      handle,
      displayName: handle.name,
      connectedAt: this.deps.now(),
      lastPushedAt: null,
      lastObservedModifiedMs: null
    };
    try {
      await this.deps.handleStorage.write(record);
    } catch {
      return { ok: false, reason: 'storage-failure' };
    }

    return {
      ok: true,
      folderName: handle.name,
      consentJustRecorded
    };
  }

  /**
   * Push the save body to the campaign's folder.  Reads the
   * existing file's `lastModified` first; bails with `'conflict'`
   * if the file was modified externally since the last
   * observation (another device wrote first via the desktop sync
   * client).
   */
  async pushCampaignToFolder({
    campaignId,
    body
  }: {
    campaignId: string;
    body: string;
  }): Promise<PushResult> {
    if (!this.isAvailable()) {
      return { ok: false, reason: 'feature-unavailable' };
    }
    const record = await this.deps.handleStorage.read(campaignId);
    if (!record) {
      return { ok: false, reason: 'not-connected' };
    }
    const handle = record.handle as FsApiDirectoryHandleIo;
    const perm = await probeWritePermission(handle);
    if (!perm.ok) {
      return { ok: false, reason: 'permission-revoked' };
    }

    const fileName = saveFileNameFor(campaignId);

    // Read-before-write: check the file's current lastModified.
    // If it's newer than what we last observed, it was modified
    // externally — bail with conflict.
    let currentLastModified: number | null = null;
    try {
      const existing = await handle.getFileHandle(fileName, {
        create: false
      });
      const file = await existing.getFile();
      currentLastModified = file.lastModified;
    } catch {
      // File doesn't exist yet — that's a NEW push, not a
      // conflict.  Fall through.
      currentLastModified = null;
    }
    if (
      currentLastModified !== null &&
      record.lastObservedModifiedMs !== null &&
      currentLastModified > record.lastObservedModifiedMs
    ) {
      return { ok: false, reason: 'conflict' };
    }

    // Open the writable stream (creating the file if needed).
    let fileHandle: FsApiFileHandleLike;
    try {
      fileHandle = await handle.getFileHandle(fileName, { create: true });
    } catch {
      return { ok: false, reason: 'write-failure' };
    }
    let writable: FsApiWritableStreamLike;
    try {
      writable = await fileHandle.createWritable();
    } catch {
      return { ok: false, reason: 'write-failure' };
    }
    try {
      await writable.write(body);
      await writable.close();
    } catch {
      return { ok: false, reason: 'write-failure' };
    }

    // Re-stat to capture the post-write lastModified for the
    // next conflict-check baseline.
    let postWriteLastModified = this.deps.now();
    let bytesWritten = body.length;
    try {
      const file = await fileHandle.getFile();
      postWriteLastModified = file.lastModified;
      bytesWritten = file.size;
    } catch {
      // Re-stat failed; fall back to the values we have.
    }

    const updated: FsApiHandleRecord = {
      ...record,
      lastPushedAt: this.deps.now(),
      lastObservedModifiedMs: postWriteLastModified
    };
    try {
      await this.deps.handleStorage.write(updated);
    } catch {
      // Storage failed but the file was written — best-effort.
    }

    return {
      ok: true,
      fileName,
      bytesWritten,
      lastModifiedMs: postWriteLastModified
    };
  }

  /**
   * Read the save file for a campaign.  Updates the
   * `lastObservedModifiedMs` baseline so the next push knows
   * which version we last saw.
   */
  async pullCampaignFromFolder({
    campaignId
  }: {
    campaignId: string;
  }): Promise<PullResult> {
    if (!this.isAvailable()) {
      return { ok: false, reason: 'feature-unavailable' };
    }
    const record = await this.deps.handleStorage.read(campaignId);
    if (!record) {
      return { ok: false, reason: 'not-connected' };
    }
    const handle = record.handle as FsApiDirectoryHandleIo;
    const perm = await probeWritePermission(handle);
    if (!perm.ok) {
      return { ok: false, reason: 'permission-revoked' };
    }
    const fileName = saveFileNameFor(campaignId);
    let fileHandle: FsApiFileHandleLike;
    try {
      fileHandle = await handle.getFileHandle(fileName, { create: false });
    } catch {
      return { ok: false, reason: 'not-found' };
    }
    let file: FsApiFileLike;
    try {
      file = await fileHandle.getFile();
    } catch {
      return { ok: false, reason: 'read-failure' };
    }
    let body: string;
    try {
      body = await file.text();
    } catch {
      return { ok: false, reason: 'read-failure' };
    }

    // Update the baseline so the next push knows what we last
    // observed.
    const updated: FsApiHandleRecord = {
      ...record,
      lastObservedModifiedMs: file.lastModified
    };
    try {
      await this.deps.handleStorage.write(updated);
    } catch {
      // Best-effort.
    }

    return { ok: true, body, lastModifiedMs: file.lastModified };
  }

  /**
   * Enumerate `.quire-save.json` files in the connected folder.
   * Used by the cross-device discovery surface — a DM who
   * connects a fresh laptop to their existing folder can see
   * what campaigns are already there.
   *
   * Filters by suffix so we don't accidentally surface unrelated
   * files the DM may have parked in the same folder.
   */
  async listSavesInFolder({
    campaignId
  }: {
    campaignId: string;
  }): Promise<ListResult> {
    if (!this.isAvailable()) {
      return { ok: false, reason: 'feature-unavailable' };
    }
    const record = await this.deps.handleStorage.read(campaignId);
    if (!record) {
      return { ok: false, reason: 'not-connected' };
    }
    const handle = record.handle as FsApiDirectoryHandleIo;
    const perm = await probeWritePermission(handle);
    if (!perm.ok) {
      return { ok: false, reason: 'permission-revoked' };
    }
    const files: Array<{
      name: string;
      lastModifiedMs: number;
      size: number;
    }> = [];
    try {
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file') continue;
        if (!entry.name.endsWith(FILE_SUFFIX)) continue;
        const file = await entry.getFile();
        files.push({
          name: entry.name,
          lastModifiedMs: file.lastModified,
          size: file.size
        });
      }
    } catch {
      return { ok: false, reason: 'list-failure' };
    }
    return { ok: true, files };
  }

  /**
   * Drop the handle record and withdraw the consent
   * acknowledgment.  Future pushes for this campaign will go
   * back through the connect ceremony.
   *
   * This DOES NOT delete the save file from the folder — the DM
   * can find it via their file browser.  Stronger "Disconnect →
   * Erase" semantics are OP-029 territory and stay out of M6a-FS
   * scope.
   */
  async disconnectFolder({
    campaignId
  }: {
    campaignId: string;
  }): Promise<DisconnectResult> {
    await this.deps.handleStorage.remove(campaignId);
    withdrawAcknowledgment(this.deps.consentStorage, campaignId, 'fs-api');
    return { ok: true };
  }

  /**
   * Convenience read for the operational view: surface the
   * current handle record (folder name + last-pushed time + …)
   * so the chip can render.  Returns null when no handle is
   * connected for this campaign.
   *
   * This is a pure read — no permission probe.  The UI typically
   * calls `getConnectedFolderState` to render, then defers the
   * permission probe to a deliberate Push click.
   */
  async getConnectedFolderState({
    campaignId
  }: {
    campaignId: string;
  }): Promise<{
    readonly connected: true;
    readonly folderName: string;
    readonly lastPushedAt: number | null;
    readonly connectedAt: number;
  } | {
    readonly connected: false;
  }> {
    const record = await this.deps.handleStorage.read(campaignId);
    if (!record) return { connected: false };
    return {
      connected: true,
      folderName: record.displayName,
      lastPushedAt: record.lastPushedAt,
      connectedAt: record.connectedAt
    };
  }

  /**
   * Request write permission via a user-gesture path.  Used by
   * the "Reconnect folder" affordance when an existing handle's
   * permission has rolled back to `prompt` between sessions.
   *
   * MUST be called from inside a user-gesture handler.
   */
  async requestPermissionForCampaign({
    campaignId
  }: {
    campaignId: string;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'not-connected' | 'denied' }> {
    const record = await this.deps.handleStorage.read(campaignId);
    if (!record) return { ok: false, reason: 'not-connected' };
    const result = await requestWritePermission(record.handle);
    if (result.ok) return { ok: true };
    return { ok: false, reason: 'denied' };
  }
}

// ---------------------------------------------------------------
// Production wiring helper
// ---------------------------------------------------------------

/**
 * Build a production-wired picker that calls
 * `window.showDirectoryPicker`.  Exported so the host element
 * can compose the orchestrator in one place rather than reaching
 * for `window` inline.
 */
export function browserDirectoryPicker(): FsApiDirectoryPicker {
  return async (options) => {
    const w = window as unknown as {
      showDirectoryPicker: (
        opts?: { mode?: 'read' | 'readwrite' }
      ) => Promise<FsApiDirectoryHandleIo>;
    };
    return w.showDirectoryPicker(options);
  };
}
