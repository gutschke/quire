/**
 * IndexedDB-backed persistence for `FileSystemDirectoryHandle`
 * objects (M6a-FS handle store).
 *
 * # Why IndexedDB
 *
 * Folder handles obtained from `showDirectoryPicker` are
 * structured-cloneable.  Browsers persist them across tab close
 * and even browser restart when stored in IndexedDB — and ONLY
 * IndexedDB.  `localStorage` can't hold them (strings only) and
 * `sessionStorage` discards them at tab close.  Without
 * IndexedDB persistence, the DM would re-pick the folder every
 * session, which kills the cloud-sync value proposition.
 *
 * # Permission lifecycle (the load-bearing piece)
 *
 * Even with the handle persisted, the BROWSER does NOT
 * automatically re-grant write access on tab reload — privacy
 * defense by design.  The lifecycle is:
 *
 *   1. First call: `showDirectoryPicker` — user picks folder,
 *      permission is granted for THIS tab.
 *   2. Store the handle in IndexedDB.
 *   3. Tab closes; user opens a new tab; we read the handle from
 *      IndexedDB.  It's structurally valid but the permission
 *      is in 'prompt' state (sometimes 'denied' if the user
 *      revoked it).
 *   4. Before each write, we MUST call:
 *      `await handle.queryPermission({mode: 'readwrite'})`
 *      If result is 'granted', proceed.  If 'prompt' or
 *      'denied', the next attempt requires a USER GESTURE
 *      (click on a button) → call
 *      `requestPermission({mode: 'readwrite'})`.
 *
 * This means: we CANNOT silently auto-push in the background
 * after a fresh tab open.  The first push of a session requires
 * a deliberate click from the DM.  Same UX shape as OAuth
 * "Sign in to push" — the click IS the consent.
 *
 * The revoked case (user clicked "Reset permission" in browser
 * settings) is structurally indistinguishable from the
 * never-granted case once permission rolls back to 'prompt' or
 * 'denied'.  Our callers treat both the same way: surface the
 * "Reconnect folder" affordance, request permission on the next
 * gesture, fall back to "Connect a folder" (re-pick) if the
 * request returns 'denied'.
 *
 * # Module shape
 *
 * Pure functions over a pluggable IndexedDB-like store.  Tests
 * pass an in-memory map; production wires the browser's
 * `indexedDB`.  No global side effects at module load.
 */

/**
 * The subset of `FileSystemDirectoryHandle` we care about.
 * Modeled as an interface so tests can substitute a mock handle
 * without depending on the real DOM types.  The real Chromium
 * type is a superset of this; structural compat is enough.
 */
export interface FsApiDirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  queryPermission(
    descriptor: { mode: 'read' | 'readwrite' }
  ): Promise<PermissionStateLike>;
  requestPermission(
    descriptor: { mode: 'read' | 'readwrite' }
  ): Promise<PermissionStateLike>;
}

/**
 * Mirror of the spec's `PermissionState` enum.  Inlined rather
 * than imported from DOM types so the module compiles in test
 * environments without the DOM lib.
 */
export type PermissionStateLike = 'granted' | 'prompt' | 'denied';

/**
 * A storage record persisted per campaign.
 */
export interface FsApiHandleRecord {
  readonly v: 1;
  readonly campaignId: string;
  /**
   * The folder handle.  Browsers structured-clone this through
   * IndexedDB — DO NOT touch it (no JSON.stringify, no shallow
   * copy).  The store reads/writes the live object.
   */
  readonly handle: FsApiDirectoryHandleLike;
  /**
   * Human-readable folder name captured at first connect.
   * Echoed by the UI so the DM can confirm "Google Drive/Quire/"
   * is the folder they meant.  Cheap; doesn't survive a folder
   * rename on the OS side but the handle does.
   */
  readonly displayName: string;
  /** ms-epoch when the DM connected the folder. */
  readonly connectedAt: number;
  /**
   * ms-epoch of the most recent successful push.  `null` if no
   * push has succeeded yet (just connected; or all attempts
   * failed).  Used by the operational view's staleness chip.
   */
  readonly lastPushedAt: number | null;
  /**
   * The save file's last-known `modifiedTime` (epoch ms) as
   * observed during the most recent push or pull.  Compared
   * against the file's CURRENT `lastModified` before writing
   * to detect external edits (the desktop sync client pulling
   * a newer version from cloud → another device wrote first).
   * `null` if we've never observed the file (just connected,
   * no push yet).
   */
  readonly lastObservedModifiedMs: number | null;
}

/**
 * Pluggable IndexedDB-shaped store so tests can substitute an
 * in-memory map.  Methods are async because the real
 * IndexedDB API is fundamentally async; an in-memory test
 * implementation resolves synchronously.
 *
 * The interface is keyed on `campaignId` — one handle per
 * campaign, per the mandate's "One folder, file-per-campaign"
 * model (the handle is the same folder for every campaign,
 * but each campaign records its own connectedAt / lastPushedAt
 * accounting).
 */
export interface FsApiHandleStorage {
  read(campaignId: string): Promise<FsApiHandleRecord | null>;
  write(record: FsApiHandleRecord): Promise<void>;
  remove(campaignId: string): Promise<void>;
  /**
   * Enumerate all records (used by the recently-played /
   * campaign-discovery surface).
   */
  list(): Promise<ReadonlyArray<FsApiHandleRecord>>;
}

/**
 * In-memory implementation for tests.  NOT for production use.
 */
export function inMemoryFsApiHandleStorage(): FsApiHandleStorage {
  const map = new Map<string, FsApiHandleRecord>();
  return {
    async read(campaignId) {
      return map.get(campaignId) ?? null;
    },
    async write(record) {
      map.set(record.campaignId, record);
    },
    async remove(campaignId) {
      map.delete(campaignId);
    },
    async list() {
      return Array.from(map.values());
    }
  };
}

/**
 * IndexedDB constants for the production storage.  The object
 * store schema is intentionally minimal — one keyPath
 * (`campaignId`) over one store (`handles`).
 */
const DB_NAME = 'quire-fs-api-handles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

/**
 * Open the IndexedDB database, creating the schema on first
 * run.  The schema is intentionally minimal so we don't have to
 * write migration logic.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'campaignId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('indexedDB open failed'));
  });
}

/**
 * Wrap an IDBRequest as a Promise; the no-throw contract is
 * preserved by the outer try/catch in the production
 * implementation methods.
 */
function awaitRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * Production storage backed by IndexedDB.  Re-opens the DB per
 * call rather than keeping a long-lived connection — IndexedDB
 * supports concurrent opens cheaply, and per-call open lets us
 * survive the rare "tab kept open across a DB upgrade" case
 * without holding a stale handle.
 */
export function browserIndexedDbFsApiHandleStorage(): FsApiHandleStorage {
  async function withStore<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => Promise<T> | T
  ): Promise<T> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = await op(store);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error('indexedDB tx failed'));
        tx.onabort = () =>
          reject(tx.error ?? new Error('indexedDB tx aborted'));
      });
      return result;
    } finally {
      db.close();
    }
  }

  return {
    async read(campaignId) {
      try {
        return await withStore('readonly', async (store) => {
          const rec = await awaitRequest<FsApiHandleRecord | undefined>(
            store.get(campaignId) as IDBRequest<FsApiHandleRecord | undefined>
          );
          return rec ?? null;
        });
      } catch {
        return null;
      }
    },
    async write(record) {
      try {
        await withStore('readwrite', async (store) => {
          await awaitRequest(store.put(record));
        });
      } catch {
        // Fail-closed: caller can re-attempt on next push.
      }
    },
    async remove(campaignId) {
      try {
        await withStore('readwrite', async (store) => {
          await awaitRequest(store.delete(campaignId));
        });
      } catch {
        // Idempotent semantics; swallow.
      }
    },
    async list() {
      try {
        return await withStore('readonly', async (store) => {
          const all = await awaitRequest<FsApiHandleRecord[]>(
            store.getAll() as IDBRequest<FsApiHandleRecord[]>
          );
          return all ?? [];
        });
      } catch {
        return [];
      }
    }
  };
}

// ---------------------------------------------------------------
// Permission lifecycle
// ---------------------------------------------------------------

/**
 * The aggregated permission outcome the cloud-push layer
 * consumes.  Either we have write permission, or we don't and
 * we want the UI to render a reconnect chip.
 */
export type FsApiPermissionOutcome =
  | { readonly ok: true; readonly state: 'granted' }
  | {
      readonly ok: false;
      readonly state: 'prompt' | 'denied';
      /**
       * Why the next step requires a user gesture.  The UI uses
       * this to render the right "Reconnect folder" copy.
       */
      readonly reason: 'needs-gesture' | 'revoked';
    };

/**
 * Probe the handle's current permission without prompting.
 *
 * This is the cheap check we run on EVERY push attempt — it has
 * no side effects and never opens a permission dialog.  The
 * follow-up step (requestPermission) requires a user gesture.
 *
 * `'granted'` → proceed.
 * `'prompt'`  → caller asks for a gesture next, then calls
 *               `requestWritePermission`.
 * `'denied'`  → caller surfaces "your browser is blocking
 *               this folder; reconnect from settings or pick
 *               a new folder."  Indistinguishable from the
 *               "user revoked in browser UI" case.
 */
export async function probeWritePermission(
  handle: FsApiDirectoryHandleLike
): Promise<FsApiPermissionOutcome> {
  let state: PermissionStateLike;
  try {
    state = await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    // Some test mocks (and very old browsers) throw rather than
    // returning 'prompt'.  Treat as 'prompt' — the next user
    // gesture will request properly.
    state = 'prompt';
  }
  if (state === 'granted') {
    return { ok: true, state: 'granted' };
  }
  return {
    ok: false,
    state,
    reason: state === 'denied' ? 'revoked' : 'needs-gesture'
  };
}

/**
 * Request write permission.  MUST be called from a user-gesture
 * code path (`onclick` etc.) — otherwise the browser will
 * silently downgrade the dialog to a no-op.
 *
 * Returns the same outcome shape as `probeWritePermission` so
 * the caller can branch uniformly.
 */
export async function requestWritePermission(
  handle: FsApiDirectoryHandleLike
): Promise<FsApiPermissionOutcome> {
  let state: PermissionStateLike;
  try {
    state = await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    // Browser refused the request (typically because we're
    // not in a user-gesture context).  Map to denied so the
    // caller surfaces the reconnect path.
    state = 'denied';
  }
  if (state === 'granted') {
    return { ok: true, state: 'granted' };
  }
  return {
    ok: false,
    state,
    reason: state === 'denied' ? 'revoked' : 'needs-gesture'
  };
}
