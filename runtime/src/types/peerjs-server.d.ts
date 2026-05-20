// Minimal type declarations for `peerjs-server` (which ships JS only).
// We use just enough of its surface to host a broker in tests.

declare module 'peerjs-server' {
  import type { Server } from 'node:http';

  export interface PeerServerOptions {
    port?: number;
    path?: string;
    key?: string;
    allow_discovery?: boolean;
  }

  export function PeerServer(
    options: PeerServerOptions,
    callback?: (server: Server) => void
  ): Server & { on(event: 'error', handler: (err: Error) => void): void };
}
