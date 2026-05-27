/**
 * D5.5-A (2026-05-27 E-LARGE-2 step 1): extracted persistence-debounce
 * queue from the chargen-controller.  Pre-extraction this lived as
 * three private members + two methods inside the 1961-LOC
 * `ChargenController` god-object:
 *
 *   - `persistTimers`     — per-key setTimeout handles
 *   - `persistPendingValues` — per-key snapshot of the next save
 *   - `persistDebounced`  — schedule a debounced save
 *   - `flushPendingPersistForKey` — flush one
 *   - `flushPending`      — flush all (called at chargen-route exit)
 *
 * No behavior change.  The class is host-agnostic: it accepts a
 * writer function in the constructor + holds no Lit / DOM
 * dependencies, so it's testable in isolation + reusable for
 * other debounced-save consumers (M5 authoring queue, future
 * scratch-note persistence, etc.).
 *
 * Key shape: free-form string the caller chooses (typical:
 * `${slug}:${slot}`).  Concurrent saves to different keys don't
 * stomp each other.
 */

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Write callback signature.  Takes the value the caller scheduled
 * + writes it to backing storage (IndexedDB / localStorage / fake
 * test storage).  Called once per flush; idempotent on the queue
 * side (the queue tracks its own pending-set + clears on flush).
 */
export type PersistenceWriter<T> = (key: string, value: T) => void;

/**
 * D5.5-A: debounced-save queue keyed by free-form string.  One
 * pending save per key; subsequent schedules within the debounce
 * window replace the pending value (last-writer-wins by design —
 * mirrors the pre-extraction setAnswer behavior where keystrokes
 * during the debounce window coalesced).
 */
export class ChargenPersistenceQueue<T> {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, T>();
  private readonly debounceMs: number;
  private readonly writer: PersistenceWriter<T>;

  constructor(writer: PersistenceWriter<T>, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.writer = writer;
    this.debounceMs = debounceMs;
  }

  /**
   * Schedule a debounced save for `key` carrying `value`.  Cancels
   * any prior pending save for the same key; the most recently-
   * scheduled value is what eventually writes.
   */
  schedule(key: string, value: T): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.pending.set(key, value);
    this.timers.set(
      key,
      setTimeout(() => this.flushKey(key), this.debounceMs)
    );
  }

  /**
   * Force a flush of the pending save for `key`, if any.  Clears
   * the timer.  No-op when nothing is pending.
   */
  flushKey(key: string): void {
    const pending = this.pending.get(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    if (pending === undefined) return;
    this.pending.delete(key);
    this.writer(key, pending);
  }

  /**
   * Flush every pending save.  Called at hostDisconnected so a tab
   * close mid-typing doesn't lose the last <debounceMs of edits.
   */
  flushAll(): void {
    for (const key of [...this.pending.keys()]) {
      this.flushKey(key);
    }
  }

  /** Test/debug accessor: number of pending saves. */
  pendingCount(): number {
    return this.pending.size;
  }
}
