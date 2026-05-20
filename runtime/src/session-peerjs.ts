/**
 * Browser-only TransportFactory backed by PeerJS.
 *
 * peerjs itself is lazy-imported inside the factory methods so that test
 * environments (vitest happy-dom) don't pay the cost of loading peerjs +
 * webrtc-adapter until the user actually starts a session.  Unit tests
 * that touch this file should mock createPeerjsFactory or use the in-
 * memory factory in session-controller.test.ts.
 *
 * Pairing codes: 8-character base32, ~40 bits of entropy.  Confusable
 * characters (0/O, 1/I/L) are omitted.  We pass the code as the PeerJS
 * peer id; the broker accepts custom ids, and using the code directly
 * removes a layer of indirection.  If the broker rejects the id as
 * already taken (very unlikely at this entropy and traffic level), the
 * caller gets a rejected promise and can retry.
 */

import { PeerJSTransport } from './core/transports/peerjs';
import type { PeerJsPeerLike } from './core/transports/peerjs';
import type { TransportFactory } from './session-controller';

const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePairingCode(length = 8): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += PAIRING_ALPHABET[Math.floor(Math.random() * PAIRING_ALPHABET.length)];
  }
  return s;
}

interface PeerJsRuntime {
  default: new (
    id?: string,
    options?: Record<string, unknown>
  ) => PeerJsPeerLike & {
    open: boolean;
    off(event: string, handler: (...args: unknown[]) => void): void;
  };
}

let cachedPeerJs: PeerJsRuntime | null = null;
async function loadPeerJs(): Promise<PeerJsRuntime> {
  if (cachedPeerJs) return cachedPeerJs;
  cachedPeerJs = (await import('peerjs')) as unknown as PeerJsRuntime;
  return cachedPeerJs;
}

function waitForOpen(
  peer: PeerJsPeerLike & { open: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (peer.open) return resolve();
    let settled = false;
    const onOpen = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

export function createPeerjsFactory(): TransportFactory {
  return {
    async createHost() {
      const PeerJs = await loadPeerJs();
      const code = generatePairingCode();
      const peer = new PeerJs.default(code, {
        debug: 1
      });
      await waitForOpen(peer);
      const transport = new PeerJSTransport({ peer });
      return { transport, pairingCode: code };
    },
    async createGuest(code: string) {
      const PeerJs = await loadPeerJs();
      const peer = new PeerJs.default(undefined, {
        debug: 1
      });
      await waitForOpen(peer);
      const transport = new PeerJSTransport({
        peer,
        knownPeers: [code]
      });
      return { transport };
    }
  };
}
