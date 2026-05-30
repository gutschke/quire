/**
 * Run #19 (2026-05-30) — UX-MH-1 player-name-beside-PC-name helper.
 *
 * Resolves a PC's controlling peer's display name on demand.  The
 * binding chain is:
 *   pcId → pcSlots[*].pcId === pcId → seat.controllerPeerId →
 *     peers[controllerPeerId].name
 *
 * Per Adversarial P1 MH-1-B: ALWAYS resolve through LIVE state at
 * render time.  Never cache a player-name with a snapshot of the
 * binding — when a seat rebinds to a new player, the OLD player's
 * name would otherwise persist on every surface that captured it
 * at ratify-time (a silent prior-player-identity disclosure).
 *
 * Returns `null` when:
 *   - no seat is bound to the pcId
 *   - the seat has no controllerPeerId (unbound or revoked)
 *   - the peer has no display name yet (peer-join with no `name`)
 *
 * The caller MUST tolerate `null` and render a sensible fallback
 * (typically: omit the player-name line, OR show "Open seat" when
 * the seat is unbound).
 */

import type { PeerPresence } from '../core/state';

export interface PlayerNameLookupSeat {
  pcId?: string;
  controllerPeerId?: string;
}

export type PlayerNameLookup = (pcId: string) => string | null;

/**
 * Build a player-name lookup over a snapshot of pcSlots + peers.
 *
 * The returned function is CHEAP — does a single seat lookup +
 * peer lookup per call.  The host wires this into each render so
 * the lookup always reflects the latest projected state (per
 * Adversarial P1 MH-1-B live-resolution requirement).
 */
export function buildPlayerNameLookup(
  pcSlots: Record<number, PlayerNameLookupSeat>,
  peers: Record<string, PeerPresence>
): PlayerNameLookup {
  return (pcId: string): string | null => {
    if (!pcId) return null;
    for (const seat of Object.values(pcSlots)) {
      if (seat.pcId === pcId) {
        const peerId = seat.controllerPeerId;
        if (!peerId) return null;
        const peer = peers[peerId];
        if (!peer) return null;
        return peer.name ?? null;
      }
    }
    return null;
  };
}
