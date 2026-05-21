/**
 * WorkingCopy — local writable layer over the read-only campaign
 * loader.  Used by M3a (player save export filter — writes the
 * stripped save to the working copy before download) and by M4
 * (living-document per-category commits).  M5 authoring mode reads
 * through the working copy when a file is dirty.
 *
 * The store is keyed by campaign-relative path (no leading `/`, no
 * `..` segments).  Each entry carries the file content, the git SHA
 * it was originally loaded at (`baseSha`, optional — used by the
 * M4 diff-format's stale-base detection), and a modification
 * timestamp.
 *
 * Storage is pluggable: production uses an IndexedDB backend (one
 * database per origin, one object store for entries + one for
 * commits).  Tests inject an in-memory backend.  This lets unit
 * tests avoid the happy-dom IDB gap without pulling in
 * fake-indexeddb as a dependency.
 *
 * Commit semantics (M4):
 *   commit({ message }) takes a snapshot of the current entries,
 *   appends a CommitMeta record to the commits store, and returns
 *   the recorded meta.  Files are NOT cleared on commit — the
 *   working copy is the staging area; export-to-tarball is a
 *   separate concern (P4-2).  Reverting a file removes it from the
 *   entries store (subsequent reads fall through to the read-only
 *   campaign loader).
 */

export interface WorkingCopyEntry {
  path: string;
  content: string;
  /** git SHA of the file when first loaded for editing.  Optional. */
  baseSha?: string;
  /** ms epoch when last written. */
  modifiedAt: number;
}

export interface CommitMeta {
  id: string;
  message: string;
  /** Snapshot of paths included in the commit (current dirty set). */
  files: readonly string[];
  committedAt: number;
}

/**
 * Storage backend abstraction.  Both methods may reject; callers
 * should handle errors (typically: surface as a save/load failure).
 */
export interface WorkingCopyStore {
  getEntry(path: string): Promise<WorkingCopyEntry | null>;
  putEntry(entry: WorkingCopyEntry): Promise<void>;
  deleteEntry(path: string): Promise<void>;
  listEntries(): Promise<WorkingCopyEntry[]>;
  putCommit(commit: CommitMeta): Promise<void>;
  listCommits(): Promise<CommitMeta[]>;
}

const VALID_PATH = /^[A-Za-z0-9._\-/]+$/;

function isValidPath(path: string): boolean {
  if (!path || path.length > 4096) return false;
  if (!VALID_PATH.test(path)) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (path.includes('//')) return false;
  return true;
}

function genId(): string {
  // Short random id; not security-critical (commit ids are local).
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class WorkingCopy {
  constructor(private readonly store: WorkingCopyStore) {}

  /**
   * Read an entry from the working copy.  Returns null if the path
   * has never been written or has been reverted.  Callers should
   * fall through to the read-only campaign loader on null.
   */
  async read(path: string): Promise<WorkingCopyEntry | null> {
    if (!isValidPath(path)) {
      throw new Error(`Invalid working-copy path: ${path}`);
    }
    return this.store.getEntry(path);
  }

  /**
   * Write content for a path.  Sets / refreshes modifiedAt.  Pass
   * baseSha when first creating the entry from a known-clean fetch;
   * subsequent writes keep the original baseSha (so the diff format
   * can detect stale-base on commit).
   */
  async write(
    path: string,
    content: string,
    baseSha?: string
  ): Promise<void> {
    if (!isValidPath(path)) {
      throw new Error(`Invalid working-copy path: ${path}`);
    }
    const existing = await this.store.getEntry(path);
    await this.store.putEntry({
      path,
      content,
      baseSha: existing?.baseSha ?? baseSha,
      modifiedAt: Date.now()
    });
  }

  /** List the paths currently in the working copy (dirty set). */
  async list(): Promise<string[]> {
    const entries = await this.store.listEntries();
    return entries.map((e) => e.path);
  }

  /**
   * Drop an entry, returning the working copy to fall-through state
   * for that path.  No-op if the path isn't dirty.
   */
  async revert(path: string): Promise<void> {
    if (!isValidPath(path)) {
      throw new Error(`Invalid working-copy path: ${path}`);
    }
    await this.store.deleteEntry(path);
  }

  /**
   * Record a commit covering the current dirty set.  M4 uses one
   * commit per accepted living-document category.  The entries are
   * NOT cleared from the working copy — they remain available for
   * subsequent commits or manual export.  Returns the recorded
   * CommitMeta.
   */
  async commit(opts: { message: string }): Promise<CommitMeta> {
    const entries = await this.store.listEntries();
    const meta: CommitMeta = {
      id: genId(),
      message: opts.message,
      files: entries.map((e) => e.path).sort(),
      committedAt: Date.now()
    };
    await this.store.putCommit(meta);
    return meta;
  }

  /** Return all commits, oldest first. */
  async listCommits(): Promise<CommitMeta[]> {
    const all = await this.store.listCommits();
    return all.sort((a, b) => a.committedAt - b.committedAt);
  }
}

// -----------------------------------------------------------------
// In-memory backend (tests + dev).
// -----------------------------------------------------------------

/**
 * Pure in-memory WorkingCopyStore.  Production code never uses this
 * directly; tests inject it to keep happy-dom + vitest unit tests
 * from needing fake-indexeddb.
 */
export class InMemoryWorkingCopyStore implements WorkingCopyStore {
  private entries = new Map<string, WorkingCopyEntry>();
  private commits: CommitMeta[] = [];

  async getEntry(path: string): Promise<WorkingCopyEntry | null> {
    return this.entries.get(path) ?? null;
  }
  async putEntry(entry: WorkingCopyEntry): Promise<void> {
    this.entries.set(entry.path, entry);
  }
  async deleteEntry(path: string): Promise<void> {
    this.entries.delete(path);
  }
  async listEntries(): Promise<WorkingCopyEntry[]> {
    return Array.from(this.entries.values());
  }
  async putCommit(commit: CommitMeta): Promise<void> {
    this.commits.push(commit);
  }
  async listCommits(): Promise<CommitMeta[]> {
    return [...this.commits];
  }
}

// -----------------------------------------------------------------
// IndexedDB backend (production browser path).
// -----------------------------------------------------------------

const DB_NAME = 'quire-working-copy';
const DB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const STORE_COMMITS = 'commits';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(STORE_COMMITS)) {
        db.createObjectStore(STORE_COMMITS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

/**
 * IndexedDB-backed store.  Lazy-init: the database is opened on
 * first access, not in the constructor, so unused-WorkingCopy
 * instances cost nothing.  Production code should construct this
 * once at app boot and re-use it.
 */
export class IndexedDbWorkingCopyStore implements WorkingCopyStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async getEntry(path: string): Promise<WorkingCopyEntry | null> {
    const db = await this.getDb();
    const result = await tx<WorkingCopyEntry | undefined>(
      db,
      STORE_ENTRIES,
      'readonly',
      (s) => s.get(path)
    );
    return result ?? null;
  }

  async putEntry(entry: WorkingCopyEntry): Promise<void> {
    const db = await this.getDb();
    await tx(db, STORE_ENTRIES, 'readwrite', (s) => s.put(entry));
  }

  async deleteEntry(path: string): Promise<void> {
    const db = await this.getDb();
    await tx(db, STORE_ENTRIES, 'readwrite', (s) => s.delete(path));
  }

  async listEntries(): Promise<WorkingCopyEntry[]> {
    const db = await this.getDb();
    return tx<WorkingCopyEntry[]>(db, STORE_ENTRIES, 'readonly', (s) =>
      s.getAll()
    );
  }

  async putCommit(commit: CommitMeta): Promise<void> {
    const db = await this.getDb();
    await tx(db, STORE_COMMITS, 'readwrite', (s) => s.put(commit));
  }

  async listCommits(): Promise<CommitMeta[]> {
    const db = await this.getDb();
    return tx<CommitMeta[]>(db, STORE_COMMITS, 'readonly', (s) =>
      s.getAll()
    );
  }
}
