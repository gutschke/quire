import { unlinkSync, existsSync } from 'node:fs';
import { TMP_HANDLE_FILE } from './global-setup';

interface BrokerHandle {
  close: () => Promise<void>;
}

export default async function globalTeardown(): Promise<void> {
  const broker = (globalThis as unknown as {
    __quireBroker?: BrokerHandle;
  }).__quireBroker;
  if (broker) {
    try {
      await broker.close();
    } catch {
      /* ignore */
    }
  }
  if (existsSync(TMP_HANDLE_FILE)) {
    try {
      unlinkSync(TMP_HANDLE_FILE);
    } catch {
      /* ignore */
    }
  }
}
