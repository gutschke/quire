# core/

DOM-free multiplayer infrastructure for the Quire runtime. The modules here can be unit-tested in plain Node (vitest + happy-dom only because some other tests need a DOM; these don't).

## Layers

```
                            ┌─────────────────┐
                            │   quire-app     │   Lit component
                            └────────┬────────┘
                                     │
                            ┌────────▼────────┐
                            │      Peer       │   orchestration
                            └────────┬────────┘
                                     │
                ┌────────────────────┼─────────────────────┐
                │                    │                     │
        ┌───────▼──────┐    ┌────────▼───────┐    ┌────────▼───────┐
        │   EventLog   │    │     state.ts   │    │   Transport    │
        │ vector clock │    │  materialize() │    │   interface    │
        └──────────────┘    └────────────────┘    └────────┬───────┘
                                                            │
                                              ┌─────────────┼──────────────┐
                                              │             │              │
                                     ┌────────▼──────┐  ┌───▼────┐  ┌──────▼────┐
                                     │   InMemory    │  │ PeerJS │  │  future   │
                                     │  (for tests)  │  │        │  │           │
                                     └───────────────┘  └────────┘  └───────────┘
```

## Modules

### `event-log.ts`

Append-only event log with vector-clock causal ordering. Each peer owns one instance. Two operations: `append(kind, payload)` for local events, `apply(event)` for remote events. `events()` returns the full log in deterministic causal order so multiple peers materialize identical state.

Vector clock arithmetic is element-wise max on merge; total order is sum-of-clock then peerId then seq, which respects happens-before and breaks concurrent-event ties deterministically.

### `state.ts`

`materialize(events) → SessionState` — pure reducer over the event log. The reducer handles these event kinds out of the box:

- `peer-join` / `peer-leave` — presence
- `coordinator-claim` / `coordinator-yield` — single-coordinator role (first claim wins; yield only from current coordinator)
- `scene-reveal` — coordinator-only; ignored from non-coordinators
- `dice-roll` — append to history
- `chat` — append to history
- `pc-edit` — last-writer-wins per (pcId, field), where "last" is causal order
- `note` — append to history

Unknown event kinds are silently ignored so new kinds can be added without breaking older clients.

### `transport.ts`

Interface for the network medium. Implementations:

- `transports/in-memory.ts` — process-local routing for tests. Supports partition, latency, drop rate. Two classes: `InMemoryNetwork` (the bus) and `InMemoryTransport` (per-peer endpoint).
- `transports/peerjs.ts` — PeerJS data-channel adapter (TODO: pending real-network integration).

### `peer.ts`

Orchestrator combining EventLog + Transport. Implements a flood-replication gossip protocol:

1. Local `append` broadcasts a `share` message to all connected peers.
2. On a new peer connecting, send a `sync-request` with the local vector clock.
3. On receiving a `sync-request`, respond with `events.since(clock)`.
4. On receiving a `share` or `sync-response`, apply events to the local log.

The protocol is simple and correct. Optimization (gossip suppression, snapshot transfer) is a follow-up if real sessions grow large.

## Test harness

`runtime/src/test/harness/simulator.ts` wraps the above into a multi-peer scenario runner. Tests in `runtime/src/test/integration/*.test.ts` exercise full sessions: DM + four players, partition mid-session, concurrent edits, chaos with interleaved partitions.

All 174 tests run in under 2 seconds on a single core. The in-memory simulation is deterministic; same scenario produces same outcome every run.

## What's not here yet

- **PeerJS adapter** for real-network testing. Pending a follow-up commit that adds `transports/peerjs.ts` plus a Node test harness that spins up `peerjs-server` and runs two clients against it. The application code does not need to change for this — only the transport.
- **AI broker** — the AI-prompt-bar's communication channel is not in `core/` yet. It will be a separate module (`ai/broker.ts` or similar) that produces events the rest of the system already understands (`ai-suggestion`, `ai-edit-proposed`, etc.).
- **Persistence** — IndexedDB durability for the event log. Currently in-memory only. The `EventLog` interface is compatible with a future `IndexedDBEventLog` that loads on construction and writes on each append/apply.
- **Encryption** — DM-only events with `quire encrypt-dm`-style encryption. The event log doesn't need to know about encryption; it goes in the payload layer.

## Determinism

Tests rely on the in-memory transport being deterministic when `latencyMs === 0` and `dropRate === 0` (the defaults). Network conditions are configurable per scenario; tests that use them are explicit about it.
