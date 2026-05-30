# Mock Campaign 07 — Network partition

## Scenario brief

The Quire transport assumes "civilized peers, occasionally flaky
network."  Real WebRTC sessions drop peers all the time — Wi-Fi
flaps, a phone backgrounds, a tunnel times out.  CRDT semantics
say: when partitioned peers reconnect, the merge converges and
the firewall holds.  This simulation drives that contract through
four partition shapes.

What we exercise:

1. **Two-peer partition.**  Peer-A goes offline for N events
   while peer-B (the coord DM) continues to author.  Peer-A
   comes back; merge is deterministic and the firewall holds.
   Both peers end at byte-identical state.
2. **Three-peer partition (asymmetric).**  Peer-A + peer-B
   (player + DM) in one partition, peer-C (a second player) in
   another.  Both groups write (DM in one, the lone player has
   no coord so writes are nearly entirely peer-join chatter +
   chat).  Merge after partition heals; all three peers
   converge.
3. **Coordinator partition + player partial log.**  Coord goes
   offline mid-session.  A player retains the partial log on
   their tab.  Coord comes back.  Coord's DM-only events
   authored before the partition do NOT leak from the player's
   partial log when other players reconnect via sync-response
   — OP-039 firewall holds across the partition seam.
4. **Save during partition.**  A peer saves while in a minority
   partition; the save reflects only the peer's local view; on
   restore + reconnect, the merge converges via the standard
   sync path.

## Driving approach

Code-level simulation using `InMemoryNetwork.setPartition` for
single-peer isolation and a second `InMemoryNetwork` instance for
multi-peer "side" partitions (peers join the second network +
unregister from the first).  Sync convergence runs through the
existing `share` / `sync-request` / `sync-response` protocol.

## Per-turn script

### 1. Two-peer partition
- Set up DM + player.  Coord-claim.  Bind PCs.  DM authors a
  baseline scene.
- Partition the player.  DM authors 5 more events.
- Heal the partition.  Player and DM exchange sync messages.
- Assert: both peers' event logs are byte-identical (via
  stringifySave); both peers' materialized states are
  byte-identical.

### 2. Three-peer partition
- Set up DM (peer-A) + 2 players (peer-B, peer-C).  Coord-claim.
- Partition peer-C alone.  In the AB partition, DM authors a
  scene + chat; peer-B authors chat.  In the C partition, peer-C
  authors chat (only — no coord means no scene/state authority).
- Heal.  Assert: all three peers converge.  Firewall holds for
  every viewer.

### 3. Coordinator partition + DM-only events
- Set up DM + 2 players.  Coord-claim.  DM appends a scratch-
  note (DM-only event kind).
- Partition the DM.  Players continue chatting.
- Player-A (kept connected) holds the partial event log
  including the scratch-note (which their RAW log carries until
  the firewall kicks in).
- Heal DM.  Verify: player-B re-syncs from player-A via
  sync-response.  The scratch-note is dropped (OP-039
  defaultSyncResponseFilter strips PLAYER_SCOPE_STRIP_KINDS).

### 4. Save during partition
- Set up DM + player.  DM authors baseline.  Partition player.
- DM autosaves while in the majority partition.  Player
  autosaves while alone.
- Verify: both saves contain ONLY the events each peer saw.
  Restore each; the materialized state matches the peer's view
  at save time.  Re-network the two peers; sync converges.

## Findings

To be filled in as the simulation runs.  Findings are tagged:

- **FIXED** inline (1-line obvious fix) — link the commit.
- **FILED** as a new OP in `open-problems.md`.
- **ACCEPTED** as a documented limitation.
