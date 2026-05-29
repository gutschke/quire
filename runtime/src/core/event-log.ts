/**
 * Append-only event log with vector-clock-based causal ordering.
 *
 * Each peer owns one EventLog instance.  Locally-authored events are added
 * via `append`; events received from other peers come in via `apply`.  The
 * log produces a deterministic causal-then-lexicographic total order on
 * `events()` so multiple peers can materialize identical state from the
 * same set of events.
 *
 * Vector clock semantics:
 *   - each event carries the author's seq plus everything the author had
 *     already seen at the moment of authorship.
 *   - `apply` merges the incoming clock element-wise max into the local
 *     clock so subsequent local appends correctly reference everything seen.
 *   - dedup is by event id (`peerId:seq`), which is deterministic.
 *
 * Total order:
 *   - primary sort: sum of vector-clock entries.  Happens-before implies
 *     strictly smaller sum, so the sort respects causality.
 *   - tiebreak (concurrent events): lexicographic on peerId, then seq.
 *     Deterministic across peers.
 */

export type PeerId = string;
export type EventKind = string;

export interface VectorClock {
  readonly [peerId: string]: number;
}

export interface QuireEvent {
  readonly id: string;
  readonly peerId: PeerId;
  readonly seq: number;
  readonly clock: VectorClock;
  readonly kind: EventKind;
  readonly payload: unknown;
  readonly ts: number;
}

export class EventLog {
  private readonly _events = new Map<string, QuireEvent>();
  private _clock: Record<string, number> = {};
  /**
   * Monotonic counter bumped on every successful mutation (append, or
   * a newly-applied apply).  Lets consumers memoize derived values
   * (e.g. `Peer.state()`'s materialize fold) and re-derive ONLY when
   * the log actually changed.  A duplicate / invalid `apply` does NOT
   * bump it — the log is unchanged, so a memo keyed on this stays valid.
   */
  private _revision = 0;

  constructor(public readonly peerId: PeerId) {}

  /** Current log revision; changes iff the event set changed. */
  revision(): number {
    return this._revision;
  }

  append(kind: EventKind, payload: unknown): QuireEvent {
    const seq = (this._clock[this.peerId] ?? 0) + 1;
    this._clock = { ...this._clock, [this.peerId]: seq };
    const event: QuireEvent = {
      id: `${this.peerId}:${seq}`,
      peerId: this.peerId,
      seq,
      clock: { ...this._clock },
      kind,
      payload,
      ts: Date.now()
    };
    this._events.set(event.id, event);
    this._revision++;
    return event;
  }

  apply(event: QuireEvent): boolean {
    if (!isValidEvent(event)) return false;
    if (this._events.has(event.id)) return false;
    this._events.set(event.id, event);
    const next = { ...this._clock };
    for (const [pid, n] of Object.entries(event.clock)) {
      next[pid] = Math.max(next[pid] ?? 0, n);
    }
    this._clock = next;
    this._revision++;
    return true;
  }

  events(): readonly QuireEvent[] {
    return Array.from(this._events.values()).sort(causalCompare);
  }

  snapshot(): VectorClock {
    return { ...this._clock };
  }

  since(clock: VectorClock): QuireEvent[] {
    return this.events().filter((ev) => (clock[ev.peerId] ?? 0) < ev.seq);
  }
}

/**
 * Cap on individual seq / clock-entry values.  A legitimate session
 * won't approach this (1e9 events would take years of continuous
 * append at one per millisecond), but it prevents a hostile peer from
 * sending `clock: { alice: 999_999_999 }` and permanently corrupting
 * alice's seq numbering.  Combined with the strict id/peerId/seq/
 * clock[peerId] cross-checks in isValidEvent, this is the EventLog's
 * defense in depth against vector-clock forgery — the higher-level
 * authentication (transport sender matches event.peerId) lives in
 * Peer.handleMessage.
 */
const SEQ_CAP = 1_000_000_000;
const ID_CAP = 256;

/**
 * Builtin Object property names that would either pollute the
 * prototype chain (`__proto__`) or shadow built-in methods when used
 * as a peerId / clock-entry key.  The local clock is a plain object
 * and downstream code calls Object.entries / Object.keys on it; a
 * peerId of "constructor" would silently corrupt iteration.
 */
const POISONOUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
]);

function isSafeId(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= ID_CAP &&
    !POISONOUS_KEYS.has(s)
  );
}

function isPositiveInteger(n: unknown, max: number): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n > 0 &&
    n <= max
  );
}

function isNonNegativeInteger(n: unknown, max: number): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 0 &&
    n <= max
  );
}

function isValidEvent(event: unknown): event is QuireEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  if (!isSafeId(e.peerId)) return false;
  if (!isPositiveInteger(e.seq, SEQ_CAP)) return false;
  if (typeof e.id !== 'string' || e.id !== `${e.peerId}:${e.seq}`) return false;
  if (e.id.length > ID_CAP + 12) return false; // peerId (256) + ':' + seq (10 digits)
  if (typeof e.kind !== 'string' || e.kind.length === 0 || e.kind.length > ID_CAP) {
    return false;
  }
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return false;
  if (
    !e.clock ||
    typeof e.clock !== 'object' ||
    Array.isArray(e.clock)
  ) {
    return false;
  }
  // Use own-enumerable keys to avoid catching inherited properties from
  // a polluted prototype (defense in depth — should never happen given
  // we reject events authored by poisonous peerIds, but cheap).
  const clock = e.clock as Record<string, unknown>;
  for (const pid of Object.keys(clock)) {
    if (!isSafeId(pid)) return false;
    if (!isNonNegativeInteger(clock[pid], SEQ_CAP)) return false;
  }
  // Author's own clock entry must equal their declared seq.  Anything
  // else implies a malformed or forged event.
  if (clock[e.peerId as string] !== e.seq) return false;
  return true;
}

function causalCompare(a: QuireEvent, b: QuireEvent): number {
  const sumA = sumOfClock(a.clock);
  const sumB = sumOfClock(b.clock);
  if (sumA !== sumB) return sumA - sumB;
  if (a.peerId !== b.peerId) return a.peerId < b.peerId ? -1 : 1;
  return a.seq - b.seq;
}

function sumOfClock(clock: VectorClock): number {
  let n = 0;
  for (const v of Object.values(clock)) n += v;
  return n;
}

export type ClockRelation = 'before' | 'after' | 'equal' | 'concurrent';

export function compareClocks(a: VectorClock, b: VectorClock): ClockRelation {
  const peers = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aSmaller = false;
  let bSmaller = false;
  for (const p of peers) {
    const av = a[p] ?? 0;
    const bv = b[p] ?? 0;
    if (av < bv) aSmaller = true;
    if (bv < av) bSmaller = true;
  }
  if (aSmaller && bSmaller) return 'concurrent';
  if (aSmaller) return 'before';
  if (bSmaller) return 'after';
  return 'equal';
}
