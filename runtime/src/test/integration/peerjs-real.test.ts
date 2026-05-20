// @vitest-environment node
/**
 * PeerJS real-network smoke tests.
 *
 * What works in Node:
 *   - Booting an in-process peerjs-server.  Pure Node; no WebRTC needed
 *     for the broker itself.  We test this.
 *
 * What does NOT work in Node:
 *   - Importing the peerjs *client* library.  peerjs bundles webrtc-adapter
 *     which probes `EventTarget.prototype` and `RTCPeerConnection.prototype`
 *     for property descriptors that match a browser's shape.  Even with
 *     @roamhq/wrtc polyfilling the WebRTC globals, the adapter throws at
 *     module-load time because Node's EventTarget and the wrtc prototypes
 *     don't expose the same descriptors browsers do.
 *
 * What's tested elsewhere:
 *   - The PeerJSTransport adapter logic — see `core/transports/peerjs.test.ts`,
 *     which exercises every code path with a mock peerjs Peer that satisfies
 *     PeerJsPeerLike structurally.
 *   - End-to-end browser validation (real peerjs + real WebRTC + real
 *     broker) belongs in a Playwright suite; not in this commit.
 *
 * The broker test below is the meaningful Node-side validation: it proves
 * we can host the signaling service for our pairing-code workflow without
 * external infrastructure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PeerServer } from 'peerjs-server';

interface BrokerHandle {
  port: number;
  close(): Promise<void>;
}

// peerjs-server defaults port to 80 if you don't specify; port:0 isn't
// honored.  Pick a high random port and retry on conflict.
function pickPort(): number {
  return 19000 + Math.floor(Math.random() * 1000);
}

async function startBroker(): Promise<BrokerHandle> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = pickPort();
    try {
      const handle = await tryStartBroker(port);
      return handle;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to start broker: ${String(lastErr)}`);
}

function tryStartBroker(port: number): Promise<BrokerHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handle: BrokerHandle): void => {
      if (settled) return;
      settled = true;
      resolve(handle);
    };
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const server = PeerServer({ port, path: '/quire-test' }, (running) => {
      const address = running.address();
      if (!address || typeof address === 'string') {
        fail(new Error('Could not determine broker port'));
        return;
      }
      finish({
        port: address.port,
        close: () =>
          new Promise<void>((res, rej) => {
            running.close((err) => (err ? rej(err) : res()));
          })
      });
    });
    server.on('error', fail);
  });
}

describe('PeerJS broker — Node-hosted signaling', () => {
  let broker: BrokerHandle;

  beforeAll(async () => {
    broker = await startBroker();
  }, 10000);

  afterAll(async () => {
    if (broker) await broker.close();
  });

  it('boots on a non-fixed port', () => {
    expect(broker.port).toBeGreaterThan(0);
  });

  it('listens on the chosen port', async () => {
    // peerjs-server speaks only WebSocket (no public HTTP endpoints).
    // Verify the TCP layer is accepting connections by sending a HEAD
    // request to the root — any response, even 404, proves the broker
    // is up.  The signaling itself is exercised by client tests
    // (Playwright suite, future).
    const resp = await fetch(`http://127.0.0.1:${broker.port}/`, {
      method: 'HEAD'
    });
    expect(resp.status).toBeGreaterThan(0); // any response is a pass
  });
});

// Full end-to-end peerjs-client tests are skipped in Node and live in a
// Playwright suite (TBD).  The skip-block below documents the intended
// scenarios so they can be ported to Playwright when the e2e layer lands.
describe.skip('PeerJS clients (browser-only — Playwright TBD)', () => {
  it('two clients connect and exchange a data-channel message', () => {
    // 1. Spin up the broker (as in the test above).
    // 2. Open two browser contexts, navigate each to play.quire.games.
    // 3. In each context, instantiate a peerjs.Peer pointing at the broker.
    // 4. From peer A, connect to peer B's id; send a message; assert receipt.
    // 5. Tear down browsers and broker.
    expect.fail(
      'Real-PeerJS-client integration requires browsers; see test header.'
    );
  });

  it('a client reconnects after the broker bounces', () => {
    // Bounce the broker mid-session; verify clients reconnect and resume.
    expect.fail('See test header.');
  });
});
