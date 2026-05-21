/**
 * Playwright global setup.  Boots an in-process peerjs-server broker
 * and exports the chosen port via a file (so global-teardown can shut
 * it down) and via the QUIRE_PEER_PORT env var (so specs can build
 * URLs pointing at it).
 *
 * Reuses the pickPort / tryStartBroker pattern from the Node-side
 * broker smoke test (src/test/integration/peerjs-real.test.ts).
 */

import { PeerServer } from 'peer';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface BrokerHandle {
  port: number;
  close: () => Promise<void>;
}

const TMP_HANDLE_FILE = path.join(tmpdir(), 'quire-e2e-broker-port.json');

function pickPort(): number {
  return 19000 + Math.floor(Math.random() * 1000);
}

async function startBroker(): Promise<BrokerHandle> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = pickPort();
    try {
      return await tryStartBroker(port);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to start broker: ${String(lastErr)}`);
}

function tryStartBroker(port: number): Promise<BrokerHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (h: BrokerHandle): void => {
      if (settled) return;
      settled = true;
      resolve(h);
    };
    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const server = PeerServer(
      {
        port,
        path: '/quire-e2e',
        allow_discovery: true,
        corsOptions: { origin: '*' }
      },
      (running) => {
        const addr = running.address();
        if (!addr || typeof addr === 'string') {
          fail(new Error('Could not determine broker port'));
          return;
        }
        finish({
          port: addr.port,
          close: () =>
            new Promise<void>((res, rej) => {
              running.close((err) => (err ? rej(err) : res()));
            })
        });
      }
    );
    server.on('error', fail);
  });
}

export default async function globalSetup(): Promise<void> {
  const broker = await startBroker();
  process.env.QUIRE_PEER_PORT = String(broker.port);
  writeFileSync(TMP_HANDLE_FILE, JSON.stringify({ port: broker.port }));
  // Stash the close fn on globalThis so teardown can call it without
  // re-importing peerjs-server (which can't easily re-bind to a port
  // it doesn't own).
  (globalThis as unknown as { __quireBroker: BrokerHandle }).__quireBroker =
    broker;
  // eslint-disable-next-line no-console
  console.log(`[quire-e2e] broker listening on port ${broker.port}`);
}

export { TMP_HANDLE_FILE };
