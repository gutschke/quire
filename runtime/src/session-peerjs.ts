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

/**
 * Optional broker config.  When omitted, the factory uses PeerJS's
 * default cloud broker (0.peerjs.com).  Tests and self-hosted
 * deployments pass an explicit host/port/path to point at their own
 * peerjs-server.
 */
export interface PeerjsBrokerConfig {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  debug?: number;
}

export function createPeerjsFactory(
  broker?: PeerjsBrokerConfig
): TransportFactory {
  const options = (): Record<string, unknown> => {
    const o: Record<string, unknown> = { debug: broker?.debug ?? 1 };
    if (broker?.host !== undefined) o.host = broker.host;
    if (broker?.port !== undefined) o.port = broker.port;
    if (broker?.path !== undefined) o.path = broker.path;
    if (broker?.secure !== undefined) o.secure = broker.secure;
    return o;
  };
  return {
    async createHost() {
      const PeerJs = await loadPeerJs();
      const code = generatePairingCode();
      const peer = new PeerJs.default(code, options());
      await waitForOpen(peer);
      const transport = new PeerJSTransport({ peer });
      return { transport, pairingCode: code };
    },
    async createGuest(code: string) {
      const PeerJs = await loadPeerJs();
      const peer = new PeerJs.default(undefined, options());
      await waitForOpen(peer);
      const transport = new PeerJSTransport({
        peer,
        knownPeers: [code]
      });
      return { transport };
    }
  };
}

/**
 * Read broker overrides from URL params, or fall back to the cloud
 * default.  Supported params:
 *
 *   peerHost   - e.g. 127.0.0.1
 *   peerPort   - e.g. 9000
 *   peerPath   - e.g. /
 *   peerSecure - "1" to force wss
 *
 * Used so end-to-end test suites (Playwright) can point the app at
 * an in-process peerjs-server without rebuilding the bundle, and so
 * a self-hosting user can point at their own broker without code
 * changes.
 */
export function createPeerjsFactoryFromUrl(): TransportFactory {
  if (typeof window === 'undefined') return createPeerjsFactory();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return createPeerjsFactory();
  }
  const host = params.get('peerHost');
  const portRaw = params.get('peerPort');
  const path = params.get('peerPath');
  const secureRaw = params.get('peerSecure');
  if (host === null && portRaw === null && path === null && secureRaw === null) {
    return createPeerjsFactory();
  }
  const port = portRaw ? Number(portRaw) : undefined;
  return createPeerjsFactory({
    host: host ?? undefined,
    port: Number.isFinite(port) ? port : undefined,
    path: path ?? undefined,
    secure: secureRaw === '1' ? true : secureRaw === '0' ? false : undefined
  });
}
