/**
 * End-to-end multiplayer test: two real browsers (Chromium contexts)
 * talking through real WebRTC via an in-process peerjs-server broker.
 *
 * Validates the layer unit tests can't exercise — actual peerjs client,
 * actual WebRTC stack, actual broker handshake.  Unit tests use a
 * structural mock for peerjs.Peer (see src/core/transports/peerjs.test.ts)
 * because peerjs's webrtc-adapter can't load under Node.
 */

import { test, expect } from '@playwright/test';
import {
  openApp,
  hostSession,
  joinSession,
  sendChat,
  chatList,
  expectPeerCount
} from './helpers';

test.describe('Quire multiplayer e2e — chat round trip', () => {
  test('host + guest connect through the real broker and exchange chat', async ({
    browser
  }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    try {
      const hostPage = await openApp(hostContext);
      const guestPage = await openApp(guestContext);

      const code = await hostSession(hostPage, 'DM');
      expect(code).toMatch(/^[A-Z2-9]+$/);

      await joinSession(guestPage, code, 'Player');

      await expectPeerCount(hostPage, 1);
      await expectPeerCount(guestPage, 1);

      await sendChat(hostPage, 'hello from the DM');
      await expect(chatList(hostPage)).toContainText('hello from the DM', {
        timeout: 10000
      });
      await expect(chatList(guestPage)).toContainText('hello from the DM', {
        timeout: 10000
      });

      await sendChat(guestPage, 'hello back from the player');
      await expect(chatList(hostPage)).toContainText(
        'hello back from the player',
        { timeout: 10000 }
      );
      await expect(chatList(guestPage)).toContainText(
        'hello back from the player',
        { timeout: 10000 }
      );
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
